-- Schema V2: Add search_profile to products table
-- Run this AFTER the initial schema.sql

-- Add search_profile column to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_profile JSONB;

-- Update products with search profiles
-- Format: { search_terms, required_tokens, preferred_tokens, exclude_tokens, size_value, size_unit, size_tolerance }

-- DAIRY
UPDATE products SET search_profile = '{
  "search_terms": ["milk"],
  "required_tokens": ["milk"],
  "preferred_tokens": ["fresh", "whole", "full fat"],
  "exclude_tokens": ["skimmed", "low fat", "semi", "lactose", "plant", "oat", "almond", "soya", "protein", "buttermilk"],
  "size_value": 2,
  "size_unit": "l",
  "size_tolerance": 0.3
}'::jsonb WHERE canonical_name = 'Fresh Whole Milk 2L';

UPDATE products SET search_profile = '{
  "search_terms": ["milk", "low fat"],
  "required_tokens": ["milk", "low fat"],
  "preferred_tokens": ["fresh"],
  "exclude_tokens": ["whole", "full fat", "lactose", "plant", "oat", "almond", "soya", "protein", "buttermilk"],
  "size_value": 2,
  "size_unit": "l",
  "size_tolerance": 0.3
}'::jsonb WHERE canonical_name = 'Fresh Low Fat Milk 2L';

UPDATE products SET search_profile = '{
  "search_terms": ["butter", "salted"],
  "required_tokens": ["butter"],
  "preferred_tokens": ["salted", "irish"],
  "exclude_tokens": ["unsalted", "spreadable", "light", "garlic"],
  "size_value": 250,
  "size_unit": "g",
  "size_tolerance": 50
}'::jsonb WHERE canonical_name = 'Butter Salted 250g';

UPDATE products SET search_profile = '{
  "search_terms": ["butter", "unsalted"],
  "required_tokens": ["butter", "unsalted"],
  "preferred_tokens": ["irish"],
  "exclude_tokens": ["salted", "spreadable", "light", "garlic"],
  "size_value": 250,
  "size_unit": "g",
  "size_tolerance": 50
}'::jsonb WHERE canonical_name = 'Butter Unsalted 250g';

UPDATE products SET search_profile = '{
  "search_terms": ["cheddar"],
  "required_tokens": ["cheddar"],
  "preferred_tokens": ["irish", "mature", "block"],
  "exclude_tokens": ["sliced", "grated", "spread", "vintage", "extra mature"],
  "size_value": 200,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Cheddar Cheese Block';

UPDATE products SET search_profile = '{
  "search_terms": ["greek", "yogurt"],
  "required_tokens": ["greek", "yogurt"],
  "preferred_tokens": ["plain", "natural"],
  "exclude_tokens": ["fruit", "honey", "vanilla", "strawberry", "fat free", "0%"],
  "size_value": 500,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Greek Style Yogurt Plain';

UPDATE products SET search_profile = '{
  "search_terms": ["eggs", "free range"],
  "required_tokens": ["eggs", "free range"],
  "preferred_tokens": ["large", "12"],
  "exclude_tokens": ["barn", "organic", "6 pack"],
  "size_value": 12,
  "size_unit": "pack",
  "size_tolerance": 2
}'::jsonb WHERE canonical_name = 'Free Range Eggs 12';

UPDATE products SET search_profile = '{
  "search_terms": ["oat milk"],
  "required_tokens": ["oat"],
  "preferred_tokens": ["unsweetened", "original"],
  "exclude_tokens": ["chocolate", "vanilla", "barista", "sweetened"],
  "size_value": 1,
  "size_unit": "l",
  "size_tolerance": 0.2
}'::jsonb WHERE canonical_name = 'Oat Milk Unsweetened';

-- BAKERY & BREAKFAST
UPDATE products SET search_profile = '{
  "search_terms": ["white bread"],
  "required_tokens": ["white", "bread"],
  "preferred_tokens": ["pan", "sliced"],
  "exclude_tokens": ["brown", "wholemeal", "sourdough", "batch"],
  "size_value": 800,
  "size_unit": "g",
  "size_tolerance": 200
}'::jsonb WHERE canonical_name = 'White Pan Bread Standard';

UPDATE products SET search_profile = '{
  "search_terms": ["brown bread"],
  "required_tokens": ["brown", "bread"],
  "preferred_tokens": ["pan", "sliced", "wholemeal"],
  "exclude_tokens": ["white", "sourdough", "batch", "soda"],
  "size_value": 800,
  "size_unit": "g",
  "size_tolerance": 200
}'::jsonb WHERE canonical_name = 'Brown Pan Bread Standard';

