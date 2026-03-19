#!/usr/bin/env python3
"""
Supermarket.ie Scraping Pipeline
Uses ScrapingBee to resolve product URLs and extract prices.

Modes:
  --resolve   Resolve search URLs → product URLs for all 'pending' store_products
  --refresh   Re-scrape prices for all 'resolved' store_products
  --full      Both: resolve pending, then refresh all resolved (default)

Usage:
  SCRAPINGBEE_API_KEY=xxx SUPABASE_SERVICE_ROLE_KEY=xxx python3 scrape_pipeline.py [--resolve|--refresh|--full]
  python3 scrape_pipeline.py --store tesco          # single store only
  python3 scrape_pipeline.py --limit 20             # cap products per store
  python3 scrape_pipeline.py --resolve --store supervalu --limit 50
"""

import os
import re
import sys
import json
import time
import argparse
import urllib.parse
import requests
from datetime import datetime, timezone

# --- Config ---
SBKEY = os.environ["SCRAPINGBEE_API_KEY"]
SUPABASE_URL = "https://ytyzwiqnobxehdqrnzhx.supabase.co"
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SB_BASE = "https://app.scrapingbee.com/api/v1/"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

STORES = ["tesco", "supervalu", "dunnes"]

# Credits per call:
#   render_js=false, premium_proxy=false = 1 credit  (Tesco — works)
#   render_js=true,  premium_proxy=false = 5 credits  (SuperValu — still blocked)
#   render_js=true,  premium_proxy=true  = 25 credits (Dunnes — 500 error, needs Browserless)
# Only Tesco is currently functional via ScrapingBee.
CREDITS_PER_CALL = 1   # search/resolve pages: render_js=false
CREDITS_PER_PRICE = 5  # product detail pages: render_js=true (needs JS for JSON-LD)


# ============================================================
# SUPABASE HELPERS
# ============================================================

def supabase_get(table, params=""):
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}?{params}",
        headers=HEADERS,
    )
    if not resp.ok:
        print(f"  ⚠ Supabase GET error: {resp.status_code} {resp.text[:200]}")
        return []
    return resp.json()


def supabase_patch(table, row_id, data):
    resp = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}",
        headers=HEADERS,
        json=data,
    )
    return resp.ok, resp.status_code


def supabase_post(table, data):
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**HEADERS, "Prefer": "return=representation"},
        json=data,
    )
    return resp.ok, resp.status_code, (resp.json() if resp.ok else resp.text)


def supabase_count(table, params=""):
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}?{params}&select=id",
        headers={**HEADERS, "Prefer": "count=exact"},
    )
    cr = resp.headers.get("content-range", "0/0")
    try:
        return int(cr.split("/")[1])
    except Exception:
        return 0


# ============================================================
# SCRAPINGBEE FETCH
# ============================================================

def sb_fetch(url, render_js=False, premium_proxy=False, timeout=90):
    """Fetch a URL via ScrapingBee.
    - render_js=False (1 credit): use for search/listing pages
    - render_js=True  (5 credits): use for product detail pages (JSON-LD needs JS)
    """
    params = {
        "api_key": SBKEY,
        "url": url,
        "render_js": "true" if render_js else "false",
        "premium_proxy": "true" if premium_proxy else "false",
    }
    try:
        resp = requests.get(SB_BASE, params=params, timeout=timeout)
        return resp
    except requests.exceptions.Timeout:
        # Return a fake response object
        class FakeResp:
            status_code = 408
            text = "Timeout"
        return FakeResp()
    except Exception as e:
        class FakeResp:
            status_code = 500
            text = str(e)
        return FakeResp()


def check_credits():
    """Check ScrapingBee credit balance."""
    try:
        resp = requests.get(f"https://app.scrapingbee.com/api/v1/usage?api_key={SBKEY}", timeout=10)
        if resp.ok:
            usage = resp.json()
            # API returns max_api_credit / used_api_credit (singular)
            used = usage.get("used_api_credit", usage.get("used_api_credits", 0))
            total = usage.get("max_api_credit", usage.get("max_api_credits", 0))
            remaining = total - used
            return remaining, total
    except Exception:
        pass
    return None, None


# ============================================================
# PRICE EXTRACTION HELPERS
# ============================================================

