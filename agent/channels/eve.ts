import { eveChannel } from 'eve/channels/eve';
import { localDev, type AuthFn } from 'eve/channels/auth';
import { verifySessionToken } from '../../src/lib/auth';

function supermarketSessionAuth(): AuthFn<Request> {
  return async (request) => {
    const header = request.headers.get('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const payload = verifySessionToken(bearer);
    if (!payload) return null;

    return {
      authenticator: 'supermarket-session',
      issuer: 'https://supermarket.ie',
      principalId: payload.subscriberId,
      principalType: 'user',
      subject: payload.subscriberId,
      attributes: payload.email ? { email: payload.email } : {},
    };
  };
}

// Production is fail-closed: callers must present the existing Supermarket.ie
// subscriber JWT. localDev keeps Eve's developer REPL usable on localhost.
export default eveChannel({
  auth: [supermarketSessionAuth(), localDev()],
});
