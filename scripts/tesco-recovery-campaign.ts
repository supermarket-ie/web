// Supervised Tesco RECOVERY CAMPAIGN runner (ChatGPT Work SQL bridge).
//
// Same JSONL stdin/stdout SQL bridge as scripts/tesco-supervised-collect.ts: the
// operator executes each emitted query once via the authenticated Supabase SQL
// connector and returns { id, rows } on stdin. NO database credential in Node.
//
// It drives the campaign orchestrator, which runs consecutive bounded supervised
// batches (<=100 each) up to a total request budget, excluding shared-SKU groups,
// continuing only on a clean 'complete', and stopping (reporting) on anything
// else. It never resumes terminal runs or retries unknown requests.
//
// Usage (authorised campaign):
//   exec node --use-env-proxy --import tsx scripts/tesco-recovery-campaign.ts \
//     --mode expansion --request-budget 1000 --max-per-run 100 --confirm-run
import { createInterface } from 'node:readline';
import { runTescoRecoveryCampaign } from '../src/lib/tesco-campaign';
import type { CollectionMode, ExecuteSql } from '../src/lib/tesco-supervised-collection';

const args = process.argv.slice(2);
function option(name: string) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
const allowed = new Set(['--mode', '--request-budget', '--max-per-run', '--dry-run', '--confirm-run']);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error('Unknown option');
  if (!['--dry-run', '--confirm-run'].includes(args[i])) {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing option value');
    i++;
  }
}
const mode = option('--mode');
if (mode !== 'renewal' && mode !== 'expansion') throw new Error('--mode renewal|expansion is required');
if (!args.includes('--dry-run') && !args.includes('--confirm-run')) throw new Error('Use --dry-run or explicit --confirm-run');
const requestBudget = Number(option('--request-budget') ?? 1000);
const maxPerRun = Number(option('--max-per-run') ?? 100);
if (!Number.isInteger(requestBudget) || requestBudget < 1 || requestBudget > 1000) throw new Error('--request-budget must be 1-1000');
if (!Number.isInteger(maxPerRun) || maxPerRun < 1 || maxPerRun > 100) throw new Error('--max-per-run must be 1-100');

let sequence = 0, disconnected = false;
const replies = new Map<number, { resolve: (rows: Record<string, unknown>[]) => void; reject: (e: Error) => void }>();
function send(value: unknown) { process.stdout.write(JSON.stringify(value) + '\n'); }
function disconnect() {
  disconnected = true;
  for (const p of replies.values()) p.reject(new Error('Supervisor disconnected'));
  replies.clear();
}
const input = createInterface({ input: process.stdin });
input.on('close', disconnect);
input.on('line', line => {
  try {
    const value = JSON.parse(line);
    const pending = replies.get(value.id);
    if (!pending) return;
    replies.delete(value.id);
    if (value.error || !Array.isArray(value.rows)) pending.reject(new Error('Database request failed'));
    else pending.resolve(value.rows);
  } catch { disconnect(); }
});
const execute: ExecuteSql = query => new Promise((resolve, reject) => {
  if (disconnected) { reject(new Error('Supervisor disconnected')); return; }
  const id = ++sequence;
  const timeout = setTimeout(() => {
    replies.delete(id); reject(new Error('Supervisor response deadline')); disconnect();
  }, 90_000);
  replies.set(id, {
    resolve: rows => { clearTimeout(timeout); resolve(rows); },
    reject: e => { clearTimeout(timeout); reject(e); },
  });
  send({ type: 'sql', id, query });
});

async function main() {
  // Dry run: report eligibility + shared-SKU exclusions WITHOUT any request.
  if (args.includes('--dry-run')) {
    const { selectSupervisedCandidates, listExcludedSharedSkuGroups } = await import('../src/lib/tesco-supervised-collection');
    const eligible = await selectSupervisedCandidates(execute, mode as CollectionMode, Math.min(maxPerRun, 100), { excludeSharedSku: true });
    const excluded = await listExcludedSharedSkuGroups(execute, mode as CollectionMode);
    send({ type: 'result', dryRun: true, mode, sampleEligible: eligible.length, excludedSharedSkuGroups: excluded.length });
    return;
  }
  const report = await runTescoRecoveryCampaign(
    { mode: mode as CollectionMode, requestBudget, maxPerRun },
    {
      execute,
      progress: value => send({ type: 'progress', ...value }),
      fetchPage: async url => {
        if (disconnected) throw new Error('Supervisor disconnected');
        const { fetchTescoCollectedPage } = await import('../src/lib/tesco-direct-collection-core');
        return fetchTescoCollectedPage(url);
      },
    },
  );
  send({ type: 'campaign_report', ...report });
}
main().catch(() => { send({ type: 'error', message: 'Campaign stopped; reconcile recorded runs before continuing.' }); process.exitCode = 1; })
  .finally(() => input.close());
