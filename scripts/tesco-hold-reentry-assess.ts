// Read-only priority queue for two-person identity review. Emits evidence,
// AI-review hypotheses and discrepancies; NEVER writes an approval or price.
// Same authenticated JSONL SQL bridge as tesco-supervised-collect.ts.
import { createInterface } from 'node:readline';
import { selectHeldReviewEvidence, type ReviewHypothesis } from '../src/lib/tesco-hold-reentry-ranking';
import { reentryEvidenceSql } from '../src/lib/tesco-hold-reentry';
import type { ExecuteSql } from '../src/lib/tesco-supervised-collection';

const args = process.argv.slice(2);
const exactEvidence = args.length === 3 && args[0] === '--evidence';
if (args.length && !exactEvidence) throw new Error('Only --evidence STORE_PRODUCT_UUID SOURCE_PAGE_UUID is supported');
let nextId = 0, disconnected = false;
const waiting = new Map<number, (rows: Record<string, unknown>[]) => void>();
const input = createInterface({ input: process.stdin });
input.on('close', () => { disconnected = true; waiting.clear(); });
input.on('line', line => {
  try {
    const message = JSON.parse(line);
    if (!Array.isArray(message.rows) || message.error) { disconnected = true; return; }
    const pending = waiting.get(message.id);
    if (pending) { waiting.delete(message.id); pending(message.rows); }
  } catch { disconnected = true; }
});
const execute: ExecuteSql = sql => new Promise((resolve, reject) => {
  if (disconnected) { reject(new Error('SQL bridge unavailable')); return; }
  const id = ++nextId;
  const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Supervisor deadline')); }, 90_000);
  waiting.set(id, rows => { clearTimeout(timer); resolve(rows); });
  process.stdout.write(JSON.stringify({ type: 'sql', id, query: sql }) + '\n');
});
async function main() {
  if (exactEvidence) {
    const [row] = await execute(`select ${reentryEvidenceSql(args[1], args[2])} evidence`);
    process.stdout.write(JSON.stringify({type:'review_evidence',storeProductId:args[1],sourcePageId:args[2],
      evidence:row?.evidence ?? null, approval:'independent_review_required'}) + '\n');
    return;
  }
  const rows: ReviewHypothesis[] = await selectHeldReviewEvidence(execute);
  process.stdout.write(JSON.stringify({ type: 'assessment', count: rows.length,
    hypotheses: {
      likely_exact: rows.filter(r => r.hypothesis === 'likely_exact').length,
      conflict: rows.filter(r => r.hypothesis === 'conflict').length,
      needs_evidence: rows.filter(r => r.hypothesis === 'needs_evidence').length,
    },
    // Every record says independent_review_required. No inference is approval.
    ranked: rows }) + '\n');
}
main().catch(() => { process.stdout.write(JSON.stringify({ type: 'error', message: 'Read-only assessment stopped' }) + '\n'); process.exitCode = 1; })
  .finally(() => input.close());
