import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Shop by Category — Grocery Prices Ireland | supermarket.ie',
  description: 'Browse live grocery prices by category across Tesco, Dunnes Stores and SuperValu in Ireland. Updated twice weekly.',
};

const CATEGORIES = [
  { slug: 'dairy',              emoji: '🥛', name: 'Dairy',              desc: 'Milk, cheese, butter, cream' },
  { slug: 'meat',               emoji: '🥩', name: 'Meat',               desc: 'Chicken, beef, pork, lamb' },
  { slug: 'vegetables',         emoji: '🥦', name: 'Vegetables',         desc: 'Fresh veg & salad' },
  { slug: 'fruit',              emoji: '🍎', name: 'Fruit',              desc: 'Fresh & seasonal fruit' },
  { slug: 'bakery',             emoji: '🍞', name: 'Bakery',             desc: 'Bread, rolls, wraps' },
  { slug: 'breakfast',          emoji: '🥣', name: 'Breakfast',          desc: 'Cereal, oats, granola' },
  { slug: 'pasta-&-rice',       emoji: '🍝', name: 'Pasta & Rice',       desc: 'Pasta, rice, noodles' },
  { slug: 'tinned',             emoji: '🥫', name: 'Tinned',             desc: 'Tomatoes, beans, tuna' },
  { slug: 'condiments',         emoji: '🧴', name: 'Condiments',         desc: 'Sauces, ketchup, mayo' },
  { slug: 'beverages',          emoji: '🧃', name: 'Beverages',          desc: 'Juice, water, squash' },
  { slug: 'snacks',             emoji: '🍿', name: 'Snacks',             desc: 'Crisps, biscuits, popcorn' },
  { slug: 'frozen',             emoji: '🧊', name: 'Frozen',             desc: 'Frozen meals & veg' },
  { slug: 'dairy-alternatives', emoji: '🌾', name: 'Dairy Alternatives', desc: 'Oat, almond, soy milk' },
  { slug: 'household',          emoji: '🧹', name: 'Household',          desc: 'Cleaning, toilet roll' },
  { slug: 'personal-care',      emoji: '🪥', name: 'Personal Care',      desc: 'Shampoo, shower gel' },
  { slug: 'baking',             emoji: '🧁', name: 'Baking',             desc: 'Flour, sugar, baking' },
  { slug: 'spreads',            emoji: '🫙', name: 'Spreads',            desc: 'Jam, honey, peanut butter' },
  { slug: 'fish',               emoji: '🐟', name: 'Fish',               desc: 'Fresh & tinned fish' },
];

export default function ShopPage() {
  return (
    <div className="min-h-screen bg-[#FFFBF7]">
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-6 pb-16">
        <div className="pt-10 pb-8">
          <h1 className="text-3xl font-bold text-[#1D2324] mb-3">Shop by category</h1>
          <p className="text-[#636E72]">
            Live grocery prices across Tesco, Dunnes Stores and SuperValu in Ireland.
            Updated twice weekly. Click any category to compare prices.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {CATEGORIES.map(cat => (
            <Link key={cat.slug} href={`/shop/${cat.slug}`}
              className="bg-white rounded-2xl border border-[#E8E2DC] p-4 hover:border-[#E17055]/40 hover:shadow-sm transition group">
              <div className="text-3xl mb-2">{cat.emoji}</div>
              <div className="font-semibold text-[#1D2324] group-hover:text-[#E17055] transition text-sm">{cat.name}</div>
              <div className="text-xs text-[#B2BEC3] mt-0.5">{cat.desc}</div>
            </Link>
          ))}
        </div>

        <div className="mt-10 bg-gradient-to-br from-[#FEF3E2] to-[#FFFBF7] border-2 border-[#E17055]/20 rounded-2xl p-6 text-center">
          <h2 className="font-bold text-[#1D2324] mb-2">Want a full weekly shop?</h2>
          <p className="text-sm text-[#636E72] mb-4">Tell our AI what you want to cook and get a personalised list with the best prices across all three stores.</p>
          <Link href="/" className="inline-block bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-6 py-3 rounded-xl font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition">
            Try the AI planner free →
          </Link>
        </div>
      </main>

      <footer className="border-t border-[#E8E2DC] py-6 px-6 text-center text-xs text-[#B2BEC3]">
        <Link href="/" className="hover:text-[#636E72]">supermarket.ie</Link>
        {' · '}
        <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="hover:text-[#636E72]">Store comparison</Link>
      </footer>
    </div>
  );
}
