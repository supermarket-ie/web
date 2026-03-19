#!/usr/bin/env python3
"""
Supermarket.ie Scraping Pipeline
Resolves real product URLs + SKUs and extracts prices using ScrapingBee.
"""

import os
import re
import json
import time
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

# Track results
results = {
    "tesco": {"fetched": 0, "resolved": 0, "prices": 0, "errors": []},
    "supervalu": {"fetched": 0, "resolved": 0, "prices": 0, "errors": []},
    "lidl": {"fetched": 0, "resolved": 0, "prices": 0, "errors": []},
    "dunnes": {"fetched": 0, "resolved": 0, "prices": 0, "errors": []},
    "aldi": {"fetched": 0, "resolved": 0, "prices": 0, "errors": []},
}


def sb_fetch(url, render_js=True, premium_proxy=True, timeout=90):
    """Fetch a URL via ScrapingBee."""
    params = {
        "api_key": SBKEY,
        "url": url,
        "render_js": "true" if render_js else "false",
        "premium_proxy": "true" if premium_proxy else "false",
    }
    resp = requests.get(SB_BASE, params=params, timeout=timeout)
    return resp


def supabase_get(table, params=""):
    """GET from Supabase REST API."""
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}?{params}",
        headers=HEADERS,
    )
    return resp.json() if resp.ok else []


def supabase_patch(table, row_id, data):
    """PATCH a row in Supabase."""
    resp = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}",
        headers=HEADERS,
        json=data,
    )
    return resp.ok, resp.status_code


def supabase_post(table, data):
    """POST to Supabase."""
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**HEADERS, "Prefer": "return=representation"},
        json=data,
    )
    return resp.ok, resp.status_code, resp.json() if resp.ok else resp.text


# ============================================================
# TESCO URL RESOLVER
# ============================================================

def resolve_tesco_url(search_url, product_name):
    """
    Fetch Tesco search and extract first matching product URL.
    Returns (product_url, sku) or (None, None)
    """
    # Convert search URL to proper search
    if "/search?" not in search_url:
        query = urllib.parse.quote(product_name)
        url = f"https://www.tesco.ie/groceries/en-IE/search?query={query}"
    else:
        url = search_url

    try:
        resp = sb_fetch(url)
        if resp.status_code != 200:
            return None, None, f"HTTP {resp.status_code}"
        
        html = resp.text
        
        # Extract product URLs - pattern: /groceries/en-IE/products/XXXXXXX
        product_links = re.findall(r'href="(/groceries/en-IE/products/(\d+)[^"]*)"', html)
        if not product_links:
            # Try without href wrapper
            product_links_raw = re.findall(r'/groceries/en-IE/products/(\d+)', html)
            if product_links_raw:
                sku = product_links_raw[0]
                return f"https://www.tesco.ie/groceries/en-IE/products/{sku}", sku, None
            return None, None, "No product links found"
        
        # Get first product
        path, sku = product_links[0]
        return f"https://www.tesco.ie{path}", sku, None
        
    except Exception as e:
        return None, None, str(e)


# ============================================================
# TESCO PRICE EXTRACTOR
# ============================================================

def extract_tesco_price(product_url):
    """Extract price from Tesco product page."""
    try:
        resp = sb_fetch(product_url)
        if resp.status_code != 200:
            return None, None, f"HTTP {resp.status_code}"
        
        html = resp.text
        
        # Try JSON-LD first
        json_ld_blocks = re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', html, re.DOTALL | re.IGNORECASE)
        for block in json_ld_blocks:
            try:
                data = json.loads(block)
                if isinstance(data, list):
                    data = data[0]
                if data.get("@type") == "Product" and data.get("offers"):
                    offers = data["offers"]
                    if isinstance(offers, list):
                        offers = offers[0]
                    price = float(offers.get("price", 0))
                    if price > 0:
                        product_name = data.get("name", "")
                        return price, product_name, None
            except:
                pass
        
        # Try price from HTML patterns
        # Tesco uses data-auto="price-per-sellable-unit" or class="price-per-quantity"
        price_patterns = [
            r'data-auto="price-per-sellable-unit"[^>]*>\s*[£€](\d+\.?\d*)',
            r'"price":\s*"?(\d+\.?\d*)"?',
            r'<span[^>]*class="[^"]*value[^"]*"[^>]*>(\d+)\.(\d+)</span>',
            r'€\s*(\d+\.\d{2})',
        ]
        
        for pattern in price_patterns:
            m = re.search(pattern, html, re.IGNORECASE)
            if m:
                try:
                    if len(m.groups()) == 2:
                        price = float(f"{m.group(1)}.{m.group(2)}")
                    else:
                        price = float(m.group(1))
                    if price > 0:
                        # Get product name from og:title
                        name_m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html, re.IGNORECASE)
                        product_name = name_m.group(1) if name_m else ""
                        return price, product_name, None
                except:
                    pass
        
        return None, None, "No price found in HTML"
        
    except Exception as e:
        return None, None, str(e)


