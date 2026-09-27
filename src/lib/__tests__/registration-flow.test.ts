import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { guestShopFixture } from './fixtures/registration-shop';

// Route integration uses an isolated database double and email sink. The actual
// Postgres claim/ownership/expiry assertions live in supabase/tests separately.
const fixture = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const tables: Record<string, Row[]> = {};
  const flags = { stagingFails: false, emailFails: false };
  class Query {
    operation = 'select'; values: Row[] = []; filters: Array<(row: Row) => boolean> = [];
    constructor(readonly table: string) {}
    select() { return this; }
    insert(value: Row | Row[]) { this.operation = 'insert'; this.values = Array.isArray(value) ? value : [value]; return this; }
    update(value: Row) { this.operation = 'update'; this.values = [value]; return this; }
    delete() { this.operation = 'delete'; return this; }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
    neq(key: string, value: unknown) { this.filters.push(row => row[key] !== value); return this; }
    lt(key: string, value: string) { this.filters.push(row => String(row[key]) < value); return this; }
    gt(key: string, value: string) { this.filters.push(row => String(row[key]) > value); return this; }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this; }
    order() { return this; }
    run(single = false) {
      const rows = tables[this.table] ??= [];
      let selected = rows.filter(row => this.filters.every(filter => filter(row)));
      if (this.operation === 'insert') {
        if (flags.stagingFails && this.table === 'registration_continuations') return { data: null, error: { code: 'unavailable' }, count: 0 };
        selected = this.values.map(value => ({ id: crypto.randomUUID(), ...value }));
        rows.push(...selected);
      } else if (this.operation === 'update') {
        selected.forEach(row => Object.assign(row, this.values[0]));
      } else if (this.operation === 'delete') {
        tables[this.table] = rows.filter(row => !selected.includes(row));
      }
      return { data: single ? selected[0] ?? null : selected, error: null, count: selected.length };
    }
    single() { return Promise.resolve(this.run(true)); }
    maybeSingle() { return Promise.resolve(this.run(true)); }
    then(resolve: (value: ReturnType<Query['run']>) => unknown) { return Promise.resolve(this.run()).then(resolve); }
  }
  const send = vi.fn<(message: Row) => Promise<{ error: { message: string } | null }>>(async () => ({ error: flags.emailFails ? { message: 'Email sink rejected request' } : null }));
  const rpc = vi.fn(async (_name: string, args: Row) => {
    const pending = tables.registration_continuations?.find(row => row.id === args.p_id && row.email_hash === args.p_email_hash);
    if (!pending) return { data: null, error: null };
    if (!pending.conversation_id) {
      const payload = pending.payload as Row;
      const id = crypto.randomUUID();
      (tables.conversations ??= []).push({ id, subscriber_id: args.p_subscriber_id, ...payload });
      pending.conversation_id = id;
      pending.payload = null;
    }
    return { data: { conversation_id: pending.conversation_id }, error: null };
  });
  return { tables, flags, send, rpc, db: { from: (table: string) => new Query(table), rpc } };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: fixture.db }));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: fixture.send } } }));

const secret = 'isolated-registration-route-test-secret';
let ip = 0;
beforeEach(() => {
  Object.keys(fixture.tables).forEach(key => delete fixture.tables[key]);
  fixture.send.mockClear(); fixture.rpc.mockClear();
  fixture.flags.stagingFails = false; fixture.flags.emailFails = false;
  vi.stubEnv('MAGIC_LINK_SECRET', secret);
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://supermarket.test');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', ''); vi.stubEnv('TELEGRAM_CHAT_ID', '');
});

