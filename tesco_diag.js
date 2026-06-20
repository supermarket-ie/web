const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
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
  });

  const page = await context.newPage();
  
  // Warmup
  console.log('Warming up...');
  await page.goto('https://www.tesco.ie/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);
  
  // Search for a product that "failed" on Jun 18
  const queries = ['Chicken Tikka Deli Fille 175g', 'Butter Unsalted 250g', 'milk'];
  
  for (const q of queries) {
    console.log(`\nSearching: "${q}"`);
    const url = `https://www.tesco.ie/shop/en-IE/search?query=${encodeURIComponent(q)}`;
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`  Status: ${resp.status()}`);
    await page.waitForTimeout(4000);
    
    const title = await page.title();
    console.log(`  Title: ${title}`);
    
    const productCount = await page.evaluate(() => 
      document.querySelectorAll('a[href*="/products/"]').length
    );
    console.log(`  Product links: ${productCount}`);
    
    if (productCount === 0) {
      // What's on the page?
      const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500));
      console.log(`  Body text: ${bodyText?.substring(0, 200)}`);
    }
  }
  
  await browser.close();
})();
