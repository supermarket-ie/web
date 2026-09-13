import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('catalogue tool amplification regression', () => {
  it('does not fan get_current_price into per-candidate snapshot queries', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'agent/tools/get_current_price.ts'), 'utf8');
    expect(source).not.toContain('getCurrentProductSnapshot');
    expect(source).not.toContain('Promise.all(');
    expect(source).toContain('resolveCatalogueProduct(productQuery, 6)');
  });
});
