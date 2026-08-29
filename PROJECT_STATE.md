# Supermarket.ie — Canonical Project State

**Last updated:** 29 August 2026

> **READ THIS FIRST BEFORE STARTING SUPERMARKET.IE DEVELOPMENT.**
>
> This file is the canonical technical/strategic project memory. Do not infer current project state solely from chat history or an old handoff prompt. Inspect the referenced code/PRs/branches before changing implementation.
>
> Update this file whenever a material architecture decision, experiment, integration, production change, or retailer-execution finding occurs. Never place credentials or secret values in this document.

## 1. North star

Supermarket.ie is intended to become **Ireland's retailer-neutral AI grocery and household shopping infrastructure**.

Target flow:

`Household intent → Shopping Capability Layer → basket → retailer execution → retailer checkout`

Supermarket.ie should own:

- household understanding and memory
- shopping intent
- product/ingredient intelligence
- cross-retailer reasoning
- basket construction
- retailer selection and transaction origination
- eventual rewards/referrals and AI-agent distribution

Retailers should initially remain merchant of record and own inventory, checkout, payment, picking and fulfilment.

Supermarket.ie is **not primarily a price-comparison website**. Price is an important input to deciding how to buy the household's shop, not the entire proposition.

Long-term product promise: **"the service that runs your household shop."**

## 2. Target capability architecture

The same Shopping Capability Layer should ultimately serve:

- Eve / Supermarket.ie agent
- Supermarket.ie website
- REST/API
- MCP
- ChatGPT and other external AI agents

Target external capabilities:

- `find_product()`
- `get_household_context()`
- `prepare_household_shop()`
- `build_basket()`
- `compare_shop()`
- `handoff_to_retailer()`
- `record_shop_outcome()`

Do not recreate business logic separately in Eve, API, MCP or website surfaces.

## 3. Shopping Capability Layer — completed

PR #20 was merged into `main` on 18 August 2026.

Merge commit:

`715889a9e61d4fb7293e9691491cdd5caeb98c52`

It moved the architecture away from:

`Eve tool → business logic`

and toward:

`Shopping Capability Service → Eve / website / future API / future MCP`

Current shared shopping code is under `src/lib/shopping/**` and includes contracts, catalogue/product resolution, retailer offers, household-context normalisation, basket construction, retailer preferences, store totals, whole-basket comparison and household-shop preparation/replenishment reasoning.

**Do not rebuild this layer before inspecting current `main`.**

## 4. Retailer execution objective

Immediate transaction milestone:

`prepare_household_shop → retailer basket → populated retailer trolley → shopper checkout`

A successful initial transaction means Supermarket.ie prepared/originated the shop and the shopper completed checkout directly with the retailer. Supermarket.ie must not handle retailer payment credentials.

Actual retailer execution requires explicit shopper approval.

Desired experience:

1. Shopper asks Eve to sort out the household shop.
2. Supermarket.ie prepares the basket.
3. Shopping Capability Layer compares retailer fulfilment/price.
4. Shopper chooses a retailer (or accepts a recommendation).
5. Shopper selects **Shop this basket**.
6. Retailer trolley is populated as far as legitimately/reliably supported.
7. Shopper reviews delivery/collection details and pays retailer directly.

## 5. Retailer execution matrix

| Retailer | Product identity/data | Cart/execution finding | Authentication | Current truthful status |
|---|---|---|---|---|
| SuperValu | Strong: `store_sku`, `store_url`, product name, price; store-scoped `rsid` | Instacart Storefront. Cart mutation known. Supports single and bulk line-item add. | SuperValu OIDC; live config has anonymous cart disabled | `product_links`; authenticated cart technically understood but not authorised/browser-native from supermarket.ie |
| Dunnes | Existing mapped catalogue/product data | Wynshop platform; first-party shopping lists/past items include multi-item **Add selected to cart** behaviour. Needs deeper execution probe | Dunnes/Wynshop auth | Under investigation; potentially stronger no-extension path than SuperValu |
| Tesco | Existing data; direct scraping historically problematic | Existing Pepesto work used Tesco search/retrieval; Pepesto supports retailer execution | To verify for execution | Pepesto is highest-leverage execution route to investigate |
| Aldi | Catalogue/pricing pipeline | No equivalent online grocery checkout target currently established | — | No transactional handoff currently |

