const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-IE',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: { 'Accept-Language': 'en-IE,en;q=0.9' },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IE', 'en'] });
  });

  const page = await context.newPage();
  
  // Step 1: Hit homepage for cookies
  console.log('[1] Loading homepage...');
  const homeResp = await page.goto('https://www.tesco.ie/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log(`    Status: ${homeResp.status()}`);
  await page.waitForTimeout(6000);
  const homeTitle = await page.title();
  console.log(`    Title: ${homeTitle}`);
  
  if (homeTitle.includes('Access Denied')) {
    console.log('    BLOCKED on homepage');
    await browser.close();
    process.exit(1);
  }

  // Step 2: Try search
  console.log('[2] Trying search for "milk"...');
  const searchResp = await page.goto('https://www.tesco.ie/shop/en-IE/search?query=milk', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log(`    Status: ${searchResp.status()}`);
  await page.waitForTimeout(4000);
  const searchTitle = await page.title();
  console.log(`    Title: ${searchTitle}`);
  
  const html = await page.content();
  if (html.includes('Access Denied')) {
    console.log('    BLOCKED on search');
  } else {
    // Count product links
    const productLinks = await page.evaluate(() => {
      return document.querySelectorAll('a[href*="/products/"]').length;
    });
    console.log(`    Product links found: ${productLinks}`);
    
    // Try to extract a price
    const firstProduct = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/products/"]');
      if (links.length === 0) return null;
      const a = links[0];
      return { href: a.getAttribute('href'), text: a.textContent?.substring(0, 80) };
    });
    if (firstProduct) console.log(`    First product: ${JSON.stringify(firstProduct)}`);
  }
  
  // Step 3: Try a direct product page
  console.log('[3] Trying product page...');
  const prodResp = await page.goto('https://www.tesco.ie/shop/en-IE/products/260776455', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log(`    Status: ${prodResp.status()}`);
  await page.waitForTimeout(3000);
  const prodTitle = await page.title();
  console.log(`    Title: ${prodTitle}`);
  
  const prodHtml = await page.content();
  if (prodHtml.includes('Access Denied')) {
    console.log('    BLOCKED on product page');
  } else {
    // Check for price
    const priceMatch = prodHtml.match(/€(\d+\.\d{2})/);
    if (priceMatch) console.log(`    Price found: €${priceMatch[1]}`);
    else console.log('    No price found in HTML');
  }

  await browser.close();
  console.log('\n[done]');
})();
