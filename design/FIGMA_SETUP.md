# supermarket.ie — Figma Setup Guide

## How to create the design file

1. Go to figma.com → Drafts → New design file
2. Rename it: `supermarket.ie — Design System`
3. Set up pages in this order:

---

## Pages

### 1. 🎨 Tokens
Document all design tokens (colours, type, spacing).
Use this as the single source of truth.

**Colour styles to create:**
- Brand / Primary → #E17055
- Brand / Primary Dark → #D4604A
- Brand / Teal → #5D9B8F
- Neutral / 900 → #1D2324
- Neutral / 700 → #636E72
- Neutral / 400 → #B2BEC3
- Neutral / 200 → #E8E2DC
- Neutral / 100 → #F5F0EB
- Neutral / 50 → #FFFBF7
- Store / Tesco → #003A8C
- Store / Dunnes → #7B0017
- Store / SuperValu → #D4400F

**Text styles to create:**
- Display / 6xl — Geist, 48px, ExtraBold, -0.04em
- Display / 5xl — Geist, 40px, ExtraBold, -0.03em
- Heading / 4xl — Geist, 32px, Bold, -0.03em
- Heading / 3xl — Geist, 28px, Bold, -0.03em
- Heading / 2xl — Geist, 24px, Bold, -0.03em
- Heading / xl — Geist, 20px, Bold
- Body / lg — Geist, 18px, Regular
- Body / md — Geist, 16px, Regular
- Body / base — Geist, 14px, Regular
- Body / sm — Geist, 12px, Regular
- Label / semibold — Geist, 14px, SemiBold
- Label / caps — Geist, 11px, SemiBold, 0.08em spacing

---

### 2. 🧩 Components
Reusable UI components. Build these first:

**Buttons**
- Primary (salmon) — default / hover / disabled
- Secondary (outline) — default / hover
- Ghost — default / hover
- Sizes: sm (32px) / md (40px) / lg (52px)

**Inputs**
- Text input — default / focus / error
- Textarea
- Select / dropdown

**Cards**
- Product card (browse page)
- Product row (list page)
- Vendor card
- Category tile (icon strip)

**Navigation**
- Desktop header
- Mobile header
- Category icon strip (Instacart style)
- Tab bar (mobile)

**Badges**
- Store badge (Tesco / Dunnes / SuperValu / Lidl / Aldi)
- Status badge (in stock / out of stock / pending)
- Plan badge (free / pro / featured)

**Modals / Sheets**
- Bottom sheet (mobile)
- Modal (desktop)
- Preferences panel

---

### 3. 📱 Consumer — Mobile
Design at 390px width (iPhone 14 Pro)

Screens:
- Homepage
- Browse (with category icon strip)
- Product list (authenticated)
- Add items panel
- Store swap
- Household settings

---

### 4. 🖥️ Consumer — Desktop
Design at 1280px width

Screens:
- Homepage
- Browse
- Product list

---

### 5. 🏪 Vendor — Onboarding
Design at 390px (mobile-first)

Screens:
- /vendor — landing page
- /vendor/signup — step 1: business info
- /vendor/signup — step 2: location + delivery
- /vendor/signup — step 3: categories
- /vendor/signup — step 4: confirmation

---

### 6. 🏪 Vendor — Dashboard
Design at 1280px (desktop-first)

Screens:
- Dashboard overview
- Product catalogue (toggle + price)
- Add custom product
- Store profile editor
- Storefront preview

---

### 7. 🛍️ Store Storefront
Public vendor page (/store/[slug])

Screens:
- Mobile storefront
- Desktop storefront

---

## Key design principles

- **Rounded:** Everything uses 12–20px radius. Nothing sharp.
- **Warm:** Background is #FFFBF7, not pure white. Cards are white on warm.
- **Sparse:** Lots of breathing room. Don't cram. 
- **Colour-coded:** Each store has its colour. Each category has its pastel.
- **Mobile-first:** Design for 390px, then scale up.
- **Instacart-inspired nav:** Large icon tiles, horizontal scroll, pastel backgrounds.

---

## Connecting to code

Once you have designs, share the Figma file URL with me.
I can then:
- Read exact colours, spacing, font sizes from the file
- Extract SVG icons/illustrations
- Match components to existing code
- Build new pages that match designs pixel-perfectly
