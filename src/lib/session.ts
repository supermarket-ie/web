// Client-side session helpers. The browser stores only a non-secret marker and
// profile preferences; authenticated API access is backed by an HttpOnly cookie.

export const SESSION_KEY = 'sm_session';
export const PROFILE_KEY = 'sm_planner_profile';
export const GUEST_PREVIEW_STARTED_KEY = 'sm_guest_preview_started_at';
const GUEST_EVE_CHAT_KEY = 'sm_eve_household_chat_v1:guest';
const GUEST_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const CLIENT_SESSION_TOKEN = '__cookie__';

export interface PlannerProfile {
  adults: number;
  children: number;
  childAges?: ('toddler' | 'young' | 'older' | 'teen')[];
  weeklyBudget?: number;
  preferredStores: string[];
  dietary: string[];
  dislikes?: string;
  meals: {
    breakfast: boolean;
    lunch: boolean;
    dinner: boolean;
    snacks: boolean;
  };
  batchCooking: boolean;
  skipDays?: string;
  extraContext?: string;
}

export interface SessionData {
  token: string;
  familySize: string;
  email?: string;
  expiresAt: number;
}

function markerSession(data: SessionData): SessionData {
  return { ...data, token: CLIENT_SESSION_TOKEN };
}

function clearExpiredGuestPreview() {
  try {
    const guestChat = localStorage.getItem(GUEST_EVE_CHAT_KEY);
    if (!guestChat) {
      localStorage.removeItem(GUEST_PREVIEW_STARTED_KEY);
      return;
    }

    const startedAtRaw = localStorage.getItem(GUEST_PREVIEW_STARTED_KEY);
    const startedAt = startedAtRaw ? Number(startedAtRaw) : NaN;

    // Guest chats created before the timed-preview policy have no timestamp.
    // Treat them as expired once so previously permanent gates are released.
    if (!Number.isFinite(startedAt) || Date.now() - startedAt >= GUEST_PREVIEW_TTL_MS) {
      localStorage.removeItem(GUEST_EVE_CHAT_KEY);
      localStorage.removeItem(GUEST_PREVIEW_STARTED_KEY);
    }
  } catch {}
}

export function saveSession(data: SessionData) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(markerSession(data))); } catch {}
}

export function loadSession(): SessionData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);

    // Anonymous agent conversations are deliberately temporary. A refresh does
    // not bypass the guest gate, but after 24 hours the browser receives a fresh
    // preview. Signed-in sessions are never affected by this cleanup.
    if (!raw) clearExpiredGuestPreview();

    if (!raw) return null;
    const d = JSON.parse(raw) as SessionData;
    if (Date.now() > d.expiresAt) { clearSession(); return null; }

    // Seamlessly migrate pre-cookie sessions. Remove the JWT from browser
    // storage immediately, then exchange it in the request body for the
    // HttpOnly cookie. Existing signed-in users do not need to request a new link.
    if (d.token && d.token !== CLIENT_SESSION_TOKEN) {
      const legacyToken = d.token;
      const marker = markerSession(d);
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(marker)); } catch {}
      fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify({ token: legacyToken }),
      }).catch(() => {});
      return marker;
    }

    return markerSession(d);
  } catch { return null; }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  if (typeof window !== 'undefined') {
    fetch('/api/session', {
      method: 'DELETE',
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {});
  }
}

export function saveProfile(profile: PlannerProfile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
}

export function loadProfile(): PlannerProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlannerProfile;
  } catch { return null; }
}
