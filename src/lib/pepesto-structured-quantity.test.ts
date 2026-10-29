import { describe, it, expect } from 'vitest';
import { pepestoStructuredQuantity } from './pepesto-quantity';

describe('pepestoStructuredQuantity — accept Pepesto US spellings', () => {
  it('reads US milliliters (the prod spelling) as millilitres — the bug fix', () => {
    // Prod data showed {"quantity":{"milliliters":500}} which the old UK-only
    // reader dropped, leaving volume products with no extractable measure.
    expect(pepestoStructuredQuantity({ milliliters: 500 })).toEqual({ grams: undefined, millilitres: 500, pieces: undefined });
  });
  it('still reads UK millilitres', () => {
    expect(pepestoStructuredQuantity({ millilitres: 250 })?.millilitres).toBe(250);
  });
  it('reads grams and pieces', () => {
    expect(pepestoStructuredQuantity({ grams: 750 })?.grams).toBe(750);
    expect(pepestoStructuredQuantity({ pieces: 8 })?.pieces).toBe(8);
  });
  it('converts litres and kilograms to the base unit', () => {
    expect(pepestoStructuredQuantity({ litres: 1.5 })?.millilitres).toBe(1500);
    expect(pepestoStructuredQuantity({ liters: 2 })?.millilitres).toBe(2000);
    expect(pepestoStructuredQuantity({ kilograms: 1 })?.grams).toBe(1000);
  });
  it('returns null for an empty / absent / malformed quantity', () => {
    expect(pepestoStructuredQuantity(null)).toBeNull();
    expect(pepestoStructuredQuantity({})).toBeNull();
    expect(pepestoStructuredQuantity({ grams: 0 })).toBeNull();
    expect(pepestoStructuredQuantity('500ml')).toBeNull();
  });
});