# ============================================================
# SUPERVALU URL RESOLVER + PRICE EXTRACTOR
# ============================================================

def resolve_supervalu_url(search_url, product_name):
    """Fetch SuperValu search and extract first product URL."""
    if "/search-results?" not in search_url:
        query = urllib.parse.quote(product_name)
        url = f"https://shop.supervalu.ie/shopping/search-results?q={query}"
    else:
        url = search_url

    try:
        resp = sb_fetch(url)
        if resp.status_code != 200:
            return None, None, f"HTTP {resp.status_code}"
        
        html = resp.text
        
        # SuperValu product URLs: /shopping/product/[slug]-[id]
        product_links = re.findall(r'href="(/shopping/product/([a-zA-Z0-9\-]+))"', html)
        if not product_links:
            # Try other patterns
            product_links = re.findall(r'"(/shopping/product/([^"]+))"', html)
        
        if not product_links:
            return None, None, "No product links found"
        
        path, slug = product_links[0]
        # Extract SKU from slug (usually last numeric part)
        sku_match = re.search(r'-(\d+)$', slug)
        sku = sku_match.group(1) if sku_match else slug
        
        return f"https://shop.supervalu.ie{path}", sku, None
        
    except Exception as e:
        return None, None, str(e)


def extract_supervalu_price(product_url):
    """Extract price from SuperValu product page."""
    try:
        resp = sb_fetch(product_url)
        if resp.status_code != 200:
            return None, None, f"HTTP {resp.status_code}"
        
        html = resp.text
        
        # JSON-LD
        json_ld_blocks = re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', html, re.DOTALL | re.IGNORECASE)
        for block in json_ld_blocks:
            try:
                data = json.loads(block)
                if isinstance(data, list):
                    data = data[0]
                if data.get("@type") == "Product" and data.get("offers"):
                    offers = data["offers"]
                    if isinstance(offers, list):
                        offers = offers[0]
                    price = float(offers.get("price", 0))
                    if price > 0:
                        return price, data.get("name", ""), None
            except:
                pass
        
        # SuperValu price patterns
        patterns = [
            r'class="[^"]*selling[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+\.?\d*)',
            r'class="[^"]*current[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+\.?\d*)',
            r'"price"[^:]*:\s*"?([0-9]+\.?[0-9]*)"?',
            r'€(\d+\.\d{2})',
        ]
        
        for p in patterns:
            m = re.search(p, html, re.IGNORECASE)
            if m:
                try:
                    price = float(m.group(1))
                    if price > 0:
                        name_m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html, re.IGNORECASE)
                        return price, (name_m.group(1) if name_m else ""), None
                except:
                    pass
        
        return None, None, "No price found"
        
    except Exception as e:
        return None, None, str(e)


# ============================================================
# LIDL URL RESOLVER + PRICE EXTRACTOR
# ============================================================

def resolve_lidl_url(search_url, product_name):
    """Fetch Lidl search and extract first product URL."""
    if "/q/search?" not in search_url and "/q/query/" not in search_url:
        query = urllib.parse.quote(product_name)
        url = f"https://www.lidl.ie/q/search?query={query}&assortment=IE&locale=en_IE&version=v2.0.0"
    else:
        # Convert old /q/query/ to /q/search?
        url = search_url.replace("/q/query/", "/q/search?query=")
        if "/q/search?" not in url:
            url = search_url

    try:
        resp = sb_fetch(url)
        if resp.status_code != 200:
            return None, None, f"HTTP {resp.status_code}"
        
        html = resp.text
        
        # Lidl product URLs: /p/[slug]/p[SKU]
        product_links = re.findall(r'"canonicalPath":\s*"(/p/([^"]+)/p(\d+))"', html)
        if product_links:
            path, slug, sku = product_links[0]
            return f"https://www.lidl.ie{path}", sku, None
        
        # Alternative pattern in href
        product_links_href = re.findall(r'href="(/p/[^"]+)"', html)
        if product_links_href:
            path = product_links_href[0]
            sku_match = re.search(r'/p(\d+)$', path)
            sku = sku_match.group(1) if sku_match else ""
            return f"https://www.lidl.ie{path}", sku, None
        
        return None, None, "No product links found"
        
    except Exception as e:
        return None, None, str(e)


