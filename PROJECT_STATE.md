# Supermarket.ie — Canonical Project State

**Last updated:** 20 September 2026

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
- **2026-09-18 — Signed-in Home visual direction modernised.** The forest-green Home banner and narrow dashboard stack were replaced with a wider consumer shopping workspace. The agent is the dominant pale-mint patterned surface on a neutral-stone page, while the current shop is a crisp-white live companion and household insights use lighter, purpose-specific cards. Green is reserved for actions and positive state rather than large decorative banners; conversation persistence and fresh-start behaviour remain unchanged.

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

- **Tesco:** uses Pepesto `/search` with exactly one product per independently
  attributable session. Accept
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

## 29. SuperValu refresh recovery — 10 September 2026

The scheduled SuperValu refresh completed at 05:31:58 UTC with 550/1,000
successful validations (55.0% coverage): 69 changed prices, 481 unchanged, 263
`direct_name_mismatch` failures and 187 `no_product_data` failures. All 1,000
requests fetched successfully, so the dominant fault was extraction/identity
handling rather than retailer transport. The preceding 7 September run had the
same shape (56.4%, 260 mismatches, 176 no-data), and 411 failed mappings were
repeated across those two runs.

Production evidence showed that the fallback metadata parser treated both
quote styles as terminators regardless of the attribute delimiter. This
truncated retailer titles such as `Ben's Original...`, `Flahavan's...` and
`10" Stonebaked...`, creating false identity failures. The Vercel-native direct
worker also omitted the older browser scraper's `__PRELOADED_STATE__` product
extraction, causing valid hydrated product records to fall through to weak
HTML price/name heuristics or `no_product_data`.

The repair keeps the trusted-price boundary fail closed and adds:

- delimiter-aware metadata attribute parsing;
- direct parsing of balanced JSON in SuperValu `__PRELOADED_STATE__` product
  and product-card records before weak HTML fallbacks;
- retailer SKU extraction and rejection when a fetched SKU conflicts with the
  resolved mapping;
- regression fixtures for apostrophes, inch marks, hydrated state and SKU
  mismatch;
- real failure-streak tracking from the most recent successful observation;
- refresh selection that keeps missing coverage first but places SuperValu
  mappings with two or more failures since their last success behind healthier
  gaps, so the same repair set does not consume every 1,000-product tranche.

Rows with a canonical size conflict remain rejected even when the stored
retailer title matches the fetched page. A stable retailer SKU proves which
retailer page was fetched; it does not prove that the page is an exact match for
the canonical product. Those rows require mapping repair rather than relaxed
acceptance.

Decision-log addition:

- **2026-09-10 — SuperValu failures are split into extraction defects and
  mapping repair.** Fix deterministic punctuation/hydration extraction, verify
  retailer SKU identity, and back off repeated repair failures without
  weakening exact-product or seven-day freshness rules.


## 30. Signed-in experience design alignment — 18 September 2026

A production visual review covered the authenticated Home, My Shop, Browse and
Household surfaces. The Home experience already reflected the current
household-agent direction, but the remaining signed-in routes mixed that design
with older catalogue/planner styling: cyan section labels and glows, a neutral
grey desktop navigation state, and legacy “AI planner” / “Checkout coming soon”
language.

The signed-in shell now uses the current green-led design tokens for active and
hover states. My Shop and Household use brand green for section hierarchy and
replace the legacy cyan decorative treatment with restrained green tonal
accents. Browse gains the same green-gradient contextual header used by the
authenticated experience and its CTA is framed around the supermarket agent and
the complete household shop.

The saved-shop handoff copy remains deliberately truthful. Until a retailer
adapter is actually available on the live saved-shop path, the UI says retailer
handoff is unavailable for that saved shop rather than implying checkout or
trolley population.

Decision-log addition:

- **2026-09-18 — Signed-in UI converges on the household-agent design.** Home,
  My Shop, Browse and Household share the green-led palette, tonal surfaces and
  agent vocabulary; legacy cyan planner styling and premature checkout language
  are removed from the principal authenticated journey.

## 31. State-aware signed-in Home — 18 September 2026

The authenticated Home now treats the persisted agent journey as the primary
workspace. When account-scoped Eve events contain a user turn, Home restores the
conversation directly. With no prior interaction, it opens with **Your agent is
ready**, the primary question and the existing fresh-shop starters. Redundant
page-level and section-level introductions are deliberately omitted so the
working surface begins at the top of Home.

The current-week summary remains available immediately below Eve as supporting
deterministic shopping state. Browse remains a primary signed-in navigation
route for direct product discovery and manual research; it supports rather than
competes with the active household-shop journey. Recent-shop links now use the
saved-list route's actual `list` query parameter.

Public and authenticated Home copy are intentionally separate. The public
guest agent retains **Ready when you are**, **Meet your supermarket agent** and
its broad discovery placeholder. The authenticated empty state uses **Your
agent is ready** and the household-oriented question. These variants are now
rendered directly from authenticated state rather than rewritten after render
by a DOM observer, preventing signed-in copy changes from leaking into the
public homepage.

Current persistence boundary: Eve's active event stream is transferred from
guest to account after sign-in and then stored per account on the current
device. Structured household shops continue to persist server-side through the
validated saved-list path. Do not describe the complete Eve transcript as
cross-device account storage until server-backed Eve event persistence exists.

Decision-log addition:

- **2026-09-18 — Persisted agent state leads signed-in Home.** A returning active
  journey resumes ahead of weekly status; an account with no interaction starts
  fresh, while Browse remains directly available in primary navigation. The
  runtime remains Eve internally, but signed-in customer copy calls it **your
  agent** rather than exposing that implementation name.
- **2026-09-18 — Public and signed-in agent copy are isolated.** Guest messaging
  remains **Meet your supermarket agent** while authenticated Home can use more
  household-specific wording; both are rendered explicitly without DOM text
  replacement.

## 32. Living Shop signed-in Home model — 18 September 2026

The next signed-in Home iteration makes the household shop a visible, evolving
product object beside the agent. The agent remains the primary place to express
intent; a **Living Receipt** shows only deterministic application state from the
current weekly plan and the latest validated saved shop.

Home derives three presentation states without asking the model to classify
them:

- **New:** no current-week validated shop, no current agent journey and no
  partial weekly plan;
- **In progress:** the agent journey or weekly plan has started, or the current
  saved shop still contains unresolved, unavailable or partially covered lines;
- **Ready:** a shop saved during the current week contains at least one item and
  every line is resolved.

The current-shop summary is built server-side from subscriber-owned
`saved_lists.items`. It exposes item count, selected-price estimate, unresolved
count and bounded line detail. It does not use hypothetical complete-retailer
totals as the household estimate, and it treats missing prices, unavailable
lines and partial coverage as attention states. Older saved lists remain
available under My Shop and recent activity but are not presented as this
week's active shop.

The receipt's action is **Review my shop** for a current saved shop. It does not
claim retailer selection, trolley population or checkout. Without a current
saved shop, its action returns focus to the agent. Home-state views and receipt
actions are instrumented without logging household contents.

Decision-log addition:

- **2026-09-18 — Signed-in Home uses a deterministic Living Shop state.** The
  visual shell may respond to agent continuity, but Ready status and receipt
  facts come only from subscriber-scoped weekly-plan and validated saved-list
  data; retailer execution remains outside this UI boundary.

## 33. Account-backed chats and Living Receipt controls — 18 September 2026

The Living Shop implementation extends the existing subscriber-owned
`conversations` records rather than introducing a second chat store. A signed-in
agent conversation is created after its first meaningful message and its Eve
events/session plus a bounded display transcript are updated after completed
turns. The latest account-backed agent chat resumes on Home; a requested chat ID
must belong to the current subscriber and be marked as an agent chat. **New
chat** clears only the active conversation. It does not clear household memory,
the weekly budget, saved shops or persistent watches.