def extract_json_ld_price(html):
    """Try to extract price + name from JSON-LD Product schema."""
    blocks = re.findall(
        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
        html, re.DOTALL | re.IGNORECASE
    )
    for block in blocks:
        try:
            data = json.loads(block)
            if isinstance(data, list):
                data = data[0]
            if data.get("@type") == "Product":
                offers = data.get("offers", {})
                if isinstance(offers, list):
                    offers = offers[0]
                price = float(offers.get("price", 0) or 0)
                if price > 0:
                    return price, data.get("name", "")
        except Exception:
            pass
    return None, None


def extract_og_title(html):
    m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html, re.IGNORECASE)
    return m.group(1).strip() if m else ""


def extract_euro_price_fallback(html):
    """Last resort: find first €X.XX pattern in HTML."""
    m = re.search(r'€\s*(\d+\.\d{2})', html)
    if m:
        try:
            return float(m.group(1))
        except Exception:
            pass
    return None


# ============================================================
# TESCO
# ============================================================

def resolve_tesco_url(search_url, product_name):
    if "/search?" not in search_url:
        query = urllib.parse.quote(product_name)
        url = f"https://www.tesco.ie/groceries/en-IE/search?query={query}"
    else:
        url = search_url

    resp = sb_fetch(url)
    if resp.status_code != 200:
        return None, None, f"HTTP {resp.status_code}"

    html = resp.text
    links = re.findall(r'href="(/groceries/en-IE/products/(\d+)[^"]*)"', html)
    if not links:
        skus = re.findall(r'/groceries/en-IE/products/(\d+)', html)
        if skus:
            sku = skus[0]
            return f"https://www.tesco.ie/groceries/en-IE/products/{sku}", sku, None
        return None, None, "No product links found"

    path, sku = links[0]
    return f"https://www.tesco.ie{path}", sku, None


