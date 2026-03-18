export const CATEGORY_CONFIG: Record<string, { emoji: string; order: number; color: string }> = {
  'Bakery':              { emoji: '🍞', order: 1,  color: '#FEF3E2' },
  'Dairy':               { emoji: '🥛', order: 2,  color: '#EEF3FB' },
  'Dairy Alternatives':  { emoji: '🌾', order: 3,  color: '#F0FAF7' },
  'Meat':                { emoji: '🥩', order: 4,  color: '#FAEAEC' },
  'Fish':                { emoji: '🐟', order: 5,  color: '#EEF3FB' },
  'Fruit':               { emoji: '🍎', order: 6,  color: '#FFF0F0' },
  'Vegetables':          { emoji: '🥦', order: 7,  color: '#F0FAF7' },
  'Frozen':              { emoji: '🧊', order: 8,  color: '#EEF3FB' },
  'Breakfast':           { emoji: '🥣', order: 9,  color: '#FEF3E2' },
  'Tinned':              { emoji: '🥫', order: 10, color: '#F5F0EB' },
  'Pasta & Rice':        { emoji: '🍝', order: 11, color: '#FEF3E2' },
  'Baking':              { emoji: '🎂', order: 12, color: '#FEF3E2' },
  'Condiments':          { emoji: '🫙', order: 13, color: '#F5F0EB' },
  'Spreads':             { emoji: '🧈', order: 14, color: '#FEF3E2' },
  'Oils':                { emoji: '🫒', order: 15, color: '#F0FAF7' },
  'Stock':               { emoji: '🍲', order: 16, color: '#FEF3E2' },
  'Seasoning':           { emoji: '🧂', order: 17, color: '#F5F0EB' },
  'Other':               { emoji: '🛒', order: 99, color: '#F5F0EB' },
};

export interface BrowseProduct {
  id: string;
  canonical_name: string;
  category: string | null;
  storeCount: number;
  nutrition: { calories: number; protein: number; carbs: number; fat: number } | null;
}
