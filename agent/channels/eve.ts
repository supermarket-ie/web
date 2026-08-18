import { eveChannel } from 'eve/channels/eve';
import { localDev, type AuthFn } from 'eve/channels/auth';
import { verifySessionToken } from '../../src/lib/auth';

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rawValue.join('='));
  }
  return null;
}

function supermarketSessionAuth(): AuthFn<Request> {
  return async (request) => {
    const header = request.headers.get('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const sessionCookie = cookieValue(request, 'sm_session');
    const payload = verifySessionToken(sessionCookie ?? bearer);
    if (!payload) return null;

    const attributes: Record<string, string | readonly string[]> = {};
    if (payload.email) attributes.email = payload.email;

    return {
      authenticator: 'supermarket-session',
      issuer: 'https://supermarket.ie',
      principalId: payload.subscriberId,
      principalType: 'user',
      subject: payload.subscriberId,
      attributes,
    };
  };
}

// Production is fail-closed: normal signed-in browser requests authenticate
// through the existing HttpOnly sm_session cookie. Bearer auth remains available
// for trusted non-browser clients. localDev keeps Eve's developer REPL usable.
export default eveChannel({
  auth: [supermarketSessionAuth(), localDev()],
});
