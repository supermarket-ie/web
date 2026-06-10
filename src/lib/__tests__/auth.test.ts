import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  getSubscriberId,
  requireSubscriberId,
  verifySessionToken,
  UnauthorizedError,
} from '../auth';

const TEST_SECRET = 'test-secret-for-auth-tests';

beforeEach(() => {
  process.env.MAGIC_LINK_SECRET = TEST_SECRET;
});

const sign = (payload: object, secret = TEST_SECRET, options?: jwt.SignOptions) =>
  jwt.sign(payload, secret, options);

describe('verifySessionToken', () => {
  it('returns the full payload for a valid token', () => {
    const token = sign({ subscriberId: 'sub-1', email: 'colin@example.ie', familySize: '4' });
    expect(verifySessionToken(token)).toMatchObject({
      subscriberId: 'sub-1',
      email: 'colin@example.ie',
      familySize: '4',
    });
  });

  it('returns null for missing, malformed, or forged tokens', () => {
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken('not-a-jwt')).toBeNull();
    expect(verifySessionToken(sign({ subscriberId: 'sub-1' }, 'wrong-secret'))).toBeNull();
  });

  it('returns null for an expired token', () => {
    const token = sign({ subscriberId: 'sub-1' }, TEST_SECRET, { expiresIn: '-1s' });
    expect(verifySessionToken(token)).toBeNull();
  });

  it('returns null for a valid token without a subscriberId claim', () => {
    expect(verifySessionToken(sign({ email: 'x@y.ie' }))).toBeNull();
  });

  it('returns null (does not throw) when the secret is not configured', () => {
    delete process.env.MAGIC_LINK_SECRET;
    expect(verifySessionToken(sign({ subscriberId: 'sub-1' }))).toBeNull();
  });
});

describe('getSubscriberId', () => {
  it('returns the subscriber id for a valid token', () => {
    expect(getSubscriberId(sign({ subscriberId: 'sub-42' }))).toBe('sub-42');
  });

  it('returns null for invalid tokens', () => {
    expect(getSubscriberId('garbage')).toBeNull();
    expect(getSubscriberId(null)).toBeNull();
  });
});

describe('requireSubscriberId', () => {
  it('returns the subscriber id for a valid token', () => {
    expect(requireSubscriberId(sign({ subscriberId: 'sub-7' }))).toBe('sub-7');
  });

  it('throws UnauthorizedError with status 401 for invalid tokens', () => {
    expect(() => requireSubscriberId('garbage')).toThrowError(UnauthorizedError);
    expect(() => requireSubscriberId(undefined)).toThrowError(UnauthorizedError);
    try {
      requireSubscriberId(null);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as UnauthorizedError).status).toBe(401);
    }
  });
});