The existing `/dashboard` history surface is now a primary **Chats** destination.
Native agent chats reopen in the signed-in Home workspace; legacy pre-Eve
conversations retain their bounded archive/continue path. Device-local storage
remains a resilience cache and guest continuity mechanism, not the source of
truth for signed-in chat history.

The Living Receipt also exposes two durable controls without changing their
underlying ownership model:

- the weekly budget can be edited inline and is saved to the subscriber's
  household record; the displayed remaining/over amount recalculates locally;
- active product watches are listed in the receipt and **Add a watch** routes the
  shopper into the agent, which still resolves and creates the persistent watch
  through the governed agent tools.

Conversation text does not implicitly become durable household memory. Budget
changes, watches and saved shops remain explicit structured writes, even when
they are requested inside a saved chat.

Decision-log addition:

- **2026-09-18 — Conversations organise the signed-in agent experience.** Chats
  save automatically at the account level, while household preferences, watches
  and shops remain separately governed durable objects; starting a new chat does
  not erase or recreate those objects.

## 34. Batched household-shop catalogue resolution — 19 September 2026

Production review found that complete household shops could show many **Needs
resolving** lines even when the named products existed in the canonical
catalogue and had trusted current offers. `present_household_shop` previously
validated only canonical product IDs supplied by the model. Generating a large
shop therefore depended on one `resolve_product`/`get_current_price` call per
line, while the shared turn budget allowed only ten expensive calls. Remaining
lines were intentionally submitted without IDs and appeared unresolved.

`present_household_shop` now performs bounded server-side batch resolution for
the entire proposal before grounding it. It derives safe alphanumeric search
seeds, queries catalogue products and the fail-closed `latest_prices` boundary
in chunks, preserves valid supplied IDs, replaces invalid supplied IDs only
when a safe match exists, and accepts either a unique exact canonical-name
match or a clearly separated high-scoring current-offer match. The model no
longer needs one catalogue tool call for every ordinary shop line.

The distinction between product identity and price coverage remains explicit:
an exact canonical product with no trusted current offer is now `unavailable`,
not `unresolved`. Ambiguous families such as generic milk remain unresolved
rather than being silently assigned to a variant. Existing trusted-offer,
freshness, exact-relationship, total and retailer-coverage gates are unchanged.
Complete-shop instructions send the full proposal directly to this batch
boundary and reserve individual catalogue calls for standalone product questions
or genuine ambiguity, avoiding redundant model-tool turns and token use.

Decision-log addition:

- **2026-09-19 — Complete-shop product resolution moved into the server-side
  presentation boundary.** Resolve all proposed lines in bounded batches and
  reserve **Needs resolving** for genuinely ambiguous or absent catalogue
  items; do not weaken canonical identity or trusted-price requirements.

## 35. SuperValu and Dunnes coverage observability — 19 September 2026

Retailer coverage is now measured independently of scrape transport success.
Private Supabase views expose current canonical-catalogue, mapping, trusted-live,
freshness, shopper-demand and category coverage for SuperValu and Dunnes, plus
their shared overlap. A private snapshot table captures the same business-level
metrics whenever a retailer run reaches a terminal state. The baseline at rollout
was 852 live SuperValu products (34.61%), 810 Dunnes products (32.90%), and 635
products live at both retailers (25.79% of the 2,462-product catalogue).

The authenticated scrape-health API and `/admin/data-health` now present these
metrics, category gaps, latest-run failure mixes and threshold alerts. The
existing scheduled watchdog includes coverage under 50%, dual-retailer coverage
under 40%, three-point regressions and prices due to expire within 24 hours in
its operational email. Supabase remains the system of record: the current data
volume and workload do not justify Snowflake, while snapshots provide a clean
future export boundary if analytical scale changes.

Live SuperValu samples established that most `no_product_data` results are HTTP
200 empty product shells for expired mappings, not parser failures. They are now
classified as `empty_product_state` so remapping can be measured separately.
Dunnes recovery now accepts the numeric product identity embedded in an existing
resolved URL when the stored SKU has drifted, but only after the existing name,
size and type safeguards pass. Search queries retain up to eight words instead
of five to reduce false `no_search_results`; no model calls were added and fuzzy
confidence thresholds were not lowered.

Decision-log addition:

- **2026-09-19 — Coverage is a first-class operational metric in Supabase.**
  Track trusted catalogue and demand coverage over time, alert on regressions,
  and repair retailer identities conservatively before considering a separate
  warehouse or model-assisted matching.


## 36. Retailer failure-recovery tranche — 19 September 2026

The first post-observability 1,000-product production runs completed degraded:
SuperValu validated 701/1,000 (70.1%) and Dunnes validated 698/1,000 (69.8%).
The resulting live trusted catalogue coverage was 1,553/2,462 (63.08%) for
SuperValu and 831/2,462 (33.75%) for Dunnes. SuperValu failures were 192
`empty_product_state` and 107 `direct_name_mismatch`; Dunnes failures were
168 `no_search_results` and 134 `no_confident_match`.

Failure samples showed a mix of deterministic false negatives and genuinely bad
stale mappings. Examples such as `Celery` versus `Dunnes Stores Fresh Celery`
should match after removing retailer boilerplate and normalising simple
inflections, while a chilli-pepper mapping pointing to a pakora must remain
rejected. Dunnes recovery now tries at most three de-duplicated retailer-owned
queries: stored retailer name, the product title encoded in the resolved URL,
and canonical name. The URL title is query evidence only; candidates still pass
the existing SKU, name, size and type safeguards. Failure records now retain the
queries and a bounded candidate sample for the next analysis tranche.

SuperValu direct-name validation now recognises simple singular/plural wording,
retailer boilerplate and retailer pack units such as piece, roll and box. A short
generic retailer mapping may accept a more specific variant only when every
meaningful expected word is present and both sides carry compatible explicit
size evidence. Size conflicts such as 500g versus 400g remain rejected.

No model calls or AI matching were introduced. A 150-product validation run
per retailer then selected only products that had failed in the preceding full
run. SuperValu recovered 27/150 previously failing mappings: 27 succeeded, 37
remained direct-name mismatches and 86 remained empty product shells. Dunnes
recovered 15/150: 13 of the previous no-confident-match cohort and two of the
previous no-search cohort. Live trusted coverage consequently moved to 1,580
SuperValu products (64.18%) and 846 Dunnes products (34.36%); demand-weighted
coverage moved to 81.07% and 68.05% respectively.

The targeted runs also exposed an observability distinction: their deliberately
failure-heavy 18% and 10% success rates are useful repair metrics but should not
replace the latest scheduled full-run health on the dashboard. Add explicit run
scope (scheduled full run versus targeted validation/canary) before relying on
`latest_run_status` for alerts. Empty SuperValu product shells remain a
separate remapping problem and are not made trusted by the name changes.

Decision-log addition:

- **2026-09-19 — Repair deterministic retailer false negatives before broader
  discovery.** Use bounded retailer-owned query variants and vocabulary
  normalisation with regression fixtures; keep stale/wrong mappings fail closed,
  retain diagnostic evidence, and validate on a small production tranche before
  another full refresh.

The follow-up validation route can replay an exact prior failure cohort by run
UUID. This prevents the standard coverage-priority selector from changing the
sample between recovery tranches, while retaining `targeted_validation` scope so
the result cannot replace scheduled full-run health.

## 39. Exact retailer recovery validation — 19 September 2026

