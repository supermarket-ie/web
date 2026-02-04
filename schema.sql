-- Products catalog (canonical items)
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  default_unit TEXT,
  default_quantity TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Store-specific product mappings
CREATE TABLE IF NOT EXISTS store_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  store TEXT NOT NULL CHECK (store IN ('tesco', 'dunnes', 'supervalu', 'lidl')),
  store_product_name TEXT NOT NULL,
  brand TEXT,
  is_own_brand BOOLEAN DEFAULT FALSE,
  store_url TEXT,
  -- Nutrition per 100g/100ml
  calories_per_100 DECIMAL(8,1),
  protein_per_100 DECIMAL(8,1),
  carbs_per_100 DECIMAL(8,1),
  fat_per_100 DECIMAL(8,1),
  saturated_fat_per_100 DECIMAL(8,1),
  sugar_per_100 DECIMAL(8,1),
  fibre_per_100 DECIMAL(8,1),
  salt_per_100 DECIMAL(8,2),
  nutrition_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, store)
);

-- Price observations (historical)
CREATE TABLE IF NOT EXISTS price_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_product_id UUID REFERENCES store_products(id) ON DELETE CASCADE,
  price DECIMAL(8,2) NOT NULL,
  was_price DECIMAL(8,2),
  on_promotion BOOLEAN DEFAULT FALSE,
  price_per_unit DECIMAL(8,2),
  unit_for_comparison TEXT,
  observed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_store_products_store ON store_products(store);
CREATE INDEX IF NOT EXISTS idx_store_products_product ON store_products(product_id);
CREATE INDEX IF NOT EXISTS idx_price_obs_store_product ON price_observations(store_product_id);
CREATE INDEX IF NOT EXISTS idx_price_obs_date ON price_observations(observed_at DESC);

-- View: Latest prices per store product
CREATE OR REPLACE VIEW latest_prices AS
SELECT DISTINCT ON (store_product_id)
  store_product_id,
  price,
  was_price,
  on_promotion,
  price_per_unit,
  unit_for_comparison,
  observed_at
FROM price_observations
ORDER BY store_product_id, observed_at DESC;

-- View: Full product comparison
CREATE OR REPLACE VIEW product_comparison AS
SELECT 
  p.canonical_name,
  p.category,
  sp.store,
  sp.store_product_name,
  sp.brand,
  sp.is_own_brand,
  lp.price,
  lp.was_price,
  lp.on_promotion,
  lp.price_per_unit,
  lp.observed_at
FROM products p
JOIN store_products sp ON sp.product_id = p.id
LEFT JOIN latest_prices lp ON lp.store_product_id = sp.id;
