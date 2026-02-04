# Scraper Status - Irish Supermarkets

## Working ✅

### Tesco Ireland
- **URL**: `https://www.tesco.ie/groceries/en-IE/search?query={product}`
- **Method**: BrowserQL (no solve needed)
- **Data available**:
  - ✅ Product name
  - ✅ Price
  - ✅ Price per unit
  - ⚠️ Nutrition (in HTML, needs parsing)
  - ⚠️ Promotions (need to detect "Clubcard Price" etc)

### SuperValu
- **URL**: `https://shop.supervalu.ie/shopping/search?query={product}`
- **Method**: BrowserQL (no solve needed)
- **Data available**:
  - ✅ Product name
  - ✅ Price
  - ✅ Was price (promotions)
  - ✅ Price per unit
  - ⚠️ Nutrition (needs product detail page)

### Dunnes Stores
- **URL**: `https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/results?q={product}`
- **Method**: BrowserQL with `solve` + `waitForTimeout(8000)`
- **Data available**:
  - ✅ Product name
  - ✅ Price
  - ✅ Price per unit
  - ✅ Product info (country, company)
  - ⚠️ Nutrition (in expanded description HTML)

### Lidl Ireland
- **URL**: Category pages e.g. `https://www.lidl.ie/h/cheese-dairy/h10071017`
- **Method**: BrowserQL (no solve needed)
- **Data available**:
  - ✅ Product name
  - ✅ Price
  - ✅ Lidl Plus discounted price
  - ✅ Price per kg/litre
  - ⚠️ Products mapped to category pages (not search)

**Lidl category URLs:**
- Dairy: `/h/cheese-dairy/h10071017`
- Eggs & Staples: `/h/eggs-staple-foods/h10071045`
- Bakery: `/h/bakery-bread-baked-goods/h10071015`
- Fresh Produce: `/h/fresh-fruit-vegetables/h10071012`
- Meat & Poultry: `/h/fresh-meat-poultry/h10071016`
- Fish: `/h/fish-seafood/h10071050`
- Frozen: `/h/frozen-food/h10071049`
- Oils & Tinned: `/h/oils-tinned-food/h10071681`
- Preserves & Spreads: `/h/preserves-spreads/h10071684`
- Spices & Sauces: `/h/spices-mustard-sauces/h10071682`

## Needs Different Approach ⚠️

### Aldi Ireland
- **Issue**: No online grocery shop
- **Alternative**: Scrape Specialbuys/offers pages
- **Data**: Weekly specials only

## BrowserQL Queries

### Tesco
```graphql
mutation {
  goto(url: "https://www.tesco.ie/groceries/en-IE/search?query=milk", waitUntil: networkIdle) { status }
  text { text }
}
```

### SuperValu
```graphql
mutation {
  goto(url: "https://shop.supervalu.ie/shopping/search?query=milk", waitUntil: networkIdle) { status }
  text { text }
}
```

### Dunnes (requires CAPTCHA solving)
```graphql
mutation {
  goto(url: "https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/results?q=milk", waitUntil: networkIdle, timeout: 60000) { status }
  solve { solved }
  waitForTimeout(time: 8000) { time }
  text { text }
}
```

## Rate Limits

- Browserless free tier: 1000 sessions/month
- With 56 products × 3 stores = 168 scrapes per full run
- Can do ~6 full scrapes per month
- Recommendation: Scrape daily with rotation (1 store per day)

## Pricing Example Output

**Dunnes Stores Simply Better Single Source Irish Jersey Whole Milk 2L**
- Price: €3.99
- Per unit: €2.00/l

**Avonmore Light Milk 1L**
- Price: €1.59
- Per unit: €1.59/l

## Nutrition Data

Nutrition data is embedded in product descriptions (Dunnes) or requires additional product detail page requests (Tesco/SuperValu). Consider:
1. Scraping nutrition once per product (doesn't change often)
2. Storing in `store_products` table
3. Only updating when product changes

## Next Steps

1. Run schema.sql in Supabase
2. Run seed-products.sql to populate products
3. Import workflow-bql-scraper.json into n8n
4. Add Dunnes support with solve/wait
5. Add nutrition extraction
