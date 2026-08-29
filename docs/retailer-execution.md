# Retailer Execution — Supermarket.ie

**Last updated:** 29 August 2026

This document records retailer-specific execution/handoff findings. Read `PROJECT_STATE.md` first for overall architecture and strategy.

## Objective

Target execution flow:

`Supermarket.ie prepared basket → shopper chooses retailer → retailer trolley populated → shopper reviews/pays retailer`

Supermarket.ie remains outside retailer payment and does not capture retailer credentials/session tokens.

## Status matrix

| Retailer | Platform / context | Known identifiers | Cart primitive | Auth/session boundary | Current status |
|---|---|---|---|---|---|
| SuperValu | Instacart Storefront | `store_sku`, `store_url`, `rsid`/retailer store ID, price/name | Store-scoped cart; single + bulk add observed in client | `anonymousCart:false`; OIDC login required | Product-link handoff proven; automatic authenticated trolley population unresolved |
| Dunnes | Wynshop | Existing retailer product mappings | First-party list/past-items multi-select → Add selected to cart | Dunnes/Wynshop auth | Investigate list/session adoption and Pepesto route |
| Tesco | Tesco Ireland + historical Pepesto integration | Existing store product mapping/queue fields | Pepesto previously used for search/retrieve; execution supported by Pepesto | To verify | Prefer Pepesto investigation before bespoke checkout work |
| Aldi | Retailer catalogue pipeline | Existing catalogue mapping | No established online grocery checkout | — | No execution adapter target currently |

## SuperValu

### Data available

The SuperValu data pipeline captures execution-relevant identifiers including:

- `store_sku`
- `store_url`
- retailer product name
- current price
- store-scoped URLs containing `rsid`

### PR #21

Branch: `agent/retailer-handoff`

Draft PR #21 established the retailer abstraction and a truthful `product_links` handoff. It should not be described as trolley population.

### Live cart findings — 29 August 2026

Read-only Storefront inspection established:

- SuperValu uses Instacart Storefront.
- `rsid` maps to retailer store context.
- Add-to-cart is store scoped.
- Normal add contract is a POST to a `stores/{retailerStoreId}/cart` resource.
- Product add data includes quantity, SKU, catalog source and selected shopping-mode ID.
- Client code contains single and bulk add domain models.
- Quantity update has its own cart domain model.
- Storefront can build/review cart before final slot/payment stages.
- SuperValu live configuration has anonymous cart disabled.
- Add while logged out triggers retailer authentication.
- Auth host/client references show OIDC-based SuperValu authentication.

### Security/product boundary

Do not:

- replay SuperValu auth/session tokens server-side
- capture passwords
- attempt to bypass the retailer login requirement
- report `authenticated_cart` until a real trolley has been populated through a legitimate user-authorised path

### Browser bridge experiment

Branch `agent/supervalu-browser-bridge-poc`, draft PR #56, proved a possible browser-side interaction model using SuperValu's visible Add button. It required an extension.

Product decision: **no extension requirement**. Therefore this is not the mainstream execution route.

A normal supermarket.ie webpage cannot execute authenticated SuperValu cart operations in the shopper's SuperValu origin due browser same-origin/security boundaries.

### Authorised route

Instacart Storefront has retailer/partner cart integration capabilities. If SuperValu/Instacart authorises Supermarket.ie, the desired bulk cart population should be technically straightforward.

## Dunnes

### Platform findings

Dunnes grocery uses a Wynshop-based platform with OIDC-style authentication.

First-party UX includes:

- shopping lists
- favourites
- past purchases
- multi-select / **Add selected to cart** behaviour
- cart review before delivery-slot/payment completion

### Key experiment

Determine whether a list/session can be created or transferred in a way that survives/adopts into shopper authentication, allowing:

`Supermarket.ie basket → Dunnes login → populated Dunnes cart`

without an extension and without Supermarket.ie handling Dunnes credentials.

Before bespoke reverse engineering, evaluate Pepesto because it already claims Dunnes execution support.

## Pepesto

### Existing Supermarket.ie work

Existing branch: `pepesto-tesco-adapter`

Historical adapter: `src/lib/pepesto-tesco.ts`

Historical API base: `https://s.pepesto.com/api`

Historical endpoints used:

- `/credits`
- `/search`
- `/retrieve`

Historical code retrieved the API credential server-side via:

`supabaseAdmin.rpc('get_pepesto_api_key')`

Do not expose the returned value. The presence/absence of a visible Vercel env variable is not the canonical Pepesto-access check.

### Historical purpose

The previous work used Pepesto primarily for Tesco product search/retrieval because direct Tesco scraping was difficult.

### Current strategic opportunity

Pepesto now matters more as a possible retailer execution layer for:

- Dunnes
- SuperValu
- Tesco Ireland

Desired architecture if adopted:

`Shopping Capability Layer → PepestoExecutionAdapter → retailer checkout runtime`

Supermarket.ie should send already-decided products/quantities; Pepesto should not replace household reasoning or retailer-neutral product intelligence.

### Checkout mechanism

Pepesto's public checkout architecture is browser-driving rather than a magic deep-link cart. The checkout service can instruct a compatible client to load pages, wait for retailer UI, execute JavaScript and request shopper actions. This is consistent with the retailer-origin/session constraints independently observed on SuperValu.

Important question: can Pepesto's execution runtime be delivered in a no-extension experience acceptable for Supermarket.ie (for example an embeddable/hosted browser/WebView model), or does it require the Pepesto app/extension/client environment?

### Credit discipline

Do not consume paid Pepesto session/search credits merely to rediscover documented behaviour. First inspect:

1. public Pepesto docs/client behaviour;
2. historical Supermarket.ie Pepesto code;
3. historical session/result data if available;
4. existing free checkout turns for any valid prior session if available.

If a new paid session is required to answer a decisive execution question, use a minimal 2–3 item experiment.

## Retailer adapter semantics

Execution methods must be named truthfully. Suggested conceptual levels:

- `product_links` — mapped retailer product links only
- `guided_cart` — Supermarket.ie guides shopper through retailer additions but does not populate cart automatically
- `authenticated_cart` — shopper-authorised retailer trolley is actually populated
- `authorised_partner_cart` — cart populated through a retailer/commerce partner integration

Do not use `authenticated_cart` or emit `retailer_trolley_prepared` merely because mappings exist.

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

1. Verify Pepesto access path remains operational via the existing Supabase RPC without exposing the key.
2. Inspect Pepesto's current no-extension execution options.
3. Study Pepesto SuperValu execution behaviour without consuming credits where possible.
4. Check historical data for reusable Pepesto sessions/results.
5. If necessary, run a minimal paid basket experiment for Dunnes and SuperValu.
6. Decide whether direct retailer adapters or Pepesto-backed execution should be the default per retailer.
