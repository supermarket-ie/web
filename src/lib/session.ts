// Client-side session helpers. The browser stores only a non-secret marker and
// profile preferences; authenticated API access is backed by an HttpOnly cookie.

export const SESSION_KEY = 'sm_session';
export const PROFILE_KEY = 'sm_planner_profile';

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

export function saveSession(data: SessionData) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...data, token: '__cookie__' }));
  } catch {}
}

export function loadSession(): SessionData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SessionData;
    if (Date.now() > d.expiresAt) { clearSession(); return null; }
    return { ...d, token: '__cookie__' };
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
