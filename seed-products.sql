-- Seed data: 56 canonical products with 4-store mappings
-- Run AFTER creating the tables from schema.sql

-- DAIRY
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Fresh Whole Milk 2L', 'Dairy', 'litre', '2L'),
('Fresh Low Fat Milk 2L', 'Dairy', 'litre', '2L'),
('Butter Salted 250g', 'Dairy', 'g', '250g'),
('Butter Unsalted 250g', 'Dairy', 'g', '250g'),
('Cheddar Cheese Block', 'Dairy', 'g', '200-250g'),
('Greek Style Yogurt Plain', 'Dairy', 'g', '500g'),
('Free Range Eggs 12', 'Dairy', 'pack', '12'),
('Oat Milk Unsweetened', 'Dairy Alternatives', 'litre', '1L');

-- BAKERY & BREAKFAST
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('White Pan Bread Standard', 'Bakery', 'loaf', '800g'),
('Brown Pan Bread Standard', 'Bakery', 'loaf', '800g'),
('Porridge Oats 1kg', 'Breakfast', 'kg', '1kg'),
('Cornflakes', 'Breakfast', 'g', '500g');

-- SPREADS & PRESERVES
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Honey Clear', 'Spreads', 'g', '340g'),
('Strawberry Jam', 'Spreads', 'g', '340g');

-- PASTA, RICE & GRAINS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Penne Pasta 500g', 'Pasta & Rice', 'g', '500g'),
('Spaghetti Pasta 500g', 'Pasta & Rice', 'g', '500g'),
('Long Grain Rice 1kg', 'Pasta & Rice', 'kg', '1kg'),
('Basmati Rice 1kg', 'Pasta & Rice', 'kg', '1kg');

-- TINNED & JARRED
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Chopped Tomatoes 400g', 'Tinned', 'g', '400g'),
('Passata', 'Tinned', 'g', '500g'),
('Baked Beans', 'Tinned', 'g', '415g'),
('Tuna in Water', 'Tinned', 'g', '145g');

-- SAUCES & CONDIMENTS
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Tomato Ketchup', 'Condiments', 'g', '460g'),
('Mayonnaise', 'Condiments', 'g', '400g'),
('Soy Sauce', 'Condiments', 'ml', '150ml'),
('Curry Sauce Mild', 'Condiments', 'g', '440g');

-- OILS & COOKING
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Olive Oil Extra Virgin 500ml', 'Oils', 'ml', '500ml'),
('Vegetable Oil', 'Oils', 'litre', '1L');

-- BAKING
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Plain Flour 1kg', 'Baking', 'kg', '1kg'),
('Self Raising Flour 1kg', 'Baking', 'kg', '1kg'),
('Granulated Sugar 1kg', 'Baking', 'kg', '1kg');

-- STOCK & SEASONING
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Chicken Stock Cubes', 'Stock', 'pack', '12'),
('Vegetable Stock Cubes', 'Stock', 'pack', '12'),
('Table Salt', 'Seasoning', 'g', '750g'),
('Black Pepper Ground', 'Seasoning', 'g', '50g');

-- MEAT & FISH
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Chicken Breast Fillets', 'Meat', 'kg', '500g'),
('Chicken Thighs', 'Meat', 'kg', '500g'),
('Minced Beef', 'Meat', 'g', '500g'),
('Pork Sausages', 'Meat', 'pack', '454g'),
('Bacon Rashers Smoked', 'Meat', 'g', '200g'),
('Salmon Fillets', 'Fish', 'g', '240g'),
('White Fish Fillets (Cod)', 'Fish', 'g', '280g');

-- VEGETABLES
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Potatoes 2kg', 'Vegetables', 'kg', '2kg'),
('Onions 1kg', 'Vegetables', 'kg', '1kg'),
('Carrots 1kg', 'Vegetables', 'kg', '1kg'),
('Tomatoes Vine', 'Vegetables', 'g', '400g'),
('Cucumber', 'Vegetables', 'each', '1'),
('Bell Peppers 3 Pack', 'Vegetables', 'pack', '3'),
('Broccoli', 'Vegetables', 'each', '1'),
('Mushrooms', 'Vegetables', 'g', '250g'),
('Iceberg Lettuce', 'Vegetables', 'each', '1'),
('Garlic Bulbs', 'Vegetables', 'each', '1');

-- FRUIT
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Bananas Loose', 'Fruit', 'kg', '1kg'),
('Apples 6 Pack', 'Fruit', 'pack', '6'),
('Oranges', 'Fruit', 'pack', '4-6');

-- FROZEN
INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Frozen Peas', 'Frozen', 'g', '900g'),
('Frozen Chips', 'Frozen', 'kg', '1.5kg');

