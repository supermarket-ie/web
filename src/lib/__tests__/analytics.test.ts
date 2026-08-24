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
