# SuperValu Storefront cart probe — 29 August 2026

## Purpose

Determine whether Supermarket.ie can truthfully upgrade the SuperValu retailer handoff from `product_links` to a populated retailer trolley without bypassing retailer security controls or handling payment credentials.

## Confirmed live behaviour

The current SuperValu online store exposes store-scoped product URLs using `rsid`, and that value is the Storefront retailer store ID used by cart operations.

For a mapped test product, the Storefront client exposes a standard cart mutation contract:

- method: `POST`
- path: `stores/{retailerStoreId}/cart`
- add-product media type: `application/vnd.cart.v1+json;domain-model=AddProductLineItemToCart`
- request fields: `quantity`, `sku`, `source.type = catalog`, and `shoppingModeId`
- bulk-add support is also present through the `AddProductLineItemsToCart` domain model
- quantity changes and removals are implemented through the same store-scoped cart resource with different domain-model media types

The cart API is reached through SuperValu's Storefront gateway and is driven by the same SKU values already persisted in `store_products`.

## Authentication boundary

The live SuperValu configuration currently has `anonymousCart` disabled.

The Storefront Add to Trolley control checks whether the shopper is logged in. When the shopper is not authenticated and anonymous cart is disabled, it opens the retailer login flow instead of invoking the add-to-cart mutation.

The Storefront uses OIDC-based customer authentication and maintains retailer session/cart state within the SuperValu shopping context. The cart therefore cannot be treated as a legitimate anonymous server-side resource for Supermarket.ie to populate independently.

No anonymous cart mutation was attempted after this boundary was confirmed.

## Checkout boundary

The live Storefront configuration does not require a delivery/collection timeslot merely to add products or review the trolley, but a timeslot is required before checkout. This is compatible with the intended Supermarket.ie boundary: prepare the shop, then leave fulfilment details and payment with SuperValu.

## Current conclusion

The cart mechanics themselves are technically understood, including single-item and bulk-add contracts. However, `authenticated_cart` is not yet a truthful Supermarket.ie handoff method because no authorised mechanism has been established for Supermarket.ie to invoke those cart mutations inside a shopper's authenticated SuperValu session.

Do not work around the retailer login requirement by replaying, capturing, or taking custody of customer credentials, cookies, or bearer tokens.

Until an authorised session handoff or retailer/Storefront integration exists, the SuperValu adapter should remain `product_links` (or another explicitly non-prefilled method).

## Production-quality routes to investigate

1. An authorised SuperValu / Storefront partner integration that permits cart creation or population for a shopper.
2. A retailer-supported OAuth/session delegation mechanism, if one becomes available.
3. A retailer-supported cart/deep-link handoff that creates a basket without Supermarket.ie possessing customer credentials.

A browser extension or other client-side automation could theoretically act inside a shopper-controlled authenticated browser, but it should not become the core transaction architecture unless explicitly supported and robust enough for production.

## Adapter follow-up

When PR #21 is refreshed onto current `main`:

- preserve SKU and quantity mapping;
- preserve explicit complete/partial/missing mapping states;
- retain `requires_retailer_login` for the current flow;
- keep the execution method truthful as `product_links` until trolley population is actually demonstrated through an authorised shopper session;
- use the store-scoped SuperValu cart-review destination rather than assuming a global `/cart` URL;
- retain SuperValu product deep links as the safe fallback.