UPDATE products SET search_profile = '{
  "search_terms": ["porridge oats"],
  "required_tokens": ["porridge", "oats"],
  "preferred_tokens": ["1kg"],
  "exclude_tokens": ["instant", "sachets", "golden syrup", "flavoured"],
  "size_value": 1,
  "size_unit": "kg",
  "size_tolerance": 0.3
}'::jsonb WHERE canonical_name = 'Porridge Oats 1kg';

UPDATE products SET search_profile = '{
  "search_terms": ["cornflakes"],
  "required_tokens": ["cornflakes"],
  "preferred_tokens": ["kelloggs"],
  "exclude_tokens": ["frosted", "honey", "chocolate"],
  "size_value": 500,
  "size_unit": "g",
  "size_tolerance": 200
}'::jsonb WHERE canonical_name = 'Cornflakes';

-- SPREADS
UPDATE products SET search_profile = '{
  "search_terms": ["honey", "clear"],
  "required_tokens": ["honey"],
  "preferred_tokens": ["clear", "pure", "runny"],
  "exclude_tokens": ["set", "manuka", "organic"],
  "size_value": 340,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Honey Clear';

UPDATE products SET search_profile = '{
  "search_terms": ["strawberry jam"],
  "required_tokens": ["strawberry", "jam"],
  "preferred_tokens": [],
  "exclude_tokens": ["reduced sugar", "no added sugar", "seedless"],
  "size_value": 340,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Strawberry Jam';

-- PASTA & RICE
UPDATE products SET search_profile = '{
  "search_terms": ["penne pasta"],
  "required_tokens": ["penne"],
  "preferred_tokens": ["pasta"],
  "exclude_tokens": ["whole wheat", "gluten free", "fresh"],
  "size_value": 500,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Penne Pasta 500g';

UPDATE products SET search_profile = '{
  "search_terms": ["spaghetti"],
  "required_tokens": ["spaghetti"],
  "preferred_tokens": [],
  "exclude_tokens": ["whole wheat", "gluten free", "fresh", "hoops"],
  "size_value": 500,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Spaghetti Pasta 500g';

UPDATE products SET search_profile = '{
  "search_terms": ["long grain rice"],
  "required_tokens": ["rice", "long grain"],
  "preferred_tokens": [],
  "exclude_tokens": ["basmati", "brown", "microwave", "boil in bag"],
  "size_value": 1,
  "size_unit": "kg",
  "size_tolerance": 0.3
}'::jsonb WHERE canonical_name = 'Long Grain Rice 1kg';

UPDATE products SET search_profile = '{
  "search_terms": ["basmati rice"],
  "required_tokens": ["basmati", "rice"],
  "preferred_tokens": [],
  "exclude_tokens": ["brown", "microwave", "boil in bag"],
  "size_value": 1,
  "size_unit": "kg",
  "size_tolerance": 0.3
}'::jsonb WHERE canonical_name = 'Basmati Rice 1kg';

-- TINNED
UPDATE products SET search_profile = '{
  "search_terms": ["chopped tomatoes"],
  "required_tokens": ["chopped", "tomatoes"],
  "preferred_tokens": [],
  "exclude_tokens": ["garlic", "herbs", "chilli", "organic"],
  "size_value": 400,
  "size_unit": "g",
  "size_tolerance": 50
}'::jsonb WHERE canonical_name = 'Chopped Tomatoes 400g';

UPDATE products SET search_profile = '{
  "search_terms": ["passata"],
  "required_tokens": ["passata"],
  "preferred_tokens": ["tomato"],
  "exclude_tokens": ["garlic", "herbs", "chilli", "basil"],
  "size_value": 500,
  "size_unit": "g",
  "size_tolerance": 200
}'::jsonb WHERE canonical_name = 'Passata';

UPDATE products SET search_profile = '{
  "search_terms": ["baked beans"],
  "required_tokens": ["baked", "beans"],
  "preferred_tokens": ["heinz"],
  "exclude_tokens": ["reduced sugar", "sausages", "mini"],
  "size_value": 415,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Baked Beans';

UPDATE products SET search_profile = '{
  "search_terms": ["tuna", "water"],
  "required_tokens": ["tuna"],
  "preferred_tokens": ["water", "chunks"],
  "exclude_tokens": ["oil", "brine", "steak"],
  "size_value": 145,
  "size_unit": "g",
  "size_tolerance": 40
}'::jsonb WHERE canonical_name = 'Tuna in Water';

