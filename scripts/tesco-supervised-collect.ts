// JSONL SQL bridge for a human-supervised Work session; no database key in Node.
// Requests go to stdout; the operator executes each query once through the
// authenticated Supabase SQL connector and returns { id, rows } on stdin.
import { createInterface } from 'node:readline';
import { collectTescoSupervised, reconcileSupervisedRun, type CollectionMode, type ExecuteSql } from '../src/lib/tesco-supervised-collection';

const args = process.argv.slice(2);
function option(name: string) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
const allowed = new Set(['--mode', '--limit', '--resume', '--reconcile', '--dry-run', '--confirm-run']);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error('Unknown option');
  if (!['--dry-run', '--confirm-run'].includes(args[i])) {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing option value');
    i++;
  }
}
const mode = option('--mode');
const reconcile = option('--reconcile');
if (!reconcile && mode !== 'renewal' && mode !== 'expansion') throw new Error('--mode renewal|expansion is required');
if (!reconcile && !args.includes('--dry-run') && !args.includes('--confirm-run')) throw new Error('Use --dry-run or explicit --confirm-run');
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
  const result = reconcile ? await reconcileSupervisedRun(execute, reconcile)
    : await collectTescoSupervised({ mode: mode as CollectionMode, limit: Number(option('--limit') ?? 25),
      resume: option('--resume'), dryRun: args.includes('--dry-run') }, {
      execute, progress: value => send({ type: 'progress', ...value }),
      fetchPage: async url => {
        if (disconnected) throw new Error('Supervisor disconnected');
        const { fetchTescoCollectedPage } = await import('../src/lib/tesco-direct-collection-core');
        return fetchTescoCollectedPage(url);
      },
    });
  const { summary, completed_urls: _completed, ...report } = result as Record<string, unknown>;
  void _completed;
  send({ type: 'result', ...report, stopReason: (summary as Record<string, unknown> | undefined)?.stopReason });
}
main().catch(() => { send({ type: 'error', message: 'Runner stopped; reconcile the recorded run before continuing.' }); process.exitCode = 1; })
  .finally(() => input.close());