The next recovery tranche was deployed through PRs #109 and #112 and validated
only against exact prior-failure cohorts. SuperValu retried 123 remaining
failures and recovered eight (6.50%). Dunnes first retried 135 remaining
failures and recovered four; diagnostics then exposed that `N Pack` versus the
same explicit `N x unit-size` notation was still being rejected. The narrow
correction retained single-item/multipack and variant safeguards, and an exact
replay recovered 22 of the remaining 131 failures (16.79%).

Live trusted coverage is now 1,588/2,462 (64.50%) for SuperValu and 872/2,462
(35.42%) for Dunnes. Demand-weighted coverage is 81.13% and 70.10%
respectively. Scheduled full-run health remains correctly anchored to the prior
1,000-product runs (SuperValu 70.10%, Dunnes 69.80%); the recovery results are
separately labelled `targeted_validation`.

The remaining exact cohorts are 115 SuperValu failures (51 empty search/product
states, 37 direct-name mismatches and 27 ambiguous remaps) and 109 Dunnes
failures (74 no-confident-match and 35 no-search-results). These should be
treated as stale/ambiguous mapping or discovery work, not resolved by lowering
confidence thresholds. No AI/model or paid-retrieval calls were introduced.

## 37. Retailer run-scope observability — 19 September 2026

`scrape_runs.run_scope` now distinguishes `scheduled_full`,
`targeted_validation`, `canary`, `catch_up`, `discovery` and `manual` work.
The regular Dunnes and SuperValu cron URLs explicitly declare
`scheduled_full`; filtered or sub-1,000 direct runs default to
`targeted_validation`, and operational catch-up dispatches declare `catch_up`.
A guard rejects attempts to label filtered or smaller runs as scheduled full.

The private current-coverage view, authenticated data-health API and scheduled
watchdog now use only the latest completed `scheduled_full` run for the primary
health signal. The latest non-scheduled run remains visible separately with its
actual scope and result. Coverage snapshots retain the scope of the run that
caused them, so targeted repair gains remain measurable without turning their
deliberately failure-heavy success rate into a false production-health alert.

After the production migration, the primary run health correctly returned to
the 19 September full runs: Dunnes 69.8% degraded and SuperValu 70.1% degraded.
The later 150-product validation cohorts remain separately recorded as
`targeted_validation`: Dunnes 10.0% and SuperValu 18.0%. Historical direct runs
of at least 1,000 products were backfilled as scheduled full; smaller direct
runs, canaries and discovery runs were classified separately.

Decision-log addition:

- **2026-09-19 — Scheduled scrape health is scope-aware.** A canary, catch-up or
  targeted failure cohort may update trusted coverage and its snapshot, but it
  cannot replace the latest scheduled full-run status used by dashboards and
  alerts.

## 38. Empty-shell remapping and pack-expression recovery — 19 September 2026

The post-validation diagnostics showed that Dunnes' remaining
`no_confident_match` cohort mixes genuine stale/wrong mappings with a narrow
false-negative class: the canonical name says `N Pack`, while the retailer title
states the same leading item count plus a total weight. The direct worker now
reuses the richer Dunnes pack parser for this case and accepts it only when both
sides expose the same item count. Single-versus-multipack changes, explicit size
changes and variant conflicts such as salted versus unsalted remain rejected.
Candidate diagnostics now include whether a price was actually returned, so an
identity failure can be distinguished from an unavailable search result.

SuperValu `empty_product_state` rows now enter a bounded retailer-owned remap
attempt. The worker issues at most two de-duplicated compact queries derived
from the stored and canonical titles, parses the existing Storefront product
card dictionary and constructs a new product URL from retailer name and SKU. A
mapping changes only when exactly one priced candidate passes the canonical
name/pack checks, or when one compatible candidate retains the same retailer
SKU. Multiple plausible variants remain unresolved. The replacement URL, SKU
and retailer title are persisted only through the existing successful product
finalizer; unsuccessful attempts retain bounded query/candidate evidence.

No AI matching, fuzzy-threshold reduction, browser extension, ScrapingBee or
Pepesto credit was introduced. Validate this tranche on the previous failure
cohort before another scheduled 1,000-product run.

Decision-log addition:

- **2026-09-19 — Repair empty shells through unique retailer-owned evidence.**
  A search result can replace an expired SuperValu product identity only when
  canonical identity and pack constraints leave one safe priced candidate;
  ambiguous families stay unresolved.

## 40. Retailer-owned mapping cleanup — 19 September 2026

Live inspection confirmed that SuperValu exposes a Storefront JSON search
gateway at `storefrontgateway.supervalu.ie/api` for store `5550`. The previous
recovery parsed server-rendered search state, but the public HTML did not
populate that state and therefore produced false empty searches. The direct
worker now consumes retailer-owned JSON search results for empty product shells
and incompatible/stale direct mappings. It still requires one canonical- and
size-compatible priced candidate, with a same-SKU preference; ambiguous
families remain unresolved.

Dunnes known-SKU recovery now permits retailer merchandising words around a
generic stored title only when the candidate matches the stored or URL SKU and
contains every meaningful canonical product term. Existing size, pack, food
type and variant guards remain mandatory. This safely covers title expansions
such as `Baby Corn 145g` while continuing to reject stale links such as chilli
peppers mapped to a pakora product. Neither path uses an AI/model or paid
retrieval service. Production impact remains pending exact-cohort validation.

The production dispatcher has two immutable, owner-authorized operations for
that validation: `[ops] SuperValu mapping discovery validation` replays the 115
failures from run `a40142ef-2448-4c54-b477-b6cc4d77a2e7`, and `[ops] Dunnes
mapping cleanup validation` replays the 109 failures from run
`d75b1dc5-d497-4f11-a32b-7f378cdd35af`. Both remain scoped as
`targeted_validation` and do not replace scheduled full-run health.

### Production validation result

Both immutable operations completed against their exact cohorts. SuperValu run
`3f359792-3929-4778-a9af-9c9ae10022ae` recovered 6/115 mappings (five updated
prices and one unchanged price), leaving 109 failures: 57
`no_confident_remap`, 51 `empty_product_state` and one
`direct_name_mismatch`. Dunnes run
`6c30c0f8-2601-4ade-a371-c8ed5ebf5a56` recovered 23/109 mappings (three
updated and 20 unchanged), leaving 86 failures: 51 `no_confident_match` and 35
`no_search_results`.

Live trusted coverage is now 1,594/2,462 (64.74%) for SuperValu and 895/2,462
(36.35%) for Dunnes. Demand-weighted coverage is 81.56% and 72.51%
respectively. Scheduled full-run health remains 70.10% for SuperValu and 69.80%
for Dunnes; both mapping runs remain separately scoped as
`targeted_validation`. The one-shot authorization issues were closed after use.

Live retailer probes of the 35 Dunnes `no_search_results` residuals found that
the catalogue still contains some exact products, but the Storefront search API
returns no items for their full merchandising title. A single additional
compact query now removes size and bounded merchandising filler while retaining
the first five meaningful canonical product terms. Returned candidates still
pass the existing SKU, size, pack, type and variant safeguards; the compact
query does not itself authorize a mapping.

The immutable `[ops] Dunnes compact discovery validation` operation replays
only the 86 failures from run `6c30c0f8-2601-4ade-a371-c8ed5ebf5a56` with
`targeted_validation` scope.

Production run `4fe56cf5-5501-45fa-8f7e-5aff7785a2a6` recovered 18/86 of that
cohort (12 updated prices and six unchanged). Dunnes live trusted coverage is
now 913/2,462 (37.08%) and demand-weighted coverage is 74.44%. The 68 residuals
are 55 `no_confident_match` and 13 `no_search_results`; automated matching must
stop for the ambiguous set. Scheduled full-run health remains 69.80%.

