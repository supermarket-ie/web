import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackEventOnce } from '@/lib/analytics';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('trackEventOnce', () => {
  it('sends one GA4 and internal event per browser session', () => {
    const values = new Map<string, string>();
    const gtag = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>();
    fetch.mockResolvedValue(new Response(null, { status: 200 }));

    vi.stubGlobal('window', { gtag });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal('fetch', fetch);

    const metadata = {
      auth_state: 'guest',
      entry_path: '/',
      prompt_source: 'typed',
    };

    trackEventOnce('agent_started', metadata);
    trackEventOnce('agent_started', metadata);

    expect(gtag).toHaveBeenCalledOnce();
    expect(gtag).toHaveBeenCalledWith('event', 'agent_started', metadata);
    expect(fetch).toHaveBeenCalledOnce();

    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      event_type: 'agent_started',
      metadata,
    });
    expect(body.session_id).toEqual(expect.any(String));
  });
});

it('counts each visible starter once per version and keeps selections in the same session', async () => {
  const values = new Map<string, string>();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('window', {});
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal('fetch', fetch);
  const { trackEvent } = await import('@/lib/analytics');
  const shop = { starter_id: 'shop:household', starter_kind: 'shop', starter_version: 2 };
  const meal = { starter_id: 'meal:product:store', starter_kind: 'meal', starter_version: 2 };
  trackEventOnce('starter_prompt_viewed', shop);
  trackEventOnce('starter_prompt_viewed', shop);
  trackEventOnce('starter_prompt_viewed', meal);
  trackEvent('starter_prompt_selected', meal);
  trackEventOnce('guest_shop_prepared');
  trackEventOnce('guest_shop_prepared');
  const events = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  expect(events.map(event => event.event_type)).toEqual([
    'starter_prompt_viewed', 'starter_prompt_viewed', 'starter_prompt_selected', 'guest_shop_prepared',
  ]);
  expect(new Set(events.map(event => event.session_id)).size).toBe(1);
  expect(events[2].metadata).toEqual(meal);
});
