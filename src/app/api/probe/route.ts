import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url') || 'https://www.tesco.ie/shop/en-IE/search?query=milk';
  
  try {
    const resp = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IE,en;q=0.9',
      },
    });
    
    const text = await resp.text();
    const hasProducts = text.includes('/products/');
    const productCount = (text.match(/\/products\//g) || []).length;
    const title = text.match(/<title>(.*?)<\/title>/)?.[1] || 'no title';
    
    return NextResponse.json({
      status: resp.status,
      title,
      hasProducts,
      productCount,
      bodyLength: text.length,
      snippet: text.substring(0, 500),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