def extract_lidl_price(product_url):
    """Extract price from Lidl product page."""
    try:
        resp = sb_fetch(product_url)
        if resp.status_code != 200:
            return None, None, f"HTTP {resp.status_code}"
        
        html = resp.text
        
        # JSON-LD
        json_ld_blocks = re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', html, re.DOTALL | re.IGNORECASE)
        for block in json_ld_blocks:
            try:
                data = json.loads(block)
                if isinstance(data, list):
                    data = data[0]
                if data.get("@type") == "Product" and data.get("offers"):
                    offers = data["offers"]
                    if isinstance(offers, list):
                        offers = offers[0]
                    price = float(offers.get("price", 0))
                    if price > 0:
                        return price, data.get("name", ""), None
            except:
                pass
        
        # Lidl price patterns
        patterns = [
            r'"price":\s*([0-9]+\.?[0-9]*),',
            r'pricebox__price[^>]*>\s*[€£]?\s*(\d+\.?\d*)',
            r'€(\d+\.\d{2})',
        ]
        
        for p in patterns:
            m = re.search(p, html, re.IGNORECASE)
            if m:
                try:
                    price = float(m.group(1))
                    if price > 0:
                        name_m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html, re.IGNORECASE)
                        return price, (name_m.group(1) if name_m else ""), None
                except:
                    pass
        
        return None, None, "No price found"
        
    except Exception as e:
        return None, None, str(e)


# ============================================================
# DUNNES URL RESOLVER + PRICE EXTRACTOR
# ============================================================

def resolve_dunnes_url(search_url, product_name):
    """Fetch Dunnes search and extract first product URL."""
    if "/search?" not in search_url:
        query = urllib.parse.quote(product_name)
        url = f"https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/search?q={query}"
    else:
        url = search_url

    try:
        resp = sb_fetch(url)
        if resp.status_code != 200:
            return None, None, f"HTTP {resp.status_code}"
        
        html = resp.text
        
        # Check for bot block
        if len(html) < 5000 or "access denied" in html.lower() or "are you human" in html.lower():
            return None, None, "Blocked by bot detection"
        
        # Dunnes product URLs: /sm/delivery/rsid/258/product/[slug]
        product_links = re.findall(r'href="(/sm/delivery/rsid/258/product/([^"?]+))"', html)
        if not product_links:
            # Try JSON embedded
            product_links_json = re.findall(r'"(/sm/delivery/rsid/258/product/([^"]+))"', html)
            if product_links_json:
                product_links = product_links_json
        
        if not product_links:
            return None, None, f"No product links found (html len={len(html)})"
        
        path, slug = product_links[0]
        return f"https://www.dunnesstoresgrocery.com{path}", slug, None
        
    except Exception as e:
        return None, None, str(e)


def extract_dunnes_price(product_url):
    """Extract price from Dunnes product page."""
    try:
        resp = sb_fetch(product_url)
        if resp.status_code != 200:
            return None, None, f"HTTP {resp.status_code}"
        
        html = resp.text
        
        if len(html) < 5000:
            return None, None, "Blocked by bot detection"
        
        # JSON-LD
        json_ld_blocks = re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', html, re.DOTALL | re.IGNORECASE)
        for block in json_ld_blocks:
            try:
                data = json.loads(block)
                if isinstance(data, list):
                    data = data[0]
                if data.get("@type") == "Product" and data.get("offers"):
                    offers = data["offers"]
                    if isinstance(offers, list):
                        offers = offers[0]
                    price = float(offers.get("price", 0))
                    if price > 0:
                        return price, data.get("name", ""), None
            except:
                pass
        
        patterns = [
            r'class="[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+\.?\d*)',
            r'"price":\s*"?([0-9]+\.?[0-9]*)"?',
            r'€(\d+\.\d{2})',
        ]
        
        for p in patterns:
            m = re.search(p, html, re.IGNORECASE)
            if m:
                try:
                    price = float(m.group(1))
                    if price > 0:
                        name_m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html, re.IGNORECASE)
                        return price, (name_m.group(1) if name_m else ""), None
                except:
                    pass
        
        return None, None, "No price found"
        
    except Exception as e:
        return None, None, str(e)


