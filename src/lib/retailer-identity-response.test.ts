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
      await db.exec(readFileSync('supabase/migrations/20261011120000_retailer_identity_responses.sql','utf8'));
      const r = captureIdentityResponse(args)!;
      const {body_sha256: _, ...row} = r;
      const data = {...row,run_uuid:'11111111-1111-4111-8111-111111111111',store_product_id:'22222222-2222-4222-8222-222222222222'};
      await db.query(`insert into retailer_identity_responses (${Object.keys(data).join(',')}) values (${Object.keys(data).map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(data).map(v=>typeof v==='object'?JSON.stringify(v):v));
      expect((await db.query<{body_sha256:string}>('select body_sha256 from retailer_identity_responses')).rows[0].body_sha256).toBe(r.body_sha256);
      await expect(db.exec("update retailer_identity_responses set sku='999999'")).rejects.toThrow('append-only');
      await expect(db.exec('delete from retailer_identity_responses')).rejects.toThrow('append-only');
      await db.exec('set role anon'); await expect(db.exec('select * from retailer_identity_responses')).rejects.toThrow('permission denied');
    } finally { await db.close(); }
  },15000);
});
