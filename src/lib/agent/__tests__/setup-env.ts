// Shared test env for the agent PoC tests. The reused Eve helpers
// (agent/lib/supabase.ts) validate these at module load, and the guest-cookie
// HMAC needs a secret. None point at a real service — the Supabase clients are
// mocked/stubbed in every test.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://stub.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'stub-service-role-key';
process.env.AGENT_GUEST_COOKIE_SECRET ??= 'test-guest-secret';
process.env.MAGIC_LINK_SECRET ??= 'test-magic-link-secret';
