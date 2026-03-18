import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { NUTRITION } from '@/lib/nutrition-data';

export const metadata: Metadata = {
  title: 'Browse Weekly Grocery List · supermarket.ie',
  description: 'Browse our curated weekly grocery essentials for Irish families. See all products by category — sign in to unlock real-time prices from Tesco, Dunnes, SuperValu, Lidl and Aldi.',
  openGraph: {
    title: 'Browse Weekly Grocery List · supermarket.ie',
    description: 'Curated grocery essentials for Irish families. Free to browse — sign in for live prices.',
    url: 'https://supermarket.ie/browse',
  },
};

// Category display config — order + emoji
const CATEGORY_CONFIG: Record<string, { emoji: string; order: number }> = {
  'Bakery':        { emoji: '🍞', order: 1 },
  'Dairy':         { emoji: '🥛', order: 2 },
  'Meat & Fish':   { emoji: '🥩', order: 3 },
  'Fruit':         { emoji: '🍎', order: 4 },
  'Vegetables':    { emoji: '🥦', order: 5 },
  'Frozen':        { emoji: '🧊', order: 6 },
  'Pantry':        { emoji: '🥫', order: 7 },
  'Breakfast':     { emoji: '🥣', order: 8 },
  'Baking':        { emoji: '🎂', order: 9 },
  'Condiments':    { emoji: '🫙', order: 10 },
  'Oils & Fats':   { emoji: '🫒', order: 11 },
  'Rice & Pasta':  { emoji: '🍝', order: 12 },
  'Spices':        { emoji: '🧂', order: 13 },
  'Other':         { emoji: '🛒', order: 99 },
};

interface Product {
  id: string;
  canonical_name: string;
  category: string | null;
  storeCount: number;
}

async function getProducts(): Promise<Product[]> {
  const { data, error } = await supabaseAdmin
    .from('store_products')
    .select('product_id, store, products(id, canonical_name, category)')
    .eq('url_status', 'resolved');

  if (error || !data) return [];

  // Aggregate by product
  const map = new Map<string, { id: string; canonical_name: string; category: string | null; stores: Set<string> }>();
  for (const row of data) {
    const raw = row.products;
    const p = (Array.isArray(raw) ? raw[0] : raw) as { id: string; canonical_name: string; category: string | null } | null;
    if (!p) continue;
    if (!map.has(p.id)) {
      map.set(p.id, { id: p.id, canonical_name: p.canonical_name, category: p.category, stores: new Set() });
    }
    map.get(p.id)!.stores.add(row.store);
  }

  return Array.from(map.values()).map(({ stores, ...rest }) => ({ ...rest, storeCount: stores.size }));
}

function groupByCategory(products: Product[]) {
  const groups = new Map<string, Product[]>();
  for (const p of products) {
    const cat = p.category ?? 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(p);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    const oa = CATEGORY_CONFIG[a]?.order ?? 99;
    const ob = CATEGORY_CONFIG[b]?.order ?? 99;
    return oa !== ob ? oa - ob : a.localeCompare(b);
  });
}

