// Verified catalogue links: real migrations in PGlite + the identity gate.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createApifyDb } from './test-support/apify-pglite';
import { independentExactIdentity } from './tesco-hold-reentry';
import { assessmentEvidence, snapshotIdentity, type ApifyPeer } from './tesco-apify-collection';
import { parseTescoCollectedPage } from './tesco-direct-collection-core';
import { renderApifyProductPage, type ApifyItem } from './tesco-apify-fetch';

const M = '9a000000-0000-0000-0000-000000000001', P = '9a000000-0000-0000-0000-0000000000a1';
const SKU = '256121718', URL = `https://www.tesco.ie/shop/en-IE/products/${SKU}`, GTIN = '05051399000015';
let db: PGlite;
const snap = async () => (await db.query<{ s: Record<string, unknown> }>(`select public.apify_mapping_snapshot($1) s`, [M])).rows[0].s;
const item = (over: Record<string, unknown> = {}) => ({ sku: SKU, gtin: GTIN, name: 'Tesco Smoked Paprika 48G', brand: 'TESCO', ...over });
async function record(over: { gtin?: string; item?: Record<string, unknown>; run?: string; captured?: string } = {}) {
  return db.query<{ id: string }>(`select public.apify_record_verified_link($1,$2,$3::jsonb,$4,$5,$6,$7,'{}'::jsonb,$8::jsonb) id`,
    [M, over.gtin ?? GTIN, JSON.stringify(over.item ?? item()), 'a'.repeat(64), over.captured ?? new Date().toISOString(),
      over.run ?? 'run-cat-1', 'b'.repeat(64), JSON.stringify(await snap())]);
}
beforeEach(async () => {
  db = await createApifyDb();
  await db.exec(`
    insert into public.products(id, canonical_name, brand, ean) values ('${P}','Paprika Smoked',null,null);
    insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, gtin, url_status) values
      ('${M}','${P}','tesco','${SKU}','${URL}','Tesco Smoked Paprika 48G','Tesco',true,null,'resolved'),
      ('9a000000-0000-0000-0000-0000000000d1','${P}','dunnes','d1',null,'Tesco Smoked Paprika 48g','Tesco',false,'${GTIN}','resolved');
    insert into public.tesco_apify_budget_reservations(campaign, reserved_usd, actual_usd, state, provider_run_id)
      values ('tesco-catalogue-20261115', 1, 0.5, 'settled', 'run-cat-1'), ('tesco-catalogue-20261115', 1, null, 'reserved', 'run-open'),
             ('tesco-apify-20261108', 1, 0.5, 'settled', 'run-growth');`);
});
afterEach(async () => { await db.close(); });

describe('apify_record_verified_link (real migration)', () => {
  it('records a same-SKU link whose GTIN is an independent peer barcode', async () => {
    const id = (await record()).rows[0].id;
    const row = (await db.query<{ status: string; barcode_source: string; tesco_sku: string }>(`select status, barcode_source, tesco_sku from public.tesco_verified_links where id=$1`, [id])).rows[0];
    expect(row).toEqual({ status: 'active', barcode_source: 'peer_gtin', tesco_sku: SKU });
  });
  it('refuses a barcode that is neither the canonical EAN nor a peer GTIN', async () => {
    await expect(record({ gtin: '05000000000002', item: item({ gtin: '05000000000002' }) })).rejects.toThrow('barcode_not_independent');
  });
  it('refuses a catalogue item for a different SKU or GTIN', async () => {
    await expect(record({ item: item({ sku: '999999999' }) })).rejects.toThrow('catalogue_item_mismatch');
    await expect(record({ item: item({ gtin: '05000000000009' }) })).rejects.toThrow('catalogue_item_mismatch');
  });
  it('refuses evidence from an unsettled or non-catalogue run, or stale evidence', async () => {
    await expect(record({ run: 'run-open' })).rejects.toThrow('catalogue_run_not_settled');
    await expect(record({ run: 'run-growth' })).rejects.toThrow('catalogue_run_not_settled');
    await expect(record({ captured: new Date(Date.now() - 15 * 86400_000).toISOString() })).rejects.toThrow('catalogue_evidence_stale');
  });
  it('refuses a shared SKU and a changed mapping', async () => {
    await db.exec(`insert into public.store_products(id, product_id, store, store_sku, store_url, url_status) values
      ('9a000000-0000-0000-0000-0000000000e1','9a000000-0000-0000-0000-0000000000a1','tesco','${SKU}','${URL}','resolved')`);
    await expect(record()).rejects.toThrow('shared_sku_requires_review');
  });
  it('reopens a link, and service_role cannot write links directly', async () => {
    const id = (await record()).rows[0].id;
    expect((await db.query<{ ok: boolean }>(`select public.apify_reopen_verified_link($1,'live gtin changed') ok`, [id])).rows[0].ok).toBe(true);
    expect((await db.query<{ status: string }>(`select status from public.tesco_verified_links where id=$1`, [id])).rows[0].status).toBe('reopened');
    await db.exec(`set role service_role`);
    await expect(db.query(`update public.tesco_verified_links set status='active'`)).rejects.toThrow('permission denied');
    await db.exec(`reset role`);
  });
});

describe('verified barcode in the identity gate', () => {
  const it2: ApifyItem = { product_id: SKU, gtin: GTIN, name: 'Tesco Smoked Paprika 48G', brand_name: 'TESCO', price: 1.2, clubcard_price: null,
    currency: 'EUR', region: 'IE', pack_size: '48', pack_size_unit: 'G', net_contents: '48g', in_stock: true, status: 'AvailableForSale',
    has_promotion: false, promotions: [], scraped_at: new Date().toISOString(), url: `https://www.tesco.ie/groceries/en-IE/products/${SKU}` };
  const live = parseTescoCollectedPage(renderApifyProductPage(URL, it2), URL).products[0];
  const snapshot = { store_product_id: M, product_id: P, store_sku: SKU, store_url: URL, url_status: 'resolved', store_brand: 'Tesco',
    store_product_name: 'Tesco Smoked Paprika 48G', is_own_brand: true, gtin: null, canonical_name: 'Paprika Smoked', canonical_brand: null,
    canonical_ean: null, same_sku_canonical_names: ['Paprika Smoked'] };
  const peer: ApifyPeer = { id: 'd', store: 'dunnes', store_product_name: 'Tesco Smoked Paprika 48g', brand: 'Tesco', gtin: null, store_sku: 'd1', observed_at: new Date().toISOString(), price: 1.3 };
  const ev = (barcode: string | null) => assessmentEvidence(snapshotIdentity(snapshot), 'p', 'c'.repeat(64), live, [], true, barcode);
  it('a matching verified barcode is accepted as independent support; a different one is not', () => {
    const withLink = independentExactIdentity(ev(GTIN), live);
    const wrong = independentExactIdentity(ev('05000000000002'), live);
    const none = independentExactIdentity(ev(null), live);
    // No peers: the verified barcode is the ONLY independent support.
    expect({ withLink, wrong, none }).toEqual({ withLink: true, wrong: false, none: false });
    void peer;
  });
});