## 41. Demand-ranked manual product resolution — 19 September 2026

After bounded retailer-owned recovery, ambiguous products must not be forced
through weaker matching. The admin data-health surface now includes a private
resolution queue built from each retailer's latest targeted failure cohort and
ranked by actual list demand. Captured retailer candidates expose explicit
`Choose product`, `Mark unavailable` and `Skip` decisions.

Resolution decisions are audited in `product_resolution_decisions`, protected
by RLS and service-role-only grants. Exact selection is accepted only when the
chosen SKU appears in the captured retailer evidence; the atomic resolver then
updates the retailer identity and writes the observed direct-retailer price.
Unavailable mappings leave trusted refresh selection. Alternatives remain in
their separate candidate table and are never silently promoted by this queue.

## 42. Product-resolution hardening and residual classification — 19 September 2026

The 177-record SuperValu/Dunnes residual was classified before any further
mapping changes. The conservative classification produced 65 retailer
search/query failures, 51 variant/size/pack conflicts, 38 insufficient-evidence
records, 15 poor or underspecified canonical identities and only eight
same-SKU exact candidates. No record has enough repeated independent evidence
to be labelled a genuine retailer absence.

The resolution path now derives candidate name, URL and price from captured
retailer evidence on the server rather than trusting browser fields. Automatic
eligibility requires the existing retailer SKU, complete canonical product
signals, exact explicit measure and pack count, no candidate-side or
canonical-side variant conflict, and corroboration from the stored retailer
title. Generic canonical phrases embedded in a different product do not
qualify. The database verifies the complete evidence tuple and retailer
URL/SKU before updating mapping or price state.

The `unavailable` action is disabled until repeated independent discovery
evidence is modelled. The admin queue remains an internal audit/exception
surface and offers an apply action only for server-validated exact candidates.
Canonical identities such as `Cornflakes`, `Deodorant Roll-On`, `Snackpack`,
`Stripes` and `Stackz` are product-policy/data-quality work, not candidates for
relaxed matching. Obvious stale mappings must be cleared or rediscovered
without renaming a generic canonical product to the arbitrary retailer item it
happened to reference.

The first eight strict exact Dunnes decisions raised live trusted coverage from
913 to 921 products (37.08% to 37.41%) and demand-weighted coverage from 74.44%
to 74.50%. A fresh targeted run showed that these products still failed the
older Dunnes worker's separate identity heuristic. The worker therefore reuses
the same stricter exact-identity predicate so accepted resolutions remain
refreshable after the initial seven-day observation. This applies only to
same-SKU candidates and does not widen the fallback similarity matcher.

Production verification run `e878ac5f-4242-4856-aaa2-cd0333b5aeb3`
subsequently refreshed 26/86 products, exactly eight more than the preceding
18/86 replay. All 26 were unchanged retailer prices and 60 remained unresolved,
confirming that the eight audited decisions now survive the ordinary Dunnes
refresh path. The live trusted figures remain 921/2,462 (37.41%) and 74.50%
demand coverage because the replay refreshed existing observations rather than
adding mappings. The current unresolved queue is 169 products: 60 Dunnes (47
`no_confident_match`, 13 `no_search_results`) and 109 SuperValu (57
`no_confident_remap`, 51 `empty_product_state`, one `direct_name_mismatch`).

SuperValu replay `39dd552a-1640-40f6-bdeb-98d20edbc89d` attempted 112 legacy
failure-cohort records, with three successful observations (two unchanged) and
109 failures. It did not change live trusted coverage, which remains
1,594/2,462 (64.74%) and 81.56% demand coverage. This confirms that the
remaining SuperValu cohort needs better canonical data or new retailer evidence,
not another pass with the same queries.

## 43. Retired browser-based data-health page — 20 September 2026

The `/admin/data-health` browser page has been removed. It was an internal
exception-handling interface and is no longer part of the operating workflow;
product resolution remains an autonomous, evidence-gated process. The page was
not present in public navigation or the sitemap and carried `noindex` metadata
while it existed. Its removal now makes the URL return the standard not-found
response.

The protected admin APIs, resolution audit table, queue view and atomic resolver
remain in place for developer-operated diagnostics and audited technical
operations. Removing the browser page does not change retailer discovery,
coverage calculation, matching safeguards or price refresh behaviour.

## 44. Pepesto account identity and blocked Tesco refresh — 20 September 2026

An owner-authorised 250-product Tesco refresh reached the protected production
dispatch but submitted no products and spent no credit. Pepesto reported a
balance of 16 cents and rejected the first `/search` request with HTTP 400
(`no products specified`). Run `pepesto_tesco_20260920100817` is recorded as
failed with a target of 250, zero submitted and zero actual cost. Tesco remains
outside `latest_prices` until a successful exact-SKU refresh produces current
observations.

Pepesto bootstrap linking now identifies the account only by
`colin@supermarket.ie`; the optional `Supermarket` alias has been removed from
future `/link` requests. This does not expose, delete or silently rotate the
existing Vault credential. Reconcile that stored credential with the funded
Pepesto account and revalidate the current `/search` contract before retrying
the paid refresh.

## 45. Funded Pepesto relink and Tesco refresh — 20 September 2026

The Pepesto credential was explicitly relinked using only
`colin@supermarket.ie`. The replacement key passed `/credits` validation before
the Vault value was changed, and the funded account reported 2,990 euro cents
(€29.90). No API key was exposed.

Pepesto's current `/search` contract uses a singular comma-separated `product`
string rather than the former `products` array. PR #138 updated the adapter to
that documented contract while retaining ten-product batching and the exact
retailer-SKU acceptance gate. A corrected ten-product canary submitted 10/10,
cost 12 cents and recovered one exact unchanged price.

Production run `pepesto_tesco_20260920103339`
(`c8812c38-678b-4346-8580-3cf14023ea3e`) then submitted and retrieved all 250
requested products across 25 sessions. Credits moved from 2,978 to 2,678 euro
cents: an actual cost of €3.00, exactly 12 cents per batch. Nineteen exact-SKU
prices were accepted: six newly inserted observations and 13 unchanged current
prices. The other 231 results failed the exact-SKU gate and were not mapped.
The run is recorded as `failed` only because 7.60% exact recovery is below the
existing 70% health threshold; submission, retrieval and spend accounting all
completed. `latest_prices` now contains 19 fresh Tesco rows, bringing Tesco
back into the live dataset without weakening matching rules. Remaining Pepesto
balance is €26.78.


## 46. Tesco preferred-products coverage gain — 20 September 2026

Pepesto's preselected `/catalog` endpoint returned no rows for existing Tesco
Ireland product URLs in two 50-product canaries; each cost 96 cents. The
250-product catalog operation was therefore not released. The cached
`/products` endpoint was then integrated with multi-line product requests and
existing Tesco URLs supplied as preferences. Returned candidates remain subject
to an exact stored retailer-SKU gate across the complete batch, so omitted or
reordered Pepesto items cannot cause positional mis-mapping.

The corrected 50-product canary recovered 19 exact products for 32 cents.
Production run `pepesto_tesco_20260920121121`
(`1d49106a-848f-4cf8-8f37-d2c173b810ec`) then attempted 250, returned 171
Pepesto items and accepted 64 exact Tesco SKUs for €1.60. The other 186 were
safely rejected. Across the funded work, fresh Tesco coverage initially increased from 19 to 106 products. A second
250-product preferred-products run (`22304113-97c9-4dff-bd83-94f480b0b71d`)
added 12 more exact prices for €1.60 before further identical retries were
stopped for diminishing returns. Final fresh Tesco coverage is 118/2,462
(4.79%), a 6.21x increase from the first successful run. Demand-weighted Tesco
coverage is 845/1,659 units (50.93%). The remaining Pepesto balance is €21.02.

