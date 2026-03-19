-- Expanded product catalogue: ~200 new canonical products
-- Run in Supabase SQL editor AFTER the existing seed
-- Adds products + store_products rows for Tesco, Dunnes, SuperValu
-- store_products rows have url_status='pending' so scraper picks them up

-- ============================================================
-- HELPER: wrap inserts to skip duplicates on canonical_name
-- ============================================================

-- DAIRY & EGGS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Fresh Whole Milk 1L', 'Dairy', 'litre', '1L'),
('Fresh Whole Milk 3L', 'Dairy', 'litre', '3L'),
('Semi Skimmed Milk 2L', 'Dairy', 'litre', '2L'),
('Skimmed Milk 2L', 'Dairy', 'litre', '2L'),
('Butter Salted 500g', 'Dairy', 'g', '500g'),
('Mozzarella 125g', 'Dairy', 'g', '125g'),
('Parmesan Grated', 'Dairy', 'g', '100g'),
('Cream Cheese', 'Dairy', 'g', '200g'),
('Sour Cream', 'Dairy', 'g', '200g'),
('Double Cream', 'Dairy', 'ml', '300ml'),
('Single Cream', 'Dairy', 'ml', '200ml'),
('Crème Fraîche', 'Dairy', 'g', '200g'),
('Natural Yogurt Plain', 'Dairy', 'g', '500g'),
('Strawberry Yogurt', 'Dairy', 'g', '125g'),
('Free Range Eggs 6', 'Dairy', 'pack', '6'),
('Rashers Smoked Streaky Bacon', 'Meat', 'g', '200g')
ON CONFLICT (canonical_name) DO NOTHING;

-- DAIRY ALTERNATIVES
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Almond Milk Unsweetened', 'Dairy Alternatives', 'litre', '1L'),
('Soy Milk', 'Dairy Alternatives', 'litre', '1L'),
('Coconut Milk Drink', 'Dairy Alternatives', 'litre', '1L'),
('Oat Milk Barista', 'Dairy Alternatives', 'litre', '1L'),
('Vegan Butter', 'Dairy Alternatives', 'g', '250g')
ON CONFLICT (canonical_name) DO NOTHING;

-- BAKERY & BREAD
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Sourdough Loaf', 'Bakery', 'loaf', '400g'),
('Wholemeal Sliced Bread', 'Bakery', 'loaf', '800g'),
('Seeded Batch Bread', 'Bakery', 'loaf', '800g'),
('Ciabatta Bread', 'Bakery', 'pack', '2 pack'),
('Burger Buns 4 Pack', 'Bakery', 'pack', '4'),
('Hot Dog Rolls 8 Pack', 'Bakery', 'pack', '8'),
('Wraps 8 Pack', 'Bakery', 'pack', '8'),
('Pitta Bread 6 Pack', 'Bakery', 'pack', '6'),
('Naan Bread 2 Pack', 'Bakery', 'pack', '2'),
('Croissants 4 Pack', 'Bakery', 'pack', '4'),
('Pain au Chocolat 4 Pack', 'Bakery', 'pack', '4')
ON CONFLICT (canonical_name) DO NOTHING;

-- BREAKFAST & CEREALS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Weetabix 24 Pack', 'Breakfast', 'pack', '24'),
('Muesli', 'Breakfast', 'g', '500g'),
('Granola', 'Breakfast', 'g', '500g'),
('Bran Flakes', 'Breakfast', 'g', '500g'),
('Rice Krispies', 'Breakfast', 'g', '340g'),
('Shreddies', 'Breakfast', 'g', '500g')
ON CONFLICT (canonical_name) DO NOTHING;

-- MEAT & POULTRY
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Chicken Whole', 'Meat', 'kg', '1.5kg'),
('Chicken Drumsticks', 'Meat', 'g', '600g'),
('Chicken Mince', 'Meat', 'g', '500g'),
('Beef Steak Sirloin', 'Meat', 'g', '225g'),
('Beef Steak Diced', 'Meat', 'g', '500g'),
('Pork Chops', 'Meat', 'g', '500g'),
('Pork Mince', 'Meat', 'g', '500g'),
('Lamb Mince', 'Meat', 'g', '500g'),
('Lamb Chops', 'Meat', 'g', '400g'),
('Turkey Mince', 'Meat', 'g', '500g'),
('Beef Burgers 4 Pack', 'Meat', 'pack', '4'),
('Cooked Ham Sliced', 'Meat', 'g', '120g'),
('Smoked Salmon', 'Fish', 'g', '100g'),
('Roast Chicken Slices', 'Meat', 'g', '120g'),
('Pepperoni', 'Meat', 'g', '70g')
ON CONFLICT (canonical_name) DO NOTHING;

