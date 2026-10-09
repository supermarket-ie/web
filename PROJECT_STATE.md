Warning: truncated output (original token count: 45547)
Total output lines: 3027

# Supermarket.ie — Canonical Project State

**Last updated:** 29 September 2026

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
boundary and reserve individual catalog…15547 tokens truncated…does not claim to repair catalogue matching or agent
response speed. The visible handoff text now uses product names and quantities
without exposing internal catalogue IDs. Production verification remains a
release gate; a READY preview alone is not proof of a successful release.

PR #229 merged as `bf02e779`. Production deployment
`dpl_DnEQJheu8PgzMRkCqUcJbZC7386X` reached READY on that commit; live HTML and
browser checks confirmed the public example, editable quantities, coverage and
household form. The catalogue and agent follow-ups below are separately scoped.

## 69. Household-shop response and product identity — 26 September 2026

The owner approved the follow-up after the weekly-shop journey exposed slow
responses, a banana/snack mismatch and duplicate proposal cards. Baseline main
and production were verified at `bf02e779`; Supabase had 2,480 trusted prices
(Tesco 539, Dunnes 920, SuperValu 1,021). The previous diagnostic guest session
for two adults and a €100 weekly budget took 121.496 seconds. It made two
`present_household_shop` calls and 20 individual `resolve_product` calls,
exhausting the ten-call expensive-tool budget. The two proposals had 9/29 and
19/29 priced lines. Tool execution itself was under two seconds per proposal;
five model steps consumed 158,463 cumulative input tokens. The repeated full
tool results and unnecessary second resolution pass were the main observed
amplifiers, rather than evidence of a slow database.

Keep the existing Eve runtime and batch resolver. Normalise ordinary pack
wording (`1kg bag`, `dozen`, `sliced pan`) and prefer clear pack-aware matches
without relaxing the minimum score or ambiguity gap. Explicit product-type,
measure, pack and variant contradictions are rejected in catalogue resolution
and household grounding. These checks catch known material conflicts; their
absence is not proof that every catalogue mapping is correct. Ambiguous needs
remain unresolved, missing prices stay missing, and incomplete basket totals
remain null. The model receives a compact coverage summary through Eve's
`toModelOutput`; the durable tool result still contains the complete native
shopping card. Instructions finish after presentation instead of doing one
lookup per missing line or repeating the basket in prose.

Only the latest completed proposal within each user turn is displayed. Earlier
turns remain in conversation history, partial/invalid revisions are ignored,
and autosave waits until the turn finishes. Memoising parsed proposals prevents
unrelated React renders from aborting/restarting persistence. The registration
invitation also waits for the completed first answer.

Two exact stored mappings were confirmed wrong: SuperValu SKU `1709524003`
mapped fresh `Mini Bananas` to Ella's Kitchen banana mini puffs, and Dunnes SKU
`100750899` mapped `Bananas Loose` to a five-banana organic pack. The guarded,
reversible SQL in `supabase/operations/2026-09-26-quarantine-banana-mappings.sql`
preserves each prior mapping in the existing private audit table and invalidates
only the unchanged erroneous mapping. A transaction dry run returned exactly
those two rows, both excluded from `latest_prices`, and was rolled back.
The same transaction was then committed and independently checked: both
erroneous mappings are absent from `latest_prices`. Trusted row counts are now
Tesco 539, Dunnes 919 and SuperValu 1,020 (2,478 total). No observation or prior
mapping was deleted, and no retailer refresh or paid retrieval was triggered.

Local validation passed 288 tests across 44 files, TypeScript and lint. New
regressions cover banana/snack and pack conflicts, ordinary pack wording,
latest-proposal selection and compact model output. Preview latency, final
release checks and production verification remain pending;
do not claim a measured speed improvement or conversion uplift yet.

PR #230's first preview exposed an additional lifecycle defect: capability
instructions were selected from `ctx.messages` at Eve `turn.started`, before
the current delivery entered history. The first request therefore received
only the fallback product module, and the repeat-lookup loop persisted despite
the new household guidance. Eve 0.39.0 documents this ordering. Capability
selection now runs in the supported HTTP channel `onMessage` hook against the
actual incoming text/parts, returning application-owned guidance as request
context and preserving `defaultEveAuth`. The stable core and protected-tool
checks are unchanged. Instructions remain modular; historical instructions
are no longer mistakenly treated as the current turn's intent. Regression
checks cover the first weekly-shop delivery and structured text input.

The next preview (`57d9f3e`) finished the same request in 79.238 seconds, with
one household-shop call and no individual product lookups (three model steps,
41,818 cumulative input tokens). It proposed 30 lines with 18 priced; this is
a single diagnostic comparison, not a latency SLA or conversion result.
It also exposed an unconfirmed six-pack being assigned a single-item price.
Grounding now requires positive evidence for a requested pack count/measure,
rejects multipack-versus-loose contradictions in both directions and recognises
bare egg counts. Unknown packs stay unpriced. The input schema explains the
required unresolved-need field and distinguishes purchase quantity from the
contents of one unit. Compact output labels incomplete budget assessments as
unconfirmed. The four-item browser check reached one native card and the
registration invitation; no signup email or account was created.

The final pack regressions bring local validation to 294 tests across 44 files;
TypeScript and lint pass. Final preview and production checks remain release
gates. Signed-in autosave selection is covered by regression tests; the live
checks use guest sessions and do not create an account solely for testing.

Commit `c3472de` passed release CI and reached a READY preview. The final
diagnostic asked one permitted dietary clarification, then completed the shop
in 75.056 seconds after the answer: one `present_household_shop` call, no
individual lookups, 36 proposed lines, 16 priced and €45.67 explicitly described
as a partial subtotal. Bananas were six individual units; unconfirmed salmon
packs remained unpriced. This is not directly comparable to the one-turn
baseline because it used a clarification. Validation also exposed the wording
`one 2L bottle` against a six-bottle offer; the final guard recognises explicit
single containers and written units such as `2 litre`, with regression cases.
Production verification remains a release gate and will be recorded on PR #230.
Final local validation passes 296 tests, TypeScript and lint.

