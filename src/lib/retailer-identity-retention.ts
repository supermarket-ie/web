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

let observationFailures = 0;
/** Failures are counted and logged at the 1st, 10th, 100th, ... occurrence, so an outage stays visible. */
function noteObservationFailure(store: string, code: string | undefined) {
  observationFailures += 1;
  if (Math.log10(observationFailures) % 1 === 0) console.warn('Identity observation not recorded', { store, code, failures: observationFailures });
}
/**
 * Lightweight identity observation for durable pair approvals: the body hash and parsed identity of a direct
 * product capture, WITHOUT the body. The database binds it to the offer as it is now and computes the identity
 * fingerprint. Failure (including the table not existing before its migration) never affects the price.
 */
export async function recordIdentityObservation(response: IdentityResponse | null | undefined, runUuid: string, storeProductId: string) {
  if (!response || response.source_kind !== 'captured_product') return;
  try {
    const { error } = await supabaseAdmin.from('retailer_identity_observations').insert({
      store_product_id: storeProductId, store: response.store, sku: response.sku, source_kind: response.source_kind,
      product_url: response.product_url, requested_url: response.requested_url, final_url: response.final_url,
      body_sha256: response.body_sha256, parser_version: response.parser_version, identity: response.identity,
      observed_at: response.retrieved_at, run_uuid: runUuid,
    });
    if (error) noteObservationFailure(response.store, error.code);
  } catch {
    noteObservationFailure(response.store, 'exception');
  }
}