-- Now insert store mappings for each product
-- DAIRY MAPPINGS
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Fresh Irish Whole Milk 2L', 'Tesco', true FROM products WHERE canonical_name = 'Fresh Whole Milk 2L'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Fresh Irish Whole Milk 2L', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Fresh Whole Milk 2L'
UNION ALL SELECT id, 'supervalu', 'SuperValu Fresh Irish Whole Milk 2L', 'SuperValu', true FROM products WHERE canonical_name = 'Fresh Whole Milk 2L'
UNION ALL SELECT id, 'lidl', 'Glenstal Fresh Irish Whole Milk 2L', 'Glenstal', true FROM products WHERE canonical_name = 'Fresh Whole Milk 2L';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Fresh Irish Low Fat Milk 2L', 'Tesco', true FROM products WHERE canonical_name = 'Fresh Low Fat Milk 2L'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Fresh Irish Low Fat Milk 2L', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Fresh Low Fat Milk 2L'
UNION ALL SELECT id, 'supervalu', 'SuperValu Fresh Irish Low Fat Milk 2L', 'SuperValu', true FROM products WHERE canonical_name = 'Fresh Low Fat Milk 2L'
UNION ALL SELECT id, 'lidl', 'Glenstal Fresh Irish Low Fat Milk 2L', 'Glenstal', true FROM products WHERE canonical_name = 'Fresh Low Fat Milk 2L';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Kerrygold Salted Butter 250g', 'Kerrygold', false FROM products WHERE canonical_name = 'Butter Salted 250g'
UNION ALL SELECT id, 'dunnes', 'Kerrygold Salted Butter 250g', 'Kerrygold', false FROM products WHERE canonical_name = 'Butter Salted 250g'
UNION ALL SELECT id, 'supervalu', 'Kerrygold Salted Butter 250g', 'Kerrygold', false FROM products WHERE canonical_name = 'Butter Salted 250g'
UNION ALL SELECT id, 'lidl', 'Glenstal Irish Creamery Butter Salted 250g', 'Glenstal', true FROM products WHERE canonical_name = 'Butter Salted 250g';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Kerrygold Unsalted Butter 250g', 'Kerrygold', false FROM products WHERE canonical_name = 'Butter Unsalted 250g'
UNION ALL SELECT id, 'dunnes', 'Kerrygold Unsalted Butter 250g', 'Kerrygold', false FROM products WHERE canonical_name = 'Butter Unsalted 250g'
UNION ALL SELECT id, 'supervalu', 'Kerrygold Unsalted Butter 250g', 'Kerrygold', false FROM products WHERE canonical_name = 'Butter Unsalted 250g'
UNION ALL SELECT id, 'lidl', 'Glenstal Irish Creamery Butter Unsalted 250g', 'Glenstal', true FROM products WHERE canonical_name = 'Butter Unsalted 250g';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Irish Cheddar 250g', 'Tesco', true FROM products WHERE canonical_name = 'Cheddar Cheese Block'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Irish Cheddar 200g', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Cheddar Cheese Block'
UNION ALL SELECT id, 'supervalu', 'SuperValu Irish Cheddar 200g', 'SuperValu', true FROM products WHERE canonical_name = 'Cheddar Cheese Block'
UNION ALL SELECT id, 'lidl', 'Milbona Irish Cheddar 200g', 'Milbona', true FROM products WHERE canonical_name = 'Cheddar Cheese Block';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Greek Style Yogurt 500g', 'Tesco', true FROM products WHERE canonical_name = 'Greek Style Yogurt Plain'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Greek Style Yogurt 500g', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Greek Style Yogurt Plain'
UNION ALL SELECT id, 'supervalu', 'SuperValu Greek Style Yogurt 500g', 'SuperValu', true FROM products WHERE canonical_name = 'Greek Style Yogurt Plain'
UNION ALL SELECT id, 'lidl', 'Milbona Greek Style Yogurt 500g', 'Milbona', true FROM products WHERE canonical_name = 'Greek Style Yogurt Plain';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Free Range Eggs 12 Pack', 'Tesco', true FROM products WHERE canonical_name = 'Free Range Eggs 12'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Free Range Eggs 12', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Free Range Eggs 12'
UNION ALL SELECT id, 'supervalu', 'SuperValu Free Range Eggs 12', 'SuperValu', true FROM products WHERE canonical_name = 'Free Range Eggs 12'
UNION ALL SELECT id, 'lidl', 'Golden Sun Free Range Eggs 12', 'Golden Sun', true FROM products WHERE canonical_name = 'Free Range Eggs 12';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Alpro Oat Unsweetened 1L', 'Alpro', false FROM products WHERE canonical_name = 'Oat Milk Unsweetened'
UNION ALL SELECT id, 'dunnes', 'Alpro Oat Unsweetened 1L', 'Alpro', false FROM products WHERE canonical_name = 'Oat Milk Unsweetened'
UNION ALL SELECT id, 'supervalu', 'Alpro Oat Unsweetened 1L', 'Alpro', false FROM products WHERE canonical_name = 'Oat Milk Unsweetened'
UNION ALL SELECT id, 'lidl', 'Vemondo Oat Drink Unsweetened', 'Vemondo', true FROM products WHERE canonical_name = 'Oat Milk Unsweetened';