PR #230 merged as `a6349a8`; production deployment
`dpl_FrVahwWvjvaRDfiBKuHbzAqSf1xa` reached READY with both public domain aliases.
The weekly-shop landing returned HTTP 200 with its existing canonical and public
example. Both quarantined mappings remained outside trusted prices.
The production five-item check displayed one card, six individual bananas, an
explicitly incomplete subtotal and the registration form; no email was sent.

## 70. Spaced unit parsing follow-up — 26 September 2026

That production check also exposed a false negative: after converting `2 litre`
to `2 l`, the existing retailer pack parser interpreted `2 l bottle` as two
bottles. Join numeric measures to their units before pack-count parsing so a
valid 2L milk offer remains eligible. This does not relax differing measures
or single-versus-multipack conflicts. A grounding regression verifies one
`2 litre bottle` at the trusted €2.25 price. The fix is separately gated through
CI and production verification; the earlier production result is not treated
as final success while this known regression remains.

PR #231 merged as `cdc26087`; production deployment
`dpl_A2t1Jfius62Z3D5Zm8576X9h6Kkj` reached READY with both public aliases.
The five-item guest check priced milk at €2.25, carrots at €1.45, a dozen eggs
at €4.35 and six loose bananas at €1.86. One card displayed an explicit €9.91
subtotal for 4/5 lines, with the unconfirmed individual water bottles excluded.
The registration prompt followed completion; no email or account was created.

## 71. Search landing shopping workspace — 26 September 2026

Sprint 2 of the traffic/registration work targets the existing organic entrance
`/compare/supermarket-prices-ireland`. Baseline GitHub main and READY production
were verified at `cdc26087`; Supabase still returned 2,478 trusted offers. The
page had a prefilled prompt redirect and static price examples, with no way to
select products or edit a shop there. The shortcut-button releases remain
reverted; this work introduces a functional shopping workspace instead.

Visitors can search the currently priced catalogue, add up to 50 exact canonical
products, change quantities from 1–20, remove lines and immediately see retailer
coverage and subtotals. Products with one retailer remain useful; three-retailer
overlap is not an entry requirement. A bounded public search route returns at
most eight products, or refreshes up to 50 exact selected IDs. Both search and
the crawlable initial examples use the existing fully paginated `latest_prices`
reader, the seven-day boundary and explicit identity-conflict checks. Unmarked
canonical single units cannot show a retailer multipack price. Empty and
unpriced lists have no numeric total, and incomplete store totals remain null.
Retailer names, dates and price exclusions remain inspectable.

The visitor supplies household size, optional budget and free-form needs. The
default request keeps to their list; completing the rest of the week is an
explicit option. Review continues through the existing Eve runtime and native
shop/save invitation. Household text and selected quantities travel via the
existing single-use session handoff, never a prompt query string. A separate
30-minute tab-local draft preserves intentions when returning to the page;
stored offers/prices are discarded and refreshed. Persistence still requires
registration and existing server grounding. This is not a second planner or
retailer checkout path, and it does not complete sprint 4's email verification
and cross-device continuation audit.

`shop_builder_edited` records aggregate action/count metadata, and
`landing_agent_started` identifies the builder, selected count and landing path.
No product query, shopping text, budget value or household detail is included
in those events. The URL, title, canonical, H1 and public price evidence remain;
the page adds useful crawlable comparison guidance and related links. ISR is
30 minutes, consistent with the weekly-shop page. No mapping, schema or retailer
job is changed, and no ranking or registration uplift is claimed.

Focused validation passes 15 tests covering identity/price truth, canonical-ID
separation, quantities, request scope, bounded search and draft expiry/restore.
The full local suite passes 306 tests across 46 files; TypeScript and changed-file
lint pass. Release CI, preview interaction and
production confirmation remain release gates and will be recorded on the PR.

PR #232 merged as `f3ac83f7`; production deployment
`dpl_4EuUkBUAcfbQdsyQh4EqvytNpjpF` reached READY with both public aliases.
Preview verified add/remove/quantity editing, draft restoration, household and
budget preservation, one completed agent shop and the save/signup invitation.
Production verified the public page, catalogue search, editing and totals.
No signup email or account was created. These checks complete sprint 2; the
full email-verification continuation remains sprint 4.

## 72. Product search coverage and useful catalogue discovery — 26 September 2026

Sprint 3 starts from GitHub main and READY production `f3ac83f7`. Supabase still
has 2,478 trusted offers (Tesco 539, Dunnes 919, SuperValu 1,020) for 1,248
canonical products. The old product-page/sitemap rule required resolved mappings
at all three main retailers: 1,029 products qualified, while 325 products with
fresh trusted offers were excluded. Category pages additionally rebuilt prices
from raw observation history, required all-three overlap, and did not link
individual products. The browse directory read an unpaginated mapping subset,
linked unavailable product routes and displayed blurred zero-price placeholders.

The public pre-release sitemap returned only 29 product URLs, despite the live
mapping-based eligibility count of 1,029. HTTP checks confirmed that the Andrex
four-roll and Baby Spinach 90g URLs returned 404, while Chicken Mince returned
200. Distinguish this observed public sitemap from the larger theoretical
eligibility count; neither is a measurement of Google's indexed-page count.

A shared public catalogue now joins canonical identities to the same guarded
`latest_prices` evidence used by the shopping workspace. One currently trusted
retailer is sufficient. Metadata records are fully paginated in stable ID order;
a failed page aborts the read rather than publishing a partial catalogue. Only
metadata is persistently cached; freshness/identity eligibility is recalculated
when pages render. Price reads retain the existing bounded cache/resilience
policy. Product pages, categories and the sitemap revalidate every 30 minutes.
Product pages use on-demand ISR instead of rebuilding the whole catalogue per
product during deployment. CI's existing explicit placeholder environment may
return an empty catalogue; preview and production cannot use that exception.

The guarded snapshot yields 1,230 products with prices across 24 categories,
including 317 products excluded by the previous publishing rule. The new sitemap
lists those currently priced products with actual observation/template dates,
replacing the blanket June date. Existing canonical product URLs remain valid
when prices expire: they show missing prices, related products and an editable
add-to-shop action. They are not redirected or marked noindex. The sitemap
omits 116 previously eligible products currently without a guarded price; their
pages remain accessible. Existing names/slugs are preserved. Future equal-name
collisions receive distinct ID-suffixed URLs rather than merging price evidence.