Detailed findings live in `docs/retailer-execution.md`.

## 6. SuperValu handoff — PR #21

Branch: `agent/retailer-handoff`

Draft PR #21: **feat: add SuperValu retailer handoff adapter**

PR #21 established:

- shared `RetailerAdapter` abstraction
- retailer registry
- SuperValu adapter
- SuperValu basket-item mapping
- selection of SuperValu alternatives when current selected offer is another retailer
- quantity preservation
- retailer SKU/product identity
- direct product URLs
- safe-domain validation
- complete/partial/missing mapping states
- tests

Important: PR #21 intentionally reports a truthful `product_links` handoff. It does **not** claim trolley population.

PR #21 is old relative to current `main`; do not merge it blindly. Preserve the architecture/findings and rebase/reimplement carefully against current `main` when execution direction is settled.

## 7. SuperValu cart investigation — 29 August 2026

A read-only live Storefront probe established:

- SuperValu's online store is Instacart Storefront infrastructure.
- `rsid` is the retailer store identifier.
- Normal add uses a store-scoped cart resource: `POST stores/{retailerStoreId}/cart`.
- The add-product contract contains quantity, SKU, catalog source and shopping-mode ID.
- Storefront client code exposes both single-line and bulk line-item add operations (`AddProductLineItemToCart` and `AddProductLineItemsToCart`).
- Quantity changes use the same cart resource with a different operation/domain model.
- Delivery/collection slot selection is not required merely to build/review the cart.
- Live SuperValu configuration has `anonymousCart: false`.
- A guest pressing Add is directed into SuperValu authentication rather than being given an anonymous trolley.
- Authentication is OIDC-based (`sts.supervalu.ie` observed in client configuration).
- Supermarket.ie must not capture/replay SuperValu credentials, bearer tokens or session cookies.

Conclusion: the cart primitive is real and bulk basket population is technically straightforward **inside an authorised SuperValu shopper context**. The unresolved problem is delegated/authenticated execution, not product mapping or basket construction.

### Rejected SuperValu approach

A Chrome browser-bridge proof of concept was created on branch `agent/supervalu-browser-bridge-poc`, draft PR #56. It drove SuperValu's visible Add control inside the shopper's browser without handling credentials.

This was **rejected as a product direction** because requiring users to install an extension is unacceptable for the mainstream Supermarket.ie experience.

Do not merge PR #56 into production. Preserve it only as evidence/experimental learning unless deliberately superseded/closed.

A normal supermarket.ie webpage cannot manipulate the shopper's authenticated `shop.supervalu.ie` context because of browser same-origin/security boundaries. Do not waste time seeking brittle browser-security bypasses.

## 8. Dunnes execution findings — 29 August 2026

Dunnes grocery currently uses a Wynshop-based platform and an OIDC-style authentication flow.

Relevant first-party behaviour includes:

- authenticated shopping lists
- favourites/past purchases
- multi-item **Add selected to cart** behaviour from saved items/lists
- cart can be built/reviewed before delivery-slot/payment completion

This makes Dunnes potentially more promising than SuperValu for a clean list-to-cart primitive.

Key unanswered question: can a Dunnes/Wynshop list/session be prepared before authentication and adopted by the shopper after login, or otherwise legitimately handed into the authenticated cart without an extension?

Before doing substantial bespoke Dunnes reverse engineering, evaluate Pepesto execution because Pepesto already supports Dunnes.

## 9. Pepesto — EXISTING INTEGRATION, DO NOT REDISCOVER

This is particularly important because prior chats lost track of this work.