-- BAKERY & BREAKFAST
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Brennans White Pan', 'Brennans', false FROM products WHERE canonical_name = 'White Pan Bread Standard'
UNION ALL SELECT id, 'dunnes', 'Brennans White Pan', 'Brennans', false FROM products WHERE canonical_name = 'White Pan Bread Standard'
UNION ALL SELECT id, 'supervalu', 'Brennans White Pan', 'Brennans', false FROM products WHERE canonical_name = 'White Pan Bread Standard'
UNION ALL SELECT id, 'lidl', 'Rowan Hill White Pan', 'Rowan Hill', true FROM products WHERE canonical_name = 'White Pan Bread Standard';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Brennans Brown Pan', 'Brennans', false FROM products WHERE canonical_name = 'Brown Pan Bread Standard'
UNION ALL SELECT id, 'dunnes', 'Brennans Brown Pan', 'Brennans', false FROM products WHERE canonical_name = 'Brown Pan Bread Standard'
UNION ALL SELECT id, 'supervalu', 'Brennans Brown Pan', 'Brennans', false FROM products WHERE canonical_name = 'Brown Pan Bread Standard'
UNION ALL SELECT id, 'lidl', 'Rowan Hill Brown Pan', 'Rowan Hill', true FROM products WHERE canonical_name = 'Brown Pan Bread Standard';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Porridge Oats 1kg', 'Tesco', true FROM products WHERE canonical_name = 'Porridge Oats 1kg'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Porridge Oats 1kg', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Porridge Oats 1kg'
UNION ALL SELECT id, 'supervalu', 'SuperValu Porridge Oats 1kg', 'SuperValu', true FROM products WHERE canonical_name = 'Porridge Oats 1kg'
UNION ALL SELECT id, 'lidl', 'Crownfield Porridge Oats 1kg', 'Crownfield', true FROM products WHERE canonical_name = 'Porridge Oats 1kg';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Kelloggs Cornflakes 500g', 'Kelloggs', false FROM products WHERE canonical_name = 'Cornflakes'
UNION ALL SELECT id, 'dunnes', 'Kelloggs Cornflakes 500g', 'Kelloggs', false FROM products WHERE canonical_name = 'Cornflakes'
UNION ALL SELECT id, 'supervalu', 'Kelloggs Cornflakes 500g', 'Kelloggs', false FROM products WHERE canonical_name = 'Cornflakes'
UNION ALL SELECT id, 'lidl', 'Crownfield Cornflakes', 'Crownfield', true FROM products WHERE canonical_name = 'Cornflakes';

-- SPREADS
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Clear Honey', 'Tesco', true FROM products WHERE canonical_name = 'Honey Clear'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Clear Honey', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Honey Clear'
UNION ALL SELECT id, 'supervalu', 'SuperValu Clear Honey', 'SuperValu', true FROM products WHERE canonical_name = 'Honey Clear'
UNION ALL SELECT id, 'lidl', 'Maribel Clear Honey', 'Maribel', true FROM products WHERE canonical_name = 'Honey Clear';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Strawberry Jam', 'Tesco', true FROM products WHERE canonical_name = 'Strawberry Jam'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Strawberry Jam', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Strawberry Jam'
UNION ALL SELECT id, 'supervalu', 'SuperValu Strawberry Jam', 'SuperValu', true FROM products WHERE canonical_name = 'Strawberry Jam'
UNION ALL SELECT id, 'lidl', 'Maribel Strawberry Jam', 'Maribel', true FROM products WHERE canonical_name = 'Strawberry Jam';

