# Supermarket.ie — Canonical Project State

**Last updated:** 6 September 2026

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

## 16. Trusted pricing architecture and current state

The pricing identity chain is `products` (canonical catalogue identity) →
`store_products` (retailer mapping) → append-only `price_observations` →
`trusted_retailer_offers` → `latest_prices`.

`latest_prices` is the fail-closed consumer boundary used by the website,
shopping agent, product pages, comparisons, list generation, basket repricing,
deals and household insights. Consumers must not fall back to raw observations
when it is unavailable or empty.

A live price requires a resolved retailer mapping, non-empty retailer SKU and
name, positive price, approved provenance and an observation no more than seven
days old. SuperValu search-result URLs are excluded. Wrong mappings and stale
prices are worse than missing prices; plausible alternatives must never be
silently substituted for exact products.

Promotion truth rule: `on_promotion` is retailer evidence, not proof of a
monetary saving. A confirmed shopper-facing saving requires
`was_price > price`. Retailer-marked offers without a previous price may be
described as such, but must not be given an invented before price or claimed
percentage saving.

Production snapshot on 6 September 2026:

| Retailer | Mapped | Live trusted | Coverage | Retailer-marked | Confirmed savings |
|---|---:|---:|---:|---:|---:|
| Tesco | 2,461 | 397 | 16.1% | 132 | 0 |
| Dunnes | 2,460 | 827 | 33.6% | 189 | 189 |
| SuperValu | 2,460 | 1,148 | 46.7% | 64 | 64 |
| **Total** | **7,381** | **2,372** | **32.1%** | **385** | **253** |

There were 1,821 canonical products with at least one live retailer price, 503
with at least two, and only 48 with all three main retailers. These figures are
a dated snapshot and must be queried again before decisions.

Refresh selection should prioritise never-observed → stalest → freshest, with
usage-aware priority for products shoppers request. Transport failures and
product-identity failures must remain separately observable.

Retailer specifics:

- **Tesco:** uses Pepesto `/search` in batches of ten, not ScrapingBee. Accept
  only an exact Tesco SKU in the returned product URL. The synchronous
  `/products` route was tested and is unsafe as the primary refresh because it
  can generalise branded queries. Pepesto currently returns current price,
  promotion flag and sometimes percentage, but no validated Clubcard label or
  explicit previous price. Do not derive a previous price until arithmetic,
  rounding and history checks have been approved. Balance after the September
  500-product run was €12.16; verify before every paid run. Paid submissions
  are enabled by an explicit owner-authorised manual dispatch, `CRON_SECRET`,
  the daily spending cap and a live balance check—not by a persistent Vercel
  enable/disable flag. There is no automatic paid submission schedule.
  Do not estimate Pepesto spend from a hard-coded tariff. On 6 September a
  100-product/ten-search run reduced the balance from €12.16 to €0.16 despite
  the previous €0.32-per-search assumption. Record credits before and after
  submission and report only the observed balance difference as actual cost.
- **Dunnes:** direct storefront API; prefer exact stored SKU and validate name,
  product signals and pack identity. Scheduled Monday/Thursday 05:10 UTC,
  target 1,000.
- **SuperValu:** direct `/product/` pages; reject search-result mappings and
  validate name/pack identity. Generic promotion CSS in shared page chrome is
  not promotion evidence. Unsupported flags were cleared in production on
  6 September. Scheduled Monday/Thursday 05:20 UTC, target 1,000.

Latest run health at this snapshot: Tesco 397/500 exact matches and 103
rejections; Dunnes 738/1,000 extracted and degraded; SuperValu 828/1,000
extracted and degraded.

PR #62 (`Fix promotion trust and Tesco retrieval`) was merged and deployed to
production on 6 September 2026 at commit
`dca0c9db46af1dfe65003b9838d2ce7b0047ec6e`. It makes shopper-facing deals and
agent promotion tools require confirmed savings, fixes the SuperValu parser,
enforces exact-SKU Tesco matching, repairs manual Tesco dispatch, and adds a
ten-minute no-cost retrieval schedule. Paid Tesco submissions remain manual,
balance-aware and capped.

## 17. Active project monitoring

- **Supermarket.ie Update:** hourly condition watch for meaningful production-
  readiness changes. This is the source of the useful supermarket health/status
  notifications the user has been receiving.
