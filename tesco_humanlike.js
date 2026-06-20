const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
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
  
  // Warmup - load homepage with full network idle
  console.log('Loading homepage (networkidle)...');
  await page.goto('https://www.tesco.ie/', { waitUntil: 'networkidle', timeout: 60000 });
  
  // Simulate human-like interactions
  console.log('Simulating human activity...');
  await page.mouse.move(500, 300);
  await page.waitForTimeout(1000);
  await page.mouse.move(800, 400);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollBy(0, -100));
  await page.waitForTimeout(2000);
  
  // Wait for Akamai to process
  await page.waitForTimeout(5000);
  
  // Check _abck cookie value length (valid ones are longer)
  const cookies = await context.cookies();
  const abck = cookies.find(c => c.name === '_abck');
  console.log(`_abck cookie length: ${abck?.value?.length || 0}`);
  console.log(`_abck first 50 chars: ${abck?.value?.substring(0, 50)}`);
  
  // Now try search
  console.log('\nTrying search...');
  const resp = await page.goto('https://www.tesco.ie/shop/en-IE/search?query=milk', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log(`Status: ${resp.status()}`);
  await page.waitForTimeout(4000);
  
  const products = await page.evaluate(() => 
    document.querySelectorAll('a[href*="/products/"]').length
  );
  console.log(`Products: ${products}`);
  
  if (products === 0) {
    // Try using the search input ON the homepage instead of direct URL
    console.log('\nTrying via homepage search box...');
    await page.goto('https://www.tesco.ie/', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3000);
    
    // Look for search input
    const searchInput = await page.$('input[type="search"], input[name="query"], input[placeholder*="search" i], input[placeholder*="Search" i]');
    if (searchInput) {
      console.log('Found search input, typing...');
      await searchInput.click();
      await page.waitForTimeout(500);
      await searchInput.type('milk', { delay: 100 });
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(5000);
      
      const newUrl = page.url();
      console.log(`New URL: ${newUrl}`);
      const products2 = await page.evaluate(() => 
        document.querySelectorAll('a[href*="/products/"]').length
      );
      console.log(`Products (via search box): ${products2}`);
    } else {
      console.log('No search input found');
      // List all inputs
      const inputs = await page.evaluate(() => 
        Array.from(document.querySelectorAll('input')).map(i => ({type: i.type, name: i.name, placeholder: i.placeholder, id: i.id}))
      );
      console.log('Available inputs:', JSON.stringify(inputs.slice(0, 5)));
    }
  }
  
  await browser.close();
})();
