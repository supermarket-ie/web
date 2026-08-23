import { NextResponse } from 'next/server';
import { resolveCatalogueProduct, resolveHybridCatalogueProduct } from '@/lib/catalogue-resolution';
import { extractCatalogueFragment } from '@/lib/agent-suggestions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (input.length < 2) return NextResponse.json({ products: [] });

  const fragment = extractCatalogueFragment(input);
  if (fragment.length < 2) return NextResponse.json({ products: [] });

  try {
    let candidates = await resolveHybridCatalogueProduct(fragment, 4);
    if (candidates.length === 0) {
      const relaxed = fragment
        .split(' ')
        .map(token => token.length > 5 && token.endsWith('s') ? token.slice(0, -1) : token)
        .join(' ');
      if (relaxed !== fragment) candidates = await resolveCatalogueProduct(relaxed, 4);
    }
    return NextResponse.json({
      products: candidates.map(candidate => ({
        name: candidate.canonical_name,
        category: candidate.category,
        best_price: candidate.best_price,
        best_store: candidate.best_store,
        on_promotion: candidate.on_promotion,
      })),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
    });
  } catch {
    return NextResponse.json({ products: [] });
  }
}
