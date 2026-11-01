import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Integration tests that apply the REAL production migration SQL into a
 * Postgres engine (PGlite) and exercise the atomic safeguard RPCs directly.
 * This proves the corrections requested in review:
 *  1. ceiling uses reserved + settled (not greatest)
 *  2. null/zero/negative estimates rejected; invalid actuals coerced
 *  5. simultaneous reservations, partial settlement, near-ceiling, cross-guest
 *  6. existing safeguards still work (rate limit, concurrency, conversation cap)
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(here, '../../../../supabase/migrations/20261101120000_agent_poc_safeguards.sql');

let db: PGlite;

async function reserve(cents: number): Promise<{ ok: boolean; reservation_id: string | null }> {
  const r = await db.query<{ ok: boolean; reservation_id: string | null }>(
    'select * from public.agent_bedrock_spend_reserve($1)',
    [cents],
  );
  return r.rows[0];
}
async function settle(id: string, actual: number | null): Promise<void> {
  await db.query('select public.agent_bedrock_spend_settle($1, $2)', [id, actual]);
}
async function ledger(): Promise<{ reserved_cents: string; settled_cents: string }> {
  const r = await db.query<{ reserved_cents: string; settled_cents: string }>(
    "select reserved_cents, settled_cents from public.agent_bedrock_spend_ledger where utc_day = (now() at time zone 'utc')::date",
  );
  return r.rows[0] ?? { reserved_cents: '0', settled_cents: '0' };
}
async function ensure(convId: string | null, guestKey: string, sub: string | null) {
  const r = await db.query<{ allowed: boolean; reason: string; conversation_id: string | null; message_count: number }>(
    'select * from public.agent_conversation_ensure($1, $2, $3)',
    [convId, guestKey, sub],
  );
  return r.rows[0];
}
async function rateCheck(guestKey: string, convId: string | null) {
  const r = await db.query<{ allowed: boolean; reason: string }>(
    'select * from public.agent_guest_rate_check($1, $2)',
    [guestKey, convId],
  );
  return r.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(readFileSync(MIGRATION, 'utf8'));
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  // Reset mutable state between tests (keep schema).
  await db.exec(
    'truncate public.agent_turns, public.agent_bedrock_spend_reservations, public.agent_bedrock_spend_ledger, public.agent_guest_limits, public.agent_conversations restart identity cascade;',
  );
});

describe('spend breaker: reserved + settled ceiling (correction #1)', () => {
  it('counts outstanding reservations AND settled spend together against $10/day', async () => {
    // Reserve 600c (outstanding), settle 300c of it would leave reserved accounting;
    // instead: reserve 600, settle it to 300 settled; then reserve again.
    const a = await reserve(600);
    expect(a.ok).toBe(true);
    await settle(a.reservation_id!, 300); // reserved 600->0, settled 0->300
    let l = await ledger();
    expect(Number(l.reserved_cents)).toBe(0);
    expect(Number(l.settled_cents)).toBe(300);

    // Now reserve 500 (outstanding) -> reserved 500, settled 300, sum 800 <= 1000 OK
    const b = await reserve(500);
    expect(b.ok).toBe(true);
    l = await ledger();
    expect(Number(l.reserved_cents)).toBe(500);
    expect(Number(l.settled_cents)).toBe(300);

    // A further 300 would make reserved(500)+settled(300)+300 = 1100 > 1000 -> REJECT.
    // (The OLD greatest() logic would have allowed it: greatest(500,300)+300=800<=1000.)
    const c = await reserve(300);
    expect(c.ok).toBe(false);
    expect(c.reservation_id).toBeNull();
  });

  it('admits exactly up to the ceiling and rejects the next cent', async () => {
    const a = await reserve(1000);
    expect(a.ok).toBe(true);
    const b = await reserve(0.1);
    expect(b.ok).toBe(false);
  });
});

describe('spend breaker: invalid values (correction #2)', () => {
  it('rejects null, zero and negative estimates', async () => {
    expect((await reserve(0)).ok).toBe(false);
    expect((await reserve(-5)).ok).toBe(false);
    const nullRes = await db.query<{ ok: boolean }>('select * from public.agent_bedrock_spend_reserve(null)');
    expect(nullRes.rows[0].ok).toBe(false);
    // No reservation rows or ledger debit were created.
    const l = await ledger();
    expect(Number(l.reserved_cents || 0)).toBe(0);
  });

  it('coerces a negative/null actual cost to 0 on settle (no ledger corruption)', async () => {
    const a = await reserve(200);
    await settle(a.reservation_id!, -50);
    let l = await ledger();
    expect(Number(l.reserved_cents)).toBe(0);
    expect(Number(l.settled_cents)).toBe(0); // negative coerced to 0

    const b = await reserve(200);
    await settle(b.reservation_id!, null);
    l = await ledger();
    expect(Number(l.settled_cents)).toBe(0); // null coerced to 0
  });

  it('table constraint forbids a non-positive reservation row directly', async () => {
    await expect(
      db.query("insert into public.agent_bedrock_spend_reservations (utc_day, estimate_cents) values ((now() at time zone 'utc')::date, 0)"),
    ).rejects.toThrow();
  });
});

