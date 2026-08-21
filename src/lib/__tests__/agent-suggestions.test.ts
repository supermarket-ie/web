import { describe, expect, it } from 'vitest';
import { buildPredictiveSuggestions, extractCatalogueFragment, inferSuggestionIntent } from '../agent-suggestions';

describe('predictive agent suggestions', () => {
  it('extracts the unfinished product rather than the surrounding question', () => {
    expect(extractCatalogueFragment('where can I find gle')).toBe('gle');
    expect(extractCatalogueFragment('is Hellmanns mayonnaise on offer')).toBe('hellmanns mayonnaise');
  });

  it('understands common guest intents', () => {
    expect(inferSuggestionIntent('where can I find butter')).toBe('find');
    expect(inferSuggestionIntent('is butter on offer')).toBe('offer');
    expect(inferSuggestionIntent('plan dinners under €80')).toBe('meal');
  });

  it('grounds product predictions in catalogue candidates', () => {
    const suggestions = buildPredictiveSuggestions('where can I find gle', [{
      name: 'Glenisk Natural Yoghurt 500g', category: 'Dairy', best_price: 2.49, best_store: 'Dunnes', on_promotion: false,
    }]);
    expect(suggestions[0].label).toContain('Glenisk Natural Yoghurt 500g');
    expect(suggestions[0].detail).toContain('€2.49');
    expect(suggestions.some(item => item.label.includes('on offer'))).toBe(true);
  });

  it('uses typed household budgets in practical predictions', () => {
    const suggestions = buildPredictiveSuggestions('shop for 4 under 120');
    expect(suggestions[0].label).toContain('€120');
    expect(suggestions[0].prompt).toContain('4 people');
  });

  it('shows more than one matching catalogue product before secondary actions', () => {
    const products = [
      { name: 'Glenisk Natural Yoghurt 500g', category: 'Dairy', best_price: 2.49, best_store: 'Dunnes', on_promotion: false },
      { name: 'Glenisk Greek Yoghurt 450g', category: 'Dairy', best_price: 3.25, best_store: 'Tesco', on_promotion: true },
    ];
    const suggestions = buildPredictiveSuggestions('where can I find gle', products);
    expect(suggestions[0].label).toContain('Natural Yoghurt');
    expect(suggestions[1].label).toContain('Greek Yoghurt');
  });

  it('preserves a named brand when a generic catalogue mapping loses it', () => {
    const suggestions = buildPredictiveSuggestions('is hellmanns mayo on offer', [
      { name: 'Mayonnaise', category: 'Condiments', best_price: 0.99, best_store: 'Aldi', on_promotion: false },
    ]);
    expect(suggestions[0].label).toBe("Is Hellmann's mayonnaise on offer?");
    expect(suggestions[0].detail).not.toContain('€0.99');
  });
});
