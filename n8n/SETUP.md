# n8n Scraper Setup

## Prerequisites

1. **Supabase tables created** - run schema.sql then seed-products.sql
2. **Browserless.io API key** - sign up at browserless.io (free tier: 1000 sessions/month)

## Environment Variables Needed

```
BROWSERLESS_API_KEY=your_key_here
SUPABASE_URL=https://ytyzwiqnobxehdqrnzhx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Scraping Strategy by Store

### Tesco Ireland
- URL pattern: `https://www.tesco.ie/groceries/en-IE/search?query={product}`
- Data structure: JSON-LD in page, or parse product tiles
- Price format: €X.XX
- Promotion: "Was €X.XX" badge

### Dunnes Stores  
- URL pattern: `https://www.dunnesstores.com/search?q={product}`
- Heavy Cloudflare protection - needs Browserless stealth mode
- Price in product cards

### SuperValu
- URL pattern: `https://shop.supervalu.ie/shopping/search?query={product}`
- Dynamic React app - needs full JS rendering
- Price per unit usually displayed

### Lidl Ireland
- No online shop - scrape offers page or weekly leaflet
- URL: `https://www.lidl.ie/offers`
- Less real-time, more weekly specials

## Workflow Architecture

```
Trigger (Cron: 7am daily)
    │
    ├─► Get all store_products from Supabase
    │
    ├─► For each store:
    │   ├─► Batch products (10 at a time)
    │   ├─► Browserless: render search page
    │   ├─► Parse prices from HTML
    │   └─► Insert price_observations
    │
    └─► Send summary notification
```

## Rate Limiting

- Browserless free tier: ~33 sessions/day
- With 56 products × 4 stores = 224 scrapes needed
- Solution: Batch searches, scrape 1-2 stores per day on rotation

## Hosting Options

1. **Railway** (recommended) - easy Docker deploy, free tier
2. **Render** - similar to Railway
3. **Self-hosted VPS** - €5/month Hetzner

## Files

- `schema.sql` - Database tables
- `seed-products.sql` - Initial 56 products with store mappings
- `docker-compose.yml` - Local development
- `workflow-scraper.json` - n8n workflow (create after getting API keys)