describe('spend breaker: partial settlement + simultaneous reservations (correction #5)', () => {
  it('partial settle retires the estimate and books the real cost', async () => {
    const a = await reserve(400);
    await settle(a.reservation_id!, 150);
    const l = await ledger();
    expect(Number(l.reserved_cents)).toBe(0);
    expect(Number(l.settled_cents)).toBe(150);
  });

  it('two concurrent-ish reservations both count; the second is bounded by the first', async () => {
    const a = await reserve(700);
    expect(a.ok).toBe(true);
    const b = await reserve(400); // 700+400=1100 > 1000 -> reject while first outstanding
    expect(b.ok).toBe(false);
    const c = await reserve(300); // 700+300=1000 -> OK
    expect(c.ok).toBe(true);
  });

  it('idempotent settle does not double-book', async () => {
    const a = await reserve(500);
    await settle(a.reservation_id!, 250);
    await settle(a.reservation_id!, 250); // second settle is a no-op
    const l = await ledger();
    expect(Number(l.settled_cents)).toBe(250);
  });
});

describe('conversation ownership (correction #3)', () => {
  it('rejects another guest using a conversation they do not own', async () => {
    const owner = await ensure(null, 'guest:alice', null);
    expect(owner.allowed).toBe(true);
    const convId = owner.conversation_id!;

    // A different guest supplies alice's conversation id.
    const intruder = await ensure(convId, 'guest:bob', null);
    expect(intruder.allowed).toBe(false);
    expect(intruder.reason).toBe('not_owned');

    // And the rate check also refuses to operate on it for bob.
    const rc = await rateCheck('guest:bob', convId);
    expect(rc.allowed).toBe(false);
    expect(rc.reason).toBe('not_owned');

    // The real owner still works.
    const back = await ensure(convId, 'guest:alice', null);
    expect(back.allowed).toBe(true);
    expect(back.conversation_id).toBe(convId);
  });

  it('an unknown conversation id is NOT adopted under the client id (server generates one)', async () => {
    const chosen = '11111111-1111-1111-1111-111111111111';
    const res = await ensure(chosen, 'guest:carol', null);
    expect(res.allowed).toBe(true);
    expect(res.conversation_id).not.toBe(chosen); // server-generated, not the supplied id
  });

  it('a subscriber key and a guest key are distinct owners', async () => {
    const sub = await ensure(null, 'sub:user-1', 'user-1');
    const intruderGuest = await ensure(sub.conversation_id!, 'guest:zzz', null);
    expect(intruderGuest.reason).toBe('not_owned');
  });
});

describe('existing safeguards still work (correction #6)', () => {
  it('rate check allows, claims the concurrent lock, then blocks a second call; turn_record releases it', async () => {
    const conv = await ensure(null, 'guest:d', null);
    const cid = conv.conversation_id!;
    expect((await rateCheck('guest:d', cid)).reason).toBe('ok');
    expect((await rateCheck('guest:d', cid)).reason).toBe('concurrent_limit');
    await db.query("select public.agent_turn_record($1,'guest:d',null,100,50,0.5,'completed','m')", [cid]);
    // lock released -> allowed again
    expect((await rateCheck('guest:d', cid)).reason).toBe('ok');
  });

  it('enforces the 15-message conversation cap', async () => {
    const conv = await ensure(null, 'guest:e', null);
    const cid = conv.conversation_id!;
    for (let i = 0; i < 15; i++) {
      await db.query("select public.agent_turn_record($1,'guest:e',null,1,1,0.01,'completed','m')", [cid]);
    }
    const capped = await ensure(cid, 'guest:e', null);
    expect(capped.allowed).toBe(false);
    expect(capped.reason).toBe('conversation_limit');
  });

  it('enforces the 10/hour message cap', async () => {
    const conv = await ensure(null, 'guest:f', null);
    const cid = conv.conversation_id!;
    for (let i = 0; i < 10; i++) {
      expect((await rateCheck('guest:f', cid)).allowed).toBe(true);
      await db.query("select public.agent_turn_record($1,'guest:f',null,1,1,0.01,'completed','m')", [cid]);
    }
    const over = await rateCheck('guest:f', cid);
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe('hour_limit');
  });
});
