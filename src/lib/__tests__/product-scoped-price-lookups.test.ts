import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('product-scoped trusted price lookups', () => {
  it('keeps exact agent price reads off the full latest_prices view', () => {
    const text = source('agent/lib/shop.ts');
    expect(text).toContain("rpc('trusted_offers_for_products'");
    expect(text).not.toContain(".from('latest_prices')");
  });

  it('preserves the trusted retailer source, freshness and mapping rules in the RPC', () => {
    const text = source('supabase/migrations/20260914205615_add_product_scoped_trusted_offer_rpc.sql');
    expect(text).toContain("obs.observed_at >= now() - interval '7 days'");
    expect(text).toContain("'tesco_direct'::text");
    expect(text).toContain("'dunnes_direct'::text");
    expect(text).toContain("'supervalu_direct'::text");
    expect(text).toContain("sp.url_status = 'resolved'");
    expect(text).toContain("'exact'::text as relationship_type");
    expect(text).toContain("'fresh'::text as freshness_state");
  });
});