def extract_tesco_price(product_url):
    resp = sb_fetch(product_url, render_js=True)  # needs JS for JSON-LD
    if resp.status_code != 200:
        return None, None, f"HTTP {resp.status_code}"

    html = resp.text
    price, name = extract_json_ld_price(html)
    if price:
        return price, name or extract_og_title(html), None

    patterns = [
        r'data-auto="price-per-sellable-unit"[^>]*>\s*[£€](\d+\.?\d*)',
        r'"price":\s*"?(\d+\.?\d*)"?',
        r'<span[^>]*class="[^"]*value[^"]*"[^>]*>(\d+)\.(\d+)</span>',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                p = float(f"{m.group(1)}.{m.group(2)}") if len(m.groups()) == 2 else float(m.group(1))
                if p > 0:
                    return p, extract_og_title(html), None
            except Exception:
                pass

    p = extract_euro_price_fallback(html)
    if p:
        return p, extract_og_title(html), None

    return None, None, "No price found"


# ============================================================
# SUPERVALU
# ============================================================

def resolve_supervalu_url(search_url, product_name):
    if "/search-results?" not in search_url:
        query = urllib.parse.quote(product_name)
        url = f"https://shop.supervalu.ie/shopping/search-results?q={query}"
    else:
        url = search_url

    resp = sb_fetch(url)
    if resp.status_code != 200:
        return None, None, f"HTTP {resp.status_code}"

    html = resp.text
    links = re.findall(r'href="(/shopping/product/([a-zA-Z0-9\-]+))"', html)
    if not links:
        links = re.findall(r'"(/shopping/product/([^"]+))"', html)
    if not links:
        return None, None, "No product links found"

    path, slug = links[0]
    sku_m = re.search(r'-(\d+)$', slug)
    sku = sku_m.group(1) if sku_m else slug
    return f"https://shop.supervalu.ie{path}", sku, None


def extract_supervalu_price(product_url):
    resp = sb_fetch(product_url, render_js=True)  # needs JS for JSON-LD
    if resp.status_code != 200:
        return None, None, f"HTTP {resp.status_code}"

    html = resp.text
    price, name = extract_json_ld_price(html)
    if price:
        return price, name or extract_og_title(html), None

    patterns = [
        r'class="[^"]*selling[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+\.?\d*)',
        r'class="[^"]*current[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+\.?\d*)',
        r'"price"[^:]*:\s*"?([0-9]+\.?[0-9]*)"?',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                p = float(m.group(1))
                if p > 0:
                    return p, extract_og_title(html), None
            except Exception:
                pass

    p = extract_euro_price_fallback(html)
    if p:
        return p, extract_og_title(html), None

    return None, None, "No price found"


# ============================================================
# DUNNES
# ============================================================

def resolve_dunnes_url(search_url, product_name):
    if "/search?" not in search_url:
        query = urllib.parse.quote(product_name)
        url = f"https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/search?q={query}"
    else:
        url = search_url

    resp = sb_fetch(url)
    if resp.status_code != 200:
        return None, None, f"HTTP {resp.status_code}"

    html = resp.text
    if len(html) < 5000 or "access denied" in html.lower() or "are you human" in html.lower():
        return None, None, "Blocked by bot detection"

    links = re.findall(r'href="(/sm/delivery/rsid/258/product/([^"?]+))"', html)
    if not links:
        links = re.findall(r'"(/sm/delivery/rsid/258/product/([^"]+))"', html)
    if not links:
        return None, None, f"No product links found (html_len={len(html)})"

    path, slug = links[0]
    return f"https://www.dunnesstoresgrocery.com{path}", slug, None


def extract_dunnes_price(product_url):
    resp = sb_fetch(product_url, render_js=True)  # needs JS for JSON-LD
    if resp.status_code != 200:
        return None, None, f"HTTP {resp.status_code}"

    html = resp.text
    if len(html) < 5000:
        return None, None, "Blocked by bot detection"

    price, name = extract_json_ld_price(html)
    if price:
        return price, name or extract_og_title(html), None

    patterns = [
        r'class="[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+\.?\d*)',
        r'"price":\s*"?([0-9]+\.?[0-9]*)"?',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                p = float(m.group(1))
                if p > 0:
                    return p, extract_og_title(html), None
            except Exception:
                pass

    p = extract_euro_price_fallback(html)
    if p:
        return p, extract_og_title(html), None

    return None, None, "No price found"


# ============================================================
# STORE DISPATCH
# ============================================================

RESOLVERS = {
    "tesco": resolve_tesco_url,
    "supervalu": resolve_supervalu_url,
    "dunnes": resolve_dunnes_url,
}
EXTRACTORS = {
    "tesco": extract_tesco_price,
    "supervalu": extract_supervalu_price,
    "dunnes": extract_dunnes_price,
}


# ============================================================
# INSERT PRICE OBSERVATION
# ============================================================

def insert_price_observation(store_product_id, price, product_name, source_url):
    ok, status, resp = supabase_post("price_observations", {
        "store_product_id": store_product_id,
        "price": price,
        "was_price": None,
        "on_promotion": False,
        "observed_at": datetime.now(timezone.utc).isoformat(),
    })
    return ok


# ============================================================
# MODE 1: RESOLVE — pending → resolved
# ============================================================

def run_resolve(stores, limit, stats):
    """Resolve search URLs to real product URLs for all pending store_products."""
    for store in stores:
        resolve_fn = RESOLVERS[store]

        rows = supabase_get(
            "store_products",
            f"store=eq.{store}&url_status=eq.pending"
            + (f"&limit={limit}" if limit else "&limit=1000")
            + "&select=id,store_product_name,store_url"
        )

        if not rows:
            print(f"  [{store}] No pending rows")
            continue

        print(f"\n  [{store.upper()}] Resolving {len(rows)} pending products...")
        s = stats[store]

        for sp in rows:
            sp_id = sp["id"]
            name = sp["store_product_name"]
            search_url = sp.get("store_url") or ""

            s["total"] += 1
            product_url, sku, err = resolve_fn(search_url, name)

            if err or not product_url:
                print(f"    ✗ {name[:50]} → {err}")
                s["errors"].append(f"resolve|{name}|{err}")
                supabase_patch("store_products", sp_id, {"url_status": "failed"})
            else:
                print(f"    ✓ {name[:50]} → {product_url[:60]}")
                s["resolved"] += 1
                supabase_patch("store_products", sp_id, {
                    "store_url": product_url,
                    "store_sku": str(sku) if sku else None,
                    "url_status": "resolved",
                })

            time.sleep(2)


# ============================================================
# MODE 2: REFRESH — re-scrape prices for all resolved
# ============================================================

def run_refresh(stores, limit, stats):
    """Re-scrape prices for all resolved store_products."""
    for store in stores:
        extract_fn = EXTRACTORS[store]

        rows = supabase_get(
            "store_products",
            f"store=eq.{store}&url_status=eq.resolved"
            + (f"&limit={limit}" if limit else "&limit=1000")
            + "&select=id,store_product_name,store_url"
        )

        if not rows:
            print(f"  [{store}] No resolved rows to refresh")
            continue

        print(f"\n  [{store.upper()}] Refreshing prices for {len(rows)} products...")
        s = stats[store]

        for sp in rows:
            sp_id = sp["id"]
            name = sp["store_product_name"]
            product_url = sp.get("store_url") or ""

            if not product_url or "/search?" in product_url or "/search-results?" in product_url:
                print(f"    ⚠ {name[:50]} — still has search URL, skipping")
                continue

            s["total"] += 1
            price, scraped_name, err = extract_fn(product_url)

            if err or price is None:
                print(f"    ✗ {name[:50]} → {err}")
                s["errors"].append(f"price|{name}|{err}")
            else:
                print(f"    ✓ {name[:50]} → €{price:.2f}")
                s["prices"] += 1
                ok = insert_price_observation(sp_id, price, scraped_name or name, product_url)
                if not ok:
                    print(f"      ⚠ DB insert failed")

            time.sleep(2)


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Supermarket.ie scraping pipeline")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--resolve", action="store_true", help="Resolve pending URLs only")
    group.add_argument("--refresh", action="store_true", help="Refresh prices only")
    group.add_argument("--full", action="store_true", help="Resolve then refresh (default)")
    parser.add_argument("--store", choices=STORES, help="Run for one store only")
    parser.add_argument("--limit", type=int, default=0, help="Max products per store (0 = all)")
    args = parser.parse_args()

    # Default to full
    if not args.resolve and not args.refresh:
        args.full = True

    stores = [args.store] if args.store else STORES
    limit = args.limit or 0

    print("=" * 60)
    print("🛒  Supermarket.ie Scraping Pipeline")
    print(f"    Mode:   {'resolve' if args.resolve else 'refresh' if args.refresh else 'full'}")
    print(f"    Stores: {', '.join(stores)}")
    print(f"    Limit:  {limit if limit else 'all'}")
    print(f"    Time:   {datetime.now().isoformat()}")

    # Credit check
    remaining, total = check_credits()
    if remaining is not None:
        print(f"    Credits: {remaining:,} / {total:,} remaining")
        # Estimate cost
        pending_count = sum(
            supabase_count("store_products", f"store=eq.{s}&url_status=eq.pending")
            for s in stores
        )
        resolved_count = sum(
            supabase_count("store_products", f"store=eq.{s}&url_status=eq.resolved")
            for s in stores
        )
        if args.full:
            est = (pending_count * 2 * CREDITS_PER_CALL) + (pending_count * CREDITS_PER_PRICE) + (resolved_count * CREDITS_PER_PRICE)
        elif args.resolve:
            est = pending_count * 2 * CREDITS_PER_CALL
        else:
            est = resolved_count * CREDITS_PER_PRICE
        if limit:
            est = min(est, len(stores) * limit * 2 * CREDITS_PER_CALL)
        print(f"    Pending to resolve: {pending_count} ({pending_count*2} SB calls)")
        print(f"    Resolved to refresh: {resolved_count} ({resolved_count} SB calls)")
        print(f"    Est. credits needed: ~{est:,}")
        if remaining < est:
            print(f"    ⚠️  WARNING: May not have enough credits!")
    print("=" * 60)

    stats = {
        s: {"total": 0, "resolved": 0, "prices": 0, "errors": []}
        for s in stores
    }

    if args.resolve or args.full:
        print("\n📍 PHASE 1: Resolving pending URLs")
        run_resolve(stores, limit, stats)

    if args.refresh or args.full:
        print("\n💰 PHASE 2: Refreshing prices")
        run_refresh(stores, limit, stats)

    # Summary
    print("\n" + "=" * 60)
    print("📊 SUMMARY")
    print("=" * 60)
    total_resolved = 0
    total_prices = 0
    total_errors = 0
    for store in stores:
        s = stats[store]
        if s["total"] > 0 or s["errors"]:
            print(f"\n  {store.upper()}:")
            print(f"    Processed: {s['total']}")
            if s.get("resolved"):
                print(f"    Resolved:  {s['resolved']}")
            if s.get("prices"):
                print(f"    Prices:    {s['prices']}")
            if s["errors"]:
                print(f"    Errors:    {len(s['errors'])}")
                for e in s["errors"][:3]:
                    print(f"      - {e[:80]}")
            total_resolved += s.get("resolved", 0)
            total_prices += s.get("prices", 0)
            total_errors += len(s["errors"])

    print(f"\n  TOTAL: {total_resolved} resolved, {total_prices} prices, {total_errors} errors")

    # Save report
    report = {
        "timestamp": datetime.now().isoformat(),
        "mode": "resolve" if args.resolve else "refresh" if args.refresh else "full",
        "stores": stores,
        "stats": stats,
    }
    report_path = "/tmp/scrape_results.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n  Results saved to {report_path}")


if __name__ == "__main__":
    main()