The shop/category directory links to crawlable product pages and adds the six
previously omitted categories (Baby, Chilled, Pet Care, Oils, Seasoning, Stock).
Canonical category names/slugs share one configuration. Historical browse
category queries and space/ampersand category paths redirect to their canonical
category route. `/browse` offers server-rendered product search and pagination;
search-result queries are noindex/follow, ordinary pagination self-canonicalises.
There is no signup gate for this public price evidence.

Product pages display exact retailer names, observed dates, source links and
explicit missing-price states. Product JSON-LD only includes visible, guarded
offers. Unverified stock availability and invented future promotion-end dates
are removed; category ItemList markup links to actual product URLs. Existing
nutrition remains retailer-labelled and is included only for a current matched
retailer product. Price claims do not promise national cheapest-store status.

An add-to-shop quantity form preserves the existing draft's household, budget,
notes, products and quantities, enforces 50-product/20-unit limits, and reloads
current prices in the existing workspace. Only intentions enter session storage.
The original product landing path continues through the agent handoff for funnel
attribution. `product_added_to_shop` records the public landing path and item
count; no shopping notes, budget or household details enter this event. Existing
Eve grounding, save and registration paths are reused; no email flow is changed.

Validation exposed two existing identity errors: Chicken Mince had a Dunnes
Turkey Breast Mince offer, and ordinary `100% Pure Honey` had a specialist Manuka
Honey offer. Shared identity checks now reject explicit meat-species conflicts
and ordinary/manuka contradictions, including in the builder/household guard.
The chicken URL remains available with missing prices. No catalogue row, mapping,
observation, schema, paid retailer job or schedule was changed. These guards catch
known contradictions, not proof that every historic mapping has been re-audited.

Local validation passes 314 tests across 47 files, TypeScript, changed-file lint
and diff checks. New regressions cover single-store eligibility, stale/zero/pack
exclusions, the observed identity errors, stable URLs without prices, equal-name
identity separation, truthful schema, category aliases and draft preservation.
Preview interaction, release CI and READY production verification remain gates;
final deployment and live evidence will be recorded on this sprint's PR. Search
Console query/position access remains unavailable: no indexing, ranking, traffic
or registration uplift is claimed from publishing more eligible pages alone.

PR #233 merged as `968d2304`; production deployment
`dpl_MaoG8VGucQWUVB1aJKYhKBq7MysC` reached READY with both public aliases.
Preview and production confirmed the catalogue/category/product routes, the
expanded sitemap, stable existing URLs and product quantity handoff. Preview
also confirmed preservation of an existing household draft through one completed
agent shop and the registration invitation. CI passed all 314 tests. Sprint 3 is
complete; email-verification continuation remains sprint 4.

## 73. Catalogue copy should sell usefulness, not catalogue size — 27 September 2026

Paul explicitly asked not to highlight the number of products to visitors: the
current catalogue size is not a selling point and may discourage registration.
This is a durable copy preference for public catalogue and category discovery.

The catalogue hero now focuses on finding food and household essentials, checking
prices and pack sizes, and adding what the household needs. Category cards and
category introductions no longer advertise product totals. The introductory
coverage disclaimer is removed; each product still shows its actual retailer
prices, checked dates and missing-price states where those help a shopping
decision. Search and browse results use neutral labels without product totals;
pagination retains the current page and Previous/Next links without a total.
URLs, headings, metadata, category descriptions, crawlable links, sitemap and
accurate structured data are preserved. The category directory no longer reads
the complete priced catalogue merely to calculate presentation counts.

Before this follow-up, GitHub main and READY production both remained `968d2304`.
A read-only Supabase check returned 2,476 trusted price rows for 1,248 canonical
products. No database, retailer refresh, matching, registration or agent-flow
changes are part of this copy update. Release checks and live confirmation will
be recorded on the PR.

PR #234 merged as `37ad3615`; production `dpl_FTZ6uYYY93picNTrb3nNoMFsYt1M`
reached READY. Live catalogue, category and browse checks confirmed the copy
change and preserved navigation/canonicals.

## 74. Registration and guest-shop continuity — 27 September 2026

Sprint 4 starts from verified GitHub main and READY production `37ad3615`.
The existing email token held account details only. Guest Eve state lived in
origin-local browser storage; another browser/device had no state to transfer.
An existing account's saved/local chat could replace the new guest journey, and
the restored transcript was not persisted as an account chat until another turn.
The sign-in form also sent a default household of two, overwriting existing
subscriber family size. These are observed implementation gaps, not proof of
which issue caused any particular visitor to abandon registration.

`/api/subscribe` now stages a bounded snapshot before sending the email. The
private `registration_continuations` table binds an opaque UUID to an HMAC of
the normalized email, with RLS and service-role-only table/function grants.
The email token carries the UUID, never the transcript or household details.
Snapshots expire after 24 hours; email links still expire after 30 minutes.
An expired, correctly signed link may lead to a fresh email request for the
same snapshot, but never authenticates on its own. Resend checks both email
binding and expiry. Automated cleanup runs on registration requests and the
existing daily protected agent-task job; claimed temporary content clears
immediately. The privacy page describes this temporary transfer.

After verification sets the existing HttpOnly session cookie, the completion
screen calls an authenticated restore route. A transaction locks and claims the
handoff, checks subscriber/email ownership and creates exactly one existing-style
account conversation. Replays return the same chat. The screen opens `/?chat=...`
and exposes a retry if restoration fails, rather than silently opening an older
chat. Requested chats load directly under the existing ownership check. Guest
events preserve the native card and display history; guest runtime session IDs
and client account claims are discarded. The first signed-in message starts an
authenticated Eve session with bounded, explicitly untrusted prior conversation
and shopping intentions as supported client context. Prices remain server-grounded.

The existing structured-shop save route still reprices before its first write.
An account/proposal uniqueness key prevents repeated links, reloads or concurrent
requests from creating duplicate shops. Autosave cache keys are account-scoped,
the shop links to the owned conversation, and a failed save has a working retry.
Sign-in preserves an existing family size; new registrations derive it from a
validated household shop when available. Registration prompts explain the free
account/save benefit and email confirmation step, and email copy follows the
actual saved-shop/conversation intent. Forms wait for a completed agent response.

