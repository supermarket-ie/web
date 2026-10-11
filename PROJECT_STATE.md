# Supermarket.ie — Canonical Project State

## Tesco coverage release and scale evaluation — 11 October 2026

PR #258 is merged as `1979aaa`; CI #915 passed and production is READY on that
commit. This supersedes the proposal-only release status below. Production remains
341 fresh Tesco / 171 three-retailer prices. Same-evidence evaluation of all 2,121
missing products unlocked four exact identities, two eligible for guarded acquisition
handoff, and zero new prices. Five unknown outcomes remain held. Zero renewals due
at 07:14 UTC; first due 12 October 11:28:30 Irish.

This branch adds a read-only batch acquisition planner: 422 eligible retrieval
targets, with an initial ten-query plan covering 72 products (12 comparison gaps).
These are targets, not accepted mappings. No Tesco requests, production mapping
changes, observations, holds or renewal safeguards changed. PR #256 remains
unapproved. See `docs/tesco-coverage-scale-2026-10-11.md` for complete before/after
results, root causes, limitations and the supervised acquisition recommendation.

## Tesco identity/acquisition handoff proposal — 11 October 2026

Production verified at 06:42 UTC: 341 fresh trusted Tesco prices, 171 fresh
three-retailer comparisons, five preserved unknown requests, no active lease or
cooldown, and zero renewals currently due. First renewal is 12 October 11:28:30
Irish time; 285 due on 12 October and 56 on 13 October. Earliest expiry is
15 October 11:28:30. Production remains merged main `5e0d88a`, deployment READY.

This branch proposes consistent unit-word normalization, narrowly bounded
direct-product structured quantity fallback, and an explicit completed-acquisition
handoff in the supervised expansion runner. No renewal mode, production mapping,
canonical record, original evidence timestamp or pricing policy was changed.
A production read-only dry-run selected Avonmore Protein Milk Vanilla 1L (308465836)
and Birds Eye Petits Pois 450g (294076621) from their original checkpointed evidence
and current peer mappings. No Tesco request or trusted-price write was made.
Both are eligible under this proposed code, not yet enabled in production.

See `docs/tesco-acquisition-handoff.md` for evidence requirements, review boundary,
duplicate prevention, commands and retained limitations. Do not merge/deploy or
retry checkpointed requests merely to demonstrate the proposal. PR #256 remains
unapproved and unexecuted; all five unknown outcomes remain held.

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
3. the product already has trusted live pri…34231 tokens truncated…ourney limits are unchanged: two user turns without a completed
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

## Read-only Tesco catalogue discovery (implementation review)

A separate offline discovery CLI now indexes structured Tesco listing/product
snapshots across the complete missing-price catalogue, with exact SKU/URL evidence,
independent GTIN checks, conservative identity/peer checks, duplicate ownership,
request/rejection holds and incremental fingerprints. It invokes the existing
identity validator without changing collection or renewal. Stored evidence never
receives a live-verified URL label. See `docs/tesco-offline-discovery.md`.

Full-catalogue evaluation exposes incomplete canonical brand/pack information,
shared or conflicting historical SKUs and absent independent peer GTIN evidence
as constraints on new exact identities. Private reports retain actual yields and
operational evidence. A ready queue is not manufactured to meet coverage targets.
No production mappings, observations, timestamps, leases or schedules were changed.

### Discovery review: compound quantity guard

Pre-merge review reproduced a false exact discovery result when an extra explicit
measure was appended to a title and structured quantity was absent. Discovery
now holds compound-measure canonical, retailer and peer titles for review rather
than comparing only the first amount. Negative controls cover extra same-unit and
mixed-unit amounts. The discovery version changes to invalidate previous cached
decisions. Production matching/collection code is unchanged.
