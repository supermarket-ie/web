export const CATALOGUE_CATEGORIES = [
  { slug: 'dairy', name: 'Dairy', emoji: '🥛', description: 'Milk, cheese, butter, cream and yogurt' },
  { slug: 'meat', name: 'Meat', emoji: '🥩', description: 'Chicken, beef, pork and lamb' },
  { slug: 'vegetables', name: 'Vegetables', emoji: '🥦', description: 'Fresh vegetables, salad and greens' },
  { slug: 'fruit', name: 'Fruit', emoji: '🍎', description: 'Fresh and seasonal fruit' },
  { slug: 'bakery', name: 'Bakery', emoji: '🍞', description: 'Bread, rolls, wraps and bakery products' },
  { slug: 'breakfast', name: 'Breakfast', emoji: '🥣', description: 'Cereal, oats, porridge and granola' },
  { slug: 'pasta-and-rice', name: 'Pasta & Rice', emoji: '🍝', description: 'Pasta, rice, noodles and grains' },
  { slug: 'tinned', name: 'Tinned', emoji: '🥫', description: 'Tinned tomatoes, beans, fish and canned food' },
  { slug: 'condiments', name: 'Condiments', emoji: '🫙', description: 'Sauces, dressings, ketchup and mayonnaise' },
  { slug: 'beverages', name: 'Beverages', emoji: '🧃', description: 'Water, juice, tea, coffee and soft drinks' },
  { slug: 'snacks', name: 'Snacks', emoji: '🍿', description: 'Crisps, biscuits, chocolate and popcorn' },
  { slug: 'frozen', name: 'Frozen', emoji: '🧊', description: 'Frozen meals, vegetables and desserts' },
  { slug: 'dairy-alternatives', name: 'Dairy Alternatives', emoji: '🌾', description: 'Oat, almond and soy drinks and dairy alternatives' },
  { slug: 'household', name: 'Household', emoji: '🧹', description: 'Laundry, cleaning products, kitchen and toilet roll' },
  { slug: 'personal-care', name: 'Personal Care', emoji: '🪥', description: 'Shampoo, shower gel, toothpaste and toiletries' },
  { slug: 'baking', name: 'Baking', emoji: '🧁', description: 'Flour, sugar and baking ingredients' },
  { slug: 'spreads', name: 'Spreads', emoji: '🫙', description: 'Jam, honey, nut butters and spreads' },
  { slug: 'fish', name: 'Fish', emoji: '🐟', description: 'Fish, salmon and seafood' },
  { slug: 'baby', name: 'Baby', emoji: '🍼', description: 'Baby food, nappies and baby care' },
  { slug: 'chilled', name: 'Chilled', emoji: '🥗', description: 'Chilled meals, dips and deli products' },
  { slug: 'pet-care', name: 'Pet Care', emoji: '🐾', description: 'Pet food, treats and supplies' },
  { slug: 'oils', name: 'Oils', emoji: '🫒', description: 'Cooking oils and sprays' },
  { slug: 'seasoning', name: 'Seasoning', emoji: '🧂', description: 'Herbs, spices, salt and pepper' },
  { slug: 'stock', name: 'Stock', emoji: '🍲', description: 'Stock cubes, pots and cooking stock' },
] as const;

// Historical space/ampersand links resolve to the existing canonical URLs.
export function catalogueCategory(value: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return undefined; }
  const normal = decoded.toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-');
  return CATALOGUE_CATEGORIES.find(category => category.slug === normal);
}