- **Grocery Market Watch:** daily condition watch for material external grocery
  marketplace, retailer-onboarding, pricing and product-data developments.

## 18. Next pricing priority

Increase trusted fresh-price coverage without weakening identity standards or
exhausting Pepesto credit. Begin by measuring the overlap deficit by canonical
product and shopper usage, then prioritise work that adds the most two-retailer
and three-retailer coverage per request/euro.

### Coverage strategy and operating plan

Refresh selection should use this priority order for exact, resolved mappings:

1. the target retailer currently has no trusted live price;
2. the product has appeared in `list_items`, ordered by usage occurrences and
   quantity;
3. the product already has trusted live prices at other main retailers, so the
   refresh completes three-store and then two-store comparisons;
4. the mapping has never produced an observation;
5. the existing observation is stalest.

Fresh target-retailer rows remain eligible as lower-priority maintenance. A
missing/blank retailer SKU is not executable refresh work and must be sent to a
mapping/discovery workflow instead of consuming a price request.

Roll out coverage improvement in measured tranches:

1. refresh resolved Dunnes and SuperValu overlap gaps first because their
   direct transports do not consume Pepesto credit;
2. discover missing direct-retailer mappings, prioritising shopper demand;
3. run Tesco only after explicit manual approval, checking the live balance and
   any authoritative Pepesto quote available for that specific run; never
   invent or hard-code an expected cost, and never schedule or automatically
   start a paid submission;
4. protect high-demand staples from ageing out by keeping the same selector in
   scheduled Monday/Thursday direct-retailer refreshes;
5. only broaden to low-demand one-store products after high-demand and overlap
   gaps are materially reduced.

Baseline targets from the 6 September snapshot are: products with at least two
live retailers from 503 to 750; all three from 48 to 150; demanded products
with at least two retailers from 70/626 to 250; and, among the top 100 demanded
products, at least 80 with two retailers and 40 with all three. Re-query these
metrics after every tranche; do not treat the targets as evidence that coverage
has already improved.

Decision-log additions:

- **2026-09-06 — Promotion truth tightened.** Retailer flags and confirmed
  monetary savings are distinct; `was_price > price` is required for a saving.
- **2026-09-06 — SuperValu promotion contamination corrected.** Generic shared
  promotion classes had marked ordinary products; unsupported live flags were
  cleared without changing prices.
- **2026-09-06 — Tesco exact-SKU Pepesto rule confirmed.** Current prices are
  accepted only for the exact mapped Tesco SKU; no inferred Clubcard before
  price is approved.
- **2026-09-06 — Coverage strategy approved.** Rank exact resolved refreshes by
  missing target-store coverage, shopper demand, cross-retailer overlap,
  never-observed status and staleness. Use free direct-retailer requests first.
  Tesco/Pepesto paid submissions are manual-only: never schedule them, and
  confirm the live balance and any authoritative Pepesto quote for every
  approved run, then record the observed cost.
- **2026-09-06 — Pepesto cost assumption invalidated.** A ten-search run cost
  €12.00 rather than the hard-coded €3.20 estimate. Cost controls and reporting
  must use observed before/after credit balances; no fixed Pepesto tariff may
  be presented as authoritative.

## 19. Household-agent runtime and guest planning

The homepage agent uses the Eve runtime (`agent/**`) for both guests and signed-
in users, with Claude Sonnet 5 and the instructions in
`agent/instructions.md`. Guest versus signed-in status changes the tools and
household data available; it should not change the agent identity.

The homepage permits two guest user turns. After a complete first answer it
may show a relevant inline signup invitation while leaving the second turn
available. A persistent action such as watching or monitoring gates
immediately. For an underspecified complete-household-shop request, Eve may use
the first response for one consolidated clarification covering household
composition, approximate budget and essential dietary requirements. The second
turn must complete the shop using explicit reasonable assumptions for anything
omitted; there must be no further clarification loop.

Homepage continuation CTAs are selected from the requested outcome. Complete
or weekly basket planning is a `shop` intent even when the prompt mentions
offers, prices or a budget as supporting evidence. Its CTA is **Save this
household shop** rather than a product-watch CTA. Generated starters should
retain their declared task meaning, and freely typed requests use the shared
deterministic intent classifier.

