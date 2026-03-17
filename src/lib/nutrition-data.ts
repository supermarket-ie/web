/**
 * Nutrition data for the 57 canonical products.
 * Values are per 100g or per 100ml as appropriate.
 * Source: typical UK/Ireland food label values.
 */

export interface NutritionData {
  calories: number;   // kcal per 100g/ml
  protein: number;    // g per 100g/ml
  carbs: number;      // g per 100g/ml
  fat: number;        // g per 100g/ml
  sugar: number;      // g per 100g/ml
  fibre?: number;     // g per 100g/ml
  salt?: number;      // g per 100g/ml
}

// Keyed by canonical_name (exact match from products table)
export const NUTRITION: Record<string, NutritionData> = {
  // Bakery
  'Brown Pan Bread Standard':    { calories: 217, protein: 8.5, carbs: 40, fat: 2.5, sugar: 3.5, fibre: 3.5, salt: 1.0 },
  'White Pan Bread Standard':    { calories: 236, protein: 8.0, carbs: 46, fat: 2.0, sugar: 3.0, fibre: 1.8, salt: 1.1 },

  // Baking
  'Granulated Sugar 1kg':        { calories: 400, protein: 0, carbs: 100, fat: 0, sugar: 100, fibre: 0, salt: 0 },
  'Plain Flour 1kg':             { calories: 341, protein: 10, carbs: 70, fat: 1.4, sugar: 1.0, fibre: 2.5, salt: 0 },
  'Self Raising Flour 1kg':      { calories: 341, protein: 10, carbs: 70, fat: 1.4, sugar: 1.0, fibre: 2.5, salt: 1.2 },

  // Breakfast
  'Cornflakes':                  { calories: 376, protein: 7.0, carbs: 84, fat: 0.9, sugar: 8.0, fibre: 3.0, salt: 1.0 },
  'Porridge Oats 1kg':           { calories: 374, protein: 11, carbs: 61, fat: 8.0, sugar: 1.0, fibre: 8.0, salt: 0 },

  // Condiments
  'Curry Sauce Mild':            { calories: 72, protein: 1.5, carbs: 8.5, fat: 3.5, sugar: 5.5, fibre: 1.0, salt: 0.8 },
  'Mayonnaise':                  { calories: 680, protein: 1.2, carbs: 2.5, fat: 75, sugar: 1.5, fibre: 0, salt: 1.1 },
  'Soy Sauce':                   { calories: 60, protein: 5.5, carbs: 7.5, fat: 0, sugar: 5.0, fibre: 0, salt: 14 },
  'Tomato Ketchup':              { calories: 115, protein: 1.5, carbs: 26, fat: 0.1, sugar: 24, fibre: 0.5, salt: 1.8 },

  // Dairy
  'Butter Salted 250g':          { calories: 737, protein: 0.5, carbs: 0.5, fat: 82, sugar: 0.5, fibre: 0, salt: 1.2 },
  'Butter Unsalted 250g':        { calories: 737, protein: 0.5, carbs: 0.5, fat: 82, sugar: 0.5, fibre: 0, salt: 0.01 },
  'Cheddar Cheese Block':        { calories: 410, protein: 25, carbs: 0.1, fat: 34, sugar: 0.1, fibre: 0, salt: 1.8 },
  'Free Range Eggs 12':          { calories: 147, protein: 13, carbs: 0.5, fat: 10, sugar: 0.5, fibre: 0, salt: 0.4 },
  'Fresh Low Fat Milk 2L':       { calories: 42, protein: 3.6, carbs: 4.8, fat: 1.5, sugar: 4.8, fibre: 0, salt: 0.1 },
  'Fresh Whole Milk 2L':         { calories: 63, protein: 3.4, carbs: 4.6, fat: 3.9, sugar: 4.6, fibre: 0, salt: 0.1 },
  'Greek Style Yogurt Plain':    { calories: 97, protein: 5.7, carbs: 3.6, fat: 6.5, sugar: 3.6, fibre: 0, salt: 0.1 },

  // Dairy Alternatives
  'Oat Milk Unsweetened':        { calories: 40, protein: 1.0, carbs: 6.6, fat: 1.0, sugar: 4.0, fibre: 0.8, salt: 0.1 },

  // Fish
  'Salmon Fillets':              { calories: 208, protein: 20, carbs: 0, fat: 14, sugar: 0, fibre: 0, salt: 0.1 },
  'White Fish Fillets (Cod)':    { calories: 82, protein: 18, carbs: 0, fat: 0.7, sugar: 0, fibre: 0, salt: 0.2 },

  // Frozen
  'Frozen Chips':                { calories: 162, protein: 2.5, carbs: 26, fat: 5.5, sugar: 0.5, fibre: 2.5, salt: 0.4 },
  'Frozen Peas':                 { calories: 70, protein: 5.5, carbs: 10, fat: 0.5, sugar: 3.5, fibre: 5.0, salt: 0.01 },

  // Fruit
  'Apples 6 Pack':               { calories: 52, protein: 0.3, carbs: 14, fat: 0.2, sugar: 10, fibre: 2.4, salt: 0 },
  'Bananas Loose':               { calories: 89, protein: 1.1, carbs: 23, fat: 0.3, sugar: 12, fibre: 2.6, salt: 0 },
  'Oranges':                     { calories: 47, protein: 0.9, carbs: 12, fat: 0.1, sugar: 9.0, fibre: 2.4, salt: 0 },

  // Meat
  'Bacon Rashers Smoked':        { calories: 215, protein: 15, carbs: 1.0, fat: 17, sugar: 0.5, fibre: 0, salt: 3.2 },
  'Chicken Breast Fillets':      { calories: 116, protein: 24, carbs: 0, fat: 2.0, sugar: 0, fibre: 0, salt: 0.1 },
  'Chicken Thighs':              { calories: 177, protein: 20, carbs: 0, fat: 11, sugar: 0, fibre: 0, salt: 0.2 },
  'Minced Beef':                 { calories: 225, protein: 17, carbs: 0, fat: 18, sugar: 0, fibre: 0, salt: 0.1 },
  'Pork Sausages':               { calories: 299, protein: 11, carbs: 10, fat: 25, sugar: 1.5, fibre: 0.5, salt: 1.6 },

  // Oils
  'Olive Oil Extra Virgin 500ml': { calories: 824, protein: 0, carbs: 0, fat: 92, sugar: 0, fibre: 0, salt: 0 },
  'Vegetable Oil':               { calories: 828, protein: 0, carbs: 0, fat: 92, sugar: 0, fibre: 0, salt: 0 },

  // Pasta & Rice
  'Basmati Rice 1kg':            { calories: 357, protein: 7.5, carbs: 78, fat: 1.0, sugar: 0.2, fibre: 1.5, salt: 0 },
  'Long Grain Rice 1kg':         { calories: 357, protein: 7.5, carbs: 78, fat: 1.0, sugar: 0.2, fibre: 1.5, salt: 0 },
  'Penne Pasta 500g':            { calories: 352, protein: 12, carbs: 70, fat: 1.5, sugar: 3.0, fibre: 3.0, salt: 0 },
  'Spaghetti Pasta 500g':        { calories: 352, protein: 12, carbs: 70, fat: 1.5, sugar: 3.0, fibre: 3.0, salt: 0 },

  // Seasoning
  'Black Pepper Ground':         { calories: 251, protein: 10, carbs: 64, fat: 3.3, sugar: 0.6, fibre: 25, salt: 0.04 },
  'Table Salt':                  { calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fibre: 0, salt: 100 },

  // Spreads
  'Honey Clear':                 { calories: 304, protein: 0.3, carbs: 82, fat: 0, sugar: 82, fibre: 0.2, salt: 0 },
  'Strawberry Jam':              { calories: 257, protein: 0.5, carbs: 64, fat: 0, sugar: 56, fibre: 0.5, salt: 0.01 },

  // Stock
  'Chicken Stock Cubes':         { calories: 259, protein: 7.5, carbs: 32, fat: 12, sugar: 2.5, fibre: 0.5, salt: 50 },
  'Vegetable Stock Cubes':       { calories: 245, protein: 5.0, carbs: 35, fat: 10, sugar: 4.0, fibre: 1.0, salt: 48 },

  // Tinned
  'Baked Beans':                 { calories: 78, protein: 4.7, carbs: 13, fat: 0.3, sugar: 5.0, fibre: 3.7, salt: 0.6 },
  'Chopped Tomatoes 400g':       { calories: 24, protein: 1.6, carbs: 4.0, fat: 0.1, sugar: 3.5, fibre: 0.9, salt: 0.3 },
  'Passata':                     { calories: 24, protein: 1.6, carbs: 4.0, fat: 0.1, sugar: 3.5, fibre: 1.2, salt: 0.1 },
  'Tuna in Water':               { calories: 109, protein: 25, carbs: 0, fat: 1.0, sugar: 0, fibre: 0, salt: 0.3 },

  // Vegetables
  'Bell Peppers 3 Pack':         { calories: 31, protein: 1.0, carbs: 6.0, fat: 0.3, sugar: 4.2, fibre: 1.6, salt: 0 },
  'Broccoli':                    { calories: 34, protein: 2.8, carbs: 4.0, fat: 0.4, sugar: 1.7, fibre: 2.6, salt: 0.03 },
  'Carrots 1kg':                 { calories: 41, protein: 0.9, carbs: 10, fat: 0.2, sugar: 4.7, fibre: 2.8, salt: 0.07 },
  'Cucumber':                    { calories: 15, protein: 0.6, carbs: 3.6, fat: 0.1, sugar: 1.7, fibre: 0.5, salt: 0 },
  'Garlic Bulbs':                { calories: 149, protein: 6.4, carbs: 33, fat: 0.5, sugar: 1.0, fibre: 2.1, salt: 0.02 },
  'Iceberg Lettuce':             { calories: 14, protein: 0.9, carbs: 2.5, fat: 0.1, sugar: 1.6, fibre: 1.3, salt: 0.02 },
  'Mushrooms':                   { calories: 22, protein: 3.1, carbs: 0.4, fat: 0.5, sugar: 0.2, fibre: 1.0, salt: 0.01 },
  'Onions 1kg':                  { calories: 40, protein: 1.2, carbs: 9.0, fat: 0.1, sugar: 5.0, fibre: 1.4, salt: 0.01 },
  'Potatoes 2kg':                { calories: 77, protein: 2.0, carbs: 17, fat: 0.1, sugar: 0.7, fibre: 1.3, salt: 0.01 },
  'Tomatoes Vine':               { calories: 18, protein: 0.9, carbs: 3.5, fat: 0.2, sugar: 3.0, fibre: 1.0, salt: 0.01 },
};