## 47. Queue-backed exact Tesco direct canary — 20 September 2026

Tesco direct recovery now has a separate `exact_direct_canary` queue mode. The
trigger creates a durable canary run and returns HTTP 202 with its run UUID
immediately; all 20 demand-ranked unresolved exact mappings are processed by
the existing Vercel Queue consumer. This path makes no Pepesto or ScrapingBee
request.

The canary fetches only each stored Tesco product URL. It records requested and
final URL, expected and returned SKU, retailer title, price, availability, HTTP
status and a bounded failure classification. A price is accepted only when the
SKU in the final Tesco URL exactly equals the stored SKU. There is no fuzzy
search fallback and no alternative SKU can update a mapping in this mode.

Evidence is retained in the private, RLS-protected
`tesco_direct_canary_results` table, with a service-role-only run summary for
exact recovery and failure-reason reporting. `retailer_coverage_current` now
includes Tesco, and `main_retailer_comparison_coverage_current` reports products
covered by at least two and by all three main retailers. Production canary
results and any decision to scale remain pending deployment verification.

The production canary stopped on its first exact stored URL with HTTP 403 and
classified the response as an access challenge. The Vercel Dublin egress was
quarantined and direct retrieval was not scaled. No Pepesto credit was used.

## 48. Untouched Pepesto products cohort — 20 September 2026

Receipt analysis showed that the two 250-product preferred-URL runs overlapped
on 186 mappings, including 179 repeated non-successes. Repeating the same
selection was therefore the cause of much of the diminishing return. There are
2,104 unresolved exact Tesco mappings that no preferred-products run attempted;
558 of these already have fresh trusted prices at both other main retailers.

The products canary now selects up to 50 mappings from this untouched cohort,
preserving the existing demand/overlap ranking and exact stored-SKU acceptance
gate. It publishes one durable queue message and returns the run UUID
immediately. The paid response, cost and progress are persisted in a private
service-role-only batch table so queue redelivery can resume finalisation
without intentionally repeating the paid request. This does not use direct
Tesco retrieval or any legacy proxy integration.

Production run `pepesto_tesco_20260920143901`
(`97f092ea-8cd6-49ed-bd04-a3ce7545c751`) processed all 50 untouched mappings
asynchronously. Pepesto returned 22 shopping-list items but no candidate with
an exact requested stored SKU. All 50 were safely rejected, the run cost 32
cents and the balance moved from €21.02 to €20.70. The returned evidence shows
that `/products` ignored the preferred URLs for this residual cohort and fell
back to broad name alternatives. Do not scale or repeat this cohort.

The canary also exposed a pre-existing Tesco mapping-integrity issue. Across
the catalogue, 325 Tesco SKUs are assigned to more than one canonical product
(742 mapping rows). Current Tesco coverage contains 118 canonical rows but 114
unique retailer SKUs. Some duplicates are catalogue synonyms, while others are
materially invalid (for example red chilli mapped to a red bell pepper SKU).
Exact response-SKU matching cannot repair a bad stored mapping: Tesco mapping
identity must be audited and invalid rows cleared or re-resolved before further
coverage spending. No returned alternative may be promoted without full brand,
type, variant, size and pack agreement.

## 49. Tesco mapping risk audit baseline — 20 September 2026

A read-only production audit introduced a deterministic Tesco identity
classifier covering URL/SKU corroboration, brand and own-label status, product
type, variant, explicit measure, pack count, fresh/frozen state, material
formulation and generic canonical identities. Duplicate-SKU status is a risk
signal only: a group cannot be called a synonym without complete group-level
identity corroboration.

The live baseline remains 118 fresh canonical rows and 114 unique fresh Tesco
SKUs, but at least 12 current rows have deterministic material conflicts. These
include red chilli mapped to a bell pepper, 250g mushrooms mapped to 300g,
180g Muller Rice mapped to 170g, several pack-count conflicts, branded
canonicals mapped to Tesco or another brand, pizza mapped to a baguette,
semolina pasta mapped to flour and yogurt mapped to a yogurt drink. No mapping
or price was changed during this pass.

All 325 duplicate-SKU groups (742 mapping rows) were enumerated. Only one group
has the same normalised canonical term set, and it still fails brand/own-label
corroboration, so no group is yet accepted automatically as a genuine synonym.
Within fresh coverage, 29 rows use a SKU duplicated elsewhere in the catalogue.

The persisted evidence from Pepesto run
`97f092ea-8cd6-49ed-bd04-a3ce7545c751` was reused without another paid request.
None of its alternative SKUs passed the strict exact-replacement test. The next
step is to complete row-level classification of the non-equivalent duplicate
groups and the remaining fresh title-review cohort, then prepare a reversible
deterministic invalidation set before recalculating corrected coverage.

## 50. Tesco deterministic repair set — 20 September 2026

The row-level read-only audit is complete for all 29 fresh rows whose Tesco SKU
is duplicated elsewhere and all 23 fresh unique-SKU rows whose retailer title
does not contain every canonical term. The combined repair set contains 26
fresh material mismatches. It extends the first 12-row result with plain oil for
chilli-infused oil, onions versus breaded onion rings, powder versus granules,
wholemeal/free-range/organic substitutions, conflicting brands, yogurt
variant/pack changes, oyster versus boneless chicken thighs and materially
different fruit variants.

If all 26 mappings are invalidated, Tesco trusted coverage will correct from
118 to 92 canonical products and from 114 to 91 unique SKUs. Catalogue coverage
will move from 4.79% to 3.74%; using the current 1,681-unit demand denominator,
demand-weighted coverage will move from 50.86% to 38.13%. Main-retailer overlap
will correct from 803 to 794 products with at least two live retailers and from
78 to 67 with all three.

The prepared migration introduces a private, RLS-protected
`retailer_mapping_audit_decisions` table. Each repair stores the complete prior
mapping identity, current-observation timestamp, classification, reason and
evidence source before changing `url_status` to `failed`. SKU, URL, title and
historical observations remain intact. The mutation is guarded by the stored
identity so it cannot invalidate a mapping changed after the audit. A full
production transaction dry-run completed and was rolled back before release.

PR #171 then passed CI and preview verification and was merged at commit
`b7507cb90931143cd1e1d919fdea17c368aa33d2`. Production deployment
`dpl_5vZFcKCa6jUpxfcWL3po34RVZKZ7` reached `READY`, after which the audited
Supabase migration was applied. Verification found 26 decisions and 26 applied
actions, 26 audit-failed mappings and zero audited mappings leaking through
`latest_prices`.

The corrected live result exactly matched the dry-run: 92 trusted Tesco
canonical products, 91 unique SKUs, 3.74% catalogue coverage and 641/1,681
demanded units (38.13%). Main-retailer overlap is now 794 products at two or
more retailers and 67 at all three. Supabase advisors showed no new unindexed
foreign key; the private audit table intentionally follows the existing
service-role-only RLS-without-user-policy pattern. Vercel reported no recent
production runtime errors.

## 51. Strict Tesco candidate-discovery canary — 20 September 2026

The next Tesco recovery path is deliberately different from the exhausted
multi-product `/search`, `/catalog` and preferred-URL `/products` retries. It
selects only mappings invalidated by the deterministic audit and submits one
canonical identity per Pepesto search session. This removes positional
attribution guesses and caps each operator-confirmed request at five products.
Following explicit approval for more testing, observed same-day discovery spend
is capped at €1.20 by default.