The older `/api/plan` + `src/lib/planner-agent.ts` runtime remains a live
compatibility path for database-backed saved conversations through
`ConversationChat.tsx`; it must not be deleted until those conversations can be
resumed in Eve without losing history. Its temporary model is aligned to Claude
Sonnet 5, but its prompt/tool architecture is still legacy. Do not add new
callers. The intended migration is to preserve/import existing conversation
history into Eve, verify list/profile/validation parity, remove the final
caller, and then delete the old planner prompt/model/tool path.

Decision-log additions:

- **2026-09-06 — Guest household-shop clarification aligned to the two-turn
  preview.** One combined clarification is allowed only when household context
  materially changes a complete-shop result; the following turn must finish.
- **2026-09-06 — CTA intent follows requested outcome.** Household-shop plans
  remain shop intent when offers or prices are used as evidence.
- **2026-09-06 — Planner convergence boundary recorded.** Homepage traffic is
  already on Eve; `/api/plan` remains only for live saved-conversation
  compatibility and is frozen pending a history-preserving migration.

## 20. Typed household-shop contract

Phase 1 of the household-agent improvement programme introduces the reusable
`household_shop.v1` contract under `src/lib/shopping/**`. It is deliberately
owned by the Shared Shopping Capability Layer rather than the homepage or Eve.

The contract separates a model-authored shop proposal from authoritative
application state. The proposal may supply household and planning assumptions,
sections, needs, quantities, reasons and canonical-product candidates. It may
not author authoritative prices, promotion savings, totals or retailer basket
coverage. `groundHouseholdShop()` validates the proposal and joins it against:

- authoritative canonical catalogue products; and
- current exact retailer offers supplied from the fail-closed `latest_prices`
  boundary.

Unknown product IDs are downgraded to unresolved needs. Known products without
a trusted current offer remain explicitly unavailable. Retailer-marked
promotion evidence stays separate from a confirmed monetary saving, which
requires `was_price > current_price`. Line totals, selected totals, retailer
totals and complete-store basket totals are calculated in server code. A
retailer basket has no basket total and cannot be described as complete if any
shop line lacks a trusted offer at that retailer.

The v1 contract supports food, drink, toiletries, cleaning and other
supermarket household consumables. It carries household assumptions, item
purpose, resolution state, candidate and selected offers, missing/uncertain
items, store coverage, retailer strategy, price provenance and a compact
decision trace.

Current migration boundary: this phase adds the contract and deterministic
grounding. Phase 2 adds Eve's native `present_household_shop` path and homepage
rendering without making new results depend on `parse-planner-markdown.ts`.
Saved lists still use their existing JSON/Markdown compatibility paths. Phase
3 should make the validated v1 payload the authoritative saved-list input while
preserving old lists and conversations.

Decision-log addition:

- **2026-09-06 — `household_shop.v1` ownership boundary established.** Models
  propose household needs; the Shared Shopping Capability Layer validates
  canonical identity and owns current offers, promotion truth, totals, store
  coverage and retailer recommendations.

## 21. Native Eve household-shop presentation

Phase 2 uses Eve's supported structured tool-result path rather than a custom
event protocol. `present_household_shop` is available to guests and signed-in
users. It accepts only the model-authored `household_shop.v1` proposal, looks up
canonical identities and exact fresh offers server-side, and returns the
validated contract as a durable Eve `dynamic-tool` result.

The homepage reads completed `present_household_shop` tool parts from Eve's
default message projection and renders a native mobile-responsive shopping
card. The card shows household/planning assumptions, dietary requirements,
sections, quantities, selected current prices, promotion evidence, unresolved
gaps, deterministic totals, complete-versus-partial retailer coverage and the
recommended retailer strategy. It explicitly labels the result as a proposed
shop rather than a saved list, retailer trolley or completed order.

This mechanism preserves the structured payload inside the Eve event log. The
existing guest-to-account handover copies that event log to the signed-in
storage key, so the rendered shop and assumptions survive signup without being
reparsed from assistant prose. Invalid or incomplete tool outputs stored in the
browser are ignored by the renderer.

Catalogue resolution now carries `canonical_product_id` through its shared
result so Eve can cite an exact identity in the presentation proposal. The
model must leave uncertain needs unresolved rather than manufacture IDs.

Compatibility boundary: `parse-planner-markdown.ts` remains untouched for the
legacy saved-list flow and historical conversations. Phase 3 must persist the
validated structured tool output directly, deterministically reprice it and
retain unresolved gaps; it must not parse the accompanying prose.

