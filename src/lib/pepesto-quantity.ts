/**
 * Pure quantity normaliser for Pepesto candidates (no server-only deps, so it is
 * importable from tests and client contexts). Pepesto returns US spellings
 * (`milliliters`, sometimes `liters`/`kilograms`); the identity validators use UK
 * `millilitres`/`grams`. Accepting both fixes a silent gap where millilitre
 * products carried NO extracted volume, so the measure check could not compare
 * size. Returns null when no usable quantity is present.
 */
export function pepestoStructuredQuantity(quantity: unknown): { grams?: number; millilitres?: number; pieces?: number } | null {
  if (!quantity || typeof quantity !== 'object' || Array.isArray(quantity)) return null;
  const q = quantity as Record<string, unknown>;
  const num = (...keys: string[]) => {
    for (const k of keys) { const v = Number(q[k]); if (Number.isFinite(v) && v > 0) return v; }
    return undefined;
  };
  const kg = num('kilograms', 'kilogram', 'kg');
  const grams = num('grams', 'gram', 'g') ?? (kg !== undefined ? kg * 1000 : undefined);
  const litres = num('litres', 'liters', 'litre', 'liter', 'l');
  const millilitres = num('millilitres', 'milliliters', 'millilitre', 'milliliter', 'ml') ?? (litres !== undefined ? litres * 1000 : undefined);
  const pieces = num('pieces', 'piece', 'units', 'count');
  if (grams === undefined && millilitres === undefined && pieces === undefined) return null;
  return { grams, millilitres, pieces };
}
