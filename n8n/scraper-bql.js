/**
 * BrowserQL Scraper for Irish Supermarkets
 * Works with n8n HTTP Request node or standalone
 */

const BROWSERLESS_TOKEN = '2TuuzibwrqehVXH57f5d0e3318139ae2c459efca12b04fe10';
const BQL_ENDPOINT = `https://chrome.browserless.io/chromium/bql?token=${BROWSERLESS_TOKEN}`;

// Store-specific search URL patterns
const STORE_URLS = {
  tesco: (query) => `https://www.tesco.ie/groceries/en-IE/search?query=${encodeURIComponent(query)}`,
  supervalu: (query) => `https://shop.supervalu.ie/shopping/search?query=${encodeURIComponent(query)}`,
  // Dunnes requires different approach - their grocery site structure is different
  // Lidl doesn't have online grocery shopping - use offers page
};

// BQL query to get page text content
const BQL_QUERY = `
mutation ScrapeProduct($url: String!) {
  goto(url: $url, waitUntil: networkIdle) {
    status
  }
  text {
    text
  }
}
`;

/**
 * Parse Tesco price data from page text
 */
function parseTescoText(text, productName) {
  const lines = text.split('\n');
  const results = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Look for product names that match
    if (line.toLowerCase().includes(productName.toLowerCase().split(' ')[0])) {
      // Look for price in nearby lines
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        const priceLine = lines[j];
        const priceMatch = priceLine.match(/€(\d+\.\d{2})/);
        const perUnitMatch = priceLine.match(/€(\d+\.\d{2})\/(litre|kg|100g|100ml)/i);
        
        if (priceMatch) {
          results.push({
            name: line,
            price: parseFloat(priceMatch[1]),
            pricePerUnit: perUnitMatch ? parseFloat(perUnitMatch[1]) : null,
            unit: perUnitMatch ? perUnitMatch[2] : null
          });
          break;
        }
      }
    }
  }
  
  return results;
}

/**
 * Parse SuperValu price data from page text
 */
function parseSuperValuText(text, productName) {
  const results = [];
  
  // SuperValu format: "ProductName\n€X.XX\n€X.XX/unit"
  // Also handles "was €X.XX" for promotions
  const regex = new RegExp(
    `([^\\n]*${productName.split(' ')[0]}[^\\n]*)\\n` +
    `(?:Save[^\\n]*\\n)?` +  // Optional "Save X%" line
    `€(\\d+\\.\\d{2})\\n` +
    `(?:was €(\\d+\\.\\d{2})\\n)?` +  // Optional "was" price
    `€(\\d+\\.\\d{2})\\/([a-z]+)`,  // Price per unit
    'gi'
  );
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({
      name: match[1].trim(),
      price: parseFloat(match[2]),
      wasPrice: match[3] ? parseFloat(match[3]) : null,
      onPromotion: !!match[3],
      pricePerUnit: parseFloat(match[4]),
      unit: match[5]
    });
  }
  
  return results;
}

/**
 * Main scrape function
 */
async function scrapeProduct(store, productName) {
  const urlFn = STORE_URLS[store];
  if (!urlFn) {
    throw new Error(`Unknown store: ${store}`);
  }
  
  const url = urlFn(productName);
  
  const response = await fetch(BQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: BQL_QUERY,
      variables: { url }
    })
  });
  
  const data = await response.json();
  const pageText = data?.data?.text?.text || '';
  
  // Parse based on store
  let results;
  switch (store) {
    case 'tesco':
      results = parseTescoText(pageText, productName);
      break;
    case 'supervalu':
      results = parseSuperValuText(pageText, productName);
      break;
    default:
      results = [];
  }
  
  return {
    store,
    query: productName,
    url,
    results,
    scrapedAt: new Date().toISOString()
  };
}

// Export for n8n Code node
module.exports = { scrapeProduct, parseTescoText, parseSuperValuText };
