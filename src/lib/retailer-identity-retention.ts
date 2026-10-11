import { supabaseAdmin } from './supabase';
import type { IdentityResponse } from './retailer-identity-response';

/** Evidence failure cannot turn a completed price finalization into a queue retry. */
export async function retainIdentityResponse(response: IdentityResponse | null | undefined, runUuid: string, storeProductId: string) {
  if (!response) return;
  try {
    const row = Object.fromEntries(Object.entries(response).filter(([key]) => key !== 'body_sha256'));
    const { error } = await supabaseAdmin.from('retailer_identity_responses').insert({ ...row, run_uuid: runUuid, store_product_id: storeProductId });
    if (error) console.warn('Retailer identity retention failed', { store: response.store, sku: response.sku, code: error.code });
  } catch { console.warn('Retailer identity retention unavailable', { store: response.store, sku: response.sku }); }
}
