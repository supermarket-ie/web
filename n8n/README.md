# n8n Setup for supermarket.ie

## Local Development

```bash
docker-compose up -d
```

Access at: http://localhost:5678
- Username: admin
- Password: supermarket2026

## Production Deployment Options

### Railway (Recommended - easy)
1. Push this folder to a repo
2. Connect to Railway
3. Deploy with environment variables

### Render
1. Use their Docker deployment
2. Add persistent disk for /home/node/.n8n

### Self-hosted VPS
1. Any €5/month VPS (Hetzner, DigitalOcean)
2. Docker + docker-compose
3. Nginx reverse proxy with SSL

## Scraping Strategy

Since all Irish supermarkets have anti-bot protection, we need:

1. **Browserless.io** - Managed headless Chrome API
   - €0 free tier (1000 sessions/month)
   - Works with n8n HTTP nodes
   - Handles Cloudflare, etc.

2. **Or self-hosted Playwright**
   - Add to docker-compose
   - More control, more maintenance

## Workflow Architecture

```
Daily @ 7am Ireland time
    │
    ├── Scrape Tesco offers (via Browserless)
    ├── Scrape Lidl offers (via Browserless)  
    ├── Scrape Aldi offers (via Browserless)
    ├── Scrape SuperValu offers (via Browserless)
    └── Scrape Dunnes offers (via Browserless)
    │
    ▼
Normalize & dedupe deals
    │
    ▼
Store in Supabase (deals table)
    │
    ▼
Query subscribers by family_size
    │
    ▼
Generate personalized emails
    │
    ▼
Send via Resend API
```

## Supabase Schema Addition

```sql
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store TEXT NOT NULL,
  product_name TEXT NOT NULL,
  original_price DECIMAL(10,2),
  sale_price DECIMAL(10,2) NOT NULL,
  discount_percent INTEGER,
  category TEXT,
  valid_from DATE,
  valid_until DATE,
  image_url TEXT,
  source_url TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deals_store ON deals(store);
CREATE INDEX idx_deals_category ON deals(category);
CREATE INDEX idx_deals_valid ON deals(valid_until);
```