Decision-log addition:

- **2026-09-06 — Native structured presentation uses durable Eve tool
  results.** `present_household_shop` returns the server-grounded v1 contract;
  homepage UI renders that payload directly while prose is limited to a short
  introduction or qualification.

## 22. Structured household-shop persistence

Phase 3 makes a completed `household_shop.v1` Eve result the authoritative input
to `/api/lists/save-from-planner`. After registration, the existing guest Eve
event handover restores the same native shop on the homepage and the signed-in
client saves that structured payload once. Existing signed-in structured shops
use the same path. A browser marker keyed by the contract generation timestamp
prevents duplicate saves, while a failed save leaves the proposed shop visible
and reports that persistence did not complete.

The save route authenticates with the HttpOnly session cookie (while retaining
the explicit-token compatibility path), reconstructs the model proposal, and
re-runs `groundHouseholdShop()` against current canonical products and the
fail-closed `latest_prices` view immediately before persistence. Therefore
stored product IDs, retailer identities, prices, promotion state, line totals
and coverage are not copied blindly from browser state. Unknown IDs become
unresolved needs and stale offers disappear through the same deterministic
grounding rules used for presentation.

`saved_lists.items` retains every line, including unresolved gaps, plus canonical
product ID, quantity, pack expectation, selected retailer identity and coverage
status. Only grounded, priced lines are written to `list_items` shopping history;
an unresolved line is retained in the saved-list JSON and is never converted to
an unrelated product. Store totals are derived from the newly grounded contract,
and incomplete retailer baskets retain a null total. Household assumptions and
the grounding decision trace are retained in `agent_decision_trace`.

Compatibility boundary: Markdown input remains accepted for historical callers
and continues through `parse-planner-markdown.ts`. New Eve household shops never
use that parser. Existing lists and conversations remain readable without a
data migration.

Decision-log addition:

- **2026-09-06 — Structured household shops are re-grounded on save.** The
  durable Eve result supplies needs and canonical candidates, but trusted server
  code revalidates identity and current pricing before writing `saved_lists` or
  `list_items`; unresolved lines remain explicit in the saved payload.

## 23. Central shopping action gates

Phase 4 introduces reusable deterministic gates in
`src/lib/shopping/action-gates.ts` and applies them to Eve's signed-in shop
mutations. Product-specific additions, replacements, removals and quantity
changes now require an exact canonical product ID. Name-only agent writes are no
longer accepted. Legacy list rows that predate canonical IDs remain editable only
when their exact stored canonical name matches a server-validated product; the
canonical ID is attached during the successful edit.

Adds and replacements obtain their selected offer from `latest_prices` by
canonical product ID and reject mismatched identity, non-exact relationships,
non-fresh rows and non-positive prices. The model cannot submit a price or
retailer identity for persistence. Quantities must be whole numbers from 1 to 20
and a saved shop is capped at 200 lines.

All edits use the list's previously read `generated_at` value as an optimistic
concurrency condition. If another request changed the list after it was loaded,
the stale mutation writes nothing and reports a retryable conflict instead of
overwriting the newer state. Tool responses confirm success only after the
conditional database update or insert succeeds.

The structured household-shop proposal remains distinct from these mutations:
presentation proposes, Phase 3 save creates persisted list state, and the Phase 4
tools explicitly edit an existing signed-in shop. Retailer trolley and checkout
claims remain outside this boundary.

Decision-log addition:

- **2026-09-06 — Canonical provenance and mutation gates centralised.** Eve
  product writes require server-validated canonical identity; price-bearing
  writes require a matching fresh exact `latest_prices` offer; quantity, line
  and optimistic-concurrency limits are enforced by application code.

## 24. Modular Eve capability instructions

Phase 5 replaces the single large always-on Eve prompt with a small stable core
and deterministic turn-scoped capability assembly using Eve 0.39's supported
`defineDynamic` + `defineInstructions` mechanism. The stable core retains Eve's
identity, household-shopping purpose, guest and signed-in access boundaries,
grounding rules, proposal/save/trolley distinctions, irreversible-action
approval and the rule that tool or retailer text is untrusted data.