-- FISH & SEAFOOD
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Tuna Steak', 'Fish', 'g', '200g'),
('Prawns Cooked', 'Fish', 'g', '180g'),
('Fish Fingers 10 Pack', 'Fish', 'pack', '10'),
('Mackerel Fillets', 'Fish', 'g', '250g'),
('Haddock Fillets', 'Fish', 'g', '360g')
ON CONFLICT (canonical_name) DO NOTHING;

-- FRUIT & VEG
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Cherry Tomatoes 250g', 'Fruit', 'g', '250g'),
('Strawberries 400g', 'Fruit', 'g', '400g'),
('Grapes Seedless 500g', 'Fruit', 'g', '500g'),
('Melon Cantaloupe', 'Fruit', 'each', 'each'),
('Lemon 4 Pack', 'Fruit', 'pack', '4'),
('Lime 4 Pack', 'Fruit', 'pack', '4'),
('Avocado 2 Pack', 'Fruit', 'pack', '2'),
('Kiwi 4 Pack', 'Fruit', 'pack', '4'),
('Mango', 'Fruit', 'each', 'each'),
('Pineapple', 'Fruit', 'each', 'each'),
('Spinach Baby Leaves 200g', 'Vegetables', 'g', '200g'),
('Kale 200g', 'Vegetables', 'g', '200g'),
('Courgette', 'Vegetables', 'each', 'each'),
('Aubergine', 'Vegetables', 'each', 'each'),
('Sweet Potato 1kg', 'Vegetables', 'kg', '1kg'),
('Butternut Squash', 'Vegetables', 'each', 'each'),
('Leeks 2 Pack', 'Vegetables', 'pack', '2'),
('Celery', 'Vegetables', 'each', 'each'),
('Spring Onions', 'Vegetables', 'bunch', 'bunch'),
('Chilli Peppers Red', 'Vegetables', 'pack', '3'),
('Tenderstem Broccoli 200g', 'Vegetables', 'g', '200g'),
('Asparagus', 'Vegetables', 'g', '200g'),
('Cauliflower', 'Vegetables', 'each', 'each'),
('Cabbage Green', 'Vegetables', 'each', 'each'),
('Mixed Salad Leaves 100g', 'Vegetables', 'g', '100g'),
('Rocket Leaves 60g', 'Vegetables', 'g', '60g'),
('Sweetcorn Cob 2 Pack', 'Vegetables', 'pack', '2'),
('Green Beans 300g', 'Vegetables', 'g', '300g'),
('Mange Tout 150g', 'Vegetables', 'g', '150g'),
('Radishes', 'Vegetables', 'pack', 'pack')
ON CONFLICT (canonical_name) DO NOTHING;

-- PASTA, RICE & GRAINS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Rigatoni Pasta 500g', 'Pasta & Rice', 'g', '500g'),
('Fusilli Pasta 500g', 'Pasta & Rice', 'g', '500g'),
('Lasagne Sheets 500g', 'Pasta & Rice', 'g', '500g'),
('Egg Noodles', 'Pasta & Rice', 'g', '300g'),
('Rice Noodles', 'Pasta & Rice', 'g', '200g'),
('Arborio Risotto Rice 500g', 'Pasta & Rice', 'g', '500g'),
('Couscous 500g', 'Pasta & Rice', 'g', '500g'),
('Quinoa 500g', 'Pasta & Rice', 'g', '500g'),
('Pearl Barley 500g', 'Pasta & Rice', 'g', '500g')
ON CONFLICT (canonical_name) DO NOTHING;

-- TINNED & JARRED
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Chopped Tomatoes 4 Pack', 'Tinned', 'pack', '4x400g'),
('Coconut Milk 400ml', 'Tinned', 'ml', '400ml'),
('Chickpeas 400g', 'Tinned', 'g', '400g'),
('Red Kidney Beans 400g', 'Tinned', 'g', '400g'),
('Lentils Green 400g', 'Tinned', 'g', '400g'),
('Black Beans 400g', 'Tinned', 'g', '400g'),
('Butter Beans 400g', 'Tinned', 'g', '400g'),
('Tuna Chunks in Brine 4 Pack', 'Tinned', 'pack', '4x145g'),
('Sardines in Olive Oil', 'Tinned', 'g', '120g'),
('Sweetcorn Tinned 340g', 'Tinned', 'g', '340g'),
('Tomato Soup 400g', 'Tinned', 'g', '400g'),
('Chicken Soup 400g', 'Tinned', 'g', '400g'),
('Pineapple Chunks Tinned', 'Tinned', 'g', '432g'),
('Peaches Tinned', 'Tinned', 'g', '410g')
ON CONFLICT (canonical_name) DO NOTHING;

