import { describe, expect, it } from 'vitest';
import { discover, validGtin, type DiscoveryInput } from './tesco-discovery';
function fixture(): DiscoveryInput {
  return { asOf: '2026-10-09T18:00:00Z', mappings: [{ id: 'mapping', product_id: 'canonical',
    canonical_name: 'Brand Mature Red Cheddar 200g', canonical_brand: 'Brand', store_product_name: 'Brand Mature Red Cheddar 200g',
    store_brand: 'Brand', is_own_brand: false, store_sku: '123456789', store_url: 'https://www.tesco.ie/shop/en-IE/products/123456789',
    url_status: 'resolved', gtin: null, observed_at: null, proven: true }],
    peers: ['supervalu', 'dunnes'].map(store => ({ id: store, product_id: 'canonical', store: store as 'supervalu' | 'dunnes',
      store_product_name: 'Brand Mature Red Cheddar 200g', brand: 'Brand', gtin: null, store_sku: 'peer', observed_at: '2026-10-08T12:00:00Z' })),
    evidence: [{ product: { sku: '123456789', url: 'https://www.tesco.ie/shop/en-IE/products/123456789',
      name: 'Brand Mature Red Cheddar 200g', brand: 'Brand', gtin: '05011056042161', price: 3.5, currency: 'EUR', available: true, quantity: null },
      page_id: 'page', created_at: '2026-10-08T12:00:00Z', body_sha256: 'a'.repeat(64) }], attempts: [], rejections: [], demand: [{ name: 'Brand Mature Red Cheddar 200g', demand: 7 }] };
}
describe('offline deterministic Tesco discovery', () => {
  it('separates exact identity from live price acceptance', () => { const r = discover(fixture()); expect(r.counts.ready).toBe(1); expect(r.decisions[0].comparison).toBe(true); expect(r.decisions[0].reasons).toEqual(['live_price_verification_required']); });
  it.each(['400g', 'White Cheddar 200g', 'Red Cheddar & Mozzarella Grated 200g', 'Red Low Fat Cheddar 200g'])('rejects material change %s', replacement => {
    const x = fixture(); x.evidence[0].product.name = `Brand Mature ${replacement}`; expect(discover(x).counts.ready).toBe(0);
  });
  it('rejects different brands even when canonical words remain in the title', () => { const x = fixture(); x.evidence[0].product.brand = 'Other'; expect(discover(x).counts.ready).toBe(0); });
  it('rejects implicit single versus multipack', () => { const x = fixture(); x.evidence[0].product.name += ' 2 Pack'; expect(discover(x).counts.ready).toBe(0); });
  it('requires explicit canonical quantity and brand', () => { const x = fixture(); x.mappings[0].canonical_name = 'Mature Red Cheddar'; x.mappings[0].canonical_brand = null; expect(discover(x).counts.ready).toBe(0); });
  it('rejects conflicting peer formulation and pack metadata', () => { const x = fixture(); x.peers[0].store_product_name = 'Brand Mature Red Cheddar & Mozzarella Grated 200g'; expect(discover(x).counts.ready).toBe(0); });
  it('detects duplicate SKU assignments across canonical products', () => { const x = fixture(); x.mappings.push({ ...x.mappings[0], id: 'other', product_id: 'other', observed_at: '2026-10-08T12:00:00Z' }); expect(discover(x).counts.ambiguous).toBe(1); });
  it('holds two exact distinct SKUs instead of choosing the highest score', () => { const x = fixture(); x.evidence.push({ ...x.evidence[0], page_id: 'second', product: { ...x.evidence[0].product, sku: '987654321', url: 'https://www.tesco.ie/shop/en-IE/products/987654321' } }); expect(discover(x).counts.ambiguous).toBe(1); });
  it.each([true, false])('never retries an attempted request (unresolved=%s)', unresolved => { const x = fixture(); x.attempts.push({ requested_url: x.evidence[0].product.url, unresolved }); expect(discover(x).counts.held).toBe(1); });
  it('requires newer evidence after rejection', () => { const x = fixture(); x.rejections.push({ id: 'mapping', at: '2026-10-09T10:00:00Z', reasons: ['size'] }); expect(discover(x).counts.held).toBe(1); });
  it('does not bypass the supervised runner prior-success requirement', () => { const x = fixture(); x.mappings[0].proven = false; expect(discover(x).counts.held).toBe(1); });
  it('classifies an exact alternate SKU as a repair, never ready', () => { const x = fixture(); x.mappings[0].store_sku = '111111111'; expect(discover(x).counts.repair_required).toBe(1); });
  it('does not use expired, future or unprovenance evidence', () => { for (const at of ['2026-09-01T00:00:00Z', '2026-10-10T00:00:00Z', 'invalid']) { const x = fixture(); x.evidence[0].created_at = at; expect(discover(x).counts.ready).toBe(0); } const x = fixture(); x.evidence[0].body_sha256 = ''; expect(discover(x).counts.ready).toBe(0); });
  it('does not accept unavailable/no-price data', () => { const x = fixture(); x.evidence[0].product.available = false; expect(discover(x).counts.ready).toBe(0); });
  it('validates GTIN checksums and never treats Tesco self-corroboration as independent', () => { expect(validGtin('05011056042161')).toBe('05011056042161'); expect(validGtin('05011056042162')).toBeNull(); const x = fixture(); x.mappings[0].gtin = x.evidence[0].product.gtin; expect(discover(x).decisions[0].candidates[0].signals).not.toContain('independent_peer_gtin'); });
  it('GTIN does not override variant conflicts', () => { const x = fixture(); x.peers[0].gtin = x.evidence[0].product.gtin; x.evidence[0].product.name += ' Mozzarella'; expect(discover(x).counts.ready).toBe(0); });
  it('reuses unchanged decisions and processes genuinely new evidence once', () => { const x = fixture(), first = discover(x), second = discover(x, first); expect(second.evaluated).toBe(0); expect(second.reused).toBe(1); expect(second.newlyReady).toEqual([]); x.evidence[0].body_sha256 = 'b'.repeat(64); expect(discover(x, second).evaluated).toBe(1); });
  it('invalidates cached decisions for new holds and age boundaries', () => { const x = fixture(), first = discover(x); x.attempts.push({ requested_url: x.evidence[0].product.url, unresolved: true }); expect(discover(x, first).counts.held).toBe(1); const y = fixture(); y.asOf = '2026-10-23T18:00:00Z'; expect(discover(y, first).counts.ready).toBe(0); });
  it('does not revisit fresh Tesco observations', () => { const x = fixture(); x.mappings[0].observed_at = '2026-10-08T12:00:00Z'; expect(discover(x).decisions).toEqual([]); });
  it('keeps immutable inputs and deterministic ordering', () => { const x = fixture(), before = JSON.stringify(x); expect(discover(x)).toEqual(discover(x)); expect(JSON.stringify(x)).toBe(before); });
  it('retains the exact collector target and labels stored URLs honestly', () => {
    const x = fixture(); x.evidence[0].requested_url = 'https://www.tesco.ie/shop/en-IE/search?query=cheddar'; x.evidence[0].mode = 'listings';
    const d = discover(x).decisions[0];
    expect(d.collectorTarget).toEqual({ canonicalProductId: 'canonical', storeProductId: 'mapping', sku: '123456789', url: x.evidence[0].product.url, requiresRepair: false });
    expect(d.candidates[0]).toMatchObject({ urlVerification: 'stored_evidence_only', liveVerifiedThisRun: false, sourceUrl: x.evidence[0].requested_url, sourceMode: 'listings' });
  });
  it.each(['https://evil.example/products/123456789', 'https://www.tesco.ie/shop/en-IE/products/987654321', 'https://www.tesco.ie/shop/en-IE/products/123456789?token=x', ''])('rejects unsafe or inconsistent URLs: %s', url => {
    const x = fixture(); x.evidence[0].product.url = url; expect(discover(x).counts.ready).toBe(0);
  });
  it('preserves numeric formulation distinctions', () => { const x = fixture(); x.mappings[0].canonical_name += ' 0% Fat'; x.evidence[0].product.name += ' 1% Fat'; expect(discover(x).counts.ready).toBe(0); });
  it('selects newest evidence by instant across timezones', () => { const x = fixture(); x.evidence[0].created_at = '2026-10-08T13:00:00+02:00'; x.evidence[0].product.name += ' Mozzarella'; x.evidence.push({ ...fixture().evidence[0], page_id: 'newer', created_at: '2026-10-08T12:00:00Z' }); expect(discover(x).counts.ready).toBe(1); });
  it('holds equal-time conflicting records across timezones', () => { const x = fixture(); x.evidence.push({ ...x.evidence[0], page_id: 'conflict', created_at: '2026-10-08T13:00:00+01:00', product: { ...x.evidence[0].product, name: 'Other 200g' } }); expect(discover(x).counts.ready).toBe(0); });
  it('retains historical SKU/URL hints without accepting legacy classifications', () => { const x = fixture(); x.evidence = []; x.historicalHints = [{ id: 'legacy', store_product_id: 'mapping', candidate_sku: '123456789', candidate_url: x.mappings[0].store_url, candidate_name: x.mappings[0].canonical_name, created_at: '2026-09-20T12:00:00Z', classification: 'exact_replacement_candidate' }]; const d = discover(x).decisions[0]; expect(d.historicalHints).toHaveLength(1); expect(d.collectorTarget).toBeNull(); expect(d.classification).toBe('needs_evidence'); });

  it('retrieves one-word evidence without bypassing the unchanged identity validator', () => { const x = fixture(); x.mappings[0].canonical_name = 'Brand 200g'; x.mappings[0].store_sku = '111111111'; x.evidence[0].product.name = 'Brand 200g'; for (const p of x.peers) p.store_product_name = 'Brand 200g'; const r = discover(x); expect(r.decisions[0].candidates.map(c => c.sku)).toEqual(['123456789']); expect(r.counts.ready).toBe(0); });

  it.each([' + 100g', ' 100g Extra', ' + 100ml'])('holds compound quantity evidence: %s', suffix => { const x = fixture(); x.evidence[0].product.name += suffix; const r = discover(x); expect(r.counts.ready).toBe(0); expect(r.decisions[0].candidates[0].reasons).toContain('compound_measure_requires_review'); });
  it('holds compound canonical and peer quantities even when the first measure agrees', () => { const x = fixture(); x.mappings[0].canonical_name += ' + 100g'; x.evidence[0].product.name += ' + 200g'; expect(discover(x).counts.ready).toBe(0); const y = fixture(); y.peers[0].store_product_name += ' + 100g'; expect(discover(y).decisions[0].candidates[0].reasons).toContain('peer_compound_measure_requires_review'); });

});