-- PASTA & RICE
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Penne Pasta 500g', 'Tesco', true FROM products WHERE canonical_name = 'Penne Pasta 500g'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Penne Pasta 500g', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Penne Pasta 500g'
UNION ALL SELECT id, 'supervalu', 'SuperValu Penne Pasta 500g', 'SuperValu', true FROM products WHERE canonical_name = 'Penne Pasta 500g'
UNION ALL SELECT id, 'lidl', 'Combino Penne Pasta 500g', 'Combino', true FROM products WHERE canonical_name = 'Penne Pasta 500g';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Spaghetti 500g', 'Tesco', true FROM products WHERE canonical_name = 'Spaghetti Pasta 500g'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Spaghetti 500g', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Spaghetti Pasta 500g'
UNION ALL SELECT id, 'supervalu', 'SuperValu Spaghetti 500g', 'SuperValu', true FROM products WHERE canonical_name = 'Spaghetti Pasta 500g'
UNION ALL SELECT id, 'lidl', 'Combino Spaghetti 500g', 'Combino', true FROM products WHERE canonical_name = 'Spaghetti Pasta 500g';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Long Grain Rice 1kg', 'Tesco', true FROM products WHERE canonical_name = 'Long Grain Rice 1kg'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Long Grain Rice 1kg', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Long Grain Rice 1kg'
UNION ALL SELECT id, 'supervalu', 'SuperValu Long Grain Rice 1kg', 'SuperValu', true FROM products WHERE canonical_name = 'Long Grain Rice 1kg'
UNION ALL SELECT id, 'lidl', 'Golden Sun Long Grain Rice 1kg', 'Golden Sun', true FROM products WHERE canonical_name = 'Long Grain Rice 1kg';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Basmati Rice 1kg', 'Tesco', true FROM products WHERE canonical_name = 'Basmati Rice 1kg'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Basmati Rice 1kg', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Basmati Rice 1kg'
UNION ALL SELECT id, 'supervalu', 'SuperValu Basmati Rice 1kg', 'SuperValu', true FROM products WHERE canonical_name = 'Basmati Rice 1kg'
UNION ALL SELECT id, 'lidl', 'Golden Sun Basmati Rice 1kg', 'Golden Sun', true FROM products WHERE canonical_name = 'Basmati Rice 1kg';

-- TINNED
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Chopped Tomatoes 400g', 'Tesco', true FROM products WHERE canonical_name = 'Chopped Tomatoes 400g'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Chopped Tomatoes 400g', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Chopped Tomatoes 400g'
UNION ALL SELECT id, 'supervalu', 'SuperValu Chopped Tomatoes 400g', 'SuperValu', true FROM products WHERE canonical_name = 'Chopped Tomatoes 400g'
UNION ALL SELECT id, 'lidl', 'Freshona Chopped Tomatoes 400g', 'Freshona', true FROM products WHERE canonical_name = 'Chopped Tomatoes 400g';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Tomato Passata', 'Tesco', true FROM products WHERE canonical_name = 'Passata'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Tomato Passata', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Passata'
UNION ALL SELECT id, 'supervalu', 'SuperValu Tomato Passata', 'SuperValu', true FROM products WHERE canonical_name = 'Passata'
UNION ALL SELECT id, 'lidl', 'Freshona Tomato Passata', 'Freshona', true FROM products WHERE canonical_name = 'Passata';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Heinz Baked Beans', 'Heinz', false FROM products WHERE canonical_name = 'Baked Beans'
UNION ALL SELECT id, 'dunnes', 'Heinz Baked Beans', 'Heinz', false FROM products WHERE canonical_name = 'Baked Beans'
UNION ALL SELECT id, 'supervalu', 'Heinz Baked Beans', 'Heinz', false FROM products WHERE canonical_name = 'Baked Beans'
UNION ALL SELECT id, 'lidl', 'Batts Baked Beans', 'Batts', true FROM products WHERE canonical_name = 'Baked Beans';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'John West Tuna in Water', 'John West', false FROM products WHERE canonical_name = 'Tuna in Water'
UNION ALL SELECT id, 'dunnes', 'John West Tuna in Water', 'John West', false FROM products WHERE canonical_name = 'Tuna in Water'
UNION ALL SELECT id, 'supervalu', 'John West Tuna in Water', 'John West', false FROM products WHERE canonical_name = 'Tuna in Water'
UNION ALL SELECT id, 'lidl', 'Nixe Tuna in Water', 'Nixe', true FROM products WHERE canonical_name = 'Tuna in Water';