-- CONDIMENTS
UPDATE products SET search_profile = '{
  "search_terms": ["tomato ketchup"],
  "required_tokens": ["ketchup"],
  "preferred_tokens": ["tomato", "heinz"],
  "exclude_tokens": ["reduced sugar", "organic", "spicy"],
  "size_value": 460,
  "size_unit": "g",
  "size_tolerance": 200
}'::jsonb WHERE canonical_name = 'Tomato Ketchup';

UPDATE products SET search_profile = '{
  "search_terms": ["mayonnaise"],
  "required_tokens": ["mayonnaise"],
  "preferred_tokens": ["real", "hellmanns"],
  "exclude_tokens": ["light", "vegan", "garlic", "chipotle"],
  "size_value": 400,
  "size_unit": "g",
  "size_tolerance": 200
}'::jsonb WHERE canonical_name = 'Mayonnaise';

UPDATE products SET search_profile = '{
  "search_terms": ["soy sauce"],
  "required_tokens": ["soy", "sauce"],
  "preferred_tokens": ["dark"],
  "exclude_tokens": ["reduced salt", "gluten free", "teriyaki"],
  "size_value": 150,
  "size_unit": "ml",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Soy Sauce';

UPDATE products SET search_profile = '{
  "search_terms": ["curry sauce"],
  "required_tokens": ["curry", "sauce"],
  "preferred_tokens": ["mild"],
  "exclude_tokens": ["hot", "madras", "vindaloo", "korma"],
  "size_value": 440,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Curry Sauce Mild';

-- OILS
UPDATE products SET search_profile = '{
  "search_terms": ["olive oil", "extra virgin"],
  "required_tokens": ["olive", "oil", "extra virgin"],
  "preferred_tokens": [],
  "exclude_tokens": ["light", "spray", "organic"],
  "size_value": 500,
  "size_unit": "ml",
  "size_tolerance": 250
}'::jsonb WHERE canonical_name = 'Olive Oil Extra Virgin 500ml';

UPDATE products SET search_profile = '{
  "search_terms": ["vegetable oil"],
  "required_tokens": ["vegetable", "oil"],
  "preferred_tokens": [],
  "exclude_tokens": ["spray", "organic"],
  "size_value": 1,
  "size_unit": "l",
  "size_tolerance": 0.5
}'::jsonb WHERE canonical_name = 'Vegetable Oil';

-- BAKING
UPDATE products SET search_profile = '{
  "search_terms": ["plain flour"],
  "required_tokens": ["plain", "flour"],
  "preferred_tokens": [],
  "exclude_tokens": ["self raising", "wholemeal", "bread"],
  "size_value": 1,
  "size_unit": "kg",
  "size_tolerance": 0.5
}'::jsonb WHERE canonical_name = 'Plain Flour 1kg';

UPDATE products SET search_profile = '{
  "search_terms": ["self raising flour"],
  "required_tokens": ["self raising", "flour"],
  "preferred_tokens": [],
  "exclude_tokens": ["plain", "wholemeal", "bread"],
  "size_value": 1,
  "size_unit": "kg",
  "size_tolerance": 0.5
}'::jsonb WHERE canonical_name = 'Self Raising Flour 1kg';

UPDATE products SET search_profile = '{
  "search_terms": ["granulated sugar"],
  "required_tokens": ["sugar", "granulated"],
  "preferred_tokens": [],
  "exclude_tokens": ["caster", "brown", "icing", "demerara"],
  "size_value": 1,
  "size_unit": "kg",
  "size_tolerance": 0.5
}'::jsonb WHERE canonical_name = 'Granulated Sugar 1kg';

-- STOCK & SEASONING
UPDATE products SET search_profile = '{
  "search_terms": ["chicken stock cubes"],
  "required_tokens": ["chicken", "stock"],
  "preferred_tokens": ["cubes", "knorr"],
  "exclude_tokens": ["vegetable", "beef", "organic", "reduced salt"],
  "size_value": 12,
  "size_unit": "pack",
  "size_tolerance": 6
}'::jsonb WHERE canonical_name = 'Chicken Stock Cubes';

UPDATE products SET search_profile = '{
  "search_terms": ["vegetable stock cubes"],
  "required_tokens": ["vegetable", "stock"],
  "preferred_tokens": ["cubes", "knorr"],
  "exclude_tokens": ["chicken", "beef", "organic", "reduced salt"],
  "size_value": 12,
  "size_unit": "pack",
  "size_tolerance": 6
}'::jsonb WHERE canonical_name = 'Vegetable Stock Cubes';

UPDATE products SET search_profile = '{
  "search_terms": ["table salt"],
  "required_tokens": ["salt"],
  "preferred_tokens": ["table"],
  "exclude_tokens": ["sea", "rock", "himalayan", "low sodium"],
  "size_value": 750,
  "size_unit": "g",
  "size_tolerance": 500
}'::jsonb WHERE canonical_name = 'Table Salt';

