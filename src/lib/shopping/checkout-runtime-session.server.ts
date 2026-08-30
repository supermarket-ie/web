import 'server-only';

import { supabaseAdmin } from '@/lib/supabase';
import type { Page } from 'playwright';
import {
  assertCheckoutRuntimeTransition,
  assertCheckoutRuntimeSessionOwner,
  isVerifiedTrolleyLineSnapshot,
  type CheckoutRuntimePlan,
  type CheckoutRuntimeState,
} from './checkout-runtime';
import { prepareOwnedCheckoutRuntimePlan } from './checkout-runtime-plan.server';
import {
  createConfiguredBrowserbaseProvider,
  type BrowserbaseCheckoutRuntimeProvider,
} from './providers/browserbase';

type RuntimeSessionRow = {
  id: string;
  subscriber_id: string;
  list_id: string;
  retailer: 'supervalu';
  provider: 'browserbase';
  provider_session_id: string;
  state: CheckoutRuntimeState;
  plan: CheckoutRuntimePlan;
  populated_product_ids: string[];
  verified_item_count: number | null;
  verified_trolley_value: number | null;
  failure_code: string | null;
  expires_at: string;
};

const PUBLIC_FIELDS = 'id, retailer, state, expires_at, verified_item_count, verified_trolley_value, failure_code';

export class CheckoutRuntimeSessionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function requireProvider(): BrowserbaseCheckoutRuntimeProvider {
  const provider = createConfiguredBrowserbaseProvider();
  if (!provider || process.env.CHECKOUT_RUNTIME_PROVIDER_CONFIGURED !== 'true') {
    throw new CheckoutRuntimeSessionError('Checkout runtime provider is not configured', 503);
  }
  return provider;
}

export async function createOwnedCheckoutRuntimeSession(input: {
  subscriberId: string;
  listId: string;
  retailer: 'supervalu';
}) {
  const provider = requireProvider();
  const { data: active } = await supabaseAdmin
    .from('checkout_runtime_sessions')
    .select('id')
    .eq('subscriber_id', input.subscriberId)
    .not('state', 'in', '(trolley_ready,failed,expired)')
    .gt('expires_at', new Date().toISOString())
    .limit(1);
  if (active?.length) {
    throw new CheckoutRuntimeSessionError('Close your existing checkout session before starting another', 409);
  }
  const { plan, unmatchedItems } = await prepareOwnedCheckoutRuntimePlan(input);
  if (!plan.launchEnabled) throw new CheckoutRuntimeSessionError('Checkout runtime launch is disabled', 503);

  const created = await provider.createSession(plan);
  const { data, error } = await supabaseAdmin
    .from('checkout_runtime_sessions')
    .insert({
      subscriber_id: input.subscriberId,
      list_id: input.listId,
      retailer: input.retailer,
      provider: 'browserbase',
      provider_session_id: created.sessionId,
      state: 'awaiting_shopper_auth',
      plan,
      expires_at: created.expiresAt,
    })
    .select(PUBLIC_FIELDS)
    .single();

  if (error || !data) {
    await provider.destroySession(created.sessionId).catch(() => undefined);
    throw new CheckoutRuntimeSessionError('Could not save checkout session', 500);
  }
  await recordRuntimeEvent(input.subscriberId, data.id, 'handoff_started', plan);
  return { session: data, unmatchedItems };
}

export async function getOwnedCheckoutRuntimeSession(subscriberId: string, sessionId: string) {
  const row = await getOwnedRow(subscriberId, sessionId);
  return syncExpiryAndProviderState(row);
}

export async function getOwnedCheckoutRuntimeShopperUrl(subscriberId: string, sessionId: string) {
  const row = await getOwnedRow(subscriberId, sessionId);
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await expireRow(row);
    throw new CheckoutRuntimeSessionError('Checkout session has expired', 410);
  }
  if (['failed', 'expired'].includes(row.state)) {
    throw new CheckoutRuntimeSessionError('Checkout session is no longer available', 410);
  }
  return requireProvider().getShopperUrl(row.provider_session_id);
}

export async function advanceOwnedCheckoutRuntimeSession(subscriberId: string, sessionId: string) {
  const existing = await getOwnedRow(subscriberId, sessionId);
  if (new Date(existing.expires_at).getTime() <= Date.now()) return expireRow(existing);
  if (['trolley_ready', 'failed', 'expired'].includes(existing.state)) return publicRow(existing);
  const row = await claimOwnedRow(subscriberId, sessionId);
  if (new Date(row.expires_at).getTime() <= Date.now()) return expireRow(row);

  const provider = requireProvider();
  try {
    return await provider.withPage(row.provider_session_id, page => advanceSupervaluPage(row, page));
  } catch {
    return failRow(row, 'provider_or_retailer_unavailable');
  } finally {
    await supabaseAdmin
      .from('checkout_runtime_sessions')
      .update({ operation_locked_until: null })
      .eq('id', row.id)
      .eq('subscriber_id', row.subscriber_id);
  }
}

