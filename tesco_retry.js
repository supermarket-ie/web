const { chromium } = require('playwright');

(async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`\n=== Attempt ${attempt} ===`);
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
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-IE', 'en'] });
    });

    const page = await context.newPage();
    
    // Warmup - load homepage
    const homeResp = await page.goto('https://www.tesco.ie/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    console.log(`  Homepage: ${homeResp.status()}`);
    
    // Wait longer for Akamai sensor scripts to fire
    await page.waitForTimeout(8000);
    
    // Check what cookies we got
    const cookies = await context.cookies();
    const akamaiCookies = cookies.filter(c => c.name.includes('ak') || c.name.includes('bm_') || c.name.includes('_abck'));
    console.log(`  Cookies: ${cookies.length} total, Akamai-like: ${akamaiCookies.map(c => c.name).join(', ')}`);
    
    // Try search
    const searchResp = await page.goto('https://www.tesco.ie/shop/en-IE/search?query=milk', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`  Search status: ${searchResp.status()}`);
    await page.waitForTimeout(4000);
    
    const productCount = await page.evaluate(() => 
      document.querySelectorAll('a[href*="/products/"]').length
    );
    console.log(`  Products: ${productCount}`);
    
    if (productCount === 0 && searchResp.status() === 403) {
      console.log(`  BLOCKED - trying networkidle warmup next time...`);
    }
    
    await browser.close();
    
    // Wait between attempts
    if (attempt < 3) await new Promise(r => setTimeout(r, 5000));
  }
})();