-- SAUCES, CONDIMENTS & COOKING
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Pasta Sauce Tomato Basil', 'Condiments', 'g', '500g'),
('Pasta Sauce Arrabiata', 'Condiments', 'g', '500g'),
('Pesto Green', 'Condiments', 'g', '190g'),
('Pesto Red', 'Condiments', 'g', '190g'),
('BBQ Sauce', 'Condiments', 'g', '380g'),
('Sweet Chilli Sauce', 'Condiments', 'ml', '190ml'),
('Worcestershire Sauce', 'Condiments', 'ml', '150ml'),
('Balsamic Vinegar', 'Condiments', 'ml', '250ml'),
('White Wine Vinegar', 'Condiments', 'ml', '350ml'),
('Apple Cider Vinegar', 'Condiments', 'ml', '500ml'),
('Dijon Mustard', 'Condiments', 'g', '185g'),
('Wholegrain Mustard', 'Condiments', 'g', '200g'),
('Hot Sauce Tabasco', 'Condiments', 'ml', '60ml'),
('Tomato Puree 140g', 'Condiments', 'g', '140g'),
('Harissa Paste', 'Condiments', 'g', '140g'),
('Tahini', 'Condiments', 'g', '270g'),
('Soy Sauce Dark', 'Condiments', 'ml', '150ml'),
('Fish Sauce', 'Condiments', 'ml', '200ml'),
('Oyster Sauce', 'Condiments', 'g', '255g'),
('Hoisin Sauce', 'Condiments', 'g', '220g'),
('Teriyaki Sauce', 'Condiments', 'g', '150g'),
('Miso Paste', 'Condiments', 'g', '200g')
ON CONFLICT (canonical_name) DO NOTHING;

-- OILS & FATS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Rapeseed Oil 1L', 'Oils', 'litre', '1L'),
('Coconut Oil 500g', 'Oils', 'g', '500g'),
('Sesame Oil', 'Oils', 'ml', '150ml'),
('Spray Oil', 'Oils', 'ml', '190ml')
ON CONFLICT (canonical_name) DO NOTHING;

-- BAKING & SUGAR
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Caster Sugar 1kg', 'Baking', 'kg', '1kg'),
('Brown Sugar 500g', 'Baking', 'g', '500g'),
('Icing Sugar 500g', 'Baking', 'g', '500g'),
('Baking Powder', 'Baking', 'g', '100g'),
('Bicarbonate of Soda', 'Baking', 'g', '200g'),
('Vanilla Extract', 'Baking', 'ml', '60ml'),
('Cocoa Powder', 'Baking', 'g', '250g'),
('Dark Chocolate 100g', 'Baking', 'g', '100g'),
('Bread Soda', 'Baking', 'g', '200g'),
('Dried Yeast', 'Baking', 'g', '7g'),
('Mixed Dried Fruit', 'Baking', 'g', '500g')
ON CONFLICT (canonical_name) DO NOTHING;

-- SPICES & HERBS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Cinnamon Ground', 'Seasoning', 'g', '40g'),
('Cumin Ground', 'Seasoning', 'g', '40g'),
('Coriander Ground', 'Seasoning', 'g', '40g'),
('Paprika Smoked', 'Seasoning', 'g', '50g'),
('Chilli Powder', 'Seasoning', 'g', '40g'),
('Turmeric Ground', 'Seasoning', 'g', '40g'),
('Garam Masala', 'Seasoning', 'g', '40g'),
('Mixed Herbs Dried', 'Seasoning', 'g', '15g'),
('Oregano Dried', 'Seasoning', 'g', '10g'),
('Thyme Dried', 'Seasoning', 'g', '10g'),
('Garlic Powder', 'Seasoning', 'g', '60g'),
('Onion Powder', 'Seasoning', 'g', '60g'),
('Curry Powder', 'Seasoning', 'g', '100g'),
('Chinese Five Spice', 'Seasoning', 'g', '38g'),
('Cajun Seasoning', 'Seasoning', 'g', '50g'),
('Italian Seasoning', 'Seasoning', 'g', '20g')
ON CONFLICT (canonical_name) DO NOTHING;

