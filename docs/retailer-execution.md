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
| Tesco | Tesco Ireland + historical Pepesto integration | Existing store product mapping; exact Tesco product URLs used in prior tests | **Pepesto checkout protocol was tested with a three-product Tesco basket and continuation turns** | Pepesto browser-driving checkout protocol; final customer runtime still unresolved | Prior basket-handoff work exists and must be recovered before new implementation |
| Aldi | Retailer catalogue pipeline | Existing catalogue mapping | No established online grocery checkout | — | No execution adapter target currently |

## SuperValu

### Data available

The SuperValu data pipeline captures execution-relevant identifiers including `store_sku`, `store_url`, retailer product name, current price and store-scoped URLs containing `rsid`.

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

Do not replay SuperValu auth/session tokens server-side, capture passwords, bypass retailer login, or report `authenticated_cart` until a real trolley has been populated through a legitimate user-authorised path.

### Browser bridge experiment

Branch `agent/supervalu-browser-bridge-poc`, draft PR #56, proved a possible browser-side interaction model using SuperValu's visible Add button. It required an extension.

Product decision: **no extension requirement**. Therefore this is not the mainstream execution route.

A normal supermarket.ie webpage cannot execute authenticated SuperValu cart operations in the shopper's SuperValu origin due browser same-origin/security boundaries.

### Authorised route

Instacart Storefront has retailer/partner cart integration capabilities. If SuperValu/Instacart authorises Supermarket.ie, desired bulk cart population should be technically straightforward.

## Dunnes

Dunnes grocery uses a Wynshop-based platform with OIDC-style authentication.

First-party UX includes shopping lists, favourites, past purchases, multi-select / **Add selected to cart** behaviour and cart review before delivery-slot/payment completion.

Key experiment: determine whether a list/session can be created or transferred in a way that survives/adopts into shopper authentication, allowing:

`Supermarket.ie basket → Dunnes login → populated Dunnes cart`

without an extension and without Supermarket.ie handling Dunnes credentials.

Before bespoke reverse engineering, evaluate Pepesto because it already supports Dunnes.

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

Earlier work did include `/credits`, `/search` and `/retrieve` to improve Tesco product discovery/pricing where direct retailer scraping was difficult.

### Phase 2 — Pepesto checkout protocol reverse-engineering

On 21 August 2026, we deliberately moved from product retrieval into **basket creation / checkout protocol investigation**.

Repo history includes, among others:

- `add one-time Pepesto checkout protocol test`
- `add three-product Pepesto checkout protocol test`
- `schedule three-product Pepesto checkout protocol test`
- `add one-time Pepesto checkout continuation`
- `add one-time Pepesto checkout recovery turn`
- `add fresh recorded Pepesto checkout session`
- `schedule fresh Pepesto checkout recording`

The three-product protocol test used known Tesco product URLs and implemented this exact sequence:

1. Call Pepesto `/products` with a manual shopping list, `supermarket_domain: 'tesco.ie'` and `preferred_product_urls` containing exact Tesco URLs.
2. Flatten returned products and select exact URL matches.
3. Extract Pepesto `session_token` for each selected product.
4. Build the requested basket as `skus`, each containing `session_token` and `num_units_to_buy`.
5. Call `/session` with `supermarket_domain: 'tesco.ie'`, locale and those basket items.
6. Receive a Pepesto `session_id`.
7. Call `/checkout` with `continue_session_id: session_id`.
8. Inspect/record the returned checkout protocol instruction.
9. Continue the same checkout session in later turns using `/checkout` again.

The checkout instruction parser explicitly looked for protocol operations including:

- `load_page`
- `await_element`
- `run_js`
- `prompt_user_action`
- `await_js_out_change`
- `done`

This demonstrates that we had already gone through Pepesto's execution steps to understand how it drives retailer basket creation and had begun translating that learning into our own Tesco basket-handoff work.

### Recorded sessions

A later test deliberately created a fresh three-product Tesco Pepesto session and stored the full first `/checkout` response in the run record. Continuation/recovery routes then reused existing `session_id` values for additional protocol turns.

Therefore **historical `scrape_runs` data may contain useful recorded Pepesto checkout responses/session metadata**. Inspect those records before paying for or recreating protocol tests.

### What is not yet established

The repository evidence proves protocol/session investigation and early basket-handoff implementation work. It does **not by itself prove that a production supermarket.ie customer completed an end-to-end Tesco checkout**.

Before writing new Tesco handoff code, recover the historical protocol results and determine exactly how far the prior implementation got.

## Pepesto as execution infrastructure

Pepesto should be evaluated primarily as **retailer execution infrastructure**, not as Supermarket.ie's shopping intelligence.

Preferred boundary:

`Shopping Capability Layer → PepestoExecutionAdapter → retailer checkout runtime`

Supermarket.ie should decide household needs, products, quantities, retailer comparison and recommendations. Pepesto can handle retailer-specific execution where useful.

Pepesto's checkout architecture is browser-driving rather than a magic deep-link cart. It returns instructions to a compatible execution client. This is consistent with the Tesco protocol we already recorded and the retailer-origin/session constraints independently observed on SuperValu.

The key product question remains whether Pepesto's execution runtime can be delivered in a **no-extension experience acceptable for Supermarket.ie**, or whether we can reproduce the necessary retailer-specific execution ourselves from the previously recorded protocol learning.

### Credit discipline

Do not consume paid Pepesto credits merely to rediscover prior work. First inspect:

1. the historical checkout-protocol commits;
2. `scrape_runs` records with retrieval methods such as `pepesto_checkout_protocol` / continuation variants;
3. stored `error_summary` checkout responses from those runs;
4. any still-valid prior session IDs where a free continuation is legitimately supported;
5. public Pepesto documentation/client behaviour.

Only create a new paid session if the historical records cannot answer a decisive question.

## Retailer adapter semantics

Execution methods must be named truthfully:

- `product_links` — mapped retailer product links only
- `guided_cart` — shopper is guided through retailer additions but cart is not automatically populated
- `authenticated_cart` — shopper-authorised retailer trolley is actually populated
- `authorised_partner_cart` — cart populated through a retailer/commerce partner integration

Do not use `authenticated_cart` or emit `retailer_trolley_prepared` merely because mappings or protocol instructions exist.

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

1. **Recover the recorded Tesco Pepesto checkout-protocol results from 21 August before doing any new Pepesto experiments.**
2. Determine how far the previous Tesco basket-handoff build actually progressed after the recorded protocol tests.
3. Verify the existing Supabase Pepesto access path remains operational without exposing the key.
4. Use the Tesco learning to understand Pepesto's SuperValu and Dunnes execution strategy without spending credits where possible.
5. Determine whether Pepesto or a reproduced retailer-specific adapter can provide the required no-extension experience.
6. Only if necessary, run a minimal new paid basket experiment.
