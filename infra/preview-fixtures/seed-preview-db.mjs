#!/usr/bin/env node
/**
 * Seed an ISOLATED Supabase preview database with synthetic fixtures.
 *
 * SAFETY — this script refuses to touch production:
 *  - Requires PREVIEW_SUPABASE_URL and PREVIEW_SUPABASE_SERVICE_ROLE_KEY
 *    (distinct names from the app's production vars, so you can't pass prod by
 *    habit).
 *  - Hard-blocks a denylist of known production project refs.
 *  - Requires explicit --confirm-isolated to run.
 *  - Writes ONLY synthetic fixture rows (no real pricing observations).
 *
 * Usage:
 *   PREVIEW_SUPABASE_URL=https://<preview-ref>.supabase.co \
 *   PREVIEW_SUPABASE_SERVICE_ROLE_KEY=<preview-branch-key> \
 *   node infra/preview-fixtures/seed-preview-db.mjs --confirm-isolated
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Known production project refs that must NEVER be seeded. Extend as needed.
const PRODUCTION_PROJECT_REF_DENYLIST = ['ytyzwiqnobxehdqrnzhx'];

function fail(msg) {
  console.error(`\n[seed-preview-db] REFUSING: ${msg}\n`);
  process.exit(1);
}

const url = process.env.PREVIEW_SUPABASE_URL?.trim();
const key = process.env.PREVIEW_SUPABASE_SERVICE_ROLE_KEY?.trim();
const confirmed = process.argv.includes('--confirm-isolated');

if (!confirmed) fail('pass --confirm-isolated to acknowledge this targets an isolated preview DB.');
if (!url || !key) fail('PREVIEW_SUPABASE_URL and PREVIEW_SUPABASE_SERVICE_ROLE_KEY are required.');

let ref = '';
try {
  ref = new URL(url).hostname.split('.')[0];
} catch {
  fail(`PREVIEW_SUPABASE_URL is not a valid URL: ${url}`);
}
if (PRODUCTION_PROJECT_REF_DENYLIST.includes(ref)) {
  fail(`target project ref "${ref}" is on the production denylist. This script only seeds isolated previews.`);
}

const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures.json'), 'utf8'));
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function upsert(table, rows) {
  const { error } = await db.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`upsert ${table} failed: ${error.message}`);
  console.log(`[seed-preview-db] upserted ${rows.length} rows into ${table}`);
}

async function main() {
  console.log(`[seed-preview-db] target preview project ref: ${ref}`);
  await upsert('products', fixtures.products);
  await upsert('store_products', fixtures.store_products);

  // price_observations have generated ids; insert with observed_at = now.
  const observations = fixtures.price_observations.map((o) => ({
    ...o,
    observed_at: new Date().toISOString(),
    source: 'preview_fixture',
  }));
  const { error } = await db.from('price_observations').insert(observations);
  if (error) throw new Error(`insert price_observations failed: ${error.message}`);
  console.log(`[seed-preview-db] inserted ${observations.length} synthetic price_observations`);

  console.log('\n[seed-preview-db] done. NOTE: trusted-price promotion into latest_prices depends on the');
  console.log('project\'s own provenance rules/migrations; fixtures are synthetic and clearly sourced as preview_fixture.');
}

main().catch((e) => fail(e.message));
