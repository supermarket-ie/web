# Supermarket.ie — Canonical Project State

**Last updated:** 29 August 2026

> **READ THIS FIRST BEFORE STARTING SUPERMARKET.IE DEVELOPMENT.**
>
> This file is the canonical technical/strategic project memory. Do not infer current project state solely from chat history or an old handoff prompt. Inspect referenced code, PRs, branches and specialist docs before changing implementation.
>
> Update this file whenever a material architecture decision, experiment, integration, production change or retailer-execution finding occurs. Never place credentials or secret values here.

## 1. North star

Supermarket.ie should become **Ireland's retailer-neutral AI grocery and household shopping infrastructure**.

Target flow:

`Household intent → Shopping Capability Layer → basket → retailer execution → retailer checkout`

Supermarket.ie owns household understanding, shopping intent, product/ingredient intelligence, cross-retailer reasoning, basket construction, retailer selection, transaction origination and eventually rewards/referrals/AI-agent distribution.

Retailers initially remain merchant of record and own checkout, payment, picking and fulfilment.

Supermarket.ie is **not primarily a price-comparison website**. Long-term promise: **"the service that runs your household shop."**

## 2. Shared Shopping Capability Layer

PR #20 merged to `main` on 18 August 2026.

Merge commit: `715889a9e61d4fb7293e9691491cdd5caeb98c52`

Architecture moved from:

`Eve tool → business logic`

toward:

`Shopping Capability Service → Eve / website / API / MCP`

Shared code under `src/lib/shopping/**` includes contracts, catalogue/product resolution, retailer offers, household context, basket construction, retailer preferences, store totals, whole-basket comparison and household-shop preparation/replenishment reasoning.

Target external capabilities include `find_product()`, `get_household_context()`, `prepare_household_shop()`, `build_basket()`, `compare_shop()`, `handoff_to_retailer()` and `record_shop_outcome()`.

**Do not rebuild this layer before inspecting current `main`.**

## 3. Immediate retailer-execution milestone

`prepare_household_shop → retailer basket → populated retailer trolley → shopper checkout`

Desired UX:

1. Eve prepares the household shop.
2. Shopping Capability Layer compares retailer fulfilment/price.
3. Shopper chooses a retailer.
4. Shopper explicitly selects **Shop this basket**.
5. Retailer trolley is populated where actually supported.
6. Shopper reviews delivery/collection and pays retailer directly.

Supermarket.ie must not handle retailer passwords, payment credentials or retailer session tokens merely to populate a cart.

**Product requirement: no browser extension.** The shopper may authenticate directly with the retailer, but Supermarket.ie must not require an extension as part of normal checkout.

## 4. Retailer status

| Retailer | Current understanding | Truthful status |
|---|---|---|
| SuperValu | Instacart Storefront; strong SKU/URL/store mapping; store-scoped single + bulk cart operations understood; anonymous cart disabled; OIDC login required | `product_links` today; authenticated cart mechanics understood but no acceptable browser-only/no-extension execution path yet |
| Dunnes | **Instacart Storefront**; production refresh uses `storefrontgateway.dunnesstoresgrocery.com/api`, store `258`; mapped SKUs/rsid URLs; `/api/stores/258/cart` exists and allows GET/POST; unauthenticated GET returns 401 | Cart resource and auth boundary proven read-only; exact authenticated add payload still to be confirmed, but architecture strongly converges with SuperValu |
| Tesco | Existing retailer data plus extensive prior Pepesto work, including checkout-protocol and 3-product basket session tests | **Prior basket-handoff work exists and must be recovered before any new Tesco implementation** |
| Aldi | Catalogue/pricing pipeline; no equivalent online grocery checkout target established | No transaction adapter currently |

See `docs/retailer-execution.md` for detailed findings.

## 5. SuperValu handoff — PR #21

Branch: `agent/retailer-handoff`

Draft PR #21 established:

- shared `RetailerAdapter`
- retailer registry
- SuperValu adapter
- basket-item mapping
- selection of SuperValu alternatives
- quantity preservation
- SKU/product identity
- direct product URLs
- safe-domain validation
- complete/partial/missing mapping states
- tests