-- SPREADS & JAMS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Peanut Butter Smooth', 'Spreads', 'g', '340g'),
('Peanut Butter Crunchy', 'Spreads', 'g', '340g'),
('Nutella 400g', 'Spreads', 'g', '400g'),
('Raspberry Jam', 'Spreads', 'g', '340g'),
('Marmalade', 'Spreads', 'g', '340g'),
('Marmite', 'Spreads', 'g', '250g')
ON CONFLICT (canonical_name) DO NOTHING;

-- STOCKS & SOUPS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Beef Stock Cubes', 'Stock', 'pack', '10 cubes'),
('Fish Stock Cubes', 'Stock', 'pack', '8 cubes'),
('Vegetable Stock Pot', 'Stock', 'pack', '4 pack'),
('Chicken Stock Pot', 'Stock', 'pack', '4 pack')
ON CONFLICT (canonical_name) DO NOTHING;

-- BEVERAGES
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Orange Juice 1L', 'Beverages', 'litre', '1L'),
('Apple Juice 1L', 'Beverages', 'litre', '1L'),
('Cranberry Juice 1L', 'Beverages', 'litre', '1L'),
('Sparkling Water 1.5L', 'Beverages', 'litre', '1.5L'),
('Still Water 6 Pack', 'Beverages', 'pack', '6x500ml'),
('Cola 2L', 'Beverages', 'litre', '2L'),
('Lemonade 2L', 'Beverages', 'litre', '2L'),
('Tea Bags 80 Pack', 'Beverages', 'pack', '80'),
('Tea Bags 160 Pack', 'Beverages', 'pack', '160'),
('Instant Coffee 100g', 'Beverages', 'g', '100g'),
('Ground Coffee 227g', 'Beverages', 'g', '227g'),
('Green Tea 20 Pack', 'Beverages', 'pack', '20'),
('Hot Chocolate 400g', 'Beverages', 'g', '400g'),
('Squash Blackcurrant 1L', 'Beverages', 'litre', '1L')
ON CONFLICT (canonical_name) DO NOTHING;

-- SNACKS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Crisps Ready Salted 6 Pack', 'Snacks', 'pack', '6'),
('Crisps Cheese Onion 6 Pack', 'Snacks', 'pack', '6'),
('Popcorn Sweet', 'Snacks', 'g', '100g'),
('Rice Cakes Plain', 'Snacks', 'pack', '9'),
('Crackers 200g', 'Snacks', 'g', '200g'),
('Oat Crackers', 'Snacks', 'g', '200g'),
('Nuts Mixed 200g', 'Snacks', 'g', '200g'),
('Almonds 200g', 'Snacks', 'g', '200g'),
('Cashews 200g', 'Snacks', 'g', '200g'),
('Raisins 500g', 'Snacks', 'g', '500g'),
('Chocolate Bar Milk 100g', 'Snacks', 'g', '100g'),
('Chocolate Bar Dark 100g', 'Snacks', 'g', '100g'),
('Biscuits Digestive', 'Snacks', 'g', '400g'),
('Biscuits Chocolate Digestive', 'Snacks', 'g', '300g'),
('Custard Creams', 'Snacks', 'g', '300g')
ON CONFLICT (canonical_name) DO NOTHING;

-- FROZEN
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Frozen Sweetcorn 1kg', 'Frozen', 'kg', '1kg'),
('Frozen Broccoli 900g', 'Frozen', 'g', '900g'),
('Frozen Mixed Veg 1kg', 'Frozen', 'kg', '1kg'),
('Frozen Spinach 900g', 'Frozen', 'g', '900g'),
('Frozen Fish Fillets', 'Frozen', 'g', '400g'),
('Frozen Burger Patties 4 Pack', 'Frozen', 'pack', '4'),
('Frozen Chicken Nuggets', 'Frozen', 'g', '400g'),
('Frozen Pizza Margherita', 'Frozen', 'each', 'each'),
('Ice Cream Vanilla 1L', 'Frozen', 'litre', '1L'),
('Frozen Strawberries 500g', 'Frozen', 'g', '500g')
ON CONFLICT (canonical_name) DO NOTHING;

