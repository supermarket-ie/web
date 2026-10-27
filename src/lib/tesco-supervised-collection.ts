import { createHash, randomUUID } from 'node:crypto';
import {
  fetchTescoCollectedPage, isTescoCollectionUrl, parseTescoCollectedPage,
  tescoPauseUntil, tescoResourceUnavailable, validateTescoCollectedIdentity,
  type TescoCollectedPage, type TescoPageResponse,
} from './tesco-direct-collection-core';
import { acquisitionDecision, acquisitionSnapshotSql, selectAcquisitionCandidates, type Acquisition } from './tesco-acquisition-handoff';
import { classifyIdentityOutcome, holdCircuitTripped, quarantineCircuitTripped } from './tesco-identity-disposition';
import { hasMaterialDuplicateCanonicalConflict } from './tesco-mapping-audit';

// Operator-only runner. No route, scheduler, migration or automatic retries.
// Each execute call is one database request. Every mutating DO block is atomic,
// so the existing authenticated SQL connector can remain the database transport.
export type ExecuteSql = (sql: string) => Promise<Record<string, unknown>[]>;
export type CollectionMode = 'renewal' | 'expansion';
export const SUPERVISED_GATE = 'workspace-supervised-20260929';
const PROTOCOL = 'tesco-supervised-v1';
type Mapping = {
  id: string; product_id: string; canonical_name: string; canonical_brand: string | null;
  store_product_name: string; store_brand: string | null; is_own_brand: boolean;
  store_sku: string; store_url: string; url_status: string;
};
export type Candidate = Mapping & {
  observed_at: string | null; price: number | null; due: boolean; held: boolean;
  proven: boolean; overlap: number; peers: Mapping[]; acquisition?: Acquisition;
};
type RunState = {
  protocol: string; mode: CollectionMode; selected: Candidate[];
  activeSupervisor: string | null; stopReason?: string; complete?: boolean;
  // Hold circuit-breaker counters. Persisted so interruption/resume cannot reset
  // or bypass the breaker. consecutiveHolds resets on an acceptance; totalHolds
  // and attempts are cumulative over the whole run (across resumes).
  consecutiveHolds?: number; totalHolds?: number; attempts?: number;
  // SEPARATE quarantine counters (isolated product-level canonical-identity
  // quarantines), counted independently of ordinary holds and persisted the same
  // way. consecutiveQuarantines resets on an acceptance; totalQuarantines cumulative.
  consecutiveQuarantines?: number; totalQuarantines?: number;
};
export type Options = { mode: CollectionMode; limit?: number; resume?: string; dryRun?: boolean; acquisitionPages?: string[]; excludeSharedSku?: boolean };
export type Dependencies = {
  execute: ExecuteSql;
  fetchPage?: (url: string) => Promise<TescoPageResponse>;
  sleep?: (ms: number) => Promise<void>;
  progress?: (value: Record<string, unknown>) => void;
};

// E-strings escape both backslashes and quotes; retailer text never becomes SQL.
function literal(value: unknown): string {
  if (value == null) return 'null';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (text.includes('\0')) throw new Error('Invalid database text');
  return "E'" + text.replaceAll('\\', '\\\\').replaceAll("'", "''").replaceAll('$', '\\044') + "'";
}
function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid run ID');
  return literal(value);
}
const mappingFields = `s.id,s.product_id,p.canonical_name,p.brand canonical_brand,
  s.store_product_name,s.brand store_brand,s.is_own_brand,s.store_sku,s.store_url,s.url_status`;