Server events distinguish email sent/failed, verification opened/expired,
registration completed, continuation restored/failed and first shop saved.
The omitted client event types `signup_email_engaged` and `sign_in_started` are
accepted, and blocked browser storage no longer stops analytics or submission.
No transcript, household requirements, budget or bearer token enters analytics.
GA completion remains supplementary to the server-confirmed registration event.

Validation: 323 tests across 49 files, TypeScript, changed-file lint and diff
checks pass. New route tests exercise the real email-token/cookie/restore/save
handlers with an isolated email sink and database double; they cover another
browser with no local storage, new/existing accounts, duplicate save, expired
and forged links, fresh-link recovery, staging failure and provider rejection.
The migration also passed isolated Postgres assertions for service-role access,
denied browser-role access, email/account binding, expiry, single claim/event,
temporary content removal and account-scoped save uniqueness. No test account
or verification email has been created in production. Database application,
release CI, preview UI and READY production checks remain release gates and
will be recorded on the PR; real inbox delivery and conversion uplift are not
established by isolated flow tests.

Database migration `20260927081635_registration_continuations` was applied
successfully. The repository migration filename follows that database-assigned
version. Live checks confirm RLS enabled, no anon/authenticated SELECT or RPC
EXECUTE permission, service-role access, a rejected unowned claim and the unique
saved-shop index. No pending handoff rows or test accounts were created. The
security advisor reports only the expected informational no-policy notice for
the new service-only table; no browser policy is appropriate to this design.

PR #235 merged as `c6b56305`; production `dpl_5gSJPENNg7CxVEBwe772TWAyZj2B`
reached READY with both public aliases. Live guest-shop/save copy, expired-link
recovery, unauthenticated restore rejection and invalid-token/no-cookie checks
passed. All 323 tests passed. No production test account/email was created.

## 75. Price-backed homepage example and editable handoff — 27 September 2026

Paul approved replacing the existing illustrative `#sample-shop` section below
the homepage agent, not adding another banner, generic prompt row or new SEO
landing page. The baseline main and READY production were `c6b56305`; a read-only
Supabase check returned 2,476 trusted offers. No retailer job, mapping, schema,
account, email or paid promotion is changed by this work.

The household-essentials example uses stable canonical identities and quantities,
with current prices from the existing fully paginated `latest_prices` reader and
the shopping-workspace freshness/identity/pack guards. It chooses one retailer by
coverage, then subtotal; it does not combine stores into a one-store total or
claim national cheapest status. Actual retailer names, quantities, check dates and
line totals are visible. The full list expands in place. Missing prices remain
explicit and prevent a complete total; no-data/dependency failure retains the
unpriced intentions without a numeric zero or taking down the agent homepage.
The server section streams independently behind Suspense. No price or total is
hardcoded. The example is labelled a starting basket, not a full week's meal plan
or an average household spend. The two-adult/one-child/€100 context is editable.

`Make this shop yours` fills the existing guest agent composer and moves focus
there without sending, saving or ordering. A non-empty request is preserved
unless the visitor explicitly chooses the example instead. Busy/gated sessions
are not overwritten. The visitor edits and sends through the existing Eve flow,
then uses Sprint 4 registration. Only shopping intentions, not cached prices or
canonical IDs, enter the editable prompt. No household text is placed in URLs;
`/#sample-shop` is the public shareable anchor. Existing catalogue and SEO routes
remain unchanged.

Aggregate `homepage_example_viewed`, `homepage_example_selected`,
`homepage_example_started` and `homepage_example_result` events distinguish actual
visibility, handoff, explicit submission and a new structured result. They use the
existing analytics session so registration can be joined to the same journey;
they contain no request text, quantities, household values or prices. Existing
server-confirmed registration events remain the conversion source of truth.
Release tests, preview interaction and READY production checks are recorded on
this work's PR. No traffic or conversion uplift is claimed. External promotion,
outreach and advertising are not launched by this homepage implementation.

Local validation passes 331 tests across 50 files, TypeScript, changed-file lint
and diff checks. Eight new regressions cover cents/quantities, one-store coverage
selection, partial/no-data states, freshness/pack/identity exclusions, intent-only
handoff and existing-draft/busy/gated protection.

The initial READY preview confirmed actual retailer prices and preserved a typed
request through the keep/replace choice. Its mushrooms had no current offer at
the selected retailer, so the authored example was changed to the already-priced
broccoli identity; this changes the example list only, not catalogue mappings or
the missing-price safeguards. Multiline example requests suppress the existing
predictive-search suggestions to keep the editable request clear.

PR #236 merged as `67ea37b5`; production `dpl_CAqVZi1uE3Cd9UdHNDfBPrrTZDkr`
reached READY with both public aliases. The public example showed a complete
€36.02 SuperValu basket and an editable, non-submitting handoff. Preview changes
to an €80 budget and three milk units survived into the native card and save
invitation. All four example funnel stages were observed. No email/account or
promotion was created. A separate existing-agent issue remains: generated prose
called the €35.21 selected mixed-store subtotal a SuperValu total, while the
validated card correctly showed the €38.27 complete SuperValu basket. The
homepage's deterministic one-store calculation was not affected.

## 76. Image-free homepage example visual refinement — 27 September 2026

Paul approved restoring visual polish without relying on product photography.
Baseline main and READY production were `67ea37b5`; a read-only database check
returned 2,459 trusted offers. This is a presentation-only follow-up to sprint 5,
not a replacement shopping flow or a claim about improved conversion.

The existing example uses a compact editorial split: household introduction and
the editable-shop action on the left, a cream receipt with a pale-green total
on the right. On narrow screens the introduction, receipt and action stack in
that order. Bundled decorative line icons provide visual anchors without remote
images, missing-image placeholders or invented product photography. Clearer type
hierarchy, quieter borders, consistent spacing, tabular prices, visible keyboard
focus, adequate touch targets and reduced-motion support preserve usability.

