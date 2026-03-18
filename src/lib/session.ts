// Client-side session helpers — token stored in localStorage

export const SESSION_KEY = 'sm_session';

export interface SessionData {
  token: string;
  familySize: string;
  email?: string;
  expiresAt: number; // ms timestamp
}

export function saveSession(data: SessionData) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {}
}

export function loadSession(): SessionData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SessionData;
    if (Date.now() > d.expiresAt) { clearSession(); return null; }
    return d;
  } catch { return null; }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}
