import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { captureIdentityResponse, evidenceFromResponse, responseHash } from './retailer-identity-response';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabaseAdmin: { from: () => ({ insert: rpc }) } }));
import { retainIdentityResponse } from './retailer-identity-retention';
const title = 'Brand Vanilla Yogurt 500g', sku = '123456';
const url = `https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/yogurt/${sku}`;
const args = { store: 'dunnes' as const, sku, title, productUrl: url, requestedUrl: 'https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/search?q=yogurt', finalUrl: 'https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/search?q=yogurt', contentType: 'application/json',
  body: JSON.stringify({ items: [{ sku, name: title, brand: 'Brand', ingredients: 'Milk', quantity: { grams: 500 }, flavour: 'Vanilla' }] }) };
describe('original retailer response retention', () => {
  it('binds parsed SKU attributes to original body and keeps listing provenance', () => {
    const r = captureIdentityResponse(args)!;
    expect(r.source_kind).toBe('captured_listing'); expect(r.body_text).toBe(args.body);
    expect(r.identity.ingredients).toBe('Milk'); expect(r.identity.quantity).toEqual({ grams: 500 });
    expect(evidenceFromResponse({ ...r, id: 'archive' })?.source.archiveRef).toBe('retailer_identity_responses:archive');
    expect(evidenceFromResponse({ ...r, id: 'archive' })?.lastLiveVerifiedAt).toBeNull();
    expect(evidenceFromResponse({ ...r, id: 'archive', body_text: '{}' })).toBeNull();
    expect(evidenceFromResponse({ ...r, id: 'archive', identity: { ...r.identity, title: 'Wrong' } })).toBeNull();
  });
  it('does not substitute a mapping SKU/title or accept conflicting source nodes', () => {
    expect(captureIdentityResponse({ ...args, sku: '999999' })).toBeNull();
    expect(captureIdentityResponse({ ...args, title: 'Brand Strawberry Yogurt 500g' })).toBeNull();
    expect(captureIdentityResponse({ ...args, finalUrl: 'https://attacker.example/' })).toBeNull();
    expect(captureIdentityResponse({ ...args, body: JSON.stringify({ items: [{sku,name:title},{sku,name:'Different'}] }) })).toBeNull();
  });
  it('retains a direct HTML response with embedded SKU JSON without representing extracted JSON as the response', () => {
    const body = `<html><script type="application/ld+json">${JSON.stringify({ '@type':'Product', sku, name:title })}</script></html>`;
    const r = captureIdentityResponse({ ...args, body, requestedUrl:url, finalUrl:url })!;
    expect(r.body_text).toBe(body); expect(r.source_kind).toBe('captured_product'); expect(r.body_sha256).toBe(responseHash(body));
  });
  // Regression for the 17 Nov 2026 production diagnostic: SuperValu product pages assign __PRELOADED_STATE__ and
  // then run more script, so slicing to the script's last "}" never parsed and NO direct capture was ever made.
  describe('SuperValu direct product page (__PRELOADED_STATE__ followed by more script)', () => {
    const svSku = '1020898000', svTitle = 'Schwartz Chilli Powder Mild  (38 g)';
    const svUrl = `https://shop.supervalu.ie/sm/delivery/rsid/5550/product/schwartz-chilli-powder-mild-38-g-id-${svSku}`;
    const state = { product: { sku: svSku, name: svTitle, brand: 'Schwartz', price: { amount: 3.4 }, description: 'Mild {chilli} blend "38g"' },
      search: { productCardDictionary: { a: { sku: svSku, name: svTitle, brand: 'Schwartz' } } } };
    const page = (extra = 'window.__ENV__ = {"region":"ie"}; window.__FLAGS__ = { a: 1 };') =>
      `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"SuperValu"}</script>`
      + `<script>window.__PRELOADED_STATE__ = ${JSON.stringify(state)}; ${extra}</script></head><body>${svTitle}</body></html>`;
    const sv = { store: 'supervalu' as const, sku: svSku, title: svTitle, productUrl: svUrl, requestedUrl: svUrl, finalUrl: svUrl, contentType: 'text/html' };
    it('captures a direct page as captured_product, bound to the SKU and title in the original body', () => {
      const r = captureIdentityResponse({ ...sv, body: page() })!;
      expect(r).toMatchObject({ source_kind: 'captured_product', parser_version: 'retailer-identity-response-v3' });
      expect(r.source_path).toContain('__PRELOADED_STATE__');
      expect(r.body_sha256).toBe(responseHash(page()));
      expect(evidenceFromResponse({ ...r, id: 'x' })?.source.kind).toBe('captured_product');
    });
    it('keeps every evidence check: wrong SKU, wrong title, redirect, conflicting copies', () => {
      expect(captureIdentityResponse({ ...sv, sku: '1020898001', body: page() })).toBeNull();
      expect(captureIdentityResponse({ ...sv, title: 'Schwartz Chilli Powder Hot (38 g)', body: page() })).toBeNull();
      expect(captureIdentityResponse({ ...sv, finalUrl: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/search', body: page() })?.source_kind).toBe('captured_listing');
      const conflicting = page().replace('"brand":"Schwartz"}}}', '"brand":"Other"}}}');
      expect(captureIdentityResponse({ ...sv, body: conflicting })).toBeNull();
    });
    it('an unterminated state object is not parsed', () => {
      expect(captureIdentityResponse({ ...sv, body: `<script>window.__PRELOADED_STATE__ = {"product":{"sku":"${svSku}","name":"${svTitle}"</script>` })).toBeNull();
    });
  });
  it('earlier parser versions (JSON listing bodies) still verify', () => {
    const r = captureIdentityResponse(args)!;
    expect(evidenceFromResponse({ ...r, id: 'old', parser_version: 'retailer-identity-response-v2' })?.source.kind).toBe('captured_listing');
    expect(evidenceFromResponse({ ...r, id: 'bad', parser_version: 'unknown-parser' })).toBeNull();
  });
  it('does not retry price finalization when evidence persistence fails', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ error: { code: '42P01' } }).mockRejectedValueOnce(Error('offline'));
    await expect(retainIdentityResponse(captureIdentityResponse(args), 'run', 'mapping')).resolves.toBeUndefined();
    await expect(retainIdentityResponse(captureIdentityResponse(args), 'run', 'mapping')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2); log.mockRestore();
  });
  it('database computes body hash and denies browser reads and historical mutation', async () => {
    const db = await PGlite.create();
    try {
      await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
      await db.exec(readFileSync('supabase/migrations/20261011113227_retailer_identity_responses.sql','utf8'));
      const r = captureIdentityResponse(args)!;
      const {body_sha256, ...row} = r;
      const data = {...row,run_uuid:'11111111-1111-4111-8111-111111111111',store_product_id:'22222222-2222-4222-8222-222222222222'};
      await db.query(`insert into retailer_identity_responses (${Object.keys(data).join(',')}) values (${Object.keys(data).map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(data).map(v=>typeof v==='object'?JSON.stringify(v):v));
      expect((await db.query<{body_sha256:string}>('select body_sha256 from retailer_identity_responses')).rows[0].body_sha256).toBe(body_sha256);
      await expect(db.exec("update retailer_identity_responses set sku='999999'")).rejects.toThrow('append-only');
      await expect(db.exec('delete from retailer_identity_responses')).rejects.toThrow('append-only');
      await db.exec('set role anon'); await expect(db.exec('select * from retailer_identity_responses')).rejects.toThrow('permission denied');
    } finally { await db.close(); }
  },15000);
});