The authored basket, trusted reader, freshness/identity checks, totals, disclosure,
event names and existing-draft/busy/gated handoff protection are unchanged. Actual
retailer names, individual checked dates, missing prices and total exclusions
remain visible. No schema, mappings, retailer work, agent narrative, registration
or email changes are included. Tests, preview checks and final production evidence
are recorded on the release PR; the separate agent-prose issue above remains open.

Local validation passes all 331 tests across 50 files, TypeScript, changed-file
lint and whitespace checks. No dependencies or remote image hosts were added.

## 77. Guest living receipt alongside the homepage agent — 27 September 2026

Paul approved adapting the signed-in right-hand basket for the pre-login shop
experience, keeping the polished `#sample-shop` example as marketing proof.
Baseline main and READY production were `8c1d80b3`; a read-only Supabase check
returned 2,383 trusted offers. No retailer refresh, schema or email change is
required.

The guest homepage opens a receipt when a shopping conversation starts. Desktop
places it beside the agent; smaller screens use an expandable summary immediately
above the composer and a compact save action. The shared receipt surface preserves
the signed-in visual language, while its data comes directly from completed,
validated `present_household_shop` results in the existing Eve conversation.
It never calls the private weekly-plan endpoint. Partial/invalid tool results
cannot replace the last completed proposal. Chat retains concise proposal markers
instead of repeating full shop cards. Product-only queries keep the existing flow.

The receipt uses server-calculated line totals, selected subtotal and one-store
coverage. No priced lines means no numeric total; incomplete shops cannot claim
to be within budget. Mixed-store prices are explicitly identified, and incomplete
retailer baskets have no complete total. Household details and assumptions remain
inspectable. A deterministic revision summary describes additions, removals and
updates without claiming savings from changing coverage.

The homepage guest UX permits one revision after the first completed proposal,
including when one initial clarification was needed, with a hard maximum of three
user messages. Without a proposal the existing two-message bound remains; watches
and other persistent requests still lead to sign-in. Authenticated tools retain
their server access controls. This UX limit is not a security or rate-limit claim.
The existing email continuation carries the same Eve events and latest proposal
through verification, then revalidates prices and saves using the existing path.
No new account or email is needed for testing; isolated route tests cover that
handover. Existing registration analytics remain in use.

A preview-only `/preview/guest-shop` viewport harness embeds the real homepage at
390 × 844 for mobile checks. It returns not-found in production, uses no synthetic
auth or shopping state and is marked noindex. Local validation passes 339 tests
across 51 files. Release CI, real preview interaction, responsive inspection and
production evidence will be recorded on the PR before this release is complete.