export async function destroyOwnedCheckoutRuntimeSession(subscriberId: string, sessionId: string) {
  const row = await getOwnedRow(subscriberId, sessionId);
  await requireProvider().destroySession(row.provider_session_id).catch(() => undefined);
  if (row.state !== 'expired') {
    await updateState(row, 'expired', { failure_code: null });
  }
}

export async function cleanupExpiredCheckoutRuntimeSessions() {
  const { data } = await supabaseAdmin
    .from('checkout_runtime_sessions')
    .select('*')
    .lt('expires_at', new Date().toISOString())
    .not('state', 'in', '(expired,failed)')
    .limit(100);

  let cleaned = 0;
  for (const row of (data ?? []) as RuntimeSessionRow[]) {
    const provider = createConfiguredBrowserbaseProvider();
    await provider?.destroySession(row.provider_session_id).catch(() => undefined);
    await expireRow(row);
    cleaned += 1;
  }
  return cleaned;
}

async function advanceSupervaluPage(row: RuntimeSessionRow, page: Page) {
  const url = new URL(page.url());
  if (url.hostname === 'sts.supervalu.ie' || /sign in|log in/i.test(await page.title())) {
    return transitionIfNeeded(row, 'awaiting_shopper_auth');
  }
  if (url.hostname !== 'shop.supervalu.ie') {
    return failRow(row, 'unexpected_retailer_origin');
  }
  if (!url.pathname.includes(`/rsid/${row.plan.context.retailerStoreId}/`)) {
    return transitionIfNeeded(row, 'awaiting_store_context');
  }

  if (row.state === 'awaiting_shopper_auth') {
    row = await updateState(row, 'populating_trolley') as RuntimeSessionRow;
  } else if (row.state === 'awaiting_store_context') {
    row = await updateState(row, 'populating_trolley') as RuntimeSessionRow;
  }

  const completed = new Set(row.populated_product_ids ?? []);
  const nextItem = row.plan.items.find(item => !completed.has(item.retailerProductId));
  if (nextItem) {
    await page.goto(nextItem.retailerUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (new URL(page.url()).hostname !== 'shop.supervalu.ie') {
      return failRow(row, 'retailer_auth_lost');
    }
    const addButton = page.getByRole('button', { name: /^(add|add to (cart|trolley))$/i }).first();
    if (!await addButton.isVisible().catch(() => false)) {
      return failRow(row, 'retailer_add_control_not_found');
    }
    await addButton.click();
    for (let quantity = 1; quantity < nextItem.quantity; quantity += 1) {
      const increaseButton = page.getByRole('button', { name: /increase|add one|plus/i }).first();
      if (!await increaseButton.isVisible().catch(() => false)) {
        return failRow(row, 'retailer_quantity_control_not_found');
      }
      await increaseButton.click();
    }
    const removalControl = page.getByRole('button', { name: /remove|decrease/i }).first();
    if (!await removalControl.isVisible().catch(() => false)) {
      return failRow(row, 'retailer_add_not_verified');
    }
    completed.add(nextItem.retailerProductId);
    const { data, error } = await supabaseAdmin
      .from('checkout_runtime_sessions')
      .update({ populated_product_ids: [...completed], updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('subscriber_id', row.subscriber_id)
      .select('*')
      .single();
    if (error || !data) throw new Error('Could not save checkout progress');
    return publicRow(data as RuntimeSessionRow);
  }

  const cartControl = page.getByRole('link', { name: /cart|trolley/i }).first();
  const cartButton = page.getByRole('button', { name: /cart|trolley/i }).first();
  if (await cartControl.isVisible().catch(() => false)) await cartControl.click();
  else if (await cartButton.isVisible().catch(() => false)) await cartButton.click();
  else return failRow(row, 'retailer_trolley_control_not_found');

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  for (const item of row.plan.items) {
    const productText = page.getByText(item.retailerProductName, { exact: false }).first();
    if (!await productText.isVisible().catch(() => false)) {
      return failRow(row, 'retailer_trolley_verification_failed');
    }
    const line = productText.locator('xpath=ancestor::*[self::li or self::article or @data-testid][1]');
    const lineText = await line.innerText().catch(() => '');
    const quantityInput = line.locator('input[type="number"], input[aria-label*="quantity" i]').first();
    const inputQuantity = await quantityInput.inputValue().catch(() => '');
    const verified = inputQuantity
      ? Number(inputQuantity) === item.quantity
      : isVerifiedTrolleyLineSnapshot(item.retailerProductName, item.quantity, lineText);
    if (!verified) return failRow(row, 'retailer_trolley_quantity_verification_failed');
  }

  const ready = await updateState(row, 'trolley_ready', {
    verified_item_count: row.plan.items.length,
    completed_at: new Date().toISOString(),
    failure_code: null,
  });
  await recordRuntimeEvent(row.subscriber_id, row.id, 'retailer_trolley_prepared', row.plan);
  return publicRow(ready as RuntimeSessionRow);
}

async function getOwnedRow(subscriberId: string, sessionId: string): Promise<RuntimeSessionRow> {
  const { data, error } = await supabaseAdmin
    .from('checkout_runtime_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('subscriber_id', subscriberId)
    .maybeSingle();
  if (error) throw new CheckoutRuntimeSessionError('Could not load checkout session', 500);
  if (!data) throw new CheckoutRuntimeSessionError('Checkout session not found', 404);
  assertCheckoutRuntimeSessionOwner(data.subscriber_id, subscriberId);
  return data as RuntimeSessionRow;
}

async function claimOwnedRow(subscriberId: string, sessionId: string): Promise<RuntimeSessionRow> {
  const { data, error } = await supabaseAdmin.rpc('claim_checkout_runtime_session', {
    p_session_id: sessionId,
    p_subscriber_id: subscriberId,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error) throw new CheckoutRuntimeSessionError('Could not lock checkout session', 500);
  if (!row) throw new CheckoutRuntimeSessionError('Checkout session is already being updated', 409);
  assertCheckoutRuntimeSessionOwner(row.subscriber_id, subscriberId);
  return row as RuntimeSessionRow;
}

async function syncExpiryAndProviderState(row: RuntimeSessionRow) {
  if (new Date(row.expires_at).getTime() <= Date.now()) return expireRow(row);
  if (['trolley_ready', 'failed', 'expired'].includes(row.state)) return publicRow(row);
  const providerState = await requireProvider().getState(row.provider_session_id);
  if (providerState === 'failed') return failRow(row, 'provider_failed');
  if (providerState === 'expired') return expireRow(row);
  return publicRow(row);
}

async function transitionIfNeeded(row: RuntimeSessionRow, state: CheckoutRuntimeState) {
  return row.state === state ? publicRow(row) : publicRow(await updateState(row, state) as RuntimeSessionRow);
}

async function failRow(row: RuntimeSessionRow, code: string) {
  if (row.state === 'failed') return publicRow(row);
  await createConfiguredBrowserbaseProvider()?.destroySession(row.provider_session_id).catch(() => undefined);
  return publicRow(await updateState(row, 'failed', { failure_code: code }) as RuntimeSessionRow);
}

async function expireRow(row: RuntimeSessionRow) {
  if (row.state === 'expired') return publicRow(row);
  await createConfiguredBrowserbaseProvider()?.destroySession(row.provider_session_id).catch(() => undefined);
  return publicRow(await updateState(row, 'expired', {}) as RuntimeSessionRow);
}

async function updateState(row: RuntimeSessionRow, state: CheckoutRuntimeState, extra: Record<string, unknown> = {}) {
  assertCheckoutRuntimeTransition(row.state, state);
  const { data, error } = await supabaseAdmin
    .from('checkout_runtime_sessions')
    .update({ state, updated_at: new Date().toISOString(), ...extra })
    .eq('id', row.id)
    .eq('subscriber_id', row.subscriber_id)
    .eq('state', row.state)
    .select('*')
    .single();
  if (error || !data) throw new CheckoutRuntimeSessionError('Checkout session changed concurrently', 409);
  return data;
}

function publicRow(row: RuntimeSessionRow) {
  return {
    id: row.id,
    retailer: row.retailer,
    state: row.state,
    expires_at: row.expires_at,
    verified_item_count: row.verified_item_count,
    verified_trolley_value: row.verified_trolley_value,
    failure_code: row.failure_code,
  };
}

async function recordRuntimeEvent(
  subscriberId: string,
  sessionId: string,
  eventType: 'handoff_started' | 'retailer_trolley_prepared',
  plan: CheckoutRuntimePlan,
) {
  await supabaseAdmin.from('agent_events').insert({
    event_type: eventType,
    subscriber_id: subscriberId,
    session_id: sessionId,
    metadata: {
      retailer: plan.retailer,
      mapped_item_count: plan.mappedItemCount,
      total_item_count: plan.totalItemCount,
      approximate_value: plan.approximateValue,
      execution_method: plan.executionMethod,
      provider: 'browserbase',
    },
  });
}
