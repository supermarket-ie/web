# Retailer Execution — Supermarket.ie

**Last updated:** 30 August 2026

This document records retailer-specific execution/handoff findings. Read `PROJECT_STATE.md` first for overall architecture and strategy.

## Objective

Target execution flow:

`Supermarket.ie prepared basket → shopper chooses retailer → retailer trolley populated → shopper reviews/pays retailer`

Supermarket.ie remains outside retailer payment and does not capture retailer passwords, payment credentials or retailer session tokens merely to populate carts.

**Mainstream product requirement: no browser extension.**

## Status matrix

| Retailer | Platform / context | Known identifiers | Cart primitive | Auth/session boundary | Current status |
|---|---|---|---|---|---|
| SuperValu | Instacart Storefront | `store_sku`, `store_url`, `rsid`/retailer store ID, price/name | Store-scoped cart; single + bulk add observed in client | `anonymousCart:false`; OIDC login required | Product-link handoff proven; authenticated cart mechanics understood; acceptable no-extension runtime unresolved |
| Dunnes | **Instacart Storefront** | Stable numeric `store_sku`, `rsid` URLs; production gateway store ID `258` | `/api/stores/258/cart`; server advertises `GET, POST` | Unauthenticated cart GET returns `401`; auth/session required | Cart path/auth boundary proven read-only; exact authenticated POST model still to confirm |
| Tesco | Tesco Ireland + historical Pepesto integration | Existing store product mapping; exact Tesco product URLs used in prior tests | Pepesto checkout protocol tested with a three-product Tesco basket and continuation turns | Pepesto browser-driving checkout protocol | Prior basket-handoff work exists and must be recovered before new implementation |
| Aldi | Retailer catalogue pipeline | Existing catalogue mapping | No established online grocery checkout | — | No execution adapter target currently |

## SuperValu

### Data available

The SuperValu data pipeline captures `store_sku`, `store_url`, retailer product name, current price and store-scoped URLs containing `rsid`.

### PR #21

Branch: `agent/retailer-handoff`

Draft PR #21 established the retailer abstraction and a truthful `product_links` handoff. It should not be described as trolley population.

### Live cart findings — 29 August 2026

Read-only Storefront inspection established:

- SuperValu uses Instacart Storefront.
- `rsid` maps to retailer-store context.
- cart is store scoped.
- normal add contract uses a POST to a `stores/{retailerStoreId}/cart` resource.
- product add data includes quantity, SKU, catalog source and selected shopping-mode ID.
- client code contains single and bulk add models: `AddProductLineItemToCart` and `AddProductLineItemsToCart`.
- quantity update uses `SetLineItemQuantity`.
- cart can be built/reviewed before final slot/payment stages.
- live SuperValu configuration has anonymous cart disabled.
- Add while logged out triggers retailer authentication.
- auth references include `sts.supervalu.ie`.

### Security/product boundary

Do not replay SuperValu auth/session tokens server-side, capture passwords, bypass retailer login, or report `authenticated_cart` until a real trolley has been populated through a legitimate user-authorised path.

### Browser bridge experiment

Branch `agent/supervalu-browser-bridge-poc`, draft PR #56, proved a possible browser-side interaction model using SuperValu's visible Add button. It required an extension.

Product decision: **reject extension requirement for mainstream UX.**

A normal supermarket.ie webpage cannot execute authenticated SuperValu cart operations in the shopper's SuperValu origin because of browser same-origin/security boundaries.

### Controlled cloud-browser access — 30 August 2026

Unlike Dunnes, SuperValu loaded successfully in the temporary controlled cloud browser and reached its live OIDC email/password login form without a Cloudflare or human-verification block. The shopper completed OIDC authentication and selected the retailer store/delivery context directly.

The controlled browser added three products through the live SuperValu interface and verified them in the real trolley:

| Product | Quantity |
|---|---:|
| SuperValu Fresh Irish Whole Milk 2L | 1 |
| SuperValu Irish Creamery Butter 227g | 1 |
| Brennans Sliced White Pan 800g | 1 |

