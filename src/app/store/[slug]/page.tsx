import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await supabaseAdmin.from('vendors').select('name, description').eq('slug', slug).eq('status', 'active').single();
  if (!data) return { title: 'Store not found' };
  return {
    title: `${data.name} · supermarket.ie`,
    description: data.description ?? `Shop at ${data.name} on supermarket.ie`,
    alternates: { canonical: `${BASE_URL}/store/${slug}` },
  };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const { data: vendor } = await supabaseAdmin
    .from('vendors')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'active')
    .single();

  if (!vendor) notFound();

  const { data: products } = await supabaseAdmin
    .from('vendor_products')
    .select('*, products(id, canonical_name, category)')
    .eq('vendor_id', vendor.id)
    .eq('in_stock', true)
    .order('price', { ascending: true });

  const grouped = new Map<string, typeof products>();
  for (const p of products ?? []) {
    const cat = (p.products as { category: string | null } | null)?.category ?? 'Other';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(p);
  }

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <header className="px-6 py-4 border-b border-[#E8E2DC] bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-base font-bold text-[#1D2324]">supermarket<span className="text-[#006A35]">.ie</span></Link>
          <Link href="/browse" className="text-sm text-[#636E72] hover:text-[#1D2324] transition">Browse all →</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-16">
        {/* Store header */}
        <div className="py-8 border-b border-[#E8E2DC] mb-8">
          <div className="flex items-start gap-4">
            {vendor.logo_url ? (
              <img src={vendor.logo_url} alt={vendor.name} className="w-16 h-16 rounded-2xl object-cover border border-[#E8E2DC] flex-shrink-0"/>
            ) : (
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl text-[#004a23] font-bold flex-shrink-0" style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
                {vendor.name.charAt(0)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-[#1D2324]">{vendor.name}</h1>
              {vendor.description && <p className="text-[#636E72] mt-1 text-sm">{vendor.description}</p>}
              <div className="flex flex-wrap gap-3 mt-3">
                {vendor.eircode && (
                  <span className="flex items-center gap-1.5 text-xs text-[#636E72]">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    {vendor.eircode}
                  </span>
                )}
                {vendor.delivery_radius_km > 0 && (
                  <span className="flex items-center gap-1.5 text-xs text-[#636E72]">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    Delivers up to {vendor.delivery_radius_km}km
                  </span>
                )}
                {vendor.click_and_collect && (
                  <span className="flex items-center gap-1.5 text-xs text-[#5D9B8F] font-medium">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                    Click & collect
                  </span>
                )}
              </div>
              {vendor.categories?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {vendor.categories.map((c: string) => (
                    <span key={c} className="text-[11px] bg-[#F5F0EB] text-[#636E72] px-2 py-0.5 rounded-full font-medium">{c}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Products */}
        {grouped.size === 0 ? (
          <div className="text-center py-12 text-[#636E72]">
            <div className="text-4xl mb-3">📦</div>
            <p>No products listed yet.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {Array.from(grouped.entries()).map(([category, items]) => (
              <section key={category}>
                <h2 className="text-sm font-bold text-[#636E72] uppercase tracking-wider mb-3">{category}</h2>
                <div className="bg-white rounded-2xl border border-[#E8E2DC] divide-y divide-[#F5F0EB]">
                  {items!.map(item => {
                    const name = (item.products as { canonical_name: string } | null)?.canonical_name ?? item.custom_name ?? 'Product';
                    return (
                      <div key={item.id} className="flex items-center justify-between px-4 py-3.5 gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[#1D2324]">{name}</div>
                          {item.custom_description && <div className="text-xs text-[#B2BEC3] mt-0.5">{item.custom_description}</div>}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          {item.compare_at_price && item.compare_at_price > item.price && (
                            <span className="text-xs text-[#B2BEC3] line-through">€{item.compare_at_price.toFixed(2)}</span>
                          )}
                          <span className="font-bold text-[#1D2324]">€{item.price.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="py-6 px-6 border-t border-[#E8E2DC]">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3 text-sm text-[#B2BEC3]">
          <Link href="/" className="font-bold text-[#1D2324]">supermarket.ie</Link>
          <Link href="/vendor" className="hover:text-[#636E72]">List your store →</Link>
        </div>
      </footer>
    </div>
  );
}