# ============================================================
# ALDI URL RESOLVER + PRICE EXTRACTOR
# ============================================================

def resolve_aldi_url(product_name):
    """Fetch Aldi search and extract first product URL."""
    query = urllib.parse.quote(product_name)
    url = f"https://groceries.aldi.ie/en-GB/Search?keywords={query}"

    try:
        resp = sb_fetch(url)
        if resp.status_code != 200:
            return None, None, f"HTTP {resp.status_code}"
        
        html = resp.text
        
        if len(html) < 3000:
            return None, None, "Blocked or empty response"
        
        # Aldi product URLs: /en-GB/p-[slug]
        product_links = re.findall(r'href="(/en-GB/p-([^"?]+))"', html)
        if not product_links:
            # Check if we're on the right page at all
            if "aldi" not in html.lower() and "groceries" not in html.lower():
                return None, None, f"Unexpected page content (len={len(html)})"
            return None, None, "No product links found"
        
        path, slug = product_links[0]
        sku = slug.split(".")[0] if "." in slug else slug
        return f"https://groceries.aldi.ie{path}", sku, None
        
    except Exception as e:
        return None, None, str(e)


def extract_aldi_price(product_url):
    """Extract price from Aldi product page."""
    try:
        resp = sb_fetch(product_url)
        if resp.status_code != 200:
            return None, None, f"HTTP {resp.status_code}"
        
        html = resp.text
        
        # JSON-LD
        json_ld_blocks = re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', html, re.DOTALL | re.IGNORECASE)
        for block in json_ld_blocks:
            try:
                data = json.loads(block)
                if isinstance(data, list):
                    data = data[0]
                if data.get("@type") == "Product" and data.get("offers"):
                    offers = data["offers"]
                    if isinstance(offers, list):
                        offers = offers[0]
                    price = float(offers.get("price", 0))
                    if price > 0:
                        return price, data.get("name", ""), None
            except:
                pass
        
        patterns = [
            r'class="[^"]*product[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+\.?\d*)',
            r'"price":\s*"?([0-9]+\.?[0-9]*)"?',
            r'€(\d+\.\d{2})',
        ]
        
        for p in patterns:
            m = re.search(p, html, re.IGNORECASE)
            if m:
                try:
                    price = float(m.group(1))
                    if price > 0:
                        name_m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html, re.IGNORECASE)
                        return price, (name_m.group(1) if name_m else ""), None
                except:
                    pass
        
        return None, None, "No price found"
        
    except Exception as e:
        return None, None, str(e)


# ============================================================
# MAIN PIPELINE
# ============================================================

def insert_price_observation(store_product_id, price, product_name, product_url, store):
    """Insert a price observation into Supabase."""
    data = {
        "store_product_id": store_product_id,
        "price": price,
        "scraped_product_name": product_name,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "source_url": product_url,
    }
    ok, status, resp = supabase_post("price_observations", data)
    return ok


