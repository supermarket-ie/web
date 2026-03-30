import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

const REVALIDATE_SECRET = (process.env.REVALIDATE_SECRET || '').trim();

export async function POST(req: NextRequest) {
  const { secret } = await req.json().catch(() => ({}));
  const trimmedSecret = (secret || '').trim();

  if (!REVALIDATE_SECRET || trimmedSecret !== REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Revalidate all price-sensitive pages
  const paths = [
    '/compare/tesco-vs-dunnes-vs-supervalu',
    '/shop',
    '/shop/dairy',
    '/shop/meat',
    '/shop/vegetables',
    '/shop/fruit',
    '/shop/bakery',
    '/shop/breakfast',
    '/shop/pasta-&-rice',
    '/shop/tinned',
    '/shop/condiments',
    '/shop/beverages',
    '/shop/snacks',
    '/shop/frozen',
    '/shop/dairy-alternatives',
    '/shop/household',
    '/shop/personal-care',
    '/shop/baking',
    '/shop/spreads',
    '/shop/fish',
  ];

  for (const path of paths) {
    revalidatePath(path);
  }

  return NextResponse.json({
    revalidated: true,
    paths: paths.length,
    timestamp: new Date().toISOString(),
  });
}
