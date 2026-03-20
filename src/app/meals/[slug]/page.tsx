import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';

export const revalidate = 86400;

// Meal definitions — ingredients map to our canonical product names
const MEALS: Record<string, {
  name: string;
  description: string;
  serves: number;
  time: string;
  ingredients: { product: string; qty: string }[];
}> = {
  'spaghetti-bolognese': {
    name: 'Spaghetti Bolognese',
    description: 'A classic Italian-inspired family dinner. Hearty beef mince ragu with rich tomato sauce over spaghetti.',
    serves: 4,
    time: '45 mins',
    ingredients: [
      { product: 'Beef Mince 500g', qty: '500g' },
      { product: 'Spaghetti 500g', qty: '500g' },
      { product: 'Tinned Chopped Tomatoes', qty: '2 tins' },
      { product: 'Onions 1kg', qty: '1 large' },
      { product: 'Garlic Bulb', qty: '3 cloves' },
      { product: 'Tomato Puree', qty: '2 tbsp' },
      { product: 'Cheddar Cheese Block', qty: 'to serve' },
    ],
  },
  'chicken-stir-fry': {
    name: 'Chicken Stir Fry',
    description: 'Quick weeknight dinner. Tender chicken strips with fresh vegetables in a savoury sauce.',
    serves: 2,
    time: '20 mins',
    ingredients: [
      { product: 'Chicken Breast Fillets', qty: '400g' },
      { product: 'Mixed Stir Fry Veg', qty: '300g' },
      { product: 'Soy Sauce', qty: '3 tbsp' },
      { product: 'White Rice 1kg', qty: '200g' },
      { product: 'Garlic Bulb', qty: '2 cloves' },
      { product: 'Ginger', qty: '1 tsp' },
    ],
  },
  'vegetable-lasagne': {
    name: 'Vegetable Lasagne',
    description: 'A comforting meat-free lasagne loaded with roasted vegetables and creamy béchamel.',
    serves: 4,
    time: '60 mins',
    ingredients: [
      { product: 'Lasagne Sheets 500g', qty: '250g' },
      { product: 'Tinned Chopped Tomatoes', qty: '2 tins' },
      { product: 'Courgette', qty: '2 medium' },
      { product: 'Mozzarella 125g', qty: '125g' },
      { product: 'Cheddar Cheese Block', qty: '100g' },
      { product: 'Onions 1kg', qty: '1 large' },
      { product: 'Whole Milk 2L', qty: '500ml' },
      { product: 'Butter Unsalted', qty: '50g' },
    ],
  },
  'irish-stew': {
    name: 'Irish Stew',
    description: 'A traditional Irish stew with tender lamb, potatoes and root vegetables. Slow-cooked comfort food.',
    serves: 4,
    time: '2 hours',
    ingredients: [
      { product: 'Lamb Chops', qty: '800g' },
      { product: 'Potatoes 2.5kg', qty: '600g' },
      { product: 'Carrots 1kg', qty: '3 large' },
      { product: 'Onions 1kg', qty: '2 large' },
      { product: 'Chicken Stock Cubes', qty: '2 cubes' },
    ],
  },
  'sausage-pasta': {
    name: 'Sausage Pasta',
    description: 'Quick and budget-friendly pork sausage pasta with tomato sauce. Ready in 25 minutes.',
    serves: 3,
    time: '25 mins',
    ingredients: [
      { product: 'Pork Sausages', qty: '6 sausages' },
      { product: 'Penne Pasta 500g', qty: '300g' },
      { product: 'Tinned Chopped Tomatoes', qty: '1 tin' },
      { product: 'Onions 1kg', qty: '1 medium' },
      { product: 'Garlic Bulb', qty: '2 cloves' },
    ],
  },
  'overnight-oats': {
    name: 'Overnight Oats',
    description: 'Prep-ahead breakfast. Creamy oats soaked overnight — grab and go in the morning.',
    serves: 1,
    time: '5 mins + overnight',
    ingredients: [
      { product: 'Porridge Oats 1kg', qty: '80g' },
      { product: 'Whole Milk 2L', qty: '150ml' },
      { product: 'Natural Yogurt Plain', qty: '2 tbsp' },
      { product: 'Strawberry Yogurt', qty: 'optional topping' },
    ],
  },
};