There is an existing branch:

`pepesto-tesco-adapter`

Historical commits on/around 21 August 2026 include:

- `schedule second Pepesto result retrieval`
- `add durable Pepesto Tesco search sessions`
- `add Pepesto Tesco adapter`

Historical adapter file:

`src/lib/pepesto-tesco.ts`

Pepesto API base used by the implementation:

`https://s.pepesto.com/api`

The historical implementation used endpoints including:

- `/credits`
- `/search`
- `/retrieve`

### Pepesto credential architecture

**Do not search for or expose a raw Pepesto secret in chat or source.**

The historical server-side adapter retrieves the credential via:

`supabaseAdmin.rpc('get_pepesto_api_key')`

and then sends it to Pepesto as a Bearer token.

Therefore the established access path is:

`Supermarket.ie server → Supabase get_pepesto_api_key() → Pepesto API`

Do not assume a missing visible `PEPESTO_API_KEY` Vercel variable means Pepesto access is absent. Verify the RPC/integration path safely.

### Pepesto strategic role

Pepesto should be evaluated primarily as **retailer execution infrastructure**, not as Supermarket.ie's shopping intelligence.

Preferred boundary:

`Shopping Capability Layer → Pepesto retailer-execution adapter → retailer basket/checkout`

Supermarket.ie should continue to decide household needs, products, quantities, retailer comparison and recommendations. Pepesto can potentially handle brittle retailer-specific checkout/browser execution.

Pepesto publicly describes support for Dunnes, SuperValu and Tesco Ireland and a session/checkout execution model. Their checkout architecture is browser-driving: a checkout service returns instructions such as page loading, waiting for elements, JavaScript execution and shopper actions; the client executes these in an appropriate browser/WebView/automation context. Do not assume Pepesto has a magic public retailer cart URL.

Before consuming paid credits, inspect public Pepesto implementation/docs and any existing historical sessions/results. If a new paid session is genuinely needed, keep the first experiment tiny and explicit.

## 10. Retailer-selection UX

The target user experience after basket preparation is retailer-neutral. Example conceptual output:

- SuperValu — X/Y items available — approx. €A
- Dunnes — X/Y items available — approx. €B
- Tesco — X/Y items available — approx. €C

Supermarket.ie may recommend a retailer based on fulfilment, price and household preferences, but the shopper chooses the retailer.

Only show **Shop this basket** as a true trolley-population capability for retailers where the execution method has actually been proven. Do not imply cart population when only product links/guided handoff are available.

## 11. Transaction instrumentation

Strategic events should include:

- `basket_prepared`
- `retailer_selected`
- `handoff_started`
- `handoff_items_mapped`
- `retailer_trolley_prepared`
- `retailer_checkout_opened`
- eventually `purchase_confirmed` only where confirmation is legitimately available

Never emit `retailer_trolley_prepared` unless a retailer trolley has actually been populated.

Long-term commercial leverage should be measured partly as retailer-attributable transaction volume / GMV.

## 12. Data/scraping context relevant to execution

Retailer scraping/data refresh is a separate workstream from retailer handoff. Do not confuse them.

Relevant current architecture/history:

- SuperValu and Dunnes refresh work runs through current production infrastructure/Vercel paths.
- Aldi has historically used GitHub execution because retailer access was blocked from Vercel.
- Tesco direct scraping has been problematic and Pepesto was previously explored/implemented for Tesco search/retrieval.
- `store_products` is the important retailer-product identity layer used by execution mapping.

Before changing a retailer adapter, inspect the current retailer scraper and `store_products` fields for that retailer.

## 13. Current branches / PRs requiring awareness

### PR #21 / `agent/retailer-handoff`

Purpose: original SuperValu `RetailerAdapter` / `product_links` handoff.

Status: valuable architecture but stale relative to current main. Preserve; do not blindly merge.

### PR #56 / `agent/supervalu-browser-bridge-poc`

Purpose: prove shopper-side authenticated SuperValu interaction without Supermarket.ie handling credentials.

