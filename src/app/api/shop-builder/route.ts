import { getAllLatestPrices } from '@/lib/price-data';
import { buildShopCatalogue, searchShopCatalogue } from '@/lib/shop-builder-catalogue';
import { SHOP_BUILDER_LIMIT } from '@/lib/shop-builder';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get('q')?.trim() ?? '';
  const ids = params.get('ids')?.split(',').filter(Boolean) ?? [];
  if (ids.length ? ids.length > SHOP_BUILDER_LIMIT || ids.some(id => !/^[a-f\d-]{36}$/i.test(id)) : query.length < 2 || query.length > 80) {
    return Response.json({ error: 'Search for a product using 2–80 characters.' }, { status: 400 });
  }
  try {
    const catalogue = buildShopCatalogue(await getAllLatestPrices());
    const selectedIds = new Set(ids);
    const products = ids.length ? catalogue.filter(product => selectedIds.has(product.id)) : searchShopCatalogue(catalogue, query);
    return Response.json({ products }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' } });
  } catch {
    return Response.json({ error: 'Product prices are temporarily unavailable. Please try again.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