def process_store(store, resolve_fn, extract_fn, limit=10):
    """Process a store: resolve URLs then extract prices."""
    print(f"\n{'='*60}")
    print(f"Processing {store.upper()} (limit={limit})")
    print('='*60)
    
    # Get store_products for this store that don't have resolved URLs
    store_products = supabase_get(
        "store_products",
        f"store=eq.{store}&url_status=neq.resolved&select=id,store,store_product_name,store_url,store_sku,url_status&limit={limit}"
    )
    
    if not store_products:
        print(f"  No unresolved products for {store}")
        return
    
    print(f"  Found {len(store_products)} products to process")
    
    for sp in store_products:
        sp_id = sp["id"]
        name = sp["store_product_name"]
        search_url = sp["store_url"]
        
        print(f"\n  Product: {name}")
        print(f"  Search URL: {search_url[:70]}...")
        
        # Step 1: Resolve URL
        results[store]["fetched"] += 1
        
        if store == "aldi":
            product_url, sku, err = resolve_fn(name)
        else:
            product_url, sku, err = resolve_fn(search_url, name)
        
        if err or not product_url:
            print(f"  ✗ URL resolve failed: {err}")
            results[store]["errors"].append(f"URL resolve: {name}: {err}")
            # Update status to 'failed'
            supabase_patch("store_products", sp_id, {"url_status": "failed"})
            time.sleep(2)
            continue
        
        print(f"  ✓ Resolved URL: {product_url}")
        print(f"  ✓ SKU: {sku}")
        results[store]["resolved"] += 1
        
        # Update Supabase with resolved URL
        ok, status = supabase_patch("store_products", sp_id, {
            "store_url": product_url,
            "store_sku": str(sku) if sku else None,
            "url_status": "resolved",
        })
        
        if not ok:
            print(f"  ✗ DB update failed: HTTP {status}")
        
        time.sleep(2)  # Be nice to ScrapingBee rate limits
        
        # Step 2: Extract price
        price, product_name, err = extract_fn(product_url)
        
        if err or price is None:
            print(f"  ✗ Price extract failed: {err}")
            results[store]["errors"].append(f"Price extract: {name}: {err}")
            time.sleep(2)
            continue
        
        print(f"  ✓ Price: €{price:.2f} ({product_name})")
        results[store]["prices"] += 1
        
        # Insert price observation
        ok = insert_price_observation(sp_id, price, product_name or name, product_url, store)
        if ok:
            print(f"  ✓ Price observation inserted")
        else:
            print(f"  ✗ Price observation insert failed")
        
        time.sleep(2)


def main():
    print("🚀 Supermarket.ie Scraping Pipeline")
    print(f"  Started: {datetime.now().isoformat()}")
    print(f"  ScrapingBee key: {SBKEY[:10]}...")
    
    # Quick ScrapingBee credit check
    credit_resp = requests.get(
        f"https://app.scrapingbee.com/api/v1/usage?api_key={SBKEY}"
    )
    if credit_resp.ok:
        usage = credit_resp.json()
        print(f"  Credits remaining: {usage.get('max_api_credits', '?') - usage.get('used_api_credits', 0)}")

    # Process each store with limits to avoid burning credits
    # Processing 5 products per store = ~50 ScrapingBee calls (2 per product)
    LIMIT_PER_STORE = 5
    
    print(f"\n📋 Processing {LIMIT_PER_STORE} products per store\n")
    
    # Tesco
    process_store("tesco", resolve_tesco_url, extract_tesco_price, LIMIT_PER_STORE)
    
    # SuperValu  
    process_store("supervalu", resolve_supervalu_url, extract_supervalu_price, LIMIT_PER_STORE)
    
    # Lidl
    process_store("lidl", resolve_lidl_url, extract_lidl_price, LIMIT_PER_STORE)
    
    # Dunnes (may be blocked)
    process_store("dunnes", resolve_dunnes_url, extract_dunnes_price, LIMIT_PER_STORE)
    
    # Aldi (no existing rows, but let's try)
    print(f"\n{'='*60}")
    print("ALDI - checking for existing rows...")
    aldi_products = supabase_get("store_products", "store=eq.aldi&select=id,store_product_name&limit=5")
    if aldi_products:
        process_store("aldi", resolve_aldi_url, extract_aldi_price, LIMIT_PER_STORE)
    else:
        print("  No Aldi rows exist yet - skipping")
        results["aldi"]["errors"].append("No rows in DB for Aldi")
    
    # Summary
    print(f"\n{'='*60}")
    print("📊 PIPELINE SUMMARY")
    print('='*60)
    total_resolved = 0
    total_prices = 0
    
    for store, r in results.items():
        if r["fetched"] > 0 or r["errors"]:
            print(f"\n{store.upper()}:")
            print(f"  Fetched:   {r['fetched']}")
            print(f"  Resolved:  {r['resolved']}")
            print(f"  Prices:    {r['prices']}")
            if r["errors"]:
                print(f"  Errors ({len(r['errors'])}):")
                for e in r["errors"][:3]:
                    print(f"    - {e}")
            total_resolved += r["resolved"]
            total_prices += r["prices"]
    
    print(f"\nTOTAL: {total_resolved} URLs resolved, {total_prices} prices extracted")
    
    # Save results to file
    report = {
        "timestamp": datetime.now().isoformat(),
        "results": results,
        "total_resolved": total_resolved,
        "total_prices": total_prices,
    }
    
    report_path = "/tmp/scrape_results.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    
    print(f"\n✓ Results saved to {report_path}")
    return report


if __name__ == "__main__":
    main()
