-- Additional household products
-- Run in Supabase SQL editor, then run scraper --resolve --store tesco/dunnes/supervalu

INSERT INTO products (canonical_name, category, default_unit, default_quantity) VALUES
('Hand Soap 250ml', 'Household', 'ml', '250ml'),
('Fabric Softener 1.5L', 'Household', 'litre', '1.5L'),
('Laundry Capsules 30 Pack', 'Household', 'pack', '30'),
('Toilet Cleaner 750ml', 'Household', 'ml', '750ml'),
('Glass Cleaner 500ml', 'Household', 'ml', '500ml'),
('Floor Cleaner 1L', 'Household', 'litre', '1L'),
('Kitchen Cleaner Spray 500ml', 'Household', 'ml', '500ml'),
('Bathroom Cleaner Spray 500ml', 'Household', 'ml', '500ml'),
('Antibacterial Wipes 40 Pack', 'Household', 'pack', '40'),
('Nappies Size 4 Pack', 'Baby', 'pack', 'pack'),
('Baby Wipes 64 Pack', 'Baby', 'pack', '64'),
('Hand Wash Refill 500ml', 'Household', 'ml', '500ml'),
('Dishcloth 5 Pack', 'Household', 'pack', '5'),
('Firelighters', 'Household', 'pack', 'pack'),
('Matches', 'Household', 'pack', 'pack'),
('Candles Pack', 'Household', 'pack', 'pack')
ON CONFLICT (canonical_name) DO NOTHING;

-- Insert store_products rows for the new products (tesco, dunnes, supervalu)
-- url_status='pending' so the scraper picks them up for resolution
INSERT INTO store_products (product_id, store, store_product_name, store_url, url_status)
SELECT p.id, s.store, p.canonical_name,
  CASE s.store
    WHEN 'tesco' THEN 'https://www.tesco.ie/shop/en-IE/search?q=' || REPLACE(p.canonical_name, ' ', '%20')
    WHEN 'dunnes' THEN 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/results?q=' || REPLACE(p.canonical_name, ' ', '%20')
    WHEN 'supervalu' THEN 'https://shop.supervalu.ie/sm/delivery/rsid/5550/results?q=' || REPLACE(p.canonical_name, ' ', '%20')
  END,
  'pending'
FROM products p
CROSS JOIN (VALUES ('tesco'), ('dunnes'), ('supervalu')) AS s(store)
WHERE p.category IN ('Household', 'Baby')
  AND p.canonical_name IN (
    'Hand Soap 250ml', 'Fabric Softener 1.5L', 'Laundry Capsules 30 Pack',
    'Toilet Cleaner 750ml', 'Glass Cleaner 500ml', 'Floor Cleaner 1L',
    'Kitchen Cleaner Spray 500ml', 'Bathroom Cleaner Spray 500ml',
    'Antibacterial Wipes 40 Pack', 'Nappies Size 4 Pack', 'Baby Wipes 64 Pack',
    'Hand Wash Refill 500ml', 'Dishcloth 5 Pack', 'Firelighters', 'Matches', 'Candles Pack'
  )
ON CONFLICT DO NOTHING;