function snapshot(sku: string): string {
  return `(select jsonb_agg(to_jsonb(m) order by m.id) from
    (select ${mappingFields} from store_products s join products p on p.id=s.product_id
     where s.store='tesco' and s.store_sku=${literal(sku)}) m)`;
}
function assertSnapshot(target: Candidate): string {
  return `if ${snapshot(target.store_sku)} is distinct from ${literal(target.peers)}::jsonb
    then raise exception 'mapping_changed'; end if;`;
}
function assertAcquisition(target: Candidate, runId: string) {
  return target.acquisition ? `if ${acquisitionSnapshotSql(target.acquisition.pageId, runId)}
    is distinct from ${literal(target.acquisition.snapshot)}::jsonb then raise exception 'acquisition_or_peer_changed'; end if;` : '';
}
function duePredicate(target: Candidate, mode: CollectionMode): string {
  return mode === 'renewal'
    ? `exists(select 1 from latest_prices where store_product_id=${uuid(target.id)}
        and observed_at=${literal(target.observed_at)}::timestamptz and observed_at<=now()-interval '4 days')`
    : `not exists(select 1 from latest_prices where store_product_id=${uuid(target.id)})`;
}
function owned(runId: string, owner: string, paused = false): string {
  // Always lock in gate -> run order. Old owners cannot checkpoint or release a
  // successor's lease after expiry, even when the successor resumes the same run.
  return `perform 1 from tesco_egress_pool where egress_key=${literal(SUPERVISED_GATE)} for update;
    perform 1 from scrape_runs where id=${uuid(runId)} for update;
    if not exists(select 1 from tesco_egress_pool where egress_key=${literal(SUPERVISED_GATE)}
      and ${paused ? 'leased_until is null and cooldown_until>now()' : 'leased_until>now() and coalesce(cooldown_until,now())<=now()'})
      or not exists(select 1 from scrape_runs where id=${uuid(runId)}
      and error_summary::jsonb->>'activeSupervisor'=${literal(owner)})
    then raise exception 'ownership_or_gate_lost'; end if;`;
}