It intentionally reports `product_links`; it does **not** claim trolley population.

PR #21 predates many later `main` commits. Preserve its architecture/findings; do not merge blindly.

## 6. SuperValu cart findings — 29 August 2026

Live Storefront inspection established:

- SuperValu uses Instacart Storefront.
- `rsid` is retailer-store context.
- Cart is store-scoped.
- Add uses `POST stores/{retailerStoreId}/cart`.
- Add payload includes SKU, quantity, catalog source and shopping-mode ID.
- Client exposes single and bulk add operations (`AddProductLineItemToCart`, `AddProductLineItemsToCart`).
- Quantity update uses `SetLineItemQuantity`.
- Delivery/collection slot is not required merely to build/review cart.
- Live config has `anonymousCart: false`.
- Logged-out Add redirects into SuperValu auth.
- OIDC auth references include `sts.supervalu.ie`.

Conclusion: bulk trolley population is technically straightforward **inside an authorised SuperValu shopper context**. The blocker is execution/auth context, not product mapping.

### Rejected extension route

Branch `agent/supervalu-browser-bridge-poc`, draft PR #56, proved a browser-side Add-to-Trolley model but required a Chrome extension.

**Do not merge PR #56 as mainstream UX.**

A normal supermarket.ie page cannot manipulate an authenticated `shop.supervalu.ie` tab because of browser same-origin/security boundaries. Do not seek brittle bypasses.

## 7. Dunnes cart findings — 29 August 2026

### Important correction

Do **not** describe current Dunnes grocery as a separate Wynshop execution surface. Current production code and live retailer URLs show that Dunnes is using **Instacart Storefront infrastructure**.

Production code explicitly uses:

- gateway: `https://storefrontgateway.dunnesstoresgrocery.com/api`
- retailer store ID: `258`
- site: `https://www.dunnesstoresgrocery.com`
- shopping mode: `22222222-2222-2222-2222-222222222222`
- search path: `/api/stores/258/search`
- headers including `x-site-host`, `x-site-location`, `x-correlation-id`, `x-shopping-mode`

Mapped Dunnes `store_products` already contain stable numeric `store_sku` values and store-scoped `rsid/258` URLs.

### Read-only cart probe

Branch: `agent/dunnes-cart-probe`

A read-only Vercel-side probe used the same headers/transport as the production Dunnes refresh. It performed no login, no POST and no cart mutation.

Results:

- production-style `/api/stores/258/search`: **HTTP 200**
- `OPTIONS /api/stores/258/cart`: **HTTP 405**, with `Allow: GET, POST`
- unauthenticated `GET /api/stores/258/cart`: **HTTP 401**

This proves:

1. Dunnes has a store-scoped Storefront cart resource at `/api/stores/258/cart`.
2. The cart resource supports POST mutations.
3. The cart is authentication/session-bound rather than a freely writable server-side guest cart.
4. Dunnes and SuperValu now appear to share the same underlying Instacart Storefront execution family, so a shared Storefront execution engine is preferable to duplicating retailer-specific cart logic if/when authenticated execution is solved.

Exact Dunnes POST domain-model/body has **not yet been sent or inferred as proven**. Do not mutate a Dunnes cart merely to discover it. First exploit the common Storefront architecture/public client behaviour or Pepesto protocol evidence.

The temporary one-shot GitHub probe workflow was removed after the test.

## 8. Pepesto — EXISTING INTEGRATION AND CHECKOUT WORK, DO NOT REDISCOVER

This is a critical historical area that was previously lost between chats.

Existing branch: `pepesto-tesco-adapter`

Historical adapter: `src/lib/pepesto-tesco.ts`

API base used: `https://s.pepesto.com/api`

### Credential architecture

Historical server-side code gets the Pepesto credential via:

`supabaseAdmin.rpc('get_pepesto_api_key')`

and sends it as a Bearer token.

Established access path:

`Supermarket.ie server → Supabase get_pepesto_api_key() → Pepesto API`

