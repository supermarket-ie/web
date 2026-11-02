import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';

// Local bridge only: the dry-run never reaches Supabase or Tesco.
async function runExpansion(args: string[], mode: 'expansion' | 'renewal' = 'expansion') {
  return new Promise<{ code: number | null; queries: string[]; result: Record<string, unknown> | null }>((resolve, reject) => {
    const child = spawn(process.execPath,
      ['--import', 'tsx', 'scripts/tesco-supervised-collect.ts', '--mode', mode, '--dry-run', '--limit', '10', ...args],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    const queries: string[] = [];
    let result: Record<string, unknown> | null = null;
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Supervised CLI timed out')); }, 30_000);
    createInterface({ input: child.stdout }).on('line', line => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(line) as Record<string, unknown>; }
      catch (error) { child.kill(); reject(error); return; }
      if (event.type === 'sql') {
        const query = String(event.query);
        if (!/^with mappings as /i.test(query)) {
          child.kill(); reject(new Error('Dry-run attempted unexpected SQL')); return;
        }
        queries.push(query);
        child.stdin.write(JSON.stringify({ id: event.id, rows: [] }) + '\n');
      }
      if (event.type === 'result') result = event;
    });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error('Supervised CLI exited ' + code + ': ' + stderr)); return; }
      resolve({ code, queries, result });
    });
  });
}

describe('supervised CLI shared-SKU exclusion', { timeout: 45_000 }, () => {
  it('activates the existing database pre-selection exclusion with an explicit boolean flag', async () => {
    const run = await runExpansion(['--exclude-shared-sku']);
    expect(run.code).toBe(0);
    expect(run.queries).toHaveLength(1);
    expect(run.queries[0]).toContain('(select count(*) from mappings m2 where m2.store_sku=c.store_sku)<=1');
    expect(run.result).toMatchObject({ type: 'result', result: 'dry_run', selected: [] });
  });

  it('does not change the established default selector unless explicitly requested', async () => {
    const run = await runExpansion([]);
    expect(run.code).toBe(0);
    expect(run.queries).toHaveLength(1);
    expect(run.queries[0]).not.toContain('(select count(*) from mappings m2 where m2.store_sku=c.store_sku)<=1');
  });
  it('offers the one-time retry only as an explicit unique-SKU renewal option', async () => {
    const run = await runExpansion(['--one-time-access-retry', '--exclude-shared-sku'], 'renewal');
    expect(run.queries).toHaveLength(1);
    expect(run.queries[0]).toContain('and due');
    expect(run.queries[0]).toContain('(select count(*) from mappings m2 where m2.store_sku=c.store_sku)<=1');
    expect(run.result).toMatchObject({ type: 'result', result: 'dry_run' });
    await expect(runExpansion(['--one-time-access-retry'], 'renewal'))
      .rejects.toThrow('Supervised CLI exited 1');
  });
});
