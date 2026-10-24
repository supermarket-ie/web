# Preview database fixtures

Synthetic, isolated data for the AWS preview so pages render with representative
content without a live production database and **without any production data**.

## Files

- `fixtures.json` — ~8 synthetic canonical products, their store mappings, and
  illustrative `price_observations`. All values are made up; nothing is a real
  retailer observation. URLs point at `preview.invalid`.
- `seed-preview-db.mjs` — seeds the fixtures into an **isolated** Supabase
  branch/clone. It cannot target production:
  - uses distinct `PREVIEW_SUPABASE_URL` / `PREVIEW_SUPABASE_SERVICE_ROLE_KEY`
    vars (not the app's production names),
  - denylists known production project refs,
  - requires `--confirm-isolated`.

## Preferred isolation approaches (in order)

1. **Supabase branch** of the project (schema identical, data isolated). Seed
   with this script, or rely on a branch snapshot.
2. **Read-only restricted key** against production — pages render real data but
   no writes are possible. (No seeding needed; do NOT run this script against it.)
3. **Fixtures via this script** into a standalone preview project — fully
   isolated when a branch isn't available.

## Why fixtures are NOT wired into the app's price/catalogue code

The trusted-price boundary (`latest_prices` → `price-data.ts`) is deliberately
fail-closed and must never substitute non-trusted data. Injecting fixtures into
that read path would weaken a product-identity safeguard. Instead, fixtures live
entirely outside the app and are loaded into an isolated DB the app then reads
normally. The existing `CI` empty-catalogue escape hatch remains the only
build-time bypass and, by design, cannot activate in preview or production.

## Usage

```bash
PREVIEW_SUPABASE_URL=https://<preview-ref>.supabase.co \
PREVIEW_SUPABASE_SERVICE_ROLE_KEY=<preview-branch-key> \
node infra/preview-fixtures/seed-preview-db.mjs --confirm-isolated
```