Every candidate returned by `/retrieve` is persisted in the private,
service-role-only `tesco_candidate_discovery_evidence` table, including its raw
payload, URL/SKU, title, price, deterministic signals and classification. A
zero-candidate session is still remembered through the durable session record
and is not selected again automatically.

The replacement gate is stricter than the existing exact-stored-SKU refresh
gate. A new Tesco SKU may be applied only when exactly one distinct candidate
has a corroborated Tesco product URL/SKU, positive observed price, complete
canonical terms, exact explicit brand, size and pack agreement, and no product
type, variant, own-label, fresh/frozen or formulation conflict. Mapping repair,
price observation, audit decision and run accounting are committed atomically
by a service-role-only database function. Ambiguous, incomplete and conflicting
candidates remain evidence only.

The schema was executed successfully inside a production transaction and
rolled back before release, then applied after PR #173 passed verification and
production deployment reached `READY`.

The first three-product production submission cost 36 cents, but persisted
evidence showed that discovery had incorrectly inherited the ordinary refresh
query preference and sent each obsolete stored Tesco title instead of its
canonical identity. Five returned candidates simply reproduced or varied the
invalid mappings; all were rejected and no mapping or trusted price changed.
This is not a valid discovery-yield measurement. Candidate discovery now
explicitly queries the canonical name, with a regression test that preserves
stored-title preference only for ordinary exact-SKU price refreshes. The
operator endpoint has no same-day guard; its default observed-spend cap is
€1.20 and an optional run-count limit is available for one-shot scheduling.

The corrected canonical-query run
`pepesto_tesco_discovery_20260920191847`
(`36a98b6a-a0fd-4125-85f0-c62a87ddd25f`) submitted three independently
attributed searches for 36 cents. Credits moved from €20.34 to €19.98. It
returned exactly one candidate per query and recovered 0/3 exact replacements:
Fyffes loose bananas still returned the Tesco own-label SKU, the 180g Muller
canonical still returned the invalidated SKU without corroborating size
evidence, and Fitzgeralds wraps still returned H.W. Nevills wholemeal wraps.
All three were rejected and no mapping or trusted price changed.

Together, the invalid first run and corrected run cost 72 cents and produced
zero safe recovery. The temporary schedules were removed after each bounded
submission. Even with additional spend authorised, do not repeat this search
strategy across another cohort: corrected canonical queries still reproduce
the obsolete stored alternatives rather than discover defensible new SKUs.

## 52. Tesco Pepesto yield reconciliation — 20 September 2026

The apparent fall from 397/500 exact matches on 5–6 September to 19/250 on
20 September was primarily a request-shape failure, not loss of Pepesto's
Tesco transport. The historical `/search` contract accepted a `products`
array and returned ten independently attributable items for each ten-product
session. The current contract accepts a singular free-text `product` field.
When ten stored titles were joined into that field, each session returned only
one item: 25 sessions therefore produced 25 items for 250 nominal products,
and the other 225 were misleadingly finalised as failed despite never having
an independently returned result.

The old headline also requires an identity qualification. Exact response-SKU
matching proved agreement with the stored mapping, not agreement between that
mapping and the canonical product. The old cohort contains known material
mismatches. It must not be blindly reactivated.

The ambiguous legacy multi-product submission endpoint is retired. The shared
search adapter permits exactly one product per session, preserving attribution
for both trusted price refresh and bounded candidate discovery. `/search`
followed by the asynchronous `/retrieve` collector is the validated Tesco
price-refresh path. The synchronous `/products` route is not an operational
Tesco refresh route.

A new `proven_search_success` products cohort recovers only stale mappings
from historical Pepesto sessions that returned one item per requested product,
had a successful receipt, remain resolved, and pass the deterministic
canonical identity classifier including duplicate-SKU checks. Fresh mappings
are excluded. Selection remains demand-ranked, is capped at 50, requires an
explicit `proven-products-canary` confirmation, and supports a zero-credit
`dry_run=true` inspection before any queue message or Pepesto request is
created.

## 53. Tesco Pepesto search golden path restored — 20 September 2026

The corrected one-product-per-session `/search` canary returned 8 exact Tesco
SKU matches from 10 products. It cost 120 cents, moving the Pepesto balance
from €19.66 to €18.46. Two non-matches were rejected. This is consistent with
the earlier 397/500 exact-SKU baseline and confirms that the poor 2/50 result
from `/products` was specific to the wrong retrieval route, not a general loss
of Pepesto viability.

The single production operation is now `[ops] tesco pepesto search refresh`,
which targets `/api/workers/pepesto-tesco-search-refresh`. It requires explicit
confirmation, submits one product per search session, records observed credits
before and after, enforces a per-run spend ceiling and leaves result collection
to the existing ten-minute `/retrieve` worker. Paid submission remains manual;
there is no persistent paid schedule.

`/products`, `/catalog`, candidate-discovery and direct Tesco experiments are
not exposed as normal production refresh operations. The legacy ambiguous
submission endpoint returns `410` and points only to the search-refresh route.
The query builder and submitter both reject multi-product search requests, and
a regression test locks this attribution rule in place.

Operational confidence must remain split into two measures: exact response-SKU
agreement establishes product identity, while price freshness is a separate
claim. The 8/10 canary repeated the same numerical prices observed on
6 September, and four promotion flags lacked a corresponding previous price;
therefore freshness and promotion evidence require separate monitoring and
must not be inferred from SKU agreement alone.

## 54. Proven Tesco search refresh batches — 20 September 2026

The restored one-product-per-session Pepesto `/search` path was scaled through
two bounded production operations after the corrected 8/10 canary. PR #187
scheduled the first 50-product batch; run
`pepesto_tesco_search_20260920214644`
(`bd1fef45-3a4a-4652-8f92-69b37ebdccc1`) accepted 40 exact stored SKUs and
safely rejected 10. Observed credit moved from €18.46 to €12.46, an actual cost
of €6.00. Corrected fresh Tesco coverage increased from 102 after the earlier
paid experiments to 142/2,462.

PR #189 scheduled the requested next batch with the same 50-product and €6.00
ceilings. The identity-audited stale proven-success selector contained only 20
eligible products, so the operation submitted those 20 rather than broadening
into unproven mappings merely to fill the limit. Run
`pepesto_tesco_search_20260920222204`
(`e8678d31-2aed-4510-8148-fd085277cc13`) fetched all 20 in the next collector
pass, accepted 14 exact stored SKUs and safely rejected six. The run succeeded
at 70% yield. Credits moved from €12.46 to €10.06, an actual cost of €2.40.

The second operation added 14 distinct `pepesto_search` observations and
brought fresh trusted Tesco coverage to 156/2,462 (6.34%). Across the two scaled
batches, 54/70 products were accepted (77.14%) for €8.40. The six residual stale
products from the second operation remain ineligible for trust without a future
exact response; do not immediately repeat them merely to spend the remaining
balance. Price freshness remains a separate confidence dimension from exact SKU
identity. The fixed-date paid triggers were removed after collection; there is
still no persistent paid Tesco schedule.

## 55. Audited untried Tesco search cohort — 21 September 2026

After the two scaled corrected-search batches, the original stale
`proven_search_success` pool had been consumed apart from six products rejected
in the latest run. Repeating those six immediately would likely repay for the
same alternatives, so the selector now continues into a new safety-preserving
cohort instead.

Selection still prioritises independently attributable historical exact-search
successes. If fewer than the requested limit remain, it then fills from resolved,
stale Tesco mappings that pass the deterministic canonical identity audit as
`obsolete_mapping` or a fully corroborated `exact_synonym_duplicate`. Products
already tried by the corrected one-product workflow are ranked behind untried
audited mappings, including sessions that returned no item. This avoids immediate
paid retries while allowing future refresh once the broader untried pool is
eventually exhausted.

