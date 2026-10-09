import { createHash, randomUUID } from 'node:crypto';
import {
  fetchTescoCollectedPage, isTescoCollectionUrl, parseTescoCollectedPage,
  tescoPauseUntil, tescoResourceUnavailable, validateTescoCollectedIdentity,
  type TescoCollectedPage, type TescoPageResponse,
} from './tesco-direct-collection-core';

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
type Candidate = Mapping & {
  observed_at: string | null; price: number | null; due: boolean; held: boolean;
  proven: boolean; overlap: number; peers: Mapping[];
};
type RunState = {
  protocol: string; mode: CollectionMode; selected: Candidate[];
  activeSupervisor: string | null; stopReason?: string; complete?: boolean;
};
export type Options = { mode: CollectionMode; limit?: number; resume?: string; dryRun?: boolean };
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

export async function selectSupervisedCandidates(execute: ExecuteSql, mode: CollectionMode, limit: number): Promise<Candidate[]> {
  if (!['renewal', 'expansion'].includes(mode) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid selection');
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
    from mappings s left join latest_prices l on l.store_product_id=s.id)
    select c.*,(select jsonb_agg(to_jsonb(m) order by m.id) from mappings m where m.store_sku=c.store_sku) peers
    from candidates c where url_status='resolved' and proven and not held
      and store_url='https://www.tesco.ie/shop/en-IE/products/'||store_sku
      and ${mode === 'renewal' ? 'due' : 'observed_at is null'}
    order by ${mode === 'renewal' ? 'observed_at asc' : 'overlap desc'},id limit ${limit}`);
  return (rows as unknown as Candidate[]).filter(m => m.url_status === 'resolved' && !m.held && m.proven
      && isTescoCollectionUrl(m.store_url) && m.store_url === `https://www.tesco.ie/shop/en-IE/products/${m.store_sku}`
      && (mode === 'renewal' ? m.due === true : !m.observed_at));
}

export async function reconcileSupervisedRun(execute: ExecuteSql, runId: string) {
  const [row] = await execute(`select r.id,r.status,r.error_summary::jsonb summary,
    (select count(*) from tesco_direct_collection_pages where run_id=r.id) reserved,
    (select count(*) from tesco_direct_collection_pages where run_id=r.id and outcome<>'pending') completed,
    (select count(*) from scrape_product_receipts where run_id=r.id and outcome='success') inserted,
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
  const { execute } = deps;
  let selected: Candidate[];
  let completedUrls: string[] = [];
  if (options.resume) {
    const prior = await reconcileSupervisedRun(execute, options.resume);
    const state = prior.summary as RunState;
    if (state.protocol !== PROTOCOL || state.mode !== options.mode) throw new Error('Run protocol or mode differs');
    if ((prior.unresolved as string[]).length) return { ...prior, result: 'unresolved_attempts' };
    if (state.complete || (state.stopReason && state.stopReason !== 'interrupted')) return { ...prior, result: 'terminal_run' };
    selected = state.selected;
    completedUrls = prior.completed_urls as string[];
  } else selected = await selectSupervisedCandidates(execute, options.mode, limit);
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
      await execute(`do $runner$ begin ${owned(runId, owner)} ${assertSnapshot(target)}
        if not (${duePredicate(target, options.mode)}) then raise exception 'not_due_or_observation_changed'; end if;
        if exists(select 1 from tesco_direct_collection_pages where requested_url=${literal(target.store_url)}
          and (outcome='pending' or created_at>now()-interval '24 hours')) then raise exception 'attempt_already_recorded'; end if;
        if exists(select 1 from tesco_egress_pool where egress_key=${literal(SUPERVISED_GATE)}
          and last_success_at>now()-interval '10 seconds') then raise exception 'pacing_not_elapsed'; end if;
        insert into tesco_direct_collection_pages(run_id,egress_key,requested_url,mode,outcome)
          values(${uuid(runId)},${literal(SUPERVISED_GATE)},${literal(target.store_url)},'products','pending');
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
      const unavailable = tescoResourceUnavailable(response);
      const transportStop = outcome !== 'ok' && !unavailable;
      const identityStop = outcome === 'ok' && reasons.some(r => r !== 'unavailable_or_no_regular_price');
      const accepted = outcome === 'ok' && reasons.length === 0 && product != null;
      const pauseUntil = transportStop ? tescoPauseUntil(response.outcome === 'ok' ? 'http_error' : response.outcome, response.retryAfter) : null;
      const pageStop = transportStop ? outcome : identityStop ? 'identity_validation_anomaly' : null;
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
          ${accepted ? assertSnapshot(target) : ''}
          update tesco_direct_collection_pages set final_url=${literal(response.finalUrl)},outcome=${literal(outcome)},
            http_status=${literal(response.status)}::int,retry_after=${literal(response.retryAfter)},elapsed_ms=${literal(response.elapsedMs)}::int,
            body_sha256=${literal(createHash('sha256').update(response.html).digest('hex'))},parsed=${literal(parsed)}::jsonb,
            identity_results=${literal([{ storeProductId: target.id, sku: target.store_sku, reasons }])}::jsonb,
            detail=${literal(JSON.stringify({ transport: response.transport, stopReason: pageStop,
              resourceUnavailable: unavailable, redirectUrl: response.redirectUrl }))}
            where run_id=${uuid(runId)} and requested_url=${literal(target.store_url)};
          ${accepted ? `if not (${duePredicate(target, options.mode)}) then raise exception 'observation_changed'; end if;
            perform finalize_store_scrape_product(p_run_uuid=>${uuid(runId)},p_store=>'tesco',p_store_product_id=>${uuid(target.id)},
              p_success=>true,p_price=>${literal(product.price)}::numeric,p_previous_price=>${literal(target.price)}::numeric,
              p_fetched=>1,p_extracted=>1);` : ''}
          ${pauseUntil ? '' : `update tesco_egress_pool set leased_until=now()+interval '10 minutes',last_success_at=now(),updated_at=now()
                where egress_key=${literal(SUPERVISED_GATE)};`}
          update scrape_runs set error_summary=(error_summary::jsonb || jsonb_build_object('heartbeatAt',now(),
            'stopReason',${literal(pageStop)}))::text where id=${uuid(runId)};
        end if; end $runner$; select 1 checkpointed`);
      deps.progress?.({ event: 'checkpoint', runId, productId: target.id, accepted, outcome, reasons });
      if (pageStop) { stopReason = pageStop; break; }
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