-- CONDIMENTS
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Heinz Tomato Ketchup 460g', 'Heinz', false FROM products WHERE canonical_name = 'Tomato Ketchup'
UNION ALL SELECT id, 'dunnes', 'Heinz Tomato Ketchup 460g', 'Heinz', false FROM products WHERE canonical_name = 'Tomato Ketchup'
UNION ALL SELECT id, 'supervalu', 'Heinz Tomato Ketchup 460g', 'Heinz', false FROM products WHERE canonical_name = 'Tomato Ketchup'
UNION ALL SELECT id, 'lidl', 'Batts Tomato Ketchup', 'Batts', true FROM products WHERE canonical_name = 'Tomato Ketchup';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Hellmanns Real Mayonnaise', 'Hellmanns', false FROM products WHERE canonical_name = 'Mayonnaise'
UNION ALL SELECT id, 'dunnes', 'Hellmanns Real Mayonnaise', 'Hellmanns', false FROM products WHERE canonical_name = 'Mayonnaise'
UNION ALL SELECT id, 'supervalu', 'Hellmanns Real Mayonnaise', 'Hellmanns', false FROM products WHERE canonical_name = 'Mayonnaise'
UNION ALL SELECT id, 'lidl', 'Batts Real Mayonnaise', 'Batts', true FROM products WHERE canonical_name = 'Mayonnaise';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Soy Sauce', 'Tesco', true FROM products WHERE canonical_name = 'Soy Sauce'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Soy Sauce', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Soy Sauce'
UNION ALL SELECT id, 'supervalu', 'SuperValu Soy Sauce', 'SuperValu', true FROM products WHERE canonical_name = 'Soy Sauce'
UNION ALL SELECT id, 'lidl', 'Kania Soy Sauce', 'Kania', true FROM products WHERE canonical_name = 'Soy Sauce';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Mild Curry Sauce', 'Tesco', true FROM products WHERE canonical_name = 'Curry Sauce Mild'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Mild Curry Sauce', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Curry Sauce Mild'
UNION ALL SELECT id, 'supervalu', 'SuperValu Mild Curry Sauce', 'SuperValu', true FROM products WHERE canonical_name = 'Curry Sauce Mild'
UNION ALL SELECT id, 'lidl', 'Kania Mild Curry Sauce', 'Kania', true FROM products WHERE canonical_name = 'Curry Sauce Mild';

-- OILS
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Extra Virgin Olive Oil 500ml', 'Tesco', true FROM products WHERE canonical_name = 'Olive Oil Extra Virgin 500ml'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Extra Virgin Olive Oil 500ml', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Olive Oil Extra Virgin 500ml'
UNION ALL SELECT id, 'supervalu', 'SuperValu Extra Virgin Olive Oil 500ml', 'SuperValu', true FROM products WHERE canonical_name = 'Olive Oil Extra Virgin 500ml'
UNION ALL SELECT id, 'lidl', 'Primadonna Extra Virgin Olive Oil 500ml', 'Primadonna', true FROM products WHERE canonical_name = 'Olive Oil Extra Virgin 500ml';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Vegetable Oil', 'Tesco', true FROM products WHERE canonical_name = 'Vegetable Oil'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Vegetable Oil', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Vegetable Oil'
UNION ALL SELECT id, 'supervalu', 'SuperValu Vegetable Oil', 'SuperValu', true FROM products WHERE canonical_name = 'Vegetable Oil'
UNION ALL SELECT id, 'lidl', 'Vita Dor Vegetable Oil', 'Vita Dor', true FROM products WHERE canonical_name = 'Vegetable Oil';

-- BAKING
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Plain Flour 1kg', 'Tesco', true FROM products WHERE canonical_name = 'Plain Flour 1kg'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Plain Flour 1kg', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Plain Flour 1kg'
UNION ALL SELECT id, 'supervalu', 'SuperValu Plain Flour 1kg', 'SuperValu', true FROM products WHERE canonical_name = 'Plain Flour 1kg'
UNION ALL SELECT id, 'lidl', 'McDonnells Plain Flour', 'McDonnells', true FROM products WHERE canonical_name = 'Plain Flour 1kg';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Self Raising Flour 1kg', 'Tesco', true FROM products WHERE canonical_name = 'Self Raising Flour 1kg'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Self Raising Flour 1kg', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Self Raising Flour 1kg'
UNION ALL SELECT id, 'supervalu', 'SuperValu Self Raising Flour 1kg', 'SuperValu', true FROM products WHERE canonical_name = 'Self Raising Flour 1kg'
UNION ALL SELECT id, 'lidl', 'McDonnells Self Raising Flour', 'McDonnells', true FROM products WHERE canonical_name = 'Self Raising Flour 1kg';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Granulated Sugar 1kg', 'Tesco', true FROM products WHERE canonical_name = 'Granulated Sugar 1kg'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Granulated Sugar 1kg', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Granulated Sugar 1kg'
UNION ALL SELECT id, 'supervalu', 'SuperValu Granulated Sugar 1kg', 'SuperValu', true FROM products WHERE canonical_name = 'Granulated Sugar 1kg'
UNION ALL SELECT id, 'lidl', 'Belbake Granulated Sugar 1kg', 'Belbake', true FROM products WHERE canonical_name = 'Granulated Sugar 1kg';