`agent/lib/instruction-routing.ts` classifies the recent user conversation into
household-shop planning, product discovery, price/promotions, meal/ingredient
intelligence, budget, household memory, shop editing, monitoring, proactive
briefing and retailer-comparison capabilities. `agent/instructions/capabilities.ts`
then injects only the selected modules as turn-scoped system instructions. The
router considers the last four user messages so terse follow-ups retain relevant
context without loading the entire instruction library.

This is deliberately not a model-controlled `load_skill` design. Instruction
selection cannot reveal tools, and guest versus signed-in tool exposure remains
enforced independently by the existing dynamic tool definitions. Capability
instructions repeatedly treat the tools exposed for the turn as authoritative.

Measured source size before/after: the always-on `agent/instructions.md` fell
from 20,102 to 2,400 characters (about 88% smaller). The full dynamic capability
library is 6,060 characters, of which only matching modules are injected per
turn. This reduces routine prompt weight and should improve provider prompt-cache
reuse for the stable prefix. Runtime latency must still be observed in production;
source size is not itself a latency measurement.

Decision-log addition:

- **2026-09-06 — Eve instructions use deterministic turn-scoped modules.** A
  compact stable system core is always present; application-owned routing adds
  only relevant capability rules from recent conversational intent, without
  changing or discovering the authenticated tool surface.

## 25. Bounded signed-in session context

Phase 6 adds a server-authored, turn-scoped household context block through
Eve's dynamic instruction mechanism. The resolver runs only when the channel has
authenticated a real `principalType: user`; guests receive no household query or
context. Every database read is constrained by that authenticated subscriber ID,
preventing context reuse across accounts or guest sessions.

The context contract can contain the current date, explicit household facts, a
compact current-shop summary, the active weekly meal plan, bounded recent
shopping evidence and active watches. Phase 5's deterministic capability router
selects which optional sections are included for the task. Current-shop data is
limited to 80 lines, recent behaviour to 40 source rows/20 summaries and watches
to 20. Raw conversation history and unrestricted purchase history are not
injected.

The entire block is capped at 4,000 characters with deterministic truncation and
an explicit `context_truncated` marker. Runtime observability records only the
character count, truncation flag, selected capabilities and included section
names; it does not log the household values. The block is delivered with user
role and is labelled application-supplied untrusted user data, so saved or
external text cannot become system instructions. The current user delivery
follows it and therefore overrides saved defaults naturally.

Explicit facts and inferred behaviour are separate named sections. Behavioural
summaries carry their `inferred_from_list_items` source, occurrence count, last
seen date and usual quantity; they are supporting evidence rather than facts.
Recommendation explanations should use this bounded evidence or the existing
decision traces without exposing internal prompt mechanics.

Current page/product context is not yet passed by the homepage Eve channel, so
Phase 6 does not manufacture it. It can be added later as a separately validated
channel attribute if a concrete use case warrants the extra context.

Decision-log addition:

- **2026-09-06 — Signed-in context is task-filtered, user-scoped and capped.**
  Eve receives a maximum 4,000-character application-authored data block only
  for authenticated subscribers; explicit facts remain separate from inferred
  evidence and context telemetry excludes household values.

## 26. Governed durable household memory

Phase 7 replaces the legacy whole-document shopping summary with a versioned
`household_memory.v2` contract in the existing `households.memory` JSONB field.
No production schema migration or backfill is required: legacy memory is
adapted on read and upgraded on its next governed write.

Durable memory has separate `explicit` and `inferred_products` maps. Explicit
facts are restricted to stable household composition, dietary, budget, store,
dislike and stopped-product keys; arbitrary temporary errands and values that
look like credentials, payment data, contact details or Irish PPS identifiers
are rejected. Each fact records source and timestamps. Inferred product facts
record canonical product identity, usual quantity, likely replenishment
interval, recency, confidence and supporting observation count, and expire after
180 days without an observation.

Corrections overwrite one stable key while preserving its creation time.
Forgetting a product deletes its inference and writes a versioned tombstone. An
inference run records its start time and cannot restore a product tombstoned
after that time, closing the delayed-writer race. Explicit stopped products also
suppress inferred product memory. The authenticated household API exposes an
inspectable governed view and supports product-specific forgetting; Eve's
preference tool supports explicit stopped products and forgetting.

Household memory is deleted with its household row through the existing
`households.subscriber_id` `ON DELETE CASCADE` relationship. The API and agent
continue to scope all reads and writes to the authenticated subscriber ID.

Decision-log addition:

- **2026-09-06 — Durable memory is versioned, inspectable and forget-safe.**
  Explicit facts and inferred evidence have distinct provenance; inference is
  bounded by retention and cannot race a user deletion to restore forgotten
  product memory.

## 27. Behavioural evaluation release gate

Phase 8 adds a repeatable, fixture-backed domain-quality suite under
`src/lib/evaluations/**`. It covers 13 representative journeys: offer-led and
ordinary complete shops, a two-adult/two-child €120 shop, four dinners and
ingredients, a usual shop, reduction below €100 without removing essentials,
cheapest butter, contextual add, cereal replacement, a genuine Persil offer
watch, gluten-free and low-protein shops, and ambiguous staple-family search.

Every run scores the agreed 16 dimensions: intent, clarification, guest turns,
household and planning-period coherence, essential categories, quantities,
dietary compliance, product resolution, price and promotion truth, store
coverage, totals, retailer split, persistence/CTA and retailer-handoff truth.
Fixtures contain no account data and make no live retailer, Supabase, model or
Pepesto calls.

Critical deterministic failures block CI through the explicit
`npm run test:behavioural` step. The initial release threshold is zero critical
failures across every fixture and non-zero coverage for all 16 dimensions.
Household coherence, practical quantities and reasonable retailer split remain
visible as `review` scores and are not initially blocking because they require
qualitative judgment. Model scoring may later assist only those qualitative
dimensions; it must not replace deterministic truth or safety checks.

Baseline on 6 September 2026: 13/13 scenarios passed with zero critical
failures; all 16 scoring dimensions had fixture coverage. The first baseline run
caught and led to fixes for plural `dinners`, direct cereal replacement and
`low-protein` capability routing, plus an incorrect captured total.

Decision-log addition:

- **2026-09-06 — Critical behavioural regressions block deployment.** CI replays
  stored domain fixtures without paid/live dependencies; deterministic truth
  and safety thresholds block, while subjective quality is reported for review.

## 28. Legacy planner retirement

Phase 9 removes the final application caller of the legacy Anthropic planner and
deletes the exact `/api/plan` generation route, `src/lib/planner-agent.ts`, its
separate watch-agent dispatcher and the obsolete manual memory test script. The
deterministic `/api/plan/weekly`, `/api/plan/refresh` and `/api/plan/reprice`
features remain: they are not model routes and continue to support the weekly
dashboard and saved-list repricing.

The only live caller found was the signed-in `/dashboard/chat/[id]` page for
pre-Eve saved conversations. Those records are not deleted or rewritten. The
page now renders a read-only archived transcript and offers **Continue with
Eve**. Eve receives only the archive UUID, loads a subscriber-owned record with
the new `get_archived_conversation` tool, and receives at most the last 12 valid
user/assistant messages at 1,000 characters each. Historical text is explicitly
untrusted, while the linked structured saved list remains authoritative.
Quick actions and list-edit entry points now continue through Eve rather than
posting to the legacy route.

Price-history and price-change queries used by weekly planning, refresh,
watchdog and household briefings moved to
`src/lib/shopping/price-history.ts`. Current Eve tools preserve household
profile updates, catalogue-grounded validation, repricing, shop modification,
watch creation and saved structured-list behaviour. Markdown parsing remains
only in the explicitly named legacy import endpoint for historical planner
output; native Eve household-shop results do not depend on it.

Production evidence checked before removal: all 35 saved legacy conversations
were preserved and linked to a saved list; none had been updated in the prior
seven days, while nine had activity within 30 days. Vercel showed no exact
`/api/plan` log match in the available one-hour window; longer log retrieval was
unavailable due the account log-query limit. Source inspection found no other
runtime caller. Production retirement was verified after merge on 6 September
2026: Vercel deployment `dpl_Coq91LRKKx1GVLgtM9VJYF6W2xV4` built commit
`e04e3e1`, reached `READY`, attached the `supermarket.ie` and
`www.supermarket.ie` aliases, and had no runtime-error clusters after release.
The public homepage returned the current Eve household-agent experience.

Decision-log addition:

- **2026-09-06 — Eve becomes the sole interactive grocery-agent runtime.**
  Legacy transcripts remain readable and resumable through a bounded,
  subscriber-scoped adapter; the old prompt/model route has no application
  caller and is removed without deleting saved history or structured shops.