export default async function BrowsePage() {
  const products = await getProducts();
  const grouped = groupByCategory(products);
  const totalProducts = products.length;
  const storeNames = ['Tesco', 'Dunnes', 'SuperValu', 'Lidl', 'Aldi'];

  return (
    <div className="min-h-screen bg-[#FFFBF7]">
      {/* Header */}
      <header className="px-6 py-4 border-b border-[#E8E2DC] bg-white/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="relative w-8 h-8">
              <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <path d="M8 12C8 10.8954 8.89543 10 10 10H30C31.1046 10 32 10.8954 32 12V32C32 34.2091 30.2091 36 28 36H12C9.79086 36 8 34.2091 8 32V12Z" fill="#E17055"/>
                <path d="M14 10V8C14 5.79086 15.7909 4 18 4H22C24.2091 4 26 5.79086 26 8V10" stroke="#E17055" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M20 17L17 30" stroke="#FFFBF7" strokeWidth="4" strokeLinecap="round"/>
                <path d="M18 17C18 17 19 15 20 15C21 15 22 17 22 17" stroke="#00B894" strokeWidth="2" strokeLinecap="round"/>
                <path d="M20 15V13" stroke="#00B894" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-[20px] font-bold tracking-tight text-[#1D2324]">
              supermarket<span className="text-[#1D2324]">.ie</span>
            </span>
          </Link>
          <Link
            href="/list/request"
            className="bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all shadow-sm"
          >
            Sign in for prices →
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-10 md:py-14 border-b border-[#E8E2DC]">
        <div className="max-w-5xl mx-auto">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-[#FEF3E2] text-[#E17055] px-3 py-1.5 rounded-full text-sm font-medium mb-4">
              <span className="w-2 h-2 bg-[#00B894] rounded-full"></span>
              {totalProducts} weekly essentials
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-[#1D2324] mb-3 leading-tight">
              Your weekly grocery list
            </h1>
            <p className="text-[#636E72] text-lg mb-5">
              Curated essentials for Irish families — with nutrition info included.
              Sign in to unlock live prices from all 5 supermarkets.
            </p>
            <div className="flex flex-wrap gap-2 mb-6">
              {storeNames.map(s => (
                <span key={s} className="px-3 py-1 bg-white border border-[#E8E2DC] rounded-full text-sm font-medium text-[#636E72]">
                  {s}
                </span>
              ))}
            </div>
            {/* Pricing CTA banner */}
            <div className="bg-white border border-[#E8E2DC] rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-[#FEF3E2] flex items-center justify-center flex-shrink-0 text-xl">
                🔒
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[#1D2324] text-sm">Prices are hidden</div>
                <div className="text-[#636E72] text-sm">Sign in free to see live prices and save €20+ a week</div>
              </div>
              <Link
                href="/list/request"
                className="flex-shrink-0 bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all shadow-sm whitespace-nowrap"
              >
                Unlock prices
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Category nav */}
      <nav className="sticky top-[61px] z-20 bg-white/90 backdrop-blur-sm border-b border-[#E8E2DC] px-6 py-3 overflow-x-auto">
        <div className="max-w-5xl mx-auto flex gap-2 min-w-max">
          {grouped.map(([cat]) => {
            const cfg = CATEGORY_CONFIG[cat] ?? { emoji: '🛒' };
            return (
              <a
                key={cat}
                href={`#cat-${cat.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-[#636E72] hover:text-[#1D2324] hover:bg-[#F5F0EB] transition whitespace-nowrap"
              >
                <span>{cfg.emoji}</span>
                <span>{cat}</span>
              </a>
            );
          })}
        </div>
      </nav>

      {/* Product list */}
      <main className="px-6 py-8">
        <div className="max-w-5xl mx-auto space-y-12">
          {grouped.map(([cat, items]) => {
            const cfg = CATEGORY_CONFIG[cat] ?? { emoji: '🛒', order: 99 };
            const catId = `cat-${cat.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
            return (
              <section key={cat} id={catId} className="scroll-mt-28">
                {/* Category header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#F5F0EB] flex items-center justify-center text-xl flex-shrink-0">
                    {cfg.emoji}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[#1D2324]">{cat}</h2>
                    <div className="text-sm text-[#636E72]">{items.length} item{items.length !== 1 ? 's' : ''}</div>
                  </div>
                </div>

                {/* Items grid */}
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)).map(product => {
                    const nutrition = NUTRITION[product.canonical_name];
                    return (
                      <div
                        key={product.id}
                        className="bg-white rounded-xl border border-[#E8E2DC] p-4 hover:border-[#D4604A]/30 hover:shadow-sm transition-all"
                      >
                        {/* Product name */}
                        <div className="font-semibold text-[#1D2324] text-sm mb-2 leading-snug">
                          {product.canonical_name}
                        </div>

                        {/* Store count */}
                        <div className="text-xs text-[#636E72] mb-3">
                          Available at {product.storeCount} store{product.storeCount !== 1 ? 's' : ''}
                        </div>

                        {/* Blurred price placeholder */}
                        <div className="relative mb-3">
                          <div className="flex items-center justify-between bg-[#FFFBF7] rounded-lg px-3 py-2 border border-[#E8E2DC]">
                            <span className="text-xs text-[#636E72]">Best price</span>
                            <div className="flex items-center gap-2">
                              <span className="text-base font-bold text-[#1D2324] blur-sm select-none">€0.00</span>
                              <svg className="w-3.5 h-3.5 text-[#B2BEC3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                            </div>
                          </div>
                        </div>

                        {/* Nutrition pills (if available) */}
                        {nutrition && (
                          <div className="flex flex-wrap gap-1">
                            <NutritionPill label="Cal" value={nutrition.calories} unit="kcal" />
                            <NutritionPill label="Prot" value={nutrition.protein} unit="g" />
                            <NutritionPill label="Carbs" value={nutrition.carbs} unit="g" />
                            <NutritionPill label="Fat" value={nutrition.fat} unit="g" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </main>

      {/* Bottom CTA */}
      <section className="px-6 py-16 bg-gradient-to-b from-[#FFFBF7] to-[#F5F0EB] border-t border-[#E8E2DC] mt-8">
        <div className="max-w-lg mx-auto text-center">
          <div className="text-4xl mb-4">🔓</div>
          <h2 className="text-2xl md:text-3xl font-bold text-[#1D2324] mb-3">
            Unlock prices in seconds
          </h2>
          <p className="text-[#636E72] mb-6">
            Free to sign up. See live prices from Tesco, Dunnes, SuperValu, Lidl and Aldi — and save €20+ every week.
          </p>
          <Link
            href="/list/request"
            className="inline-flex items-center gap-2 bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-8 py-4 rounded-xl text-lg font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all shadow-lg shadow-[#E17055]/20"
          >
            Get my free list
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
          <p className="text-sm text-[#B2BEC3] mt-4">No card required · 2,400+ Irish families signed up</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 bg-[#1D2324] text-white">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <Link href="/" className="font-bold text-lg">
            supermarket<span className="text-white/60">.ie</span>
          </Link>
          <div className="flex gap-6 text-sm text-[#B2BEC3]">
            <Link href="/privacy" className="hover:text-white transition">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition">Terms</Link>
            <a href="mailto:hello@supermarket.ie" className="hover:text-white transition">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function NutritionPill({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#F5F0EB] rounded text-[10px] font-medium text-[#636E72]">
      <span className="text-[#9BA3A7]">{label}</span>
      <span className="text-[#1D2324]">{value}{unit}</span>
    </span>
  );
}