-- STOCK & SEASONING
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Knorr Chicken Stock Cubes', 'Knorr', false FROM products WHERE canonical_name = 'Chicken Stock Cubes'
UNION ALL SELECT id, 'dunnes', 'Knorr Chicken Stock Cubes', 'Knorr', false FROM products WHERE canonical_name = 'Chicken Stock Cubes'
UNION ALL SELECT id, 'supervalu', 'Knorr Chicken Stock Cubes', 'Knorr', false FROM products WHERE canonical_name = 'Chicken Stock Cubes'
UNION ALL SELECT id, 'lidl', 'Kania Chicken Stock Cubes', 'Kania', true FROM products WHERE canonical_name = 'Chicken Stock Cubes';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Knorr Vegetable Stock Cubes', 'Knorr', false FROM products WHERE canonical_name = 'Vegetable Stock Cubes'
UNION ALL SELECT id, 'dunnes', 'Knorr Vegetable Stock Cubes', 'Knorr', false FROM products WHERE canonical_name = 'Vegetable Stock Cubes'
UNION ALL SELECT id, 'supervalu', 'Knorr Vegetable Stock Cubes', 'Knorr', false FROM products WHERE canonical_name = 'Vegetable Stock Cubes'
UNION ALL SELECT id, 'lidl', 'Kania Vegetable Stock Cubes', 'Kania', true FROM products WHERE canonical_name = 'Vegetable Stock Cubes';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Saxa Table Salt', 'Saxa', false FROM products WHERE canonical_name = 'Table Salt'
UNION ALL SELECT id, 'dunnes', 'Saxa Table Salt', 'Saxa', false FROM products WHERE canonical_name = 'Table Salt'
UNION ALL SELECT id, 'supervalu', 'Saxa Table Salt', 'Saxa', false FROM products WHERE canonical_name = 'Table Salt'
UNION ALL SELECT id, 'lidl', 'Kania Table Salt', 'Kania', true FROM products WHERE canonical_name = 'Table Salt';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Schwartz Ground Black Pepper', 'Schwartz', false FROM products WHERE canonical_name = 'Black Pepper Ground'
UNION ALL SELECT id, 'dunnes', 'Schwartz Ground Black Pepper', 'Schwartz', false FROM products WHERE canonical_name = 'Black Pepper Ground'
UNION ALL SELECT id, 'supervalu', 'Schwartz Ground Black Pepper', 'Schwartz', false FROM products WHERE canonical_name = 'Black Pepper Ground'
UNION ALL SELECT id, 'lidl', 'Kania Ground Black Pepper', 'Kania', true FROM products WHERE canonical_name = 'Black Pepper Ground';

-- MEAT
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Irish Chicken Breast Fillets', 'Tesco', true FROM products WHERE canonical_name = 'Chicken Breast Fillets'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Irish Chicken Breast Fillets', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Chicken Breast Fillets'
UNION ALL SELECT id, 'supervalu', 'SuperValu Irish Chicken Breast Fillets', 'SuperValu', true FROM products WHERE canonical_name = 'Chicken Breast Fillets'
UNION ALL SELECT id, 'lidl', 'Birchwood Irish Chicken Breast Fillets', 'Birchwood', true FROM products WHERE canonical_name = 'Chicken Breast Fillets';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Irish Chicken Thighs', 'Tesco', true FROM products WHERE canonical_name = 'Chicken Thighs'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Irish Chicken Thighs', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Chicken Thighs'
UNION ALL SELECT id, 'supervalu', 'SuperValu Irish Chicken Thighs', 'SuperValu', true FROM products WHERE canonical_name = 'Chicken Thighs'
UNION ALL SELECT id, 'lidl', 'Birchwood Irish Chicken Thighs', 'Birchwood', true FROM products WHERE canonical_name = 'Chicken Thighs';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Irish Beef Mince', 'Tesco', true FROM products WHERE canonical_name = 'Minced Beef'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Irish Beef Mince', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Minced Beef'
UNION ALL SELECT id, 'supervalu', 'SuperValu Irish Beef Mince', 'SuperValu', true FROM products WHERE canonical_name = 'Minced Beef'
UNION ALL SELECT id, 'lidl', 'Birchwood Irish Beef Mince', 'Birchwood', true FROM products WHERE canonical_name = 'Minced Beef';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Irish Pork Sausages', 'Tesco', true FROM products WHERE canonical_name = 'Pork Sausages'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Irish Pork Sausages', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Pork Sausages'
UNION ALL SELECT id, 'supervalu', 'SuperValu Irish Pork Sausages', 'SuperValu', true FROM products WHERE canonical_name = 'Pork Sausages'
UNION ALL SELECT id, 'lidl', 'Birchwood Irish Pork Sausages', 'Birchwood', true FROM products WHERE canonical_name = 'Pork Sausages';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Smoked Bacon Rashers', 'Tesco', true FROM products WHERE canonical_name = 'Bacon Rashers Smoked'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Smoked Bacon Rashers', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Bacon Rashers Smoked'
UNION ALL SELECT id, 'supervalu', 'SuperValu Smoked Bacon Rashers', 'SuperValu', true FROM products WHERE canonical_name = 'Bacon Rashers Smoked'
UNION ALL SELECT id, 'lidl', 'Birchwood Smoked Bacon Rashers', 'Birchwood', true FROM products WHERE canonical_name = 'Bacon Rashers Smoked';