-- CHILLED & READY MEALS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Orange Juice Chilled 1.5L', 'Chilled', 'litre', '1.5L'),
('Fresh Pasta Penne 400g', 'Chilled', 'g', '400g'),
('Fresh Pasta Spaghetti 400g', 'Chilled', 'g', '400g'),
('Hummus 200g', 'Chilled', 'g', '200g'),
('Guacamole 150g', 'Chilled', 'g', '150g'),
('Coleslaw 300g', 'Chilled', 'g', '300g'),
('Ready Meal Lasagne', 'Chilled', 'g', '400g'),
('Ready Meal Chicken Tikka', 'Chilled', 'g', '400g'),
('Ready Meal Spag Bol', 'Chilled', 'g', '400g'),
('Quiche Lorraine', 'Chilled', 'g', '400g')
ON CONFLICT (canonical_name) DO NOTHING;

-- CLEANING & HOUSEHOLD
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Washing Up Liquid 500ml', 'Household', 'ml', '500ml'),
('Washing Liquid 1L', 'Household', 'litre', '1L'),
('Dishwasher Tablets 30 Pack', 'Household', 'pack', '30'),
('Bleach 750ml', 'Household', 'ml', '750ml'),
('Multi Surface Spray', 'Household', 'ml', '500ml'),
('Kitchen Roll 4 Pack', 'Household', 'pack', '4'),
('Toilet Roll 9 Pack', 'Household', 'pack', '9'),
('Bin Bags 20 Pack', 'Household', 'pack', '20'),
('Cling Film', 'Household', 'each', 'each'),
('Tin Foil', 'Household', 'each', 'each'),
('Sandwich Bags 25 Pack', 'Household', 'pack', '25'),
('Sponge Scourers 5 Pack', 'Household', 'pack', '5')
ON CONFLICT (canonical_name) DO NOTHING;

-- PERSONAL CARE
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Shampoo 400ml', 'Personal Care', 'ml', '400ml'),
('Conditioner 400ml', 'Personal Care', 'ml', '400ml'),
('Body Wash 250ml', 'Personal Care', 'ml', '250ml'),
('Deodorant Roll-On', 'Personal Care', 'ml', '50ml'),
('Toothpaste 75ml', 'Personal Care', 'ml', '75ml'),
('Toothbrush', 'Personal Care', 'each', 'each'),
('Handwash 250ml', 'Personal Care', 'ml', '250ml'),
('Moisturiser Face 50ml', 'Personal Care', 'ml', '50ml'),
('Shower Gel 500ml', 'Personal Care', 'ml', '500ml'),
('Shaving Foam 250ml', 'Personal Care', 'ml', '250ml')
ON CONFLICT (canonical_name) DO NOTHING;

-- BABY & KIDS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Nappies Size 4 44 Pack', 'Baby', 'pack', '44'),
('Baby Wipes 72 Pack', 'Baby', 'pack', '72'),
('Baby Formula Stage 1 900g', 'Baby', 'g', '900g'),
('Baby Food Puree 4 Month', 'Baby', 'g', '120g')
ON CONFLICT (canonical_name) DO NOTHING;

-- PET CARE
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Dog Food Dry 2kg', 'Pet Care', 'kg', '2kg'),
('Cat Food Wet 4 Pack', 'Pet Care', 'pack', '4'),
('Cat Food Dry 1.5kg', 'Pet Care', 'kg', '1.5kg')
ON CONFLICT (canonical_name) DO NOTHING;


-- ============================================================
-- Now insert store_products rows for new products
-- url_status = 'pending' so scraper picks them up
-- store_url = search URL (scraper will resolve to product page)
-- ============================================================

-- Insert store_products for all NEW products × 3 stores
-- Skips any product already having a row for that store (safe to re-run)
INSERT INTO store_products (product_id, store, store_product_name, store_url, url_status)
SELECT
  p.id,
  s.store,
  p.canonical_name,
  CASE s.store
    WHEN 'tesco'     THEN 'https://www.tesco.ie/groceries/en-IE/search?query=' || replace(p.canonical_name, ' ', '+')
    WHEN 'dunnes'    THEN 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/search?q=' || replace(p.canonical_name, ' ', '+')
    WHEN 'supervalu' THEN 'https://shop.supervalu.ie/shopping/search-results?q=' || replace(p.canonical_name, ' ', '+')
  END as store_url,
  'pending' as url_status
FROM products p
CROSS JOIN (VALUES ('tesco'), ('dunnes'), ('supervalu')) AS s(store)
WHERE NOT EXISTS (
  SELECT 1 FROM store_products sp2
  WHERE sp2.product_id = p.id AND sp2.store = s.store
);