UPDATE products SET search_profile = '{
  "search_terms": ["black pepper ground"],
  "required_tokens": ["black", "pepper"],
  "preferred_tokens": ["ground"],
  "exclude_tokens": ["white", "whole", "cracked", "mixed"],
  "size_value": 50,
  "size_unit": "g",
  "size_tolerance": 50
}'::jsonb WHERE canonical_name = 'Black Pepper Ground';

-- MEAT
UPDATE products SET search_profile = '{
  "search_terms": ["chicken breast"],
  "required_tokens": ["chicken", "breast"],
  "preferred_tokens": ["irish", "fillets"],
  "exclude_tokens": ["stuffed", "kiev", "coated", "marinated"],
  "size_value": 500,
  "size_unit": "g",
  "size_tolerance": 200
}'::jsonb WHERE canonical_name = 'Chicken Breast Fillets';

UPDATE products SET search_profile = '{
  "search_terms": ["chicken thighs"],
  "required_tokens": ["chicken", "thighs"],
  "preferred_tokens": ["irish"],
  "exclude_tokens": ["stuffed", "marinated", "boneless"],
  "size_value": 500,
  "size_unit": "g",
  "size_tolerance": 200
}'::jsonb WHERE canonical_name = 'Chicken Thighs';

UPDATE products SET search_profile = '{
  "search_terms": ["beef mince"],
  "required_tokens": ["beef", "mince"],
  "preferred_tokens": ["irish"],
  "exclude_tokens": ["steak", "lean", "extra lean", "organic"],
  "size_value": 500,
  "size_unit": "g",
  "size_tolerance": 200
}'::jsonb WHERE canonical_name = 'Minced Beef';

UPDATE products SET search_profile = '{
  "search_terms": ["pork sausages"],
  "required_tokens": ["pork", "sausages"],
  "preferred_tokens": ["irish"],
  "exclude_tokens": ["chicken", "beef", "cumberland", "chipolata", "cocktail"],
  "size_value": 454,
  "size_unit": "g",
  "size_tolerance": 200
}'::jsonb WHERE canonical_name = 'Pork Sausages';

UPDATE products SET search_profile = '{
  "search_terms": ["bacon rashers smoked"],
  "required_tokens": ["bacon", "smoked"],
  "preferred_tokens": ["rashers"],
  "exclude_tokens": ["unsmoked", "streaky", "medallions", "lardons"],
  "size_value": 200,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Bacon Rashers Smoked';

-- FISH
UPDATE products SET search_profile = '{
  "search_terms": ["salmon fillets"],
  "required_tokens": ["salmon", "fillets"],
  "preferred_tokens": ["fresh"],
  "exclude_tokens": ["smoked", "canned", "frozen"],
  "size_value": 240,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Salmon Fillets';

UPDATE products SET search_profile = '{
  "search_terms": ["cod fillets"],
  "required_tokens": ["cod", "fillets"],
  "preferred_tokens": ["fresh"],
  "exclude_tokens": ["smoked", "battered", "frozen"],
  "size_value": 280,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'White Fish Fillets (Cod)';

-- VEGETABLES
UPDATE products SET search_profile = '{
  "search_terms": ["potatoes"],
  "required_tokens": ["potatoes"],
  "preferred_tokens": ["rooster", "irish"],
  "exclude_tokens": ["baby", "new", "mashed", "frozen", "chips"],
  "size_value": 2,
  "size_unit": "kg",
  "size_tolerance": 0.5
}'::jsonb WHERE canonical_name = 'Potatoes 2kg';

UPDATE products SET search_profile = '{
  "search_terms": ["onions"],
  "required_tokens": ["onions"],
  "preferred_tokens": ["brown"],
  "exclude_tokens": ["red", "spring", "pickled", "fried"],
  "size_value": 1,
  "size_unit": "kg",
  "size_tolerance": 0.5
}'::jsonb WHERE canonical_name = 'Onions 1kg';

UPDATE products SET search_profile = '{
  "search_terms": ["carrots"],
  "required_tokens": ["carrots"],
  "preferred_tokens": [],
  "exclude_tokens": ["baby", "batons", "organic"],
  "size_value": 1,
  "size_unit": "kg",
  "size_tolerance": 0.5
}'::jsonb WHERE canonical_name = 'Carrots 1kg';