Status: experiment only. Extension requirement makes it unsuitable as mainstream UX. Do not promote as product direction.

### `pepesto-tesco-adapter`

Purpose: historical Pepesto Tesco search/retrieval integration.

Status: crucial prior work. Inspect and selectively bring forward concepts/client code rather than rediscovering Pepesto access.

## 14. Strategic guardrails

- Do not turn Supermarket.ie back into primarily a price-comparison site.
- Do not build Supermarket.ie-owned grocery fulfilment at this stage.
- Do not become merchant of record initially.
- Do not make marketplace/vendor onboarding a prerequisite for proving transactions.
- Do not make retailer commercial agreements a prerequisite where a legitimate technical handoff exists.
- Do not circumvent retailer security controls.
- Do not make the business fundamentally dependent on bypassing anti-automation/security protections.
- Do not handle retailer payment credentials.
- Do not capture/replay retailer passwords or session tokens merely to populate a cart.
- Do not use hidden sponsored recommendations. User trust and retailer-neutral reasoning are core.
- Do not claim an execution state that has not actually happened.

## 15. Current recommended next sequence

1. Treat this file and `docs/retailer-execution.md` as canonical context.
2. Verify the historical Pepesto access path (`get_pepesto_api_key`) remains operational without exposing the secret.
3. Study Pepesto's SuperValu/Dunnes execution mechanism using public docs/code and existing historical data before spending credits.
4. Determine whether Pepesto can provide an acceptable no-extension customer experience under the Supermarket.ie brand/surface.
5. If a paid experiment is needed, test a tiny 2–3 item basket for Dunnes and SuperValu.
6. Decide the execution backend strategy: direct retailer adapter, Pepesto-backed adapter, or authorised retailer integration per retailer.
7. Bring the chosen execution interface into the current Shopping Capability Layer.
8. Add transaction attribution events.
9. Connect the proven handoff to Eve with explicit shopper approval.
10. Only then expose the same primitive through API/MCP.

## 16. Documentation discipline

For every material Supermarket.ie development session:

1. Read `PROJECT_STATE.md` first.
2. Inspect current `main` and referenced branches/PRs before coding.
3. Read the relevant specialist document under `docs/`.
4. Do the work.
5. Update the relevant state/documentation **in the same workstream** when findings or decisions change.
6. Record important abandoned approaches as well as successful ones so future sessions do not repeat them.
7. Never put secrets, tokens, passwords, customer credentials or payment data into project-state documents.

### Decision-log format

Append material decisions below using:

`YYYY-MM-DD — Decision — Reason — Consequence`

## 17. Decision log

- **2026-08-18 — Shared Shopping Capability Layer established (PR #20).** Reason: business logic must be reusable by Eve, website, API and MCP. Consequence: new shopping features should extend shared capability code rather than Eve-specific logic.
- **2026-08-18 — SuperValu selected as first retailer-handoff adapter (PR #21).** Reason: useful execution identifiers and reliable product URLs already available. Consequence: truthful `product_links` handoff created while trolley mechanism remained unproven.
- **2026-08-29 — SuperValu cart mechanism established.** Reason: live Storefront investigation. Consequence: bulk cart population is technically understood, but anonymous cart is disabled and authenticated browser context is required.
- **2026-08-29 — Browser-extension requirement rejected for mainstream handoff.** Reason: unacceptable user friction. Consequence: PR #56 remains experimental evidence only; no-extension is a product requirement.
- **2026-08-29 — Pepesto prior work rediscovered and elevated.** Reason: existing `pepesto-tesco-adapter` branch and Supabase-backed credential architecture show retailer execution infrastructure was already being explored. Consequence: investigate Pepesto before further bespoke retailer reverse engineering.
- **2026-08-29 — Repository documentation becomes canonical project memory.** Reason: chat history was causing rediscovery and loss of prior technical decisions. Consequence: future sessions must read and maintain this file.