The trolley reported 3 items with a total of €6.33. The experiment stopped before checkout/payment.

Conclusion: controlled cloud-browser authenticated trolley population is now **proven for SuperValu**. Production mutation remains disabled until the shopper-facing runtime, session isolation/destruction, failure handling and transaction instrumentation exist. Do not generalise the SuperValu result to Dunnes merely because both use Storefront infrastructure.

## Dunnes

### Platform correction

Current Dunnes grocery should **not** be described as a separate Wynshop execution platform in project state. Current production code explicitly calls the **Instacart Storefront API**.

Production Dunnes refresh configuration:

- `STORE_ID = 258`
- `GATEWAY_BASE = https://storefrontgateway.dunnesstoresgrocery.com/api`
- `SITE_URL = https://www.dunnesstoresgrocery.com`
- delivery shopping-mode ID: `22222222-2222-2222-2222-222222222222`
- search endpoint: `/api/stores/258/search`
- Storefront request headers include `x-site-host`, `x-site-location`, `x-correlation-id` and `x-shopping-mode`

Mapped products already carry stable SKUs and store-scoped retailer URLs.

### Read-only cart experiment — 29 August 2026

Experiment branch: `agent/dunnes-cart-probe`

The original HTML probe was blocked by Cloudflare, so the experiment was corrected to use the **same Dunnes Storefront gateway transport already used by our production refresh**. This is important: the successful production path does not depend on scraping the Dunnes HTML page.

The Vercel-side probe performed only read operations/metadata checks. It did **not** authenticate a shopper, POST to a cart, mutate a cart, or use Pepesto.

Results:

- `GET /api/stores/258/search` using production-style headers → **200 application/json**
- `OPTIONS /api/stores/258/cart` → **405**, with `Allow: GET, POST`
- unauthenticated `GET /api/stores/258/cart` → **401 application/json**

Conclusions:

1. Dunnes has a store-scoped Storefront cart resource at `/api/stores/258/cart`.
2. That resource supports POST cart mutation.
3. The cart is authentication/session-bound.
4. The underlying retailer execution architecture is materially closer to SuperValu than previously understood.
5. A shared **Instacart Storefront execution layer** should now be preferred over independent SuperValu/Dunnes cart plumbing, subject to confirmation of Dunnes' authenticated POST domain model.

### Shopper-observed quantity mutation — 30 August 2026

A normal shopper session changed one existing trolley line from quantity one to quantity two while the browser Network panel was filtered to the Dunnes Storefront gateway. Sanitized evidence established:

- request: `POST /api/lists`
- response: `202 Accepted`
- content type/domain model: `application/vnd.lists.v1+json;domain-model=ChangeItemQuantityInPlanningList`
- payload shape: `{ sku, quantity: { value, type: "each" } }`
- follow-up read: `GET /api/lists/planning/{listId}`

No password, cookie, authorization header or complete customer-session identifier is recorded in the repository. This confirms the Dunnes quantity-set wire contract. It also shows that Dunnes does **not** simply expose the same observed cart resource/model as SuperValu: its current frontend mutation is planning-list based.

### Shopper-observed zero-to-one add — 30 August 2026

A second sanitized observation added a SKU that was not already present in the trolley:

- request: `POST /api/lists`
- response: `202 Accepted`
- content type/domain model: `application/vnd.lists.v1+json;domain-model=AddItemToPlanningList`
- payload shape: `{ sku, quantity: { value: 1, type: "each" } }`

This confirms Dunnes single-item add. Initial add and later quantity change share the endpoint and payload structure but use distinct domain models.

### What is not yet proven

We have not yet independently observed:

- a native multi-item/bulk add;

Do not claim the SuperValu `AddProductLineItemToCart` or `AddProductLineItemsToCart` models are identical. The confirmed Dunnes quantity-set request is `POST /api/lists` with the payload above.

The most likely next source of proof should be common Storefront client behaviour or Pepesto's recorded protocol, rather than mutating a cart merely to learn the API.

### Controlled cloud-browser experiment — 30 August 2026