-- FISH
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Irish Salmon Fillets', 'Tesco', true FROM products WHERE canonical_name = 'Salmon Fillets'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Salmon Fillets', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Salmon Fillets'
UNION ALL SELECT id, 'supervalu', 'SuperValu Salmon Fillets', 'SuperValu', true FROM products WHERE canonical_name = 'Salmon Fillets'
UNION ALL SELECT id, 'lidl', 'Ocean Sea Salmon Fillets', 'Ocean Sea', true FROM products WHERE canonical_name = 'Salmon Fillets';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Cod Fillets', 'Tesco', true FROM products WHERE canonical_name = 'White Fish Fillets (Cod)'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Cod Fillets', 'Dunnes Stores', true FROM products WHERE canonical_name = 'White Fish Fillets (Cod)'
UNION ALL SELECT id, 'supervalu', 'SuperValu Cod Fillets', 'SuperValu', true FROM products WHERE canonical_name = 'White Fish Fillets (Cod)'
UNION ALL SELECT id, 'lidl', 'Ocean Sea Cod Fillets', 'Ocean Sea', true FROM products WHERE canonical_name = 'White Fish Fillets (Cod)';

-- VEGETABLES
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Rooster Potatoes 2kg', 'Tesco', true FROM products WHERE canonical_name = 'Potatoes 2kg'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Rooster Potatoes 2kg', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Potatoes 2kg'
UNION ALL SELECT id, 'supervalu', 'SuperValu Rooster Potatoes 2kg', 'SuperValu', true FROM products WHERE canonical_name = 'Potatoes 2kg'
UNION ALL SELECT id, 'lidl', 'Harvest Basket Rooster Potatoes 2kg', 'Harvest Basket', true FROM products WHERE canonical_name = 'Potatoes 2kg';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Brown Onions 1kg', 'Tesco', true FROM products WHERE canonical_name = 'Onions 1kg'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Onions 1kg', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Onions 1kg'
UNION ALL SELECT id, 'supervalu', 'SuperValu Onions 1kg', 'SuperValu', true FROM products WHERE canonical_name = 'Onions 1kg'
UNION ALL SELECT id, 'lidl', 'Harvest Basket Onions 1kg', 'Harvest Basket', true FROM products WHERE canonical_name = 'Onions 1kg';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Carrots 1kg', 'Tesco', true FROM products WHERE canonical_name = 'Carrots 1kg'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Carrots 1kg', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Carrots 1kg'
UNION ALL SELECT id, 'supervalu', 'SuperValu Carrots 1kg', 'SuperValu', true FROM products WHERE canonical_name = 'Carrots 1kg'
UNION ALL SELECT id, 'lidl', 'Harvest Basket Carrots 1kg', 'Harvest Basket', true FROM products WHERE canonical_name = 'Carrots 1kg';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Vine Tomatoes', 'Tesco', true FROM products WHERE canonical_name = 'Tomatoes Vine'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Tomatoes', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Tomatoes Vine'
UNION ALL SELECT id, 'supervalu', 'SuperValu Vine Tomatoes', 'SuperValu', true FROM products WHERE canonical_name = 'Tomatoes Vine'
UNION ALL SELECT id, 'lidl', 'Harvest Basket Tomatoes', 'Harvest Basket', true FROM products WHERE canonical_name = 'Tomatoes Vine';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Cucumber', 'Tesco', true FROM products WHERE canonical_name = 'Cucumber'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Cucumber', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Cucumber'
UNION ALL SELECT id, 'supervalu', 'SuperValu Cucumber', 'SuperValu', true FROM products WHERE canonical_name = 'Cucumber'
UNION ALL SELECT id, 'lidl', 'Cucumber', NULL, false FROM products WHERE canonical_name = 'Cucumber';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Mixed Peppers 3 Pack', 'Tesco', true FROM products WHERE canonical_name = 'Bell Peppers 3 Pack'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Mixed Peppers 3 Pack', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Bell Peppers 3 Pack'
UNION ALL SELECT id, 'supervalu', 'SuperValu Mixed Peppers 3 Pack', 'SuperValu', true FROM products WHERE canonical_name = 'Bell Peppers 3 Pack'
UNION ALL SELECT id, 'lidl', 'Mixed Peppers 3 Pack', NULL, false FROM products WHERE canonical_name = 'Bell Peppers 3 Pack';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Broccoli', 'Tesco', true FROM products WHERE canonical_name = 'Broccoli'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Broccoli', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Broccoli'
UNION ALL SELECT id, 'supervalu', 'SuperValu Broccoli', 'SuperValu', true FROM products WHERE canonical_name = 'Broccoli'
UNION ALL SELECT id, 'lidl', 'Broccoli', NULL, false FROM products WHERE canonical_name = 'Broccoli';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Mushrooms', 'Tesco', true FROM products WHERE canonical_name = 'Mushrooms'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Mushrooms', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Mushrooms'
UNION ALL SELECT id, 'supervalu', 'SuperValu Mushrooms', 'SuperValu', true FROM products WHERE canonical_name = 'Mushrooms'
UNION ALL SELECT id, 'lidl', 'Mushrooms', NULL, false FROM products WHERE canonical_name = 'Mushrooms';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Iceberg Lettuce', 'Tesco', true FROM products WHERE canonical_name = 'Iceberg Lettuce'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Iceberg Lettuce', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Iceberg Lettuce'
UNION ALL SELECT id, 'supervalu', 'SuperValu Iceberg Lettuce', 'SuperValu', true FROM products WHERE canonical_name = 'Iceberg Lettuce'
UNION ALL SELECT id, 'lidl', 'Iceberg Lettuce', NULL, false FROM products WHERE canonical_name = 'Iceberg Lettuce';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Garlic', 'Tesco', true FROM products WHERE canonical_name = 'Garlic Bulbs'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Garlic', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Garlic Bulbs'
UNION ALL SELECT id, 'supervalu', 'SuperValu Garlic', 'SuperValu', true FROM products WHERE canonical_name = 'Garlic Bulbs'
UNION ALL SELECT id, 'lidl', 'Garlic', NULL, false FROM products WHERE canonical_name = 'Garlic Bulbs';