const request = (path: string, body: unknown, cookie?: string) => new NextRequest(`https://supermarket.test${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `192.0.2.${++ip}`, ...(cookie ? { cookie: `sm_session=${cookie}` } : {}) }, body: JSON.stringify(body),
});

async function subscribe(email: string, continuation?: unknown) {
  const { POST } = await import('../../app/api/subscribe/route');
  return POST(request('/api/subscribe', { email, continuation, sessionId: 'isolated-browser', source: 'signup' }));
}

function emailLink() {
  const mail = fixture.send.mock.calls.at(-1)?.[0] as unknown as { text: string; subject: string };
  return { mail, url: mail.text.match(/https:\/\/supermarket\.test\/\S+/)![0] };
}

describe('verified email shop continuation routes', () => {
  it('carries a guest shop into a new account without browser storage, then saves it once', async () => {
    const shop = guestShopFixture();
    expect((await subscribe('new-shopper@example.invalid', { events: shop.events, session: { sessionId: 'never-transfer' } })).status).toBe(200);
    const { mail, url } = emailLink();
    expect(mail.subject).toContain('Save your household shop');
    const claims = jwt.verify(new URL(url).searchParams.get('token')!, secret) as jwt.JwtPayload;
    expect(claims.continuationId).toBeTruthy();
    expect(claims).not.toHaveProperty('events');
    expect(claims).not.toHaveProperty('household');
    expect(fixture.tables.subscribers).toBeUndefined();

    const { GET } = await import('../../app/api/auth/complete-registration/route');
    const verified = await GET(new NextRequest(url));
    expect(verified.status).toBe(307);
    expect(verified.headers.get('location')).toContain(`continuation=${claims.continuationId}`);
    const cookie = verified.cookies.get('sm_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(fixture.tables.subscribers).toHaveLength(1);
    expect(fixture.tables.subscribers[0].family_size).toBe('3');

    const { POST: restore } = await import('../../app/api/auth/restore-continuation/route');
    const restored = await restore(request('/api/auth/restore-continuation', { id: claims.continuationId }, cookie.value));
    const { conversationId } = await restored.json();
    const repeated = await restore(request('/api/auth/restore-continuation', { id: claims.continuationId }, cookie.value));
    expect(await repeated.json()).toEqual({ conversationId });
    expect(fixture.tables.conversations).toHaveLength(1);
    expect(fixture.tables.registration_continuations[0].payload).toBeNull();
    expect(fixture.rpc).toHaveBeenCalledWith('claim_registration_continuation', expect.objectContaining({ p_email: 'new-shopper@example.invalid', p_subscriber_id: fixture.tables.subscribers[0].id }));

    const { POST: save } = await import('../../app/api/lists/save-from-planner/route');
    const body = { household_shop: shop.shop, conversation_id: conversationId };
    const saved = await save(request('/api/lists/save-from-planner', body, cookie.value));
    expect(saved.status).toBe(200);
    const duplicate = await save(request('/api/lists/save-from-planner', body, cookie.value));
    expect((await duplicate.json()).already_saved).toBe(true);
    expect(fixture.tables.saved_lists).toHaveLength(1);
    expect((fixture.tables.saved_lists[0].items as Array<{ quantity: number }>)[0].quantity).toBe(3);
    expect(fixture.tables.agent_events.filter(row => row.event_type === 'registration_shop_saved')).toHaveLength(1);
    expect(fixture.tables.agent_events.filter(row => row.event_type === 'signup_completed')).toHaveLength(1);
  });

  it('preserves an existing household size and directs them to the new guest conversation', async () => {
    fixture.tables.subscribers = [{ id: crypto.randomUUID(), email: 'returning@example.invalid', family_size: '5', subscribed: true }];
    fixture.tables.conversations = [{ id: crypto.randomUUID(), title: 'Older shop' }];
    await subscribe('returning@example.invalid', { events: guestShopFixture().events });
    const { GET } = await import('../../app/api/auth/complete-registration/route');
    const verified = await GET(new NextRequest(emailLink().url));
    expect(verified.headers.get('location')).toContain('new=0&continuation=');
    expect(fixture.tables.subscribers[0].family_size).toBe('5');
    expect(fixture.tables.agent_events.filter(row => row.event_type === 'signup_completed')).toHaveLength(0);
  });

  it('does not send a misleading email when staging fails or the payload is invalid', async () => {
    fixture.flags.stagingFails = true;
    expect((await subscribe('failed-stage@example.invalid', { events: guestShopFixture().events })).status).toBe(503);
    expect(fixture.send).not.toHaveBeenCalled();
    fixture.flags.stagingFails = false;
    expect((await subscribe('invalid-stage@example.invalid', { events: [null] })).status).toBe(503);
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it('discards the staged handoff if the email provider rejects delivery', async () => {
    fixture.flags.emailFails = true;
    expect((await subscribe('failed-email@example.invalid', { events: guestShopFixture().events })).status).toBe(502);
    expect(fixture.tables.registration_continuations).toHaveLength(0);
  });

  it('rejects unauthenticated restores and expired or forged verification links', async () => {
    const { POST } = await import('../../app/api/auth/restore-continuation/route');
    expect((await POST(request('/api/auth/restore-continuation', { id: crypto.randomUUID() }))).status).toBe(401);
    expect(fixture.rpc).not.toHaveBeenCalled();
    const { GET } = await import('../../app/api/auth/complete-registration/route');
    for (const token of ['forged', jwt.sign({ purpose: 'registration_verification', email: 'expired@example.invalid' }, secret, { expiresIn: '-1s' })]) {
      const response = await GET(new NextRequest(`https://supermarket.test/api/auth/complete-registration?token=${token}`));
      expect(response.headers.get('location')).toContain('error=expired');
      expect(response.cookies.get('sm_session')).toBeUndefined();
    }
  });

  it('requires a fresh email to resume an expired link, bound to the same recipient and draft', async () => {
    await subscribe('retry-draft@example.invalid', { events: guestShopFixture().events });
    const claims = jwt.verify(new URL(emailLink().url).searchParams.get('token')!, secret) as jwt.JwtPayload;
    const expired = jwt.sign({ purpose: 'registration_verification', email: claims.email, continuationId: claims.continuationId }, secret, { expiresIn: '-1s' });
    const { GET } = await import('../../app/api/auth/complete-registration/route');
    const response = await GET(new NextRequest(`https://supermarket.test/api/auth/complete-registration?token=${expired}`));
    expect(response.cookies.get('sm_session')).toBeUndefined();
    expect(response.headers.get('location')).toContain(`error=expired&continuation=${claims.continuationId}`);
    expect(fixture.tables.subscribers).toBeUndefined();
    const { POST } = await import('../../app/api/subscribe/route');
    expect((await POST(request('/api/subscribe', { email: claims.email, continuationId: claims.continuationId }))).status).toBe(200);
    const fresh = jwt.verify(new URL(emailLink().url).searchParams.get('token')!, secret) as jwt.JwtPayload;
    expect(fresh.continuationId).toBe(claims.continuationId);
    expect(fixture.tables.registration_continuations).toHaveLength(1);
    expect((await POST(request('/api/subscribe', { email: 'wrong-recipient@example.invalid', continuationId: claims.continuationId }))).status).toBe(503);
    expect(fixture.send).toHaveBeenCalledTimes(2);
    fixture.tables.registration_continuations[0].expires_at = new Date(Date.now() - 1_000).toISOString();
    expect((await POST(request('/api/subscribe', { email: claims.email, continuationId: claims.continuationId }))).status).toBe(503);
    expect(fixture.send).toHaveBeenCalledTimes(2);
  });
});