async function getPricesForIngredients(productNames: string[]) {
  const { data } = await supabaseAdmin
    .from('price_observations')
    .select('price, store_products(store, products(canonical_name))')
    .order('observed_at', { ascending: false })
    .limit(2000);

  if (!data) return {};

  const result: Record<string, Record<string, number>> = {};
  const seen = new Set<string>();

  for (const row of data) {
    const sp = row.store_products as unknown as { store: string; products: { canonical_name: string } | null } | null;
    const name = sp?.products?.canonical_name;
    const store = sp?.store;
    if (!name || !store) continue;

    const key = `${name}:${store}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (productNames.some(p => name.toLowerCase().includes(p.toLowerCase().split(' ')[0]))) {
      if (!result[name]) result[name] = {};
      result[name][store] = row.price;
    }
  }

  return result;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const meal = MEALS[slug];
  if (!meal) return { title: 'Meal not found' };
  return {
    title: `${meal.name} — Cheapest Ingredients in Ireland | supermarket.ie`,
    description: `Find the cheapest ingredients for ${meal.name} across Tesco, Dunnes Stores and SuperValu in Ireland. Live prices updated twice weekly.`,
    keywords: [`${meal.name} ingredients Ireland`, `${meal.name} cost Ireland`, 'cheap ${meal.name} Ireland', 'Irish supermarket prices'],
  };
}

export function generateStaticParams() {
  return Object.keys(MEALS).map(slug => ({ slug }));
}

export default async function MealPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meal = MEALS[slug];
  if (!meal) notFound();

  const productNames = meal.ingredients.map(i => i.product);
  const prices = await getPricesForIngredients(productNames);

  const storeNames = { tesco: 'Tesco', dunnes: 'Dunnes Stores', supervalu: 'SuperValu' };
  const stores = ['tesco', 'dunnes', 'supervalu'] as const;
  const storeColors = { tesco: '#003A8C', dunnes: '#7B0017', supervalu: '#D4400F' };

  // Calculate total per store
  const storeTotals: Record<string, number> = { tesco: 0, dunnes: 0, supervalu: 0 };
  let priceableItems = 0;

  for (const { product } of meal.ingredients) {
    const matchedPrices = Object.entries(prices).find(([name]) =>
      name.toLowerCase().includes(product.toLowerCase().split(' ')[0].toLowerCase())
    )?.[1];
    if (!matchedPrices) continue;
    priceableItems++;
    for (const store of stores) {
      if (matchedPrices[store]) storeTotals[store] += matchedPrices[store];
    }
  }

  const ranked = [...stores].filter(s => storeTotals[s] > 0).sort((a, b) => storeTotals[a] - storeTotals[b]);
  const cheapest = ranked[0];

  return (
    <div className="min-h-screen bg-[#FFFBF7]">
      <header className="px-4 py-4 border-b border-[#E8E2DC] bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-bold text-lg text-[#1D2324]">supermarket<span className="text-[#E17055]">.ie</span></Link>
          <Link href="/" className="text-xs bg-[#E17055] text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-[#D4604A] transition">
            Build my list →
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-16">
        <nav className="pt-6 pb-2 text-xs text-[#B2BEC3]">
          <Link href="/" className="hover:text-[#636E72]">Home</Link>
          {' · '}
          <Link href="/meals" className="hover:text-[#636E72]">Meals</Link>
          {' · '}
          <span className="text-[#636E72]">{meal.name}</span>
        </nav>

        <div className="pt-4 pb-6">
          <h1 className="text-3xl font-bold text-[#1D2324] mb-2">{meal.name}</h1>
          <p className="text-[#636E72] mb-3">{meal.description}</p>
          <div className="flex gap-4 text-sm text-[#636E72]">
            <span>🍽 Serves {meal.serves}</span>
            <span>⏱ {meal.time}</span>
          </div>
        </div>

        {/* Cheapest store banner */}
        {cheapest && (
          <div className="rounded-2xl p-5 mb-6 text-white" style={{ background: storeColors[cheapest] }}>
            <div className="text-sm opacity-80 mb-1">Cheapest place to buy ingredients</div>
            <div className="text-2xl font-bold">{storeNames[cheapest]}</div>
            <div className="text-lg mt-1">{fmt(storeTotals[cheapest])} total for {priceableItems} ingredients</div>
          </div>
        )}

        {/* Store comparison */}
        {ranked.length > 1 && (
          <div className="grid grid-cols-3 gap-2 mb-8">
            {ranked.map((store, i) => (
              <div key={store} className="rounded-xl p-3 border-2 text-center"
                style={{ borderColor: i === 0 ? storeColors[store] : '#E8E2DC', background: i === 0 ? '#F5F9FF' : '#fff' }}>
                <div className="text-xs font-bold mb-1" style={{ color: i === 0 ? storeColors[store] : '#1D2324' }}>
                  {storeNames[store].split(' ')[0]}
                </div>
                <div className="text-base font-bold" style={{ color: i === 0 ? storeColors[store] : '#1D2324' }}>
                  {fmt(storeTotals[store])}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Ingredient list */}
        <h2 className="text-lg font-bold text-[#1D2324] mb-3">Ingredients & prices</h2>
        <div className="bg-white rounded-2xl border border-[#E8E2DC] divide-y divide-[#F5F0EB] mb-8">
          {meal.ingredients.map(({ product, qty }) => {
            const matchedEntry = Object.entries(prices).find(([name]) =>
              name.toLowerCase().includes(product.toLowerCase().split(' ')[0].toLowerCase())
            );
            const matchedPrices = matchedEntry?.[1];
            const matchedName = matchedEntry?.[0];
            const bestStore = matchedPrices ? stores.filter(s => matchedPrices[s]).sort((a, b) => matchedPrices[a] - matchedPrices[b])[0] : null;

            return (
              <div key={product} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-[#1D2324]">{matchedName ?? product}</div>
                    <div className="text-xs text-[#B2BEC3] mt-0.5">{qty}</div>
                  </div>
                  {bestStore && matchedPrices ? (
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-[#1D2324]">{fmt(matchedPrices[bestStore])}</div>
                      <div className="text-xs text-[#636E72]">{storeNames[bestStore].split(' ')[0]}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-[#B2BEC3]">price varies</div>
                  )}
                </div>
                {matchedPrices && Object.keys(matchedPrices).length > 1 && (
                  <div className="mt-1.5 flex gap-3">
                    {stores.filter(s => matchedPrices[s]).map(s => (
                      <span key={s} className="text-[11px] text-[#B2BEC3]">
                        {storeNames[s].split(' ')[0]} {fmt(matchedPrices[s])}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-br from-[#FEF3E2] to-[#FFFBF7] border-2 border-[#E17055]/20 rounded-2xl p-6 text-center">
          <div className="text-2xl mb-2">🛒</div>
          <h3 className="font-bold text-[#1D2324] mb-1">Add {meal.name} to your weekly list</h3>
          <p className="text-sm text-[#636E72] mb-4">
            Tell our AI planner what you want to cook and get a full shopping list with live prices from all three stores.
          </p>
          <Link href={`/?prompt=${encodeURIComponent(meal.name)}`}
            className="inline-block bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-6 py-3 rounded-xl font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition">
            Plan my {meal.name} week →
          </Link>
        </div>

        {/* Other meals */}
        <div className="mt-10">
          <h2 className="text-lg font-bold text-[#1D2324] mb-4">Other popular meals</h2>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(MEALS).filter(([s]) => s !== slug).slice(0, 4).map(([s, m]) => (
              <Link key={s} href={`/meals/${s}`}
                className="bg-white rounded-xl border border-[#E8E2DC] p-3 hover:border-[#E17055]/40 transition">
                <div className="text-sm font-semibold text-[#1D2324]">{m.name}</div>
                <div className="text-xs text-[#B2BEC3] mt-0.5">{m.serves} servings · {m.time}</div>
              </Link>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-[#E8E2DC] py-6 px-4 text-center text-xs text-[#B2BEC3]">
        <Link href="/" className="hover:text-[#636E72]">supermarket.ie</Link>
        {' · '}
        <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="hover:text-[#636E72]">Price comparison</Link>
        {' · '}Prices updated twice weekly
      </footer>
    </div>
  );
}

function fmt(n: number) { return `€${n.toFixed(2)}`; }
