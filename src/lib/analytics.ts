const SESSION_KEY = 'smi_session_id';

declare global {
  interface Window {
    gtag?: (command: 'event', eventName: string, parameters?: Record<string, unknown>) => void;
  }
}

function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function trackEvent(
  eventType: string,
  metadata?: Record<string, unknown>,
  token?: string,
) {
  if (typeof window !== 'undefined') {
    const gaParameters = metadata ? { ...metadata } : undefined;
    window.gtag?.('event', eventType, gaParameters);

    // GA4's recommended registration event makes the completed conversion
    // available in standard acquisition reports as well as our custom funnel.
    if (eventType === 'signup_completed') {
      window.gtag?.('event', 'sign_up', {
        method: typeof metadata?.method === 'string' ? metadata.method : 'email',
      });
    }
  }

  // Fire and forget - never block UI
  const body: Record<string, unknown> = {
    event_type: eventType,
    session_id: getSessionId(),
  };
  if (metadata) body.metadata = metadata;
  if (token) body.token = token;

  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {}); // Swallow errors - analytics should never break the app
}

export function trackEventOnce(
  eventType: string,
  metadata?: Record<string, unknown>,
  token?: string,
) {
  if (typeof window === 'undefined') return;

  const key = `smi_event_once:${eventType}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    // If storage is unavailable, preserve analytics delivery rather than
    // affecting the agent experience.
  }

  trackEvent(eventType, metadata, token);
}