Do not search for, print or expose the secret value.

### Phase 1 — Tesco search/retrieval

Earlier Pepesto work used `/credits`, `/search` and `/retrieve` for Tesco product discovery/pricing because direct Tesco scraping was problematic.

### Phase 2 — Tesco basket / checkout-protocol work

**Do not describe the prior Pepesto work as search/retrieval only.**

On 21 August 2026 we explicitly investigated how Pepesto creates a Tesco basket and began reproducing that approach for Supermarket.ie handoff.

Repo history includes commits such as:

- `add one-time Pepesto checkout protocol test`
- `add three-product Pepesto checkout protocol test`
- `schedule three-product Pepesto checkout protocol test`
- `add one-time Pepesto checkout continuation`
- `add one-time Pepesto checkout recovery turn`
- `add fresh recorded Pepesto checkout session`
- `schedule fresh Pepesto checkout recording`

The three-product test implemented:

`/products` with exact Tesco preferred URLs → exact matches → Pepesto session tokens → `/session` with quantities → Pepesto session ID → `/checkout` → record protocol instruction → continue `/checkout` on the same session`

The checkout protocol parser explicitly inspected:

- `load_page`
- `await_element`
- `run_js`
- `prompt_user_action`
- `await_js_out_change`
- `done`

Historical Supabase records still include session/checkout metadata. One known session is `76a090b1-f7f9-437d-b505-2b996f00718a`; later continuation/recovery checkout calls were charged €0.00. Do not create a new paid session merely to rediscover this protocol.

### Pepesto public runtime boundary — 29 August 2026

Pepesto's current public docs confirm `/checkout` is a turn-by-turn browser-driving protocol. A compatible client must be able to load retailer pages, run server-provided JS, wait for DOM state and prompt the shopper.

Pepesto's hosted Agent-to-Cart/MCP route is free to initiate, but the actual consumer checkout handoff goes into the **Pepesto mobile app**. On desktop it shows a QR code and asks the user to continue on the phone. Pepesto says the app runs the checkout loop and then redirects to the retailer cart/login page.

Pepesto's iframe/dockable UI can host its basket-review UI, but current public documentation says the actual checkout-driving step moves into the Pepesto mobile app. Therefore **Pepesto has not revealed a normal browser-only cross-origin trick that supermarket.ie can simply copy**.

This validates our own browser-origin analysis: the hard part is executing inside the retailer-authenticated context. Pepesto solves that with a controlled client runtime (mobile WebView/app; their API also cites browser extensions or Playwright as examples).

### Pepesto strategic role

Preferred role if used:

`Shopping Capability Layer → PepestoExecutionAdapter → retailer execution`

Supermarket.ie should continue to decide household needs, products, quantities, retailer comparison and recommendations. Pepesto should not replace our shopping intelligence.

However, because the user experience must not require a browser extension and ideally should remain Supermarket.ie-led, continue studying/reproducing the underlying retailer Storefront operations before adopting Pepesto's mobile-app handoff as the primary UX.

## 9. Retailer-selection UX

After basket preparation, show retailer-neutral fulfilment/price options, for example:

- SuperValu — X/Y items — approx. €A
- Dunnes — X/Y items — approx. €B
- Tesco — X/Y items — approx. €C

Supermarket.ie may recommend based on fulfilment, price and household preferences, but the shopper chooses.

Only show **Shop this basket** as true trolley population where it has actually been proven. Never claim `authenticated_cart` merely because mappings or protocol instructions exist.

## 10. Transaction instrumentation

Target events:

- `basket_prepared`
- `retailer_selected`
- `handoff_started`
- `handoff_items_mapped`
- `retailer_trolley_prepared`
- `retailer_checkout_opened`
- `purchase_confirmed` only where legitimately observable

Never emit `retailer_trolley_prepared` unless the retailer trolley was actually populated.

Long-term leverage should include retailer-attributable GMV.

## 11. Current branches / PRs requiring awareness

### PR #21 / `agent/retailer-handoff`
Original SuperValu `RetailerAdapter` / `product_links` handoff. Valuable but stale relative to current main.

### PR #56 / `agent/supervalu-browser-bridge-poc`
Extension-based SuperValu proof. Experimental only; not mainstream product direction.

### `agent/dunnes-cart-probe`
Read-only Dunnes gateway/cart discovery branch. Confirmed Storefront cart path/auth boundary. One-shot workflow removed after test. Do not treat as production implementation.

### `pepesto-tesco-adapter`
Historical Pepesto Tesco work covering **both product retrieval and checkout/basket-protocol investigation**. Inspect before new Pepesto/Tesco handoff work.

## 12. Strategic guardrails

- Do not turn Supermarket.ie back into primarily price comparison.
- Do not build Supermarket.ie-owned grocery fulfilment at this stage.
- Do not become merchant of record initially.
- Do not make marketplace/vendor onboarding a prerequisite for proving transactions.
- Do not require retailer commercial agreements where a legitimate technical handoff exists.
- Do not circumvent retailer security controls.
- Do not make the business dependent on bypassing anti-automation/security protections.
- Do not handle retailer payment credentials.
- Do not capture/replay retailer passwords/session tokens merely to populate carts.
- Do not require consumer browser extensions.
- Do not use hidden sponsored recommendations.
- Do not claim an execution state that has not happened.

## 13. Current recommended next sequence

1. Read this file and `docs/retailer-execution.md` before retailer work.
2. Treat Dunnes and SuperValu as likely members of a common **Instacart Storefront execution family**, not completely separate checkout integrations.
3. Recover the most detailed historical Tesco Pepesto checkout instructions/results available from repo history and `scrape_runs`.
4. Continue zero-credit inspection of public Pepesto and Instacart client/runtime behaviour for retailer-specific execution details.
5. Determine whether a legitimate browser-native authenticated Storefront handoff exists; do not seek same-origin bypasses.
6. If a retailer-specific Pepesto session becomes the only way to reveal a decisive missing instruction, tell the user before spending credits and keep the test minimal.
7. Bring the chosen execution method behind the current Shopping Capability Layer / retailer adapter interface.
8. Add transaction attribution events.
9. Connect proven handoff to Eve with explicit shopper approval.
10. Only then expose the same primitive through API/MCP.

## 14. Documentation discipline

For every material Supermarket.ie development session:

1. Read `PROJECT_STATE.md` first.
2. Inspect current `main` and referenced branches/PRs.
3. Read relevant specialist docs.
4. Do the work.
5. Update documentation in the same workstream when findings/decisions change.
6. Record abandoned approaches as well as successful ones.
7. Never put secrets, tokens, passwords, customer credentials or payment data into project-state documents.

## 15. Decision log

- **2026-08-18 — Shared Shopping Capability Layer established (PR #20).** Reusable shopping logic becomes the architectural core.
- **2026-08-18 — SuperValu selected as first retailer-handoff adapter (PR #21).** Truthful `product_links` handoff created while cart execution remained unproven.
- **2026-08-21 — Pepesto Tesco checkout protocol investigated.** Three-product session, checkout instruction and continuation/recovery work were performed; this was the start of basket-handoff implementation, not merely search/retrieval.
- **2026-08-29 — SuperValu cart mechanism established.** Bulk cart operation understood; authenticated execution remains the blocker.
- **2026-08-29 — Browser-extension requirement rejected.** No-extension is a product requirement.
- **2026-08-29 — Pepesto prior work rediscovered.** Historical execution work must be recovered before new retailer reverse engineering.
- **2026-08-29 — Dunnes confirmed as Instacart Storefront execution.** Production gateway/search works at store 258; cart resource allows GET/POST and returns 401 without authentication. Consequence: design toward a shared Storefront execution engine for Dunnes/SuperValu rather than duplicate retailer-specific cart plumbing.
- **2026-08-29 — Pepesto public runtime boundary clarified.** Free MCP/list handoff still finishes through Pepesto's mobile app/WebView; no browser-only cross-origin shortcut has been identified.
- **2026-08-29 — Repository documentation is canonical project memory.** Future sessions must read and maintain these docs.