# SEO Phase Spec — supermarket.ie

## Brand Focus

**supermarket.ie is an AI grocery agent, NOT a price comparison website.**

All SEO work must reinforce the brand: "Your personal AI grocery agent for Ireland."
Price data is a *capability* of the agent, not the product itself.

## Scope — Phase 1 (Technical SEO Foundation)

### 1. Homepage SSR (P0 — Critical)

The homepage is `'use client'` — Google sees a blank shell.

**Fix:**
- Convert `src/app/page.tsx` to a **server component**
- Move all static content (HeroSection, StoreLogosBar, HowItWorksSection, BenefitsSection, TestimonialsSection, FAQSection, BottomCTASection) to be server-rendered
- Keep interactive elements (cookie banner, planner chat, session-dependent UI) as client component islands using `'use client'` only on the specific components that need it
- The `<h1>`, all body text, FAQ answers, and section headings must be in the initial HTML

**Validation:** `curl -s https://supermarket.ie | grep -i "h1"` should return the heading.

### 2. OG Image (P1)

- Create a static `/public/og-image.png` (1200×630) — branded, shows "Your AI grocery agent for Ireland"
- Later: dynamic per-page OG via `@vercel/og` (not this sprint)

### 3. Structured Data Additions (P1)

Add JSON-LD to pages that don't have it:

- **Blog posts** (`/blog/[slug]`): `Article` schema (headline, datePublished, author, description)
- **Homepage FAQ**: `FAQPage` schema (already have FAQ section — just add the JSON-LD)
- **Shop category pages** (`/shop/[category]`): `ItemList` schema
- **All subpages**: `BreadcrumbList` schema

### 4. Canonical URLs (P1)

Every page's `generateMetadata` (or `metadata` export) should include:
```ts
alternates: { canonical: `${BASE_URL}/path-here` }
```

Currently only the root layout sets this. Each page needs its own.

### 5. Breadcrumbs (P1)

- Add visual breadcrumb navigation to: blog posts, category pages, compare pages, deals pages
- Add `BreadcrumbList` JSON-LD alongside the visual breadcrumbs
- Use a shared `<Breadcrumbs>` component

### 6. Internal Linking (P1)

- Blog posts should have a "Related" section linking to relevant category/deals pages
- Category pages should link to related blog posts
- Compare pages should link to relevant deals pages
- All content pages should have a CTA linking to the planner ("Let your AI agent handle this →")

## Out of Scope (This Sprint)

- Google Search Console setup (needs Paul to verify domain ownership in Google)
- Google Analytics / Vercel Analytics (separate task — needs Paul's Google account)
- Programmatic long-tail pages (Phase 2 — needs keyword research first)
- Dynamic OG images via @vercel/og (Phase 2)
- Per-product pages (future)

## Technical Notes

- `NEXT_PUBLIC_BASE_URL` = `https://supermarket.ie`
- Homepage components in `src/components/homepage/` (HeroSection, etc.)
- Blog content in `src/lib/blog.ts`
- Existing JSON-LD in: layout.tsx, compare/[matchup], cost-of-weekly-shop, deals, deals/[store]
- Sitemap at `src/app/sitemap.ts` — no changes needed this sprint

## Success Criteria

1. Homepage H1 and all text content visible in `view-source:` (no JS required)
2. `og-image.png` exists and renders on social share
3. Google Rich Results Test passes for Article (blog), FAQ (homepage), ItemList (shop categories)
4. Every public page has its own canonical URL
5. Breadcrumbs visible on all subpages
