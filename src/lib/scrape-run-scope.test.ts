import { describe, expect, it } from 'vitest';
import { resolveRetailerRunScope } from './scrape-run-scope';

describe('resolveRetailerRunScope', () => {
  it('classifies the regular unfiltered 1,000-product run as scheduled full', () => {
    expect(resolveRetailerRunScope({ requested: null, limit: 1000 })).toEqual({ scope: 'scheduled_full' });
  });

  it('classifies smaller and filtered runs as targeted validation', () => {
    expect(resolveRetailerRunScope({ requested: null, limit: 150 })).toEqual({ scope: 'targeted_validation' });
    expect(resolveRetailerRunScope({ requested: null, limit: 1000, query: 'failed' })).toEqual({ scope: 'targeted_validation' });
  });

  it('preserves an explicit operational scope', () => {
    expect(resolveRetailerRunScope({ requested: 'catch_up', limit: 275 })).toEqual({ scope: 'catch_up' });
  });

  it('rejects unknown scopes and misleading scheduled-full labels', () => {
    expect(resolveRetailerRunScope({ requested: 'anything', limit: 1000 })).toEqual({ error: 'Unsupported run scope: anything' });
    expect(resolveRetailerRunScope({ requested: 'scheduled_full', limit: 150 })).toEqual({
      error: 'scheduled_full requires an unfiltered run of at least 1,000 products',
    });
  });
});
