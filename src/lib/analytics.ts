const SESSION_KEY = 'smi_session_id';

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
  }).catch(() => {}); // Swallow errors - analytics should never break the app
}