The response acceptance contract is unchanged: one product per Pepesto
`/search` session, asynchronous `/retrieve`, and an exact stored Tesco SKU in
a corroborated Tesco product URL before any price observation is trusted. The
fallback does not repair mappings, accept alternative SKUs or weaken brand,
variant, size, pack, formulation or duplicate-SKU safeguards.

## 56. Audited Tesco search scale validation — 21 September 2026

PR #191 deployed the audited-untried selector and PR #192 released one bounded
50-product operation through the corrected one-product-per-session `/search`
route. Run `pepesto_tesco_search_20260921172137`
(`b1333407-f9b3-40c1-b99a-a8d76d0aa615`) retrieved all 50 sessions, accepted
46 exact stored Tesco SKUs and safely rejected four. The run succeeded at 92%
yield. Credits moved from €10.06 to €4.06, an actual cost of €6.00.

Fresh trusted Tesco coverage increased from 156 before the operation to
202/2,462 (8.20%). Demand coverage is 836/1,681 units (49.73%). Across the main
retailers, 1,800 canonical products now have at least one live price, 841 have
at least two and 120 have all three. The fixed-date paid trigger was removed
after completion.

The validated next recovery tranche is 250 audited, previously untried
products, released as five separately accounted 50-product runs with a €6.00
ceiling each. At the currently observed 12 cents per product this requires
about €30; require a live balance of at least €35 before release and continue
to record actual before/after credit rather than treating that observation as
a permanent tariff. At the latest 92% yield, 250 products would add about 230
trusted prices and bring Tesco to roughly 432/2,462 (17.55%), but this is a
planning estimate rather than a promised result.

The `/retrieve` worker now checks up to 50 sessions per ten-minute pass instead
of 20 and has a 300-second runtime allowance. This reduces expected collection
for the five-batch tranche from roughly 130 minutes to about 50 minutes without
changing candidate extraction, exact-SKU acceptance, finalisation or failure
handling. Paid submission remains manual and no persistent Tesco paid schedule
is installed.

## 57. Tesco 250-product recovery tranche — 21 September 2026

A live zero-spend balance check confirmed €33.96 before release. PR #195 then
scheduled five separately accounted 50-product operations through the validated
one-product-per-session Pepesto `/search` route. All 250 distinct audited,
previously untried candidates were submitted and retrieved successfully:

- `pepesto_tesco_search_20260921204248`
  (`23aab187-26d8-486d-a700-147f2779e1e9`): 47 accepted, 3 rejected.
- `pepesto_tesco_search_20260921204518`
  (`a1463436-ba28-45df-8c62-1bc119618792`): 45 accepted, 5 rejected.
- `pepesto_tesco_search_20260921204823`
  (`ee2d8bee-235f-4974-96ec-8b16b141b65c`): 47 accepted, 3 rejected.
- `pepesto_tesco_search_20260921205127`
  (`f868643a-0325-49e9-b556-4433317f3577`): 46 accepted, 4 rejected.
- `pepesto_tesco_search_20260921205442`
  (`b1c79adc-74bc-4138-88a2-320f70d31924`): 39 accepted, 11 rejected.

The tranche accepted 224/250 exact stored Tesco SKUs (89.6%) and safely
rejected 26. All 250 Pepesto sessions returned and no retrieval session failed.
Observed credits moved from €33.96 to €3.96: €30.00 actual spend, exactly
matching the aggregate five-run ceiling.

Fresh trusted Tesco coverage increased by the same 224 products, from
202/2,462 (8.20%) to 426/2,462 (17.30%). Demand coverage remained
836/1,681 units (49.73%), showing that this tranche repaired audited catalogue
gaps rather than the currently demanded subset. Across the three main
retailers, products with at least one live price increased from 1,800 to 1,828,
at least two from 841 to 939 and all three from 120 to 218.

PR #196 removed all five fixed-date paid triggers immediately after submission;
the cleanup deployment reached production before retrieval finished. The free
ten-minute `/retrieve` worker completed the queue. There is no persistent paid
Tesco schedule. Exact response-SKU agreement continues to establish identity
only; price freshness remains a separate confidence measure.


## 58. Demand-first Tesco mapping-repair tranche prepared — 21 September 2026

The completed 250-product refresh lifted Tesco catalogue coverage but did not
change demand coverage. A live audit found 163 missing-demand Tesco mappings.
Only 19 were untried mappings with basic URL/SKU evidence, and deterministic
identity review rejects that apparent pool because the stored Tesco identities
contain material brand, product, formulation, measure or pack conflicts.
Repeating the normal refresh selector would therefore continue into
zero-demand catalogue gaps rather than safely improve household-list coverage.

The next safe tranche is instead the remaining 20 untried mappings already
invalidated by the deterministic risk audit. All 20 are tied to current demand,
representing 67 demanded units. Candidate discovery searches by canonical
identity, persists every candidate, and permits a mapping and price update only
when one exact replacement SKU passes the full brand, type, variant, measure,
pack, formulation and URL/SKU checks.

The protected candidate-discovery route now supports an explicit
`demand_only=true` cohort of up to 20 products, a caller-supplied spend ceiling
hard-limited to 240 cents, and `dry_run=true` inspection before any run, credit
lookup or Pepesto request is created. At the currently observed 12 cents per
one-product search, the complete tranche is expected to cost €2.40. Treat that
as a bounded current-tariff estimate and continue recording actual credits
before and after the run. No paid schedule is installed.


## 59. Demand-first Tesco mapping-repair result — 22 September 2026

PR #199 released the prepared 20-product demand-only candidate-discovery
tranche. Run `pepesto_tesco_discovery_20260922114211`
(`3240abfb-78b6-4037-bf4c-68a2b128dee6`) submitted and retrieved all 20
one-product Pepesto search sessions. Credits moved from €3.96 to €1.56, an
actual cost of €2.40 matching the run ceiling.

The operation persisted 40 candidate rows across 16 products; four products
returned no candidates. Nineteen candidate rows across eight products were
material mismatches and 12 rows across nine products were ambiguous. Two
products produced nine individually exact-looking candidates, but each had
multiple qualifying SKUs: seven materially different chicken-thigh products
for the underspecified `Chicken Thighs` canonical and both white and wholemeal
six-pack pitta for `Pitta Bread 6 Pack`. The single-SKU finalisation rule
correctly rejected both groups rather than guessing a variant.

No mapping or price was accepted. Tesco coverage therefore remained
426/2,462 (17.30%) and demand coverage remained 836/1,681 units (49.73%).
The 20 products are now recorded as attempted discovery evidence and must not
be repaid for without new deterministic identity evidence or a canonical
product-definition repair. PR #200 removed the fixed-date paid trigger after
submission; no persistent paid Tesco schedule remains.

## 60. Deterministic canonical repair from persisted Tesco evidence — 22 September 2026

The 20-product demand-first evidence was reconciled against Dunnes and
SuperValu identities without another Pepesto request. Only `Pitta Bread 6
Pack` had enough cross-retailer evidence for a deterministic repair: the
existing SuperValu SKU/URL explicitly identifies the product as white pitta,
which resolves the otherwise ambiguous white-versus-wholemeal Tesco pair.

The canonical is clarified to `White Pitta Bread 6 Pack`, including its eight
existing list-item units. Tesco is restored to exact SKU `254945564`, `Tesco
White Plain Pitta Bread 6 Pack`, with the persisted €0.88 observation from run
`3240abfb-78b6-4037-bf4c-68a2b128dee6`. The wholemeal SKU is retained as
rejected evidence with an explicit variant conflict, and the prior mapping is
preserved in `retailer_mapping_audit_decisions`.

