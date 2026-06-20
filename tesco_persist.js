const { chromium } = require('playwright');
const fs = require('fs');

const STATE_FILE = '/tmp/tesco_browser_state.json';

(async () => {
  // Check if we have saved state
  let storageState = undefined;
  if (fs.existsSync(STATE_FILE)) {
    console.log('Loading saved browser state...');
    storageState = STATE_FILE;
  }

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  
  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-IE',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: { 'Accept-Language': 'en-IE,en;q=0.9' },
  };
  
  if (storageState) contextOptions.storageState = storageState;

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IE', 'en'] });
  });

  const page = await context.newPage();
  
  if (!storageState) {
    // Fresh start — do full warmup
    console.log('Fresh start, warming up on homepage...');
    await page.goto('https://www.tesco.ie/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(8000);
  }
  
  // Try search directly (with or without saved state)
  console.log('Trying search...');
  const resp = await page.goto('https://www.tesco.ie/shop/en-IE/search?query=butter', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log(`Status: ${resp.status()}`);
  await page.waitForTimeout(4000);
  
  const products = await page.evaluate(() => 
    document.querySelectorAll('a[href*="/products/"]').length
  );
  console.log(`Products: ${products}`);
  
  if (products > 0) {
    console.log('SUCCESS! Saving browser state...');
    await context.storageState({ path: STATE_FILE });
    console.log('State saved to', STATE_FILE);
  } else {
    const title = await page.title();
    console.log(`Blocked (title: ${title})`);
    
    // If blocked, try homepage warmup even with existing state
    if (storageState) {
      console.log('Saved state expired, re-warming...');
      await page.goto('https://www.tesco.ie/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(8000);
      
      const resp2 = await page.goto('https://www.tesco.ie/shop/en-IE/search?query=butter', { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log(`Retry status: ${resp2.status()}`);
      await page.waitForTimeout(4000);
      
      const products2 = await page.evaluate(() => 
        document.querySelectorAll('a[href*="/products/"]').length
      );
      console.log(`Retry products: ${products2}`);
      
      if (products2 > 0) {
        await context.storageState({ path: STATE_FILE });
        console.log('State re-saved');
      }
    }
  }
  
  await browser.close();
})();