export async function selectSupervisedCandidates(
  execute: ExecuteSql,
  mode: CollectionMode,
  limit: number,
  options: { excludeSharedSku?: boolean } = {},
): Promise<Candidate[]> {
  if (!['renewal', 'expansion'].includes(mode) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid selection');
  // Pre-selection exclusion of shared-SKU canonical groups. When on, any product
  // whose Tesco SKU is mapped by more than one canonical product (incl. genuine
  // synonyms) is conservatively deferred. Applied in the `eligible` CTE — BEFORE
  // the limit — so batches fill with non-shared candidates. The runtime
  // duplicate-canonical hard stop remains an independent safeguard.
  const sharedSkuExclusion = options.excludeSharedSku
    ? `and (select count(*) from mappings m2 where m2.store_sku=c.store_sku)<=1`
    : '';
  const rows = await execute(`with mappings as (select ${mappingFields} from store_products s join products p on p.id=s.product_id
    where s.store='tesco'), candidates as (select s.*,l.observed_at,l.price,
    (l.observed_at<=now()-interval '4 days') due,
    exists(select 1 from scrape_product_receipts r where r.store_product_id=s.id and r.outcome='success') proven,
    (select count(distinct peer.store) from latest_prices peer where peer.canonical_product_id=s.product_id
      and peer.store in ('supervalu','dunnes')) overlap,
    exists(select 1 from tesco_direct_collection_pages d where d.requested_url=s.store_url and
      (d.outcome='pending' or d.created_at>now()-interval '24 hours'
       or (d.created_at>=coalesce(l.observed_at,'-infinity'::timestamptz) and
         (d.outcome<>'ok' or exists(select 1 from jsonb_array_elements(d.identity_results) i
          where i->>'storeProductId'=s.id::text and jsonb_array_length(i->'reasons')>0))))) held
    from mappings s left join latest_prices l on l.store_product_id=s.id),
    eligible as (select c.*,(select jsonb_agg(to_jsonb(m) order by m.id) from mappings m where m.store_sku=c.store_sku) peers
      from candidates c where url_status='resolved' and proven and not held
        and store_url='https://www.tesco.ie/shop/en-IE/products/'||store_sku
        and ${mode === 'renewal' ? 'due' : 'observed_at is null'}
        ${sharedSkuExclusion}),
    -- One row per requested URL: two canonical mappings can share a SKU/URL
    -- (incl. equivalent synonyms). Collapsing to a single representative here —
    -- BEFORE the limit — guarantees a batch never contains the same URL twice,
    -- so it cannot cause a second request or an attempt_already_recorded
    -- interruption. The representative is the lowest id; peers retain the full
    -- same-SKU group for the runtime duplicate-canonical safeguard.
    url_unique as (select e.*, row_number() over (partition by e.store_url order by e.id) rn from eligible e)
    select u.* from url_unique u where u.rn=1
    order by ${mode === 'renewal' ? 'u.observed_at asc' : 'u.overlap desc'},u.id limit ${limit}`);
  const candidates = (rows as unknown as (Candidate & { rn?: number })[])
    .map((m) => { const copy = { ...m }; delete copy.rn; return copy as Candidate; })
    .filter(m => m.url_status === 'resolved' && !m.held && m.proven
      && isTescoCollectionUrl(m.store_url) && m.store_url === `https://www.tesco.ie/shop/en-IE/products/${m.store_sku}`
      && (mode === 'renewal' ? m.due === true : !m.observed_at)
      // Belt-and-braces for the exclusion: never return a shared-SKU product when
      // excludeSharedSku is set, even if the SQL predicate ever regressed.
      && (!options.excludeSharedSku || (Array.isArray(m.peers) ? m.peers.length <= 1 : true)));
  // Belt-and-braces: guarantee URL uniqueness in the returned batch even if the
  // SQL dedup ever regressed. Keeps the first (ordering-preferred) per URL.
  const seenUrls = new Set<string>();
  return candidates.filter(m => {
    if (seenUrls.has(m.store_url)) return false;
    seenUrls.add(m.store_url);
    return true;
  });
}

/**
 * Read-only enumeration of the shared-SKU canonical groups that the bulk
 * recovery conservatively DEFERS (excludeSharedSku). One entry per shared SKU,
 * listing the SKU, the member canonical mappings and a reason. Does NOT touch
 * mappings, holds or observations — purely for the campaign exception report.
 */
export type DeferredSharedSkuGroup = {
  store_sku: string;
  member_count: number;
  canonical_names: string[];
  store_product_ids: string[];
  reason: string;
};
export async function listExcludedSharedSkuGroups(execute: ExecuteSql, mode: CollectionMode): Promise<DeferredSharedSkuGroup[]> {
  const rows = await execute(`with mappings as (select ${mappingFields} from store_products s join products p on p.id=s.product_id
    where s.store='tesco'), candidates as (select s.*,l.observed_at,
    exists(select 1 from scrape_product_receipts r where r.store_product_id=s.id and r.outcome='success') proven
    from mappings s left join latest_prices l on l.store_product_id=s.id),
    eligible as (select c.* from candidates c where url_status='resolved' and proven
      and store_url='https://www.tesco.ie/shop/en-IE/products/'||store_sku
      and ${mode === 'renewal' ? '(observed_at<=now()-interval \'4 days\')' : 'observed_at is null'})
    select e.store_sku, count(*) member_count,
      jsonb_agg(e.canonical_name order by e.id) canonical_names,
      jsonb_agg(e.id order by e.id) store_product_ids
    from eligible e group by e.store_sku having count(*)>1
    order by e.store_sku`);
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    store_sku: String(r.store_sku),
    member_count: Number(r.member_count),
    canonical_names: (r.canonical_names as string[]) ?? [],
    store_product_ids: ((r.store_product_ids as string[]) ?? []).map(String),
    reason: 'shared_sku_canonical_group_deferred',
  }));
}

/**
 * ACTUAL count of eligible candidates (not capped at a batch limit), applying
 * the same gates as selectSupervisedCandidates including optional shared-SKU
 * exclusion and per-URL uniqueness. Read-only; for the campaign report's true
 * "remaining eligible" figure.
 */