-- FRUIT
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Loose Bananas', 'Tesco', true FROM products WHERE canonical_name = 'Bananas Loose'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Bananas', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Bananas Loose'
UNION ALL SELECT id, 'supervalu', 'SuperValu Bananas', 'SuperValu', true FROM products WHERE canonical_name = 'Bananas Loose'
UNION ALL SELECT id, 'lidl', 'Loose Bananas', NULL, false FROM products WHERE canonical_name = 'Bananas Loose';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Eating Apples 6 Pack', 'Tesco', true FROM products WHERE canonical_name = 'Apples 6 Pack'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Apples 6 Pack', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Apples 6 Pack'
UNION ALL SELECT id, 'supervalu', 'SuperValu Apples 6 Pack', 'SuperValu', true FROM products WHERE canonical_name = 'Apples 6 Pack'
UNION ALL SELECT id, 'lidl', 'Harvest Basket Apples', 'Harvest Basket', true FROM products WHERE canonical_name = 'Apples 6 Pack';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Oranges', 'Tesco', true FROM products WHERE canonical_name = 'Oranges'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Oranges', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Oranges'
UNION ALL SELECT id, 'supervalu', 'SuperValu Oranges', 'SuperValu', true FROM products WHERE canonical_name = 'Oranges'
UNION ALL SELECT id, 'lidl', 'Oranges', NULL, false FROM products WHERE canonical_name = 'Oranges';

-- FROZEN
INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Garden Peas', 'Tesco', true FROM products WHERE canonical_name = 'Frozen Peas'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Garden Peas', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Frozen Peas'
UNION ALL SELECT id, 'supervalu', 'SuperValu Garden Peas', 'SuperValu', true FROM products WHERE canonical_name = 'Frozen Peas'
UNION ALL SELECT id, 'lidl', 'Freshona Garden Peas', 'Freshona', true FROM products WHERE canonical_name = 'Frozen Peas';

INSERT INTO store_products (product_id, store, store_product_name, brand, is_own_brand)
SELECT id, 'tesco', 'Tesco Straight Cut Chips', 'Tesco', true FROM products WHERE canonical_name = 'Frozen Chips'
UNION ALL SELECT id, 'dunnes', 'Dunnes Stores Chips', 'Dunnes Stores', true FROM products WHERE canonical_name = 'Frozen Chips'
UNION ALL SELECT id, 'supervalu', 'SuperValu Chips', 'SuperValu', true FROM products WHERE canonical_name = 'Frozen Chips'
UNION ALL SELECT id, 'lidl', 'Harvest Basket Chips', 'Harvest Basket', true FROM products WHERE canonical_name = 'Frozen Chips';
