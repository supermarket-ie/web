import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';

type CliEvent = Record<string, unknown> & { type: string };
const temporaryDirectories: string[] = [];

// Exercise the real CLI with an entirely local, empty-evidence SQL bridge.
// No database or retailer transport is available to these tests.
function dryRun(args: string[]): Promise<{ code: number | null; events: CliEvent[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      ['--import', 'tsx', 'scripts/tesco-machine-approve.ts', '--dry-run', ...args],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    const events: CliEvent[] = [];
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Local approval CLI did not finish'));
    }, 30_000);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        const event = JSON.parse(line) as CliEvent;
        events.push(event);
        if (event.type === 'sql') {
          if (String(event.query).includes('record_verified_hold_reentry')) {
            child.kill();
            reject(new Error('Dry run attempted a decision write'));
            return;
          }
          child.stdin.write(JSON.stringify({ id: event.id, rows: [] }) + '\n');
        }
      } catch (error) {
        child.kill();
        reject(error);
      }
    });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); resolve({ code, events, stderr }); });
  });
}

function reviewedIds(events: CliEvent[]) {
  return events.filter(event => event.type === 'operational_review').map(event => event.mapping_id);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

// Child Node/tsx startup can compete with the full PGlite suite in CI.
describe('bounded operational approval CLI advancement', { timeout: 60_000 }, () => {
  it('keeps the first 33 priority candidates and advances to the other 60 without overlap', async () => {
    const first = await dryRun(['--limit', '33']);
    const remaining = await dryRun(['--offset', '33', '--limit', '60']);
    expect(first.code).toBe(0);
    expect(remaining.code).toBe(0);
    expect(first.events.at(-1)).toMatchObject({ type: 'operational_summary', offset: 0,
      limit: 33, candidate_count: 93, next_offset: 33, considered: 33,
      decisions_recorded: 0, collection_started: false });
    expect(remaining.events.at(-1)).toMatchObject({ type: 'operational_summary', offset: 33,
      limit: 60, candidate_count: 93, next_offset: null, considered: 60,
      decisions_recorded: 0, collection_started: false });
    const priorityIds = readFileSync('docs/tesco-hold-reentry-production-queue-20261101.jsonl', 'utf8')
      .trim().split('\n').map(line => JSON.parse(line))
      .filter(row => row.type === 'candidate' && row.expected_genuine_triple_if_live)
      .map(row => row.mapping_id);
    expect(reviewedIds(first.events)).toEqual(priorityIds);
    expect(new Set([...reviewedIds(first.events), ...reviewedIds(remaining.events)]).size).toBe(93);
  });

  it('can reach a wider appended manifest beyond the first 100 candidates', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tesco-approval-cli-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'additional-candidates.jsonl');
    const extra = Array.from({ length: 10 }, (_, i) => ({ type: 'candidate',
      mapping_id: randomUUID(), source_page_id: randomUUID(), sku: String(900000000 + i),
      expected_genuine_triple_if_live: false }));
    writeFileSync(path, extra.map(row => JSON.stringify(row)).join('\n') + '\n');
    const result = await dryRun(['--candidate-file', path, '--offset', '100', '--limit', '100']);
    expect(result.code).toBe(0);
    expect(reviewedIds(result.events)).toEqual(extra.slice(7).map(row => row.mapping_id));
    expect(result.events.at(-1)).toMatchObject({ offset: 100, limit: 100,
      candidate_count: 103, next_offset: null, considered: 3, decisions_recorded: 0 });
  });

  it('can select only a new manifest, preserving its triple priority and bounded offsets', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tesco-approval-cli-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'new-candidates.jsonl');
    const extra = [undefined, true].map((priority, i) => ({ type: 'candidate',
      mapping_id: randomUUID(), source_page_id: randomUUID(), sku: String(900000000 + i),
      expected_genuine_triple_if_live: priority }));
    writeFileSync(path, extra.map(row => JSON.stringify(row)).join('\n') + '\n');
    const first = await dryRun(['--candidate-file-only', path, '--limit', '1']);
    const second = await dryRun(['--candidate-file-only', path, '--offset', '1', '--limit', '1']);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(reviewedIds(first.events)).toEqual([extra[1].mapping_id]);
    expect(reviewedIds(second.events)).toEqual([extra[0].mapping_id]);
    expect(first.events.at(-1)).toMatchObject({ offset: 0, candidate_count: 2,
      next_offset: 1, considered: 1, decisions_recorded: 0, collection_started: false });
    expect(second.events.at(-1)).toMatchObject({ offset: 1, candidate_count: 2,
      next_offset: null, considered: 1, decisions_recorded: 0, collection_started: false });
  });

  it('rejects additive and exclusive manifest modes together before reading files', async () => {
    const result = await dryRun(['--candidate-file', 'unused-additive.jsonl',
      '--candidate-file-only', 'unused-exclusive.jsonl']);
    expect(result.code).not.toBe(0);
    expect(result.events).toEqual([]);
    expect(result.stderr).toContain('Select only one candidate-file mode');
  });

  it.each(['-1', '1.5', 'NaN', 'Infinity', '9007199254740992'])
    ('rejects invalid offset %s before any evidence query', async offset => {
      const result = await dryRun(['--offset', offset]);
      expect(result.code).not.toBe(0);
      expect(result.events).toEqual([]);
      expect(result.stderr).toContain('Machine review offset must be a nonnegative safe integer');
    });

  it('does not allow an offset to hide duplicate mappings elsewhere in a manifest', async () => {
    const result = await dryRun(['--offset', '100', '--candidate-file',
      'docs/tesco-hold-reentry-inference-addendum-20261101.jsonl']);
    expect(result.code).not.toBe(0);
    expect(result.events).toEqual([]);
    expect(result.stderr).toContain('Duplicate mapping in AI evidence manifest');
  });
});