UPDATE products SET search_profile = '{
  "search_terms": ["tomatoes vine"],
  "required_tokens": ["tomatoes"],
  "preferred_tokens": ["vine"],
  "exclude_tokens": ["cherry", "tinned", "chopped", "passata"],
  "size_value": 400,
  "size_unit": "g",
  "size_tolerance": 200
}'::jsonb WHERE canonical_name = 'Tomatoes Vine';

UPDATE products SET search_profile = '{
  "search_terms": ["cucumber"],
  "required_tokens": ["cucumber"],
  "preferred_tokens": [],
  "exclude_tokens": ["mini", "pickled"],
  "size_value": 1,
  "size_unit": "each",
  "size_tolerance": 0
}'::jsonb WHERE canonical_name = 'Cucumber';

UPDATE products SET search_profile = '{
  "search_terms": ["peppers mixed"],
  "required_tokens": ["peppers"],
  "preferred_tokens": ["mixed", "3 pack"],
  "exclude_tokens": ["stuffed", "roasted", "chilli"],
  "size_value": 3,
  "size_unit": "pack",
  "size_tolerance": 1
}'::jsonb WHERE canonical_name = 'Bell Peppers 3 Pack';

UPDATE products SET search_profile = '{
  "search_terms": ["broccoli"],
  "required_tokens": ["broccoli"],
  "preferred_tokens": [],
  "exclude_tokens": ["frozen", "florets", "tenderstem"],
  "size_value": 1,
  "size_unit": "each",
  "size_tolerance": 0
}'::jsonb WHERE canonical_name = 'Broccoli';

UPDATE products SET search_profile = '{
  "search_terms": ["mushrooms"],
  "required_tokens": ["mushrooms"],
  "preferred_tokens": [],
  "exclude_tokens": ["stuffed", "dried", "sliced"],
  "size_value": 250,
  "size_unit": "g",
  "size_tolerance": 100
}'::jsonb WHERE canonical_name = 'Mushrooms';

UPDATE products SET search_profile = '{
  "search_terms": ["iceberg lettuce"],
  "required_tokens": ["iceberg", "lettuce"],
  "preferred_tokens": [],
  "exclude_tokens": ["romaine", "cos", "little gem"],
  "size_value": 1,
  "size_unit": "each",
  "size_tolerance": 0
}'::jsonb WHERE canonical_name = 'Iceberg Lettuce';

UPDATE products SET search_profile = '{
  "search_terms": ["garlic"],
  "required_tokens": ["garlic"],
  "preferred_tokens": [],
  "exclude_tokens": ["granules", "powder", "paste", "puree", "minced"],
  "size_value": 1,
  "size_unit": "each",
  "size_tolerance": 1
}'::jsonb WHERE canonical_name = 'Garlic Bulbs';

-- FRUIT
UPDATE products SET search_profile = '{
  "search_terms": ["bananas"],
  "required_tokens": ["bananas"],
  "preferred_tokens": ["loose"],
  "exclude_tokens": ["dried", "chips", "organic"],
  "size_value": 1,
  "size_unit": "kg",
  "size_tolerance": 0.5
}'::jsonb WHERE canonical_name = 'Bananas Loose';

UPDATE products SET search_profile = '{
  "search_terms": ["apples"],
  "required_tokens": ["apples"],
  "preferred_tokens": ["eating", "6 pack"],
  "exclude_tokens": ["cooking", "juice", "dried"],
  "size_value": 6,
  "size_unit": "pack",
  "size_tolerance": 2
}'::jsonb WHERE canonical_name = 'Apples 6 Pack';

UPDATE products SET search_profile = '{
  "search_terms": ["oranges"],
  "required_tokens": ["oranges"],
  "preferred_tokens": [],
  "exclude_tokens": ["juice", "marmalade"],
  "size_value": 4,
  "size_unit": "pack",
  "size_tolerance": 2
}'::jsonb WHERE canonical_name = 'Oranges';

-- FROZEN
UPDATE products SET search_profile = '{
  "search_terms": ["frozen peas"],
  "required_tokens": ["peas"],
  "preferred_tokens": ["garden", "frozen"],
  "exclude_tokens": ["mushy", "tinned", "fresh"],
  "size_value": 900,
  "size_unit": "g",
  "size_tolerance": 400
}'::jsonb WHERE canonical_name = 'Frozen Peas';

UPDATE products SET search_profile = '{
  "search_terms": ["frozen chips"],
  "required_tokens": ["chips"],
  "preferred_tokens": ["frozen", "oven"],
  "exclude_tokens": ["crinkle", "skinny", "curly"],
  "size_value": 1.5,
  "size_unit": "kg",
  "size_tolerance": 0.5
}'::jsonb WHERE canonical_name = 'Frozen Chips';
