# Retailer handoff

Supermarket.ie retailer execution is implemented behind a shared `RetailerAdapter` contract.

## SuperValu stage 1

The first SuperValu adapter prepares a retailer-specific handoff from a Supermarket.ie `ShoppingBasket`.

It:

- selects the SuperValu offer for each canonical basket item, including alternatives when another retailer is currently selected;
- preserves basket quantities;
- carries SuperValu SKU/product identity and direct product URLs where available;
- validates that product links remain on `shop.supervalu.ie`;
- reports complete versus partial mapping explicitly;
- exposes the SuperValu trolley destination without claiming the trolley is prefilled.

The current method is therefore `product_links`.

## Stage 2 target

The next stage is to prove a reliable trolley-add mechanism against SuperValu's current online-shopping implementation. Only after that mechanism is verified should the adapter advertise `authenticated_cart` or a stronger handoff method.

Payment, delivery/collection slot selection, substitutions and final order confirmation remain retailer-side actions unless a future supported integration changes that boundary.
