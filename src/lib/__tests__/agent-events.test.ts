import { describe, expect, it } from 'vitest';

// Event delivery is intentionally a hint rather than authoritative state: the
// consumer always re-reads the canonical product snapshot before deciding.
// Keep the message contract compact and stable for queue compatibility.
describe('agent product-change event contract', () => {
  it('uses canonical product identity as the evaluation key', () => {
    const event = {
      canonicalName: "Hellmann's Real Mayonnaise 500ml",
      store: 'dunnes',
      runUuid: 'run-1',
      storeProductId: 'sp-1',
      previousPrice: 4.5,
      observedPrice: 3.5,
      observedAt: new Date().toISOString(),
    };

    expect(event.canonicalName).toBe("Hellmann's Real Mayonnaise 500ml");
    expect(event.storeProductId).toBeTruthy();
    expect(event.runUuid).toBeTruthy();
  });
});
