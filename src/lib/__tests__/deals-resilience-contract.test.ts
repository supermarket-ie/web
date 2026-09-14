import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('public deals dependency resilience', () => {
  it.each([
    'src/app/deals/page.tsx',
    'src/app/deals/[store]/page.tsx',
  ])('%s uses ISR instead of forcing a live Supabase read per request', file => {
    const text = source(file);
    expect(text).toContain('export const revalidate = 30 * 60');
    expect(text).not.toContain("dynamic = 'force-dynamic'");
    expect(text).not.toContain('getAllLatestPrices({ bypassCache: true })');
  });

  it('keeps a bounded trusted-price last-known-good fallback without raw-price fallback', () => {
    const text = source('src/lib/price-data.ts');
    expect(text).toContain('LAST_KNOWN_GOOD_MAX_AGE_MS = 2 * 60 * 60 * 1000');
    expect(text).toContain('serving bounded last-known-good trusted-price cache');
    expect(text).toContain(".from('latest_prices')");
    expect(text).not.toContain(".from('price_observations')");
  });
});
