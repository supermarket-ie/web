// Single source of truth for subscriber session-token verification.
// Every API route that needs the calling subscriber should use one of these
// instead of rolling its own jwt.verify — all queries run through the
// service-role Supabase client, so a missed auth check exposes everything.

import jwt from 'jsonwebtoken';

/** Thrown by requireSubscriberId; carries the HTTP status routes should return. */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = 'Invalid or missing session token') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

// Read lazily (not at module load) so builds and tests that never verify a
// token don't require the env var to be present.
function secret(): string {
  const s = process.env.MAGIC_LINK_SECRET;
  if (!s) throw new Error('MAGIC_LINK_SECRET environment variable is required');
  return s;
}

/** Claims carried by a subscriber session token (magic-link JWT). */
export interface SessionPayload {
  subscriberId: string;
  email?: string;
  familySize?: string;
}

/**
 * Verifies a session token and returns its full payload, or null for a
 * missing, malformed, expired, or forged token. Use when the route needs
 * claims beyond the subscriber id (email, familySize).
 */
export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  try {
    const p = jwt.verify(token, secret()) as Partial<SessionPayload>;
    return p.subscriberId ? (p as SessionPayload) : null;
  } catch {
    return null;
  }
}

/**
 * Safe variant: returns the subscriber id, or null for a missing, malformed,
 * expired, or forged token. Use when the route has a meaningful
 * unauthenticated path (e.g. /api/plan works for anonymous users).
 */
export function getSubscriberId(token: string | null | undefined): string | null {
  return verifySessionToken(token)?.subscriberId ?? null;
}

/**
 * Strict variant: returns the subscriber id or throws UnauthorizedError.
 * Prefer this in new routes — forgetting to handle the unauthenticated case
 * fails loudly at the auth call instead of silently leaking further down.
 */
export function requireSubscriberId(token: string | null | undefined): string {
  const id = getSubscriberId(token);
  if (!id) throw new UnauthorizedError();
  return id;
}