The first READY preview (`ba0e6eb1`, PR #238) completed a real three-turn guest
journey: clarification, a seven-line top-up shop with one unpriced product, then
an explicit revision changing milk quantity and removing that product. The
receipt retained the €12.64 incomplete proposal during revision, then showed the
€14.89 selected total and “1 removed · 1 updated”. The mixed-retailer label and
missing-price warning were correct. The existing model prose still occasionally
attributes the selected subtotal to one retailer or calls an incomplete proposal
within budget; deterministic receipt truth does not fix that separate agent
narrative issue recorded in §75.

The 390px preview confirmed a compact summary above the composer and expandable
product details. Follow-up polish makes mobile product and save disclosures
mutually exclusive, uses plain missing-price wording, and suppresses an early
registration prompt while the initial proposal is still processing. A further
isolated regression confirms the latest revision, quantities and budget survive
email continuation. No live verification email or test account was created.

## 78. Guest ideas: optional first-answer saving, registration gate retained

The first product-use/meal-ideas answer had no structured shop, correctly, but
HomePlanner automatically opened the full registration form after any first
useful answer. That made exploration feel interrupted before the shopper chose
an idea. The user requested a quieter first-answer experience while explicitly
retaining the registration gateway.

First non-shop answers now show a small optional “Save these ideas — free
account” action (or “Save this answer” for other intents). Opening it reveals
the existing email continuation form; closing it preserves the mounted form.
Meal copy describes saving ideas rather than claiming a meal plan already
exists. The collapsed action does not count as a full signup-form impression.
Completed structured shops keep the existing receipt and save invitation.

Exploratory meal guidance now offers a contextual next step: choose an idea,
give the number of people, and optionally name ingredients already owned. It
does not create a basket from ideas alone. Acceptance prepares a structured
proposed shop through present_household_shop, excluding stated owned ingredients
and making reasonable assumptions. Short follow-ups use conversation context;
natural “make with”, “ways to use” and snack queries select meal guidance.

The guest journey limits are unchanged: two user turns without a completed
proposal; one revision after a completed proposal with at most three user turns;
persistent monitoring still leads to registration immediately. Composer/send
guards, server authentication, verification and continuation persistence remain
unchanged. Added regressions cover ideas without a shop reaching the gate,
ideas becoming a shop followed by one revision and the gate, and natural meal
idea routing. Local tests pass 344 assertions across 51 files. Preview, CI and
production evidence will be recorded on the release PR.

The READY PR #239 preview at d8c01e8159a8e32ff496d6bb4d71902b5fe09365
returned Philadelphia ideas with only the optional save action. Opening and
closing that action revealed the existing email form without submitting it.
Choosing spinach/mushroom pasta for two produced a three-line priced proposal
at €3.89, excluding the cheese, garlic, oil and pepper already owned. One
revision doubled the pasta, updated the total to €5.64 and disabled further
guest input while preserving the registration form. The first mobile ideas
response at 390px also retained an enabled composer and collapsed save action.
Local build passes using system TLS certificates for Google Fonts; CI passed.

## 79. Mobile navigation overlays the page and exposes category links

While §78 was in preview, the user reported that the mobile menu pushed the
page down and asked for category headings instead of a generic browse option.
AppShell's menu was an in-flow header block. It is now a native modal dialog
anchored to the right, with a dimmed backdrop, independent category scrolling,
body scroll lock and a fixed sign-in/register action. Native modal behaviour
keeps keyboard focus inside the menu and restores it on close; Escape, close
button, backdrop and destination selection dismiss the panel. It also closes
when navigating or resizing to the desktop breakpoint.

The menu leads with “Your agent” and lists the existing CATALOGUE_CATEGORIES
names in two columns, linking to their existing canonical /shop/{slug} routes.
“View all categories” remains available. No product counts, new catalogue
routes, catalogue data changes or registration exemptions are introduced.
Desktop navigation and the signed-in bottom navigation remain in place.
Responsive preview and final production evidence are tracked on PR #239.

## 80. Remove the example section's self-link

The user flagged “Link to this example” in the homepage “See the result”
section as random. It linked back to the section already being viewed and
competed with the meaningful “Make this shop yours” action. Remove that visible
self-link and its unused import. Keep the sample-shop anchor for existing
inbound links, the example content, prefill behaviour and registration flow.
This is a presentation-only cleanup; release verification is recorded on its PR.

## 81. Homepage starter and deal-chip audit (27 September 2026)

The user asked whether the homepage starter prompts are dynamic/useful and why
the Instant Coffee banner never changes. Inspection of production at main
b15b9942b0f61757b201be1508515657a9e69ffa confirms the following findings.

Market starters use fixed templates filled from latest_prices, with deterministic
ten-minute rotation among up to twelve top-ranked candidates. They are shared
guest suggestions, not AI-written or household-personalised recommendations.
Meal/household candidates rank by percentage saving; comparisons rank by raw
price spread under the same canonical name, without pack/unit normalisation.
The starter analytics record prompt_source=starter but no individual starter
identity, so these events cannot attribute registration to a particular prompt.

The separate LiveDealChip is not hardcoded. Its API selects the twenty largest
absolute savings, omits category from the response, then the client filters by
grocery keywords and picks up to five for five-second rotation. The actual
/api/promotions response had twenty rows but only one surviving grocery deal:
Instant Coffee 100g at Dunnes, €6 versus €9.80 (39% rounded saving). Therefore
its rotation is disabled by the one-item pool. The underlying retailer product
is L'OR Classique Instant Coffee 100g; the canonical label drops its brand.

The cited haddock starter is not a like-for-like comparison: Dunnes Stores
Breaded Irish Haddock Fillets 250g at €4 and SuperValu Loose Haddock Fillets
(1 kg) at €21.99 share the canonical name Haddock Fillets. Do not promote the
raw spread as evidence of better value. No product mapping was changed in this
audit; any mapping repair needs the established identity validation workflow.

The cited Philadelphia offer (€1.32 versus €2.65), Colgate offer (€4 versus €8)
and coffee offer were last observed on 24 September. “Today” and “this week”
are fixed wording, not derived from check dates or confirmed promotion periods.
The shop starter also exposes an offer count despite the user's preference to
avoid catalogue/coverage counts. Recommended next work: prioritise useful shop
outcomes, validate comparison eligibility, use honest freshness copy, remove
the redundant deal chip/count emphasis, and measure individual starter outcomes.
These are findings and recommendations only; this audit changes no live UI/data.

## 82. Homepage starter usefulness and attribution (27 September 2026)

User approved the §81 recommendations. The first starter now prepares a household
shop after asking for household/budget/existing-stock context. Meal and household
starters rotate within their own eligible categories, interleaving categories so
one heavily discounted category does not fill the candidate pool. They use actual
retailer names, preserving brand/pack details, and show observed check dates rather
than fixed “today/this week”. Meal prompts offer a contextual next step to build a
shop; household offers ask about value without assuming bulk buying is useful.
Preview exposed Club Lemon cans categorised under Fruit, so meal candidates also
require a recognisable ingredient in the actual retailer name and exclude drinks
and confectionery. Duplicate retailer products do not consume extra rotation slots.
Exploratory meal prompt wording is checked against the guest journey classifier so
it does not open an empty receipt before the visitor asks for a shop.
The fourth slot only promotes a product comparison when actual retailer names
(including brand/variant) and explicit pack evidence agree under the same canonical
ID. Loose/variable-weight products, missing evidence and conflicting packs/brands
fall back to a useful comparison capability prompt. This is deliberately stricter
than trusting the canonical mapping alone. No mapping or retailer feed changed.
The offer-count starter and separate LiveDealChip banner are removed. The remaining
promotions endpoint is unchanged. Stable fallback prompts share one client-safe
module, and price-check detail wraps rather than truncating on small screens.

Analytics add starter_prompt_viewed (half of the individual button visible, once
per starter/version/browser session), starter_prompt_selected (accepted tap), and
guest_shop_prepared (first newly completed validated guest shop in the session).
Starter ID, kind, position and version accompany starter events and agent_started;
deployment hostname lets the report exclude all preview/QA events from production.
no shopper prompt/email is added to these events. Existing session_id propagation
through the signed verification token already joins the normal email-verification
flow to server-recorded signup_completed, including opening that link on another
device. Authentication, signup limits and continuation payloads are unchanged.
The regression checks assert this correlation without real emails/accounts.

The read-only report docs/analytics/homepage-starters.sql gives per-starter visible
sessions, first selections, prepared shops and verified registrations with a
seven-day outcome window. This is observational first-selection attribution, not
proof of a conversion lift. Analytics blocking/storage loss and resending a link
from a different browser can cause gaps; existing-account sign-ins are excluded.
Wait for real cohorts to mature before judging winners. Template version is 2.

Validation/release evidence is recorded in PR #241. A merged PR is not itself a
production verification; the final deployed commit and live checks must be noted
in that PR before reporting the release complete.

Local verification for this implementation: all 359 tests across 51 files pass,
including the initial 17 starter-selection/identity cases, analytics de-duplication and the
isolated email continuation flow. The production build passes with normal TLS
certificate verification enabled. Lint has no errors (22 existing warnings;
changed files have none). The read-only report executes successfully against the
current schema and initially returns no v2 rows, as expected before release.

Three additional ingredient-filter cases pass (20 starter tests, 362 total after
the added cases). Preview desktop and 390px mobile checks show dated dynamic
starters with no separate deal banner. A household starter gathered context,
produced a receipt with explicit missing prices, and completed its permitted
revision to a fully priced €6.89 draft. The composer then gated registration.
The final selection logic's mobile tuna starter produced useful meal ideas,
an enabled follow-up composer and the quiet optional save link without an empty
receipt. Internal events recorded individual impressions/selections and the
prepared shop; the report's production-host filter excludes this QA traffic.

## Tesco structured direct collection — 29 September 2026

The historical 24–48-hour Tesco wait is an application quarantine policy, not a
measured retailer block lifetime. The legacy RPC defaults to 48 hours and clamps
at a 24-hour minimum. A later success on ordinary Vercel egress would not prove
same-IP recovery. Keep stop-on-challenge and do not treat cooldown expiry as proof
that transport is healthy.

A bounded product/listing collector now reads Tesco's Irish structured Apollo
page data and exact listing references. It separates regular prices from
conditional promotions, performs strict canonical identity checks, records
private request evidence, paginates selection inputs, and allows successful
products to become eligible for renewal after four days. It uses one deployment
path gate for the full run, stops on 401/403/challenge or 429, honors Retry-After,
and avoids repeated page requests for 24 hours. Existing seven-day freshness and
mapping-repair rules are unchanged. No recurring schedule is introduced.

See `docs/tesco-direct-collection.md` for the owner-issue probe/collection commands,
evidence schema, limitations and rollout gates. Local validation passes: 376 tests, including 14 collection tests, TypeScript,
lint (existing warnings only), and replay of the public product/listing fixtures.
PR #242 passed required CI and Vercel Preview, merged, and reached READY in
production. The deployed bounded probe returned an access denial on its first
request and stopped before listing collection; it wrote no prices. Persistent
quarantine and private result recording worked. Direct production transport is
therefore still blocked. Waiting longer than the earlier proposed cooldown did
not establish accepted access on the deployment path; ordinary Vercel egress
does not establish same-IP continuity. Retain the 48-hour policy and require
accepted retailer access before scaling. Do not shorten the timer as a presumed
transport fix. The implementation is deployed; coverage recovery is not proven.
Production audit rows and request results belong in private evidence storage,
not this repository.

### Supervised workspace recovery (partial run checkpoint)

Following explicit user approval, a separately supervised workspace collection
is refreshing existing mappings through the same structured parser, identity
checks and idempotent price finalizer. Vercel's quarantine is unchanged. The
workspace evidence gate is disabled for automated selection and is not a pool
failover identity. No paid provider, cookies, challenge solver or IP rotation is
used. Each page is checkpointed privately before continuing; a denial/rate limit
or other fetch failure stops the run.

The first accepted write was verified through `latest_prices`. Listing breadth
had low trusted yield. Exact pages with fully specified canonical identities are
now prioritised; generic canonical descriptions frequently fail strict pack-size
checks. The earlier 500/1,000 planning estimates are not established forecasts.
The standalone `scripts/tesco-workspace-page.mjs` emits one parsed page and its
identity decisions without holding database credentials. The supervising client
persists private evidence and calls the existing finalizer only for accepted,
still-resolved, unchanged canonical/SKU mappings. This is a supervised recovery,
not a recurring production transport.

The supervised pass completed 118 successful page requests before a brand-search
URL returned HTTP 404. The current conservative supervisor stops on any HTTP
error, so this triggered a 15-minute application pause, not the 48-hour
access-denial quarantine. No 401/403/429 was observed. The Vercel pause is unchanged.
Accepted prices were committed and verified incrementally. Private page evidence,
price receipts and the resumable queue are persisted in the manual scrape run.
The run is explicitly partial/degraded, not a completed full-catalogue scrape.
Future work should distinguish a confirmed no-result search from an access denial
without weakening challenge/429 handling or silently clearing an active gate.

Brand-specific listings with a requested count of 100 returned larger structured
result sets and materially improved yield. Pagination must preserve the actual
returned page size; do not change count mid-pagination and skip offsets. Stored
metadata-only candidate checks overestimated exact live matches, especially where
canonicals omit pack sizes. Do not extrapolate the initial 20-page sample into a
promised 500/1,000 fresh trusted products. Remaining mapping repairs require
separate identity evidence; no canonical mappings were changed during this run.

The user subsequently authorised continuation after the workspace pause had
expired. The saved brand-listing queue and its returned pagination were completed,
followed by the remaining stale, unseen candidates with explicit canonical sizes
or pack counts that passed the stored-identity precheck. The resumed requests
returned HTTP 200 without access denials or rate limits; accepted writes were
verified through `latest_prices`. Previously completed requests were not repeated.
The narrower overlapping Ballymaloe Foods query was covered by the broader
Ballymaloe search. Generic/underspecified residuals remain a mapping/product-policy
workload, not evidence that Tesco lacks those products. The selected collection
phase is complete; this is not a claim of full-catalogue coverage, a new production
transport, or achievement of the earlier speculative coverage targets.

### Tesco expansion and exact mapping repair — 29 September 2026

The user authorised a broader pass over previously unvisited resolved SKUs,
without rejecting requests solely because stored identity metadata is weak.
The first tranche stopped on an out-of-scope permanent redirect. This was a
resource-level event, not a new access denial; the existing application pause
was retained until its expiry. The production Vercel gate remains untouched.

Offline review of saved retailer evidence identified a small cohort of unique,
branded replacement SKUs with equal explicit pack size and variant. These were
applied transactionally after rechecking live canonical names, old mappings,
retailer evidence and destination-SKU collisions. Immutable private audit rows
retain the prior mapping, replacement product and source page. Cached prices
retain their original observation timestamps. Shared canonical definitions and
general identity thresholds were not changed. Broader classifier suggestions
included unsuitable variants and composite products and were not auto-applied.

The supervised helper now distinguishes missing resources from transport stops:
404/410 without Retry-After, and permanent redirects to the exact public Irish
homepage, can be recorded and skipped. Out-of-scope redirects are never followed.
Unknown redirects, challenges, 401/403, 429, Retry-After, parse and network errors
retain the conservative stop policy. Targeted tests cover missing pages that
actually contain access challenges and ensure redirect targets are not fetched.
This helper change does not enable an automatic production transport or clear
an active cooldown. Private run/evidence records remain the source of operational
counts and the resumable queue; successful page retrieval is not trusted coverage.

The subsequent supervised requests encountered a permanent redirect from a
retired product URL to the Irish steamed-vegetables/rice/pasta category. That
Irish browse-category shape is now also skippable without following it, limited
to permanent redirects, clean lowercase category path segments, no query/hash,
no authentication/security markers and no Retry-After. Other redirects remain
unknown and still stop. No workspace access
denial or rate limit was recorded. Application pauses already set by the older
handler are not shortened. CI passed all tests and the behavioural gate; its
first build failed in unchanged Google-font handling and a single retry passed.

Further private duplicate-SKU review showed that wrong or underspecified peers
were preventing otherwise exact products from refreshing. Reviewed stale peers
were quarantined with URL/SKU/GTIN cleared and `url_status=failed`; prior values,
canonical identity and the retailer evidence remain in immutable audit snapshots.
Different flavour/pack/product conflicts are labelled material mismatches;
underspecified or unproven identities are labelled insufficient evidence, not
retailer absence. No fresh peer was removed. Exact remaining mappings were
replayed with original evidence timestamps and the unchanged identity predicate.
Two previously conflicting groups also became unique after the earlier remaps.
Shared canonical definitions and synonym/duplicate matching rules are unchanged.

### Tesco transport diagnosis and evidence preservation — 8 October 2026

Repeated supervised network failures hit the local collector deadline. The old
catch handler erased HTTP status, Retry-After and exception/phase information,
including when a denial response had already arrived but its body failed. This
prevents retrospective attribution to Tesco versus network/workspace transport.
The workspace uses its existing managed proxy; no alternate route was tested.
Latency variance supports transient delay as a hypothesis, not a proven origin.

A narrow reviewed correction retains allowlisted transport diagnostics in private
page detail and preserves known 401/403/429 classifications on body failure.
Tests cover local deadlines before headers and during body reads, header/status
preservation, redirects, error sanitisation, existing challenge/Retry-After rules
and no extra requests. Deadline, pacing, terminal network-error policy, lease,
checkpoints, finalizer, identity matching and production mappings are unchanged.
See docs/tesco-direct-collection.md for the conservative conditional retry proposal;
no retry or scheduler is implemented or authorised by this code change.

The bounded live test ran the existing collector after cooldown expiry and stopped
on an exact-measure validation rejection after HTTP success. No new trusted price
was inserted. Deferred timeout products remain untested. Private run
tesco_workspace_transport_test6_20261008 contains the evidence. This small result
cannot validate a larger batch or unattended execution. Main and production were
unchanged at inspection; the correction remains a PR requiring review/deployment
approval. Operational counts and product evidence remain outside the repository.

### Supervised Tesco renewal implementation — 9 October 2026

The transport diagnostic correction above is now on main (#249). A separate
implementation from documentation-only #250 adds an operator-only Node renewal
entry point; see `docs/tesco-supervised-renewal.md`. It explicitly selects
still-fresh, proven observations at four days old, oldest first, separately from
expansion. Live parser/identity checks and the existing append-only finaliser
remain authoritative. No database migration, mapping change, scheduler or
production routing change is included.

The persistent SQL bridge uses the authenticated Supabase connector, the existing
disabled workspace gate, owner-guarded leases and atomic page/receipt/observation
commits. Unknown attempts remain held for reconciliation without automatic
retry; committed pages are skipped on an eligible interrupted-run resume.
Cooldowns precede checkpoints, and a stale owner cannot clear its successor.
Automated isolated PostgreSQL tests execute the existing finaliser, including
idempotency, rollback, old-price preservation and access-stop cases. Dedicated
runner TypeScript validation is included in CI. The production read-only dry run
selected no due products on 9 October; no Tesco request or production write was
made for this implementation check. Operational counts remain private.

First renewal is due 12 October 2026 at 11:28 Irish time, before the corresponding
15 October expiry. PR #251 was reviewed and merged on 9 October at
`69797402833097d3c7982db331a8828b6612c70d`, with an identical tree to CI #897
(406 tests, including 25 renewal tests). Main's ruleset required the passing
validate check and squash merge, with no approving-review requirement or bypass.
Production deployment `dpl_7zsS3B2AmJcZkDPW57SEcSbRBf3s` reached READY. The merged
CLI's read-only production dry run selected no due products and made no writes.

The first supervised batch is capped at 25 due products; 12 October at 11:40
Irish time is the recommended initial window, subject to live preflight. Front-
load renewal as the cohort becomes due that day, finish late carry-over early
on 13 October and retain 14 October for safe recovery. A 48-hour quarantine or
unresolved identity failure can still prevent complete coverage preservation.
Do not retry held requests or expand the catalogue during renewal protection.
The detailed procedure is in `docs/tesco-supervised-renewal.md`; exact coverage,
workload and unresolved-request evidence remain private.

The smallest proposed Work-independent follow-up is inspection of the existing
EC2/systemd host, a separately approved one-product connectivity test and a
thin PostgreSQL adapter around this runner. Current host access/credentials and
Tesco reachability are unverified; the legacy shell's Tesco branch uses a
different scraper. No AWS canary, new infrastructure, egress change, scheduler
or live renewal was executed. Work access does not establish Vercel/AWS access.


### Supervised expansion interruption — 9 October 2026

A fresh production queue review used current coverage, exact-page attempt holds,
stored identity replay and cross-retailer pack/variant checks. Live expansion
appended trusted observations before the supervisor session was lost with a
durable pending request. Read-only reconciliation confirmed committed receipts
and an unknown request outcome. Do not resume this run or retry that URL; allow
its owned lease to expire normally. The persisted run can still display running
after supervisor loss. Exact run IDs, products and counts remain private.

Existing fresh observations were verified unchanged and no renewal was due.
Renewal remains the priority from 12 October; expansion did not change its code,
eligibility, automated routing or schedules. New expansion observations acquire
their own later four-day renewal windows.

Recovery review identified two spelling-only canonical-title proposals. Offline
replay accepted those proposed titles and rejected wrong-SKU, unavailable,
missing-price, wrong-size, wrong-brand and wrong-variant controls. These are
shared canonical changes, not approved production mapping repairs: inspect all
canonical dependencies and obtain approval before applying them. Another title
proposal remains blocked by duplicate-SKU ambiguity. The only stored alternate
SKU found in the incorrect-SKU cohort conflicts with a peer retailer formulation
and remains held. No mapping repair, broad validator relaxation or new live
request was made after the unknown outcome.
