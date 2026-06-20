const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
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
  
  // Load homepage
  console.log('Loading homepage...');
  await page.goto('https://www.tesco.ie/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  
  // Simulate human: scroll, move mouse, wait for Akamai sensor
  console.log('Human-like interaction (15s)...');
  await page.waitForTimeout(3000);
  await page.mouse.move(400, 300);
  await page.waitForTimeout(1000);
  await page.mouse.move(700, 500);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(2000);
  await page.mouse.move(300, 200);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollBy(0, -200));
  await page.waitForTimeout(3000);
  // Click something benign (not a link)
  await page.mouse.click(600, 600);
  await page.waitForTimeout(3000);
  
  const cookies = await context.cookies();
  const abck = cookies.find(c => c.name === '_abck');
  console.log(`_abck length: ${abck?.value?.length || 0}`);
  
  // Try search
  console.log('\nTrying search...');
  const resp = await page.goto('https://www.tesco.ie/shop/en-IE/search?query=milk', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log(`Status: ${resp.status()}`);
  await page.waitForTimeout(5000);
  
  const products = await page.evaluate(() => 
    document.querySelectorAll('a[href*="/products/"]').length
  );
  console.log(`Products: ${products}`);
  
  if (products === 0) {
    const title = await page.title();
    console.log(`Title: ${title}`);
    console.log('Still blocked after human-like warmup');
  } else {
    console.log('SUCCESS - search working');
  }
  
  await browser.close();
})();
