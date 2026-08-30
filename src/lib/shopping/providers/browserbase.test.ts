import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
vi.mock('server-only', () => ({}));
import { createCheckoutRuntimePlan } from '../checkout-runtime';
import { BrowserbaseCheckoutRuntimeProvider, type PageConnector } from './browserbase';

const item = {
  canonicalName: 'Whole milk',
  retailerUrl: 'https://shop.supervalu.ie/sm/delivery/rsid/5552/product/example/1001',
  retailerProductId: '1001',
  retailerProductName: 'SuperValu Fresh Irish Whole Milk 2L',
  quantity: 1,
  price: 2.25,
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Browserbase checkout provider', () => {
  it('creates an isolated EU session with logs and recordings disabled', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        id: 'provider-session-1',
        expiresAt: '2026-08-30T20:00:00.000Z',
        status: 'RUNNING',
        connectUrl: 'wss://connect.browserbase.com/opaque',
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        debuggerFullscreenUrl: 'https://www.browserbase.com/live/opaque',
        wsUrl: 'wss://connect.browserbase.com/opaque',
      }));
    const goto = vi.fn().mockResolvedValue(null);
    const connectionUrls: string[] = [];
    const connectPage: PageConnector = async <T,>(wsUrl: string, action: (page: Page) => Promise<T>) => {
      connectionUrls.push(wsUrl);
      return action({ goto } as unknown as Page);
    };
    const provider = new BrowserbaseCheckoutRuntimeProvider(
      { apiKey: 'test-key' },
      request,
      connectPage,
    );
    const plan = createCheckoutRuntimePlan({ retailer: 'supervalu', items: [item], providerConfigured: true });

    const session = await provider.createSession(plan);

    expect(session.sessionId).toBe('provider-session-1');
    const createBody = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(createBody).toMatchObject({
      region: 'eu-central-1',
      keepAlive: true,
      timeout: 1200,
      browserSettings: { recordSession: false, logSession: false },
    });
    expect(createBody.browserSettings).not.toHaveProperty('context');
    expect(connectionUrls).toEqual(['wss://connect.browserbase.com/opaque']);
    expect(goto).toHaveBeenCalledWith(item.retailerUrl, expect.objectContaining({ waitUntil: 'domcontentloaded' }));
  });

  it('refuses a launch when the retailer runtime is not enabled', async () => {
    const provider = new BrowserbaseCheckoutRuntimeProvider(
      { apiKey: 'test-key' },
      vi.fn<typeof fetch>(),
    );
    const dunnesPlan = createCheckoutRuntimePlan({
      retailer: 'dunnes',
      providerConfigured: true,
      items: [{ ...item, retailerUrl: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/example/1001' }],
    });
    await expect(provider.createSession(dunnesPlan)).rejects.toThrow(/not allowed/i);
  });

  it('explicitly releases provider state', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: 'COMPLETED' }));
    const provider = new BrowserbaseCheckoutRuntimeProvider(
      { apiKey: 'test-key' },
      request,
    );
    await provider.destroySession('provider-session-1');
    expect(request).toHaveBeenCalledWith(
      'https://api.browserbase.com/v1/sessions/provider-session-1',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ status: 'REQUEST_RELEASE' }) }),
    );
  });
});
