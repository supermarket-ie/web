# SuperValu browser bridge proof of concept

Purpose: prove that a shopper-approved Supermarket.ie basket can be handed into the shopper's own authenticated SuperValu browser session without Supermarket.ie receiving SuperValu credentials, session tokens or payment details.

## Boundary

- Runs only on `https://shop.supervalu.ie/*`.
- Uses SuperValu's visible Add to Trolley button rather than replaying OIDC or cart API credentials.
- Stores the temporary basket only in the SuperValu tab's `sessionStorage`.
- Does not submit checkout, reserve a delivery slot, access payment information or place an order.
- Current PoC supports quantity `1` only. Quantity preservation must not be claimed until the SuperValu quantity stepper is separately proven.

## Local test

1. Open Chrome extensions and enable Developer mode.
2. Choose **Load unpacked** and select this `experiments/supervalu-browser-bridge` directory.
3. Open the Vercel preview route `/experiments/supervalu-browser-bridge` from branch `agent/supervalu-browser-bridge-poc`.
4. Click **Shop this basket at SuperValu**.
5. If SuperValu asks for authentication, sign in directly on SuperValu.
6. The bridge panel will guide the three-item handoff and then open SuperValu's store-scoped trolley review.

## Success criteria

The experiment succeeds only if all of the following are observed in the shopper's own SuperValu account/session:

- the expected mapped SKU is added using the native SuperValu UI;
- navigation to the next mapped product preserves the authenticated session;
- all three items appear in the SuperValu trolley review page;
- no SuperValu password, bearer token, session cookie or payment data is handled by Supermarket.ie.

If SuperValu changes its DOM so the native Add button cannot be reliably identified, the bridge must fail visibly rather than claim that a trolley was prepared.