A temporary controlled Chrome session was used to test whether Dunnes could be reached through the proposed web-accessible checkout runtime. Cloudflare presented a pre-site human-verification challenge. One user-authorised verification attempt did not clear, and the same session remained blocked when handed to the user for manual control.

The experiment stopped at the security boundary. It did not reach Dunnes login, capture credentials/session material or mutate a cart.

Consequence: generic cloud Chromium/Playwright must not be treated as a viable Dunnes runtime without a later legitimate proof. The ordinary-browser observation subsequently established the quantity-set request without collecting a HAR or intentionally copying cookies, authorization headers, passwords or payment data.

The temporary one-shot GitHub workflow used to invoke the sanitized probe was removed after the experiment.

### Native Dunnes UX

Dunnes publicly exposes:

- product-level Add to Cart controls while browsing;
- saved lists/favourites;
- past purchases/order history;
- multi-item **Add selected to cart** from a prior order.

Those first-party features are consistent with the existence of a bulk cart primitive, but do not alone prove its wire contract.

## Tesco / Pepesto — PRIOR CHECKOUT WORK EXISTS

This section is critical. **Do not describe the prior Pepesto work as search/retrieval only.**

### Existing branch and access

Existing branch: `pepesto-tesco-adapter`

Historical adapter: `src/lib/pepesto-tesco.ts`

API base: `https://s.pepesto.com/api`

Credential retrieval was server-side through:

`supabaseAdmin.rpc('get_pepesto_api_key')`

Do not expose the returned value.

### Phase 1 — Tesco product retrieval

Earlier work used `/credits`, `/search` and `/retrieve` to improve Tesco product discovery/pricing where direct retailer scraping was difficult.

### Phase 2 — Pepesto checkout protocol reverse-engineering

On 21 August 2026, we deliberately moved from product retrieval into **basket creation / checkout protocol investigation**.

Repo history includes:

- `add one-time Pepesto checkout protocol test`
- `add three-product Pepesto checkout protocol test`
- `schedule three-product Pepesto checkout protocol test`
- `add one-time Pepesto checkout continuation`
- `add one-time Pepesto checkout recovery turn`
- `add fresh recorded Pepesto checkout session`
- `schedule fresh Pepesto checkout recording`

The three-product protocol test used known Tesco product URLs and implemented:

1. `/products` with `supermarket_domain: 'tesco.ie'` and exact preferred Tesco URLs.
2. Select exact returned product matches.
3. Extract Pepesto `session_token`s.
4. Build `skus` with `session_token` + `num_units_to_buy`.
5. `/session` to create the basket session.
6. Receive `session_id`.
7. `/checkout` with `continue_session_id`.
8. Record the returned checkout instruction.
9. Continue the same session in later `/checkout` turns.

The instruction parser explicitly handled:

- `load_page`
- `await_element`
- `run_js`
- `prompt_user_action`
- `await_js_out_change`
- `done`

This proves that prior work already used Pepesto as a reference implementation for retailer basket creation and began translating that learning into Supermarket.ie handoff work.

### Recorded sessions / cost discipline

Historical `scrape_runs` records still exist.

Known Tesco session:

`76a090b1-f7f9-437d-b505-2b996f00718a`

Historical three-product cost:

- `/products`: €0.04
- `/session`: €1.20
- first `/checkout`: €0.00
- continuation/recovery checkout turns: €0.00

Do not pay to recreate this protocol unless a decisive retailer-specific instruction cannot otherwise be recovered.

## Pepesto current execution model

Pepesto's current public documentation confirms that `/checkout` is a turn-by-turn **browser-driving** protocol. The client repeatedly receives instructions such as page loading, DOM waits, JavaScript execution, user prompts and completion state.

Pepesto explicitly describes compatible clients such as a mobile WebView, browser extension or Playwright environment. It does not automate payment.

### Public no-key / MCP path

Pepesto's hosted Agent-to-Cart MCP can receive a shopping list without an API key or upfront credit use. However, the current consumer journey is:

`AI/MCP → Pepesto link → Pepesto mobile app → checkout-driving loop → retailer cart/login`

On desktop, Pepesto shows a QR code to continue in the mobile app.

Therefore the free MCP path is useful for **studying Pepesto and validating retailer coverage**, but it is not evidence of a browser-only supermarket.ie handoff.

### Dockable / iframe UI

Pepesto publicly provides a `dockable.js` embed for its hosted basket/review UI (`app.pepesto.com`). Current docs say the actual checkout action subsequently redirects into Pepesto's mobile app. The iframe itself is not a demonstrated way to run authenticated retailer cart mutations from an ordinary third-party webpage.

### Strategic interpretation

Pepesto remains useful in two ways:

1. as a reference/oracle for retailer-specific checkout steps;
2. potentially as an execution backend if its app/runtime trade-off becomes acceptable.

But the preferred Supermarket.ie product remains:

`Shopping Capability Layer → retailer execution → retailer checkout`

with the Supermarket.ie experience retained as much as possible and no consumer browser extension.

## Shared Storefront direction

The latest findings materially change the adapter design assumption.

SuperValu and Dunnes both sit on Instacart Storefront-style infrastructure. Therefore the likely architecture should become:

`RetailerAdapter → InstacartStorefrontExecutionEngine → retailer-specific config/auth/store context`

rather than duplicating cart mechanics independently.

Potential retailer-specific configuration includes:

- storefront hostname
- gateway hostname
- retailer/store ID resolution
- shopping-mode resolution
- auth host/SSO behaviour
- exact cart domain-model/body if it differs
- final cart-review URL

Do not implement this as `authenticated_cart` until an actual shopper-authorised trolley population has been proven.

## Retailer adapter semantics

Execution methods must be named truthfully:

- `product_links` — mapped retailer product links only
- `guided_cart` — shopper is guided through retailer additions but cart is not automatically populated
- `authenticated_cart` — shopper-authorised retailer trolley is actually populated
- `authorised_partner_cart` — cart populated through a retailer/commerce partner integration

Do not use `authenticated_cart` or emit `retailer_trolley_prepared` merely because mappings, endpoints or protocol instructions exist.

## Checkout Runtime v0

The first production-facing scaffold is intentionally provider-neutral and fail-closed:

- `CheckoutRuntimeProvider` owns temporary interactive session creation, state lookup and destruction.
- The prepare endpoint maps an authenticated shopper's saved list through `trusted_retailer_offers`; it does not launch a browser or receive retailer credentials.
- The SuperValu review page is hidden unless `CHECKOUT_RUNTIME_PREVIEW_ENABLED=true`.
- Actual launch remains disabled unless `CHECKOUT_RUNTIME_PROVIDER_CONFIGURED=true`, which is valid only when a real provider implementation and lifecycle controls are connected.
- Dunnes remains launch-blocked because the controlled-browser runtime is not proven past Cloudflare.

The provider must isolate shoppers, let the shopper authenticate directly on the retailer origin, expire sessions, destroy browser state and report verified trolley state. A prepared mapping is not a prepared retailer trolley.

## Transaction events

Target events:

- `basket_prepared`
- `retailer_selected`
- `handoff_started`
- `handoff_items_mapped`
- `retailer_trolley_prepared`
- `retailer_checkout_opened`
- `purchase_confirmed` only where legitimately observable

Capture retailer, mapped/total item count, approximate basket value and execution method where appropriate, while avoiding retailer credentials/payment data.

## Next investigation

1. Select and configure a production interactive-browser provider for SuperValu with shopper isolation and guaranteed session destruction.
2. Connect provider session creation/state/destruction behind `CheckoutRuntimeProvider` and verify the trolley before reporting success.
3. Treat SuperValu and Dunnes as a common Instacart Storefront execution family while preserving retailer-specific runtime proof.
4. Determine whether Dunnes can legitimately pass its Cloudflare boundary; do not seek a bypass.
5. Recover the most detailed historical Tesco/Pepesto checkout instruction payloads available without new paid sessions.
