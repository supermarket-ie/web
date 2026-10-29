// Supervised SQL-bridge CLI for the Tesco mapping-recovery pilot.
//
// Default (read-only): selects the full held both-peer cohort, stratified-samples
// the 50, and prints the per-product plan — NO Pepesto spend, NO mutation.
//
// The LIVE discovery run (Pepesto /search per product + optional fresh Tesco-page
// tier-2 check + evidence persistence) is driven by runDiscoveryPilot() in
// src/lib/tesco-mapping-recovery-runner.ts, wired in the production app/worker
// where the Pepesto key and permitted egress are available. This CLI deliberately
// stops at the read-only cohort plan so nothing is spent or changed by accident.
import { createInterface } from 'node:readline';
import {
  pilotCohortSql,
  selectRepresentativeSample,
  type PilotCohortRow,
} from '../src/lib/tesco-mapping-recovery-pilot';

const args = process.argv.slice(2);
function option(name: string) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
const allowed = new Set(['--limit', '--both-peers-only', '--plan']);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error('Unknown option');
  if (args[i] === '--limit') { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing --limit value'); i++; }
}

let sequence = 0, disconnected = false;
const replies = new Map<number, { resolve: (rows: Record<string, unknown>[]) => void; reject: (e: Error) => void }>();
function send(value: unknown) { process.stdout.write(JSON.stringify(value) + '\n'); }
function disconnect() { disconnected = true; for (const p of replies.values()) p.reject(new Error('Supervisor disconnected')); replies.clear(); }
const input = createInterface({ input: process.stdin });
input.on('close', disconnect);
input.on('line', (line) => {
  try {
    const value = JSON.parse(line);
    const pending = replies.get(value.id);
    if (!pending) return;
    replies.delete(value.id);
    if (value.error || !Array.isArray(value.rows)) pending.reject(new Error('Database request failed'));
    else pending.resolve(value.rows);
  } catch { disconnect(); }
});
function execute(query: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    if (disconnected) { reject(new Error('Supervisor disconnected')); return; }
    const id = ++sequence;
    const timeout = setTimeout(() => { replies.delete(id); reject(new Error('Supervisor response deadline')); disconnect(); }, 90_000);
    replies.set(id, { resolve: (rows) => { clearTimeout(timeout); resolve(rows); }, reject: (e) => { clearTimeout(timeout); reject(e); } });
    send({ type: 'sql', id, query });
  });
}

function toRow(r: Record<string, unknown>): PilotCohortRow {
  const reasons = Array.isArray(r.held_reasons) ? (r.held_reasons as string[]) : [];
  return {
    storeProductId: String(r.store_product_id),
    productId: String(r.product_id),
    canonicalName: String(r.canonical_name ?? ''),
    canonicalBrand: (r.canonical_brand as string) ?? null,
    storeProductName: String(r.store_product_name ?? ''),
    storeBrand: (r.store_brand as string) ?? null,
    isOwnBrand: (r.is_own_brand as boolean) ?? null,
    storeSku: (r.store_sku as string) ?? null,
    storeUrl: (r.store_url as string) ?? null,
    heldReasons: reasons,
    liveName: (r.live_name as string) ?? null,
    supervaluPrice: r.sv_price == null ? null : Number(r.sv_price),
    dunnesPrice: r.dn_price == null ? null : Number(r.dn_price),
    bothPeers: Boolean(r.sv) && Boolean(r.dn),
  };
}

async function main() {
  const limit = Math.max(1, Math.min(Number(option('--limit') ?? 50), 50));
  // Read-only: full held both-peer cohort, then stratified-sample the top `limit`.
  const rows = (await execute(pilotCohortSql({ bothPeersOnly: true }))).map(toRow);
  const sample = selectRepresentativeSample(rows, limit);
  const byDefect: Record<string, number> = {};
  const byRecoverability: Record<string, number> = {};
  for (const c of sample) {
    byDefect[c.defect] = (byDefect[c.defect] ?? 0) + 1;
    byRecoverability[c.recoverability] = (byRecoverability[c.recoverability] ?? 0) + 1;
  }
  send({
    type: 'plan',
    mode: 'read_only_cohort_plan',
    cohortAvailable: rows.length,
    sampled: sample.length,
    stratifiedBy: 'identity_failure_defect (round-robin), likely-recovery first within each',
    byDefect,
    byRecoverability,
    products: sample.map((c) => ({
      storeProductId: c.storeProductId,
      storeSku: c.storeSku,
      canonicalName: c.canonicalName,
      storedName: c.storeProductName,
      liveName: c.liveName,
      defect: c.defect,
      recoverability: c.recoverability,
      bothPeers: c.bothPeers,
      supervaluPrice: c.supervaluPrice,
      dunnesPrice: c.dunnesPrice,
    })),
    note: 'READ-ONLY plan. No Pepesto spend, no mapping/price change. The live '
      + 'discovery run is a separate supervised step via runDiscoveryPilot().',
  });
}

main().then(() => process.exit(0)).catch((e) => { send({ type: 'error', message: e instanceof Error ? e.message : String(e) }); process.exit(1); });
