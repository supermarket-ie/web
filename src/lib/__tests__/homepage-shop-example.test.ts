import { describe, expect, it } from 'vitest';
import { buildHomepageExample, HOMEPAGE_EXAMPLE_ITEMS } from '../homepage-shop-example';
import { examplePrefillAction } from '../homepage-example-handoff';
import type { ProductPrice } from '../price-data';

const now = Date.parse('2026-09-27T09:00:00Z');
const row = (index = 0, patch: Partial<ProductPrice> = {}): ProductPrice => ({
  canonical_product_id: HOMEPAGE_EXAMPLE_ITEMS[index].id,
  canonical_name: HOMEPAGE_EXAMPLE_ITEMS[index].name,
  category: 'Household', store: 'supervalu', price: 2.25, was_price: null, on_promotion: false,
  store_product_name: HOMEPAGE_EXAMPLE_ITEMS[index].name, store_sku: String(index), store_url: null,
  observed_at: '2026-09-24T08:00:00Z', source: 'direct', relationship_type: 'exact', freshness_state: 'fresh', ...patch,
});

describe('homepage price-backed shop example', () => {
  it('prices quantities in cents at one retailer and exposes the actual evidence', () => {
    const example = buildHomepageExample(HOMEPAGE_EXAMPLE_ITEMS.map((_, i) => row(i, { price: 1.11 })), now);
    expect(example.total).toBe(15.54);
    expect(example.subtotal).toBe(15.54);
    expect(example.lines[0].lineTotal).toBe(2.22);
    expect(example.oldestCheck).toBe('2026-09-24T08:00:00Z');
    expect(example.missingCount).toBe(0);
  });

  it('prefers complete coverage over a cheaper partial basket without mixing retailers', () => {
    const rows = HOMEPAGE_EXAMPLE_ITEMS.map((_, i) => row(i));
    const example = buildHomepageExample([...rows, row(0, { store: 'tesco', price: 0.5 })], now);
    expect(example.store).toBe('supervalu');
    expect(example.total).toBe(31.5);
    expect(example.lines[0].offer?.price).toBe(2.25);
  });

  it('never displays a complete total when a single product lacks a price', () => {
    const example = buildHomepageExample([row(), row(1, { store: 'dunnes', price: 0.1 })], now);
    expect(example.total).toBeNull();
    expect(example.subtotal).toBe(0.1);
    expect(example.lines[0].lineTotal).toBeNull();
    expect(example.lines).toHaveLength(HOMEPAGE_EXAMPLE_ITEMS.length);
  });

  it('excludes expired, future, zero and conflicting pack prices', () => {
    for (const patch of [
      { observed_at: '2026-09-19T08:00:00Z' }, { observed_at: '2026-09-28T08:00:00Z' },
      { price: 0 }, { store_product_name: 'Whole Milk 6 x 2L' },
    ]) {
      const example = buildHomepageExample([row(0, patch)], now);
      expect(example.store).toBeNull();
      expect(example.subtotal).toBeNull();
      expect(example.total).toBeNull();
    }
  });

  it('does not reuse an equal name from a different canonical identity', () => {
    expect(buildHomepageExample([row(0, { canonical_product_id: 'other' })], now).subtotal).toBeNull();
  });

  it('keeps all shopping intentions when price data is unavailable, without a zero-price claim', () => {
    const example = buildHomepageExample([], now);
    expect(example.lines.every(line => line.offer === null && line.lineTotal === null)).toBe(true);
    expect(example.subtotal).toBeNull();
    expect(example.prompt).toContain('2 × Fresh Whole Milk 2L');
  });

  it('hands off editable household details and quantities, not cached prices or IDs', () => {
    const example = buildHomepageExample([row()], now);
    expect(example.prompt).toContain('2 adults and 1 child');
    expect(example.prompt).toContain('€100');
    expect(example.prompt).toContain('2 × Chopped Tomatoes 400g');
    expect(example.prompt).toContain('do not add an unsolicited full weekly shop');
    expect(example.prompt).not.toContain('2.25');
    expect(example.prompt).not.toContain(HOMEPAGE_EXAMPLE_ITEMS[0].id);
  });

  it('asks before replacing a draft and never changes a busy or gated request', () => {
    expect(examplePrefillAction('', false, false)).toBe('replace');
    expect(examplePrefillAction('My own shop', false, false)).toBe('confirm');
    expect(examplePrefillAction('', true, false)).toBe('unavailable');
    expect(examplePrefillAction('My own shop', false, true)).toBe('unavailable');
  });
});