export async function countEligibleCandidates(
  execute: ExecuteSql,
  mode: CollectionMode,
  options: { excludeSharedSku?: boolean } = {},
): Promise<number> {
  const sharedSkuExclusion = options.excludeSharedSku
    ? `and (select count(*) from mappings m2 where m2.store_sku=c.store_sku)<=1`
    : '';
  const [row] = await execute(`with mappings as (select ${mappingFields} from store_products s join products p on p.id=s.product_id
    where s.store='tesco'), candidates as (select s.*,l.observed_at,
    exists(select 1 from scrape_product_receipts r where r.store_product_id=s.id and r.outcome='success') proven,
    exists(select 1 from tesco_direct_collection_pages d where d.requested_url=s.store_url and
      (d.outcome='pending' or d.created_at>now()-interval '24 hours'
       or (d.created_at>=coalesce(l.observed_at,'-infinity'::timestamptz) and
         (d.outcome<>'ok' or exists(select 1 from jsonb_array_elements(d.identity_results) i
          where i->>'storeProductId'=s.id::text and jsonb_array_length(i->'reasons')>0))))) held
    from mappings s left join latest_prices l on l.store_product_id=s.id),
    eligible as (select c.* from candidates c where url_status='resolved' and proven and not held
      and store_url='https://www.tesco.ie/shop/en-IE/products/'||store_sku
      and ${mode === 'renewal' ? "(observed_at<=now()-interval '4 days')" : 'observed_at is null'}
      ${sharedSkuExclusion})
    select count(distinct store_url)::int n from eligible`);
  return Number((row as Record<string, unknown>)?.n ?? 0);
}

export async function reconcileSupervisedRun(execute: ExecuteSql, runId: string) {
  const [row] = await execute(`select r.id,r.status,r.error_summary::jsonb summary,
    (select count(*) from tesco_direct_collection_pages where run_id=r.id) reserved,
    (select count(*) from tesco_direct_collection_pages where run_id=r.id and outcome<>'pending') completed,
    (select count(*) from scrape_product_receipts where run_id=r.id and outcome='success') inserted,
    -- Quarantined products this run (durably rejected, canonical-identity
    -- confined, no price) — from the per-page disposition recorded in detail.
    (select count(*) from tesco_direct_collection_pages
      where run_id=r.id and outcome='ok' and detail::jsonb->>'quarantined'='true') quarantined,
    -- Ordinary product-level holds this run (ok page, identity reasons, NOT
    -- quarantined, NOT accepted).
    (select count(*) from tesco_direct_collection_pages d
      where d.run_id=r.id and d.outcome='ok' and coalesce(d.detail::jsonb->>'disposition','')='hold_continue') held,
    coalesce((select jsonb_agg(requested_url order by created_at) from tesco_direct_collection_pages
      where run_id=r.id and outcome='pending'),'[]'::jsonb) unresolved,
    coalesce((select jsonb_agg(requested_url) from tesco_direct_collection_pages
      where run_id=r.id and outcome<>'pending'),'[]'::jsonb) completed_urls
    from scrape_runs r where r.id=${uuid(runId)} and r.store='tesco'`);
  if (!row) throw new Error('Unknown Tesco run');
  return row;
}

