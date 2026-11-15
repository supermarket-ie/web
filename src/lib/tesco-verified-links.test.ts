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
const D = '9a000000-0000-0000-0000-0000000000d1';
const status = async () => (await db.query<{ status: string; reopened_reason: string | null }>(
  `select status, reopened_reason from public.tesco_verified_links order by verified_at desc limit 1`)).rows[0];
const provenance = (sp = D, gtin = GTIN) => db.query<{ id: string }>(`select public.record_product_barcode_provenance($1,$2,$3,$4,now() - interval '1 hour') id`,
  [sp, gtin, 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/x', 'e'.repeat(64)]);
beforeEach(async () => {
  db = await createApifyDb();
  // The canonical EAN equals the Tesco GTIN: the realistic (Tesco-sourced) case.
  await db.exec(`
    insert into public.products(id, canonical_name, brand, ean) values ('${P}','Paprika Smoked',null,'${GTIN}');
    insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, gtin, url_status) values
      ('${M}','${P}','tesco','${SKU}','${URL}','Tesco Smoked Paprika 48G','Tesco',true,'${GTIN}','resolved'),
      ('${D}','${P}','dunnes','d1',null,'Tesco Smoked Paprika 48g','Tesco',false,null,'resolved');
    insert into public.tesco_apify_budget_reservations(campaign, reserved_usd, actual_usd, state, provider_run_id)
      values ('tesco-catalogue-20261115', 1, 0.5, 'settled', 'run-cat-1'), ('tesco-catalogue-20261115', 1, null, 'reserved', 'run-open'),
             ('tesco-apify-20261108', 1, 0.5, 'settled', 'run-growth');`);
});
afterEach(async () => { await db.close(); });

describe('barcode provenance (real migration)', () => {
  it('a matching canonical EAN WITHOUT independent provenance is refused (same evidence twice)', async () => {
    await expect(record()).rejects.toThrow('barcode_not_independent');
  });
  it('provenance can only be recorded from a Dunnes/SuperValu offer, never from Tesco', async () => {
    await expect(provenance(M)).rejects.toThrow('source_must_be_dunnes_or_supervalu');
    expect((await provenance()).rows[0].id).toBeTruthy();
  });
  it('records a link backed by a live Dunnes provenance row', async () => {
    await provenance();
    const id = (await record()).rows[0].id;
    const row = (await db.query<{ status: string; barcode_source: string; tesco_sku: string }>(`select status, barcode_source, tesco_sku from public.tesco_verified_links where id=$1`, [id])).rows[0];
    expect(row).toEqual({ status: 'active', barcode_source: 'dunnes', tesco_sku: SKU });
  });
  it('refuses provenance for a DIFFERENT barcode, or whose peer offer moved to another product', async () => {
    await provenance(D, '05000000000002');
    await expect(record()).rejects.toThrow('barcode_not_independent');
    await provenance();
    await db.exec(`insert into public.products(id, canonical_name) values ('9a000000-0000-0000-0000-0000000000a9','Other');
      update public.store_products set product_id='9a000000-0000-0000-0000-0000000000a9' where id='${D}'`);
    await expect(record()).rejects.toThrow('barcode_not_independent');
  });
  it('refuses a catalogue item for a different SKU/GTIN, unsettled or non-catalogue runs, stale evidence, shared SKUs', async () => {
    await provenance();
    await expect(record({ item: item({ sku: '999999999' }) })).rejects.toThrow('catalogue_item_mismatch');
    await expect(record({ item: item({ gtin: '05000000000009' }) })).rejects.toThrow('catalogue_item_mismatch');
    await expect(record({ run: 'run-open' })).rejects.toThrow('catalogue_run_not_settled');
    await expect(record({ run: 'run-growth' })).rejects.toThrow('catalogue_run_not_settled');
    await expect(record({ captured: new Date(Date.now() - 15 * 86400_000).toISOString() })).rejects.toThrow('catalogue_evidence_stale');
    await db.exec(`insert into public.store_products(id, product_id, store, store_sku, store_url, url_status) values
      ('9a000000-0000-0000-0000-0000000000e1','${P}','tesco','${SKU}','${URL}','resolved')`);
    await expect(record()).rejects.toThrow('shared_sku_requires_review');
  });
  it('service_role cannot write links or provenance directly', async () => {
    await provenance(); await record();
    await db.exec(`set role service_role`);
    await expect(db.query(`update public.tesco_verified_links set status='active'`)).rejects.toThrow('permission denied');
    await expect(db.query(`insert into public.product_barcode_provenance(product_id,gtin,source_store,store_product_id,source_url,evidence_sha256,captured_at)
      values ('${P}','${GTIN}','dunnes','${D}','https://x','${'e'.repeat(64)}',now())`)).rejects.toThrow('permission denied');
    await db.exec(`reset role`);
  });
});

describe('revalidation: links reopen when the evidence changes, even with the same SKU and barcode', () => {
  beforeEach(async () => { await provenance(); await record(); expect((await status()).status).toBe('active'); });
  const cases: Array<[string, string, string]> = [
    ['the canonical brand changes', `update public.products set brand='Schwartz' where id='${P}'`, 'canonical_product_changed'],
    ['the canonical name changes', `update public.products set canonical_name='Paprika Smoked 48g' where id='${P}'`, 'canonical_product_changed'],
    ['the Tesco mapping is edited', `update public.store_products set store_product_name='Tesco Smoked Paprika 50G' where id='${M}'`, 'retailer_offer_changed:update'],
    ['the peer offer that supplied the barcode changes', `update public.store_products set brand='Dunnes' where id='${D}'`, 'retailer_offer_changed:update'],
    ['ANOTHER canonical product\'s Tesco offer takes the linked SKU', `insert into public.products(id, canonical_name) values ('9a000000-0000-0000-0000-0000000000a8','Other Paprika');
      insert into public.store_products(id, product_id, store, store_sku, url_status) values ('9a000000-0000-0000-0000-0000000000e2','9a000000-0000-0000-0000-0000000000a8','tesco','${SKU}','resolved')`, 'retailer_offer_changed:insert'],
    ['the barcode provenance is revoked', `update public.product_barcode_provenance set revoked_at=now()`, 'barcode_provenance_changed'],
  ];
  for (const [label, sql, reason] of cases) {
    it(`reopens when ${label}`, async () => {
      await db.exec(sql);
      expect(await status()).toEqual({ status: 'reopened', reopened_reason: reason });
    });
  }
  it('stays active on volatile bookkeeping (URL check, nutrition) and a provenance refresh', async () => {
    await db.exec(`update public.store_products set url_last_checked_at=now(), calories_per_100=300 where id='${M}'`).catch(async () => {
      await db.exec(`alter table public.store_products add column url_last_checked_at timestamptz, add column calories_per_100 numeric`);
      await db.exec(`update public.store_products set url_last_checked_at=now(), calories_per_100=300 where id='${M}'`);
    });
    await provenance();
    expect((await status()).status).toBe('active');
  });
  it('reopen RPC still works for live identity drift', async () => {
    const { rows } = await db.query<{ id: string }>(`select id from public.tesco_verified_links where status='active'`);
    expect((await db.query<{ ok: boolean }>(`select public.apify_reopen_verified_link($1,'live gtin changed') ok`, [rows[0].id])).rows[0].ok).toBe(true);
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