The other 19 products remain unresolved because their persisted candidates do
not prove exact brand, type, variant, measure, pack or formulation identity.
No further Pepesto credit was spent and no paid schedule was added.

## 61. Structured-quantity Tesco demand repairs — 22 September 2026

The wider missing-demand backlog was reconciled against persisted candidate
payloads and Dunnes/SuperValu identities without another Pepesto request.
Structured candidate quantity is now part of deterministic replacement
classification, allowing `pieces=1` to corroborate the otherwise omitted
`loose`/single-item wording while still rejecting multi-piece packs.

Three further mappings had sufficient exact evidence. `Loose Pink Lady Apples
1 Pack` maps to Tesco SKU `284182372` at €0.60 and `Loose Aubergines 1 Pack`
maps to Tesco SKU `266344796` at €0.85; both persisted candidates explicitly
report one piece. The branded Dr. Oetker canonical is corrected from pizza to
`Dr. Oetker Bistro Pepperoni Baguettes 2 Pack 250g`, matching both the Dunnes
identity and existing Tesco SKU `260285673` with its prior trusted €2.00
Pepesto observation.

All prior mappings and evidence decisions remain auditable. Other candidates
remain unresolved where brand, type, variant, formulation, measure or pack
identity is not exact. No Pepesto credit was spent and no schedule was added.

## 62. On-demand private GA4 traffic report — 26 September 2026

The production service-account connection in `src/lib/google-analytics.ts`
remains configured in Vercel. The August traffic assessment used a temporary
public endpoint and cron that were removed after use; there was no surviving
on-demand report route. Do not assume the GA4 connector itself is an invocable
report without a deployed entry point.

The deployed read-only operation `[ops] analytics traffic report` uses the
existing owner-authored GitHub issue dispatcher and a `CRON_SECRET`-protected
route. It compares the last 14 complete GA4 property days with the preceding
14 days and returns daily activity, source/medium, landing pages and event
counts. The response is stored in the private `ops_manual_dispatches` table;
the public dispatcher returns only status and dispatch ID for this operation,
including idempotent replays. The operation sends no personal or credential
data to public logs. After deployment, create a fresh owner-authored issue with
that exact title, call `/api/ops/dispatch?issue=<number>`, and read its private
response through the database. PR #219 was merged as `68ca948`, the Vercel
production deployment reached READY and issue #220 ran successfully. The
private report is in `ops_manual_dispatches` dispatch
`4d8632d2-52e5-4d05-838a-b651a8ecc91c`.

For 12–25 September, GA4 counted 1,241 sessions and 1,109 new users, versus
668 sessions and 580 new users in the preceding 14 days. The `/contact`
landing page accounts for 538 sessions, the comparison landing page 138 and
home 99. GA4 reported 68 signup prompt views and six `signup_started` events;
`keyEvents` was zero. The database has no new subscriber from 19–25 September;
two signup verification emails were sent on 20 and 21 September with no
signup-source verification link open. A controlled registration on 26
September did receive the email and completed the protected session. The
Supabase egress quota outage on 22–23 September is not a complete explanation
for the earlier registration stop. GA4's client completion event is missing
despite server-confirmed registrations, so use `subscribers` and
`agent_events` as the registration source of truth until GA4 is verified.

## 63. Registration funnel recovery — 26 September 2026

PR #221, merged as `fe96006`, extended the private report with `/contact`
daily and source breakdowns. The production deployment reached READY and the
second owner-authorized dispatch through issue #220 succeeded as
`fc88f227-1af9-4e2a-bf56-218d8ad76c57`. All 538 `/contact` landing
sessions in the 12–25 September report were classified as `(direct) / (none)`;
184 were engaged sessions. The surge begins on 17 September (40 sessions),
then 91 on 18 September and 57–76 a day on several subsequent days. This is
not evidence of qualified household interest, but GA4 alone cannot establish
whether visits were automated. Do not add a shopper signup prompt to the
partnership/contact page on this evidence alone.

The release initializes the GA4 tag queue before hydration and gives the
verified signup completion event callback up to 1.2 seconds before redirect.
This improves client delivery but is not a substitute for a verified
server-side conversion record. The email link is valid for 30 minutes rather
than 15, with consistent email and UI copy, a prompt to check Updates/spam
and an explicit retry option. Existing rate limits remain in place. The
production sign-in page returned HTTP 200 and the protected analytics route
returned HTTP 401 without credentials. A fresh real-user signup and GA4
completion event have not yet been observed after the release; continue using
`subscribers` and `agent_events` as the registration source of truth.

## 64. Contact landing route — 26 September 2026

The `/contact` page appears in public search results, although GA4 classified
all 538 sessions landing there on 12–25 September as direct traffic. Indexing
alone does not establish the cause of the spike. To test whether these visits
include shoppers, move the existing contact form to `/contact-us`, update the
footer and vendor contact links, and add the new canonical URL to the sitemap.
Temporarily redirect `/contact` to the agent homepage with `?entry=contact` so
GA4 can distinguish old-link traffic from normal homepage landings. PR #223
merged as `0340ecf`; the production deployment reached READY. Live checks
confirmed `/contact` returns HTTP 307 with `Location: /?entry=contact`, the
marked homepage returns HTTP 200, and `/contact-us` returns HTTP 200 with its
canonical and footer link. Keep the redirect reversible and compare those
landing sessions with agent starts and verified registrations before treating
the traffic as qualified demand.

## 65. Immediate acquisition and signup improvements — 26 September 2026

The 14-day GA4 increase of 573 sessions included 536 additional `/contact`
landings compared with the preceding 14 days. Excluding that page leaves 703
sessions versus 666, about 5.6% growth. The next decision needs an organic
source-to-landing breakdown and a report on events for sessions redirected
from `/contact` to `/?entry=contact`. Extend only the private on-demand report
with these aggregate dimensions; the redirect report includes the partial
current day and must not be compared directly with complete-day totals.

The comparison landing page is a meaningful existing shopper entrance. Offer
one-tap weekly-shop, budget and dinner tasks alongside its free-form agent
request, measuring the selected action in `landing_agent_started`. Keep the
visitor's first agent answer available before the email gate. For signup
emails, distinguish the subject and message from ordinary sign-in, making the
saved conversation and next step explicit. Observe subsequent prompt-to-email,
email-to-verification and verified-subscriber counts before claiming uplift.
PR #225 merged as `0d97777`; CI and preview passed and the production
deployment reached READY. The private dispatch above returned HTTP 200.
Its new `organic_landings` list has 126 Google organic sessions on the main
comparison page, 40 on home and a long tail of product pages. The new
`redirected_contact_events` list was empty on the same partial day; that is
not yet an outcome measure. Preview showed the comparison-page task buttons.

## 66. Product search handoff — 26 September 2026

The expanded private GA4 report ran successfully after PR #225 as dispatch
`987c7be5-a7c5-4bb2-b9ca-5e7b9d3cddbf`. In the last 14 completed days,
126 of 409 Google organic sessions landed on the main comparison page; the
homepage received 40, then product pages formed a long tail, led by chicken
mince with 14. The comparison-page one-tap tasks target the largest existing
organic entrance. The product template's price-panel CTA currently links to
the plain homepage, losing the viewed product. Carry the product and its
landing path into the agent prompt, and offer one-tap add, alternative and
watch tasks in the existing product agent card. This changes the journey for
existing indexed product pages; subsequent agent starts and verified signups
still need measurement before claiming an uplift. PR #226 merged as `aca3676`
after CI and preview passed. The production deployment reached READY, and
`/browse/chicken-mince` rendered the three tasks and a price-panel link whose
agent prompt includes `Chicken Mince` and the product landing path.