export async function collectTescoSupervised(options: Options, deps: Dependencies): Promise<Record<string, unknown>> {
  if (!['renewal', 'expansion'].includes(options.mode)) throw new Error('Explicit renewal or expansion mode required');
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be 1–100');
  if (options.acquisitionPages && (options.mode !== 'expansion' || options.resume || options.acquisitionPages.length > limit))
    throw new Error('Acquisition handoff requires a new bounded expansion run');
  const { execute } = deps;
  let selected: Candidate[];
  let completedUrls: string[] = [];
  // Circuit-breaker counters. Seeded from prior run state on resume so a restart
  // cannot reset or bypass the breaker.
  let consecutiveHolds = 0;
  let totalHolds = 0;
  let attempts = 0;
  let consecutiveQuarantines = 0;
  let totalQuarantines = 0;
  if (options.resume) {
    const prior = await reconcileSupervisedRun(execute, options.resume);
    const state = prior.summary as RunState;
    if (state.protocol !== PROTOCOL || state.mode !== options.mode) throw new Error('Run protocol or mode differs');
    if ((prior.unresolved as string[]).length) return { ...prior, result: 'unresolved_attempts' };
    if (state.complete || (state.stopReason && state.stopReason !== 'interrupted')) return { ...prior, result: 'terminal_run' };
    selected = state.selected;
    completedUrls = prior.completed_urls as string[];
    consecutiveHolds = Number(state.consecutiveHolds ?? 0);
    totalHolds = Number(state.totalHolds ?? 0);
    attempts = Number(state.attempts ?? 0);
    consecutiveQuarantines = Number(state.consecutiveQuarantines ?? 0);
    totalQuarantines = Number(state.totalQuarantines ?? 0);
  } else selected = options.acquisitionPages ? await selectAcquisitionCandidates(execute, options.acquisitionPages)
    : await selectSupervisedCandidates(execute, options.mode, limit, { excludeSharedSku: options.excludeSharedSku });
  if (options.dryRun || !selected.length) return { result: options.dryRun ? 'dry_run' : 'no_due_products',
    mode: options.mode, selected: selected.map(m => ({ id: m.id, name: m.canonical_name, observedAt: m.observed_at })) };

  const runId = options.resume ?? randomUUID(), owner = randomUUID();
  const initial: RunState = { protocol: PROTOCOL, mode: options.mode, selected, activeSupervisor: owner };
  // Retain the identifier even if the claim commits but its acknowledgement is lost.
  deps.progress?.({ event: 'starting', runId, mode: options.mode, selected: selected.length });
  // The workspace gate is intentionally disabled for automated egress selection.
  // Never enable it or switch to another host's gate here.
  await execute(`do $runner$ begin
    perform 1 from tesco_egress_pool where egress_key=${literal(SUPERVISED_GATE)} for update;
    if not exists(select 1 from tesco_egress_pool where egress_key=${literal(SUPERVISED_GATE)}
      and enabled=false and (leased_until is null or leased_until<=now()) and coalesce(cooldown_until,now())<=now())
      then raise exception 'gate_unavailable'; end if;
    -- Invalidate expired owners before transferring this protocol's single gate.
    update scrape_runs set error_summary=(error_summary::jsonb || jsonb_build_object('activeSupervisor',null))::text
      where id<>${uuid(runId)} and case when run_id like 'tesco_supervised_renewal_%' or run_id like 'tesco_supervised_expansion_%'
        then error_summary::jsonb->>'protocol'=${literal(PROTOCOL)} and error_summary::jsonb->>'activeSupervisor' is not null
        else false end;
    ${options.resume ? `perform 1 from scrape_runs where id=${uuid(runId)} for update;
      if not exists(select 1 from scrape_runs where id=${uuid(runId)} and error_summary::jsonb->>'protocol'=${literal(PROTOCOL)}
        and error_summary::jsonb->>'mode'=${literal(options.mode)}
        and coalesce(error_summary::jsonb->>'stopReason','interrupted')='interrupted'
        and coalesce((error_summary::jsonb->>'complete')::boolean,false)=false)
        or exists(select 1 from tesco_direct_collection_pages where run_id=${uuid(runId)} and outcome='pending')
        then raise exception 'resume_state_changed'; end if;
      update scrape_runs set status='running',finished_at=null,error_summary=(error_summary::jsonb ||
        jsonb_build_object('activeSupervisor',${literal(owner)},'stopReason',null))::text where id=${uuid(runId)};`
      : `insert into scrape_runs(id,store,run_id,target_count,retrieval_method,run_scope,error_summary)
        values(${uuid(runId)},'tesco',${literal(`tesco_supervised_${options.mode}_${runId}`)},${selected.length},
        'tesco_direct','manual',${literal(initial)});`}
    update tesco_egress_pool set leased_until=now()+interval '10 minutes',updated_at=now()
      where egress_key=${literal(SUPERVISED_GATE)};
    end $runner$; select ${uuid(runId)} id`);
  deps.progress?.({ event: 'claimed', runId, mode: options.mode, selected: selected.length });
  let stopReason = 'complete';
  try {
    for (const target of selected) {
      if (completedUrls.includes(target.store_url)) continue;
      // Pacing survives process restart and is checked again after acquiring locks.
      const [spacing] = await execute(`select greatest(0,10000-extract(epoch from
        (now()-last_success_at))*1000)::int wait_ms from tesco_egress_pool where egress_key=${literal(SUPERVISED_GATE)}`);
      await (deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms))))(Number(spacing?.wait_ms ?? 0));
      await execute(`do $runner$ begin ${owned(runId, owner)} ${assertSnapshot(target)} ${assertAcquisition(target, runId)}
        if not (${duePredicate(target, options.mode)}) then raise exception 'not_due_or_observation_changed'; end if;
        if exists(select 1 from tesco_direct_collection_pages where requested_url=${literal(target.store_url)}
          ${target.acquisition ? `and id<>${uuid(target.acquisition.pageId)}` : ''}
          and (outcome='pending' or created_at>now()-interval '24 hours')) then raise exception 'attempt_already_recorded'; end if;
        if exists(select 1 from tesco_egress_pool where egress_key=${literal(SUPERVISED_GATE)}
          and last_success_at>now()-interval '10 seconds') then raise exception 'pacing_not_elapsed'; end if;
        insert into tesco_direct_collection_pages(run_id,egress_key,requested_url,mode,outcome,detail)
          values(${uuid(runId)},${literal(SUPERVISED_GATE)},${literal(target.store_url)},'products','pending',
          ${literal(target.acquisition ? JSON.stringify({ purpose: 'price_verification', sourceAcquisitionPageId: target.acquisition.pageId,
            sourceBodySha256: target.acquisition.snapshot.page.body_sha256 }) : null)});
        end $runner$; select 1 reserved`);

      const response = await (deps.fetchPage ?? fetchTescoCollectedPage)(target.store_url);
      let parsed: TescoCollectedPage | null = null;
      let outcome: string = response.outcome;
      try { if (outcome === 'ok') parsed = parseTescoCollectedPage(response.html, response.finalUrl); }
      catch { outcome = 'parse_error'; }
      const product = parsed?.products.find(p => p.sku === target.store_sku);
      const reasons = product ? validateTescoCollectedIdentity({ storeProductId: target.id,
        canonicalName: target.canonical_name, canonicalBrand: target.canonical_brand,
        storeProductName: target.store_product_name, storeBrand: target.store_brand, isOwnBrand: target.is_own_brand,
        storeSku: target.store_sku, storeUrl: target.store_url, duplicateSkuCount: target.peers.length,
        duplicateCanonicalNames: target.peers.map(p => p.canonical_name), isFresh: !!target.observed_at }, product) : ['missing_exact_product'];
      if (target.acquisition && product && !acquisitionDecision(target.acquisition.snapshot, product))
        reasons.push('acquisition_live_identity_not_exact');
      const unavailable = tescoResourceUnavailable(response);
      const transportStop = outcome !== 'ok' && !unavailable;
      // Independently inspect the product's SAME-SKU canonical mapping group for a
      // MATERIAL duplicate-canonical conflict, BEFORE deciding hold-and-continue.
      // The ordinary validator can return an attribute conflict (measure/variant/
      // etc) first and mask a material duplicate-SKU conflict; this forces a hard
      // stop in that case. Genuine equivalent synonyms are NOT flagged.
      const materialDuplicateConflict = hasMaterialDuplicateCanonicalConflict({
        storeProductId: target.id, canonicalName: target.canonical_name, canonicalBrand: target.canonical_brand,
        storeProductName: target.store_product_name, storeBrand: target.store_brand, isOwnBrand: target.is_own_brand,
        storeSku: target.store_sku, storeUrl: target.store_url, duplicateSkuCount: target.peers.length,
        duplicateCanonicalNames: target.peers.map(p => p.canonical_name), isFresh: !!target.observed_at,
      });
      // Per-product identity disposition (only meaningful on a clean ok page).
      // accept: finalise. skip_no_price: benign, move on. hold_continue: hold this
      // product + continue the batch. stop: systemic/ambiguous/unknown/material
      // duplicate-canonical conflict -> end batch.
      const disposition = outcome === 'ok'
        ? classifyIdentityOutcome(reasons, product != null, materialDuplicateConflict)
        : 'stop';
      const accepted = outcome === 'ok' && disposition === 'accept' && product != null;
      const isHold = outcome === 'ok' && disposition === 'hold_continue';
      // Quarantine-and-continue: an isolated, product-confined canonical-identity
      // rejection on a clean ok page with the SKU found + no duplicate conflict.
      // Durably rejected/held like a hold (NO price accepted), but counted on a
      // SEPARATE axis from ordinary holds and from systemic stops.
      const isQuarantine = outcome === 'ok' && disposition === 'quarantine_continue';
      // A batch-ending identity stop only when the disposition is 'stop' on an ok
      // page (systemic/unknown/mixed/material-duplicate). Holds/quarantines/skips
      // do NOT end the batch.
      const identityStop = outcome === 'ok' && disposition === 'stop';
      const pauseUntil = transportStop ? tescoPauseUntil(response.outcome === 'ok' ? 'http_error' : response.outcome, response.retryAfter) : null;
      // pageStop = the per-page recorded stop context (null for accept/hold/quarantine/skip).
      const pageStop = transportStop ? outcome : identityStop ? 'identity_validation_anomaly' : null;
      // Update cumulative circuit-breaker counters for ok pages that were
      // identity-evaluated (accept/hold/quarantine/skip; NOT transport stops,
      // which don't reflect identity). Persisted below so resume can't reset them.
      let breaker: false | 'consecutive' | 'rate' = false;
      let quarantineBreaker: false | 'consecutive' | 'rate' = false;
      if (outcome === 'ok' && !identityStop) {
        attempts += 1;
        if (isHold) { totalHolds += 1; consecutiveHolds += 1; consecutiveQuarantines = 0; }
        else if (isQuarantine) { totalQuarantines += 1; consecutiveQuarantines += 1; consecutiveHolds = 0; }
        else if (accepted) { consecutiveHolds = 0; consecutiveQuarantines = 0; }
        // skip_no_price leaves both consecutive counters unchanged.
        breaker = holdCircuitTripped(consecutiveHolds, totalHolds, attempts);
        quarantineBreaker = quarantineCircuitTripped(consecutiveQuarantines, totalQuarantines, attempts);
      }
      // Quarantine precedes evidence/finalisation: a later database error must not
      // roll back a known access restriction. This operation is owner guarded.
      if (pauseUntil) await execute(`do $runner$ begin ${owned(runId, owner)}
        perform pause_tesco_collection_egress(${literal(SUPERVISED_GATE)},${literal(pauseUntil)}::timestamptz,${outcome === 'access_block'});
        update scrape_runs set error_summary=(error_summary::jsonb || jsonb_build_object('stopReason',${literal(pageStop)}))::text
          where id=${uuid(runId)}; end $runner$; select 1 paused`);
      // Checkpoint + receipt + append are one atomic operation. No cached page is
      // finalised later with a new timestamp. A lost acknowledgement is reconciled.
      await execute(`do $runner$ begin ${owned(runId, owner, !!pauseUntil)}
        if exists(select 1 from tesco_direct_collection_pages where run_id=${uuid(runId)}
          and requested_url=${literal(target.store_url)} and outcome='pending') then
          ${accepted || isQuarantine ? assertSnapshot(target) + assertAcquisition(target, runId) : ''}
          update tesco_direct_collection_pages set final_url=${literal(response.finalUrl)},outcome=${literal(outcome)},
            http_status=${literal(response.status)}::int,retry_after=${literal(response.retryAfter)},elapsed_ms=${literal(response.elapsedMs)}::int,
            body_sha256=${literal(createHash('sha256').update(response.html).digest('hex'))},parsed=${literal(parsed)}::jsonb,
            identity_results=${literal([{ storeProductId: target.id, sku: target.store_sku, reasons }])}::jsonb,
            detail=${literal(JSON.stringify({ transport: response.transport, stopReason: pageStop,
              resourceUnavailable: unavailable, redirectUrl: response.redirectUrl,
              disposition: outcome === 'ok' ? disposition : undefined,
              quarantined: isQuarantine || undefined,
              ...(target.acquisition ? { purpose: 'price_verification', sourceAcquisitionPageId: target.acquisition.pageId,
                sourceBodySha256: target.acquisition.snapshot.page.body_sha256 } : {}) }))}
            where run_id=${uuid(runId)} and requested_url=${literal(target.store_url)};
          ${accepted && product ? `if not (${duePredicate(target, options.mode)}) then raise exception 'observation_changed'; end if;
            perform finalize_store_scrape_product(p_run_uuid=>${uuid(runId)},p_store=>'tesco',p_store_product_id=>${uuid(target.id)},
              p_success=>true,p_price=>${literal(product.price)}::numeric,p_previous_price=>${literal(target.price)}::numeric,
              p_fetched=>1,p_extracted=>1);` : ''}
          ${pauseUntil ? '' : `update tesco_egress_pool set leased_until=now()+interval '10 minutes',last_success_at=now(),updated_at=now()
                where egress_key=${literal(SUPERVISED_GATE)};`}
          update scrape_runs set error_summary=(error_summary::jsonb || jsonb_build_object('heartbeatAt',now(),
            'stopReason',${literal(pageStop)},
            'consecutiveHolds',${literal(consecutiveHolds)}::int,
            'totalHolds',${literal(totalHolds)}::int,
            'attempts',${literal(attempts)}::int,
            'consecutiveQuarantines',${literal(consecutiveQuarantines)}::int,
            'totalQuarantines',${literal(totalQuarantines)}::int))::text where id=${uuid(runId)};
        end if; end $runner$; select 1 checkpointed`);
      deps.progress?.({ event: 'checkpoint', runId, productId: target.id, accepted, held: isHold, quarantined: isQuarantine, outcome, reasons });
      // Decide break vs continue ONLY after the rejection/acceptance checkpoint
      // above has committed AND its acknowledgement is confirmed (this execute()
      // resolved). A lost acknowledgement throws -> caught -> stopReason =
      // 'interrupted' (we never continue on an unacknowledged checkpoint).
      if (pageStop) { stopReason = pageStop; break; }
      // Circuit breaker: a run of ordinary holds is itself a signal. Counters are
      // persisted (above) so interruption/resume cannot reset or bypass this.
      if (breaker) {
        stopReason = breaker === 'consecutive' ? 'identity_hold_consecutive_exceeded' : 'identity_hold_rate_exceeded';
        await execute(`do $runner$ begin ${owned(runId, owner)}
          update scrape_runs set error_summary=(error_summary::jsonb || jsonb_build_object('stopReason',${literal(stopReason)}))::text
            where id=${uuid(runId)}; end $runner$; select 1 breaker`);
        break;
      }
      // SEPARATE quarantine breaker: a long run / high rate of isolated
      // quarantines indicates a bad cohort or a subtle systemic issue -> stop.
      if (quarantineBreaker) {
        stopReason = quarantineBreaker === 'consecutive' ? 'identity_quarantine_consecutive_exceeded' : 'identity_quarantine_rate_exceeded';
        await execute(`do $runner$ begin ${owned(runId, owner)}
          update scrape_runs set error_summary=(error_summary::jsonb || jsonb_build_object('stopReason',${literal(stopReason)}))::text
            where id=${uuid(runId)}; end $runner$; select 1 qbreaker`);
        break;
      }
      // accept / skip_no_price / hold_continue / quarantine_continue → next product.
    }
  } catch {
    // Do not print driver/connector errors: these can contain credentials or SQL.
    // The durable pending reservation is authoritative after any uncertain write.
    stopReason = 'interrupted';
  } finally {
    // A paused gate has already released its lease. Owner comparison still prevents
    // this invocation clearing a successor's lease. Never clear/shorten cooldown.
    await execute(`do $runner$ begin
      perform 1 from tesco_egress_pool where egress_key=${literal(SUPERVISED_GATE)} for update;
      perform 1 from scrape_runs where id=${uuid(runId)} for update;
      if exists(select 1 from scrape_runs where id=${uuid(runId)} and error_summary::jsonb->>'activeSupervisor'=${literal(owner)}) then
        update tesco_egress_pool set leased_until=null,updated_at=now() where egress_key=${literal(SUPERVISED_GATE)};
        update scrape_runs set status=${literal(stopReason === 'complete' ? 'success' : 'degraded')},finished_at=now(),
          duration_seconds=extract(epoch from now()-started_at)::int,
          error_summary=(error_summary::jsonb || jsonb_build_object('activeSupervisor',null,
            'stopReason',coalesce(nullif(error_summary::jsonb->>'stopReason',''),${literal(stopReason)}),
            'complete',${stopReason === 'complete'}))::text where id=${uuid(runId)};
      end if; end $runner$; select 1 closed`);
  }
  return { ...await reconcileSupervisedRun(execute, runId), result: stopReason };
}
