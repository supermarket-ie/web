import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://supermarket.ie';

export const metadata: Metadata = {
  title: 'Shop by Category — Grocery Prices Ireland | supermarket.ie',
  description: 'Browse live grocery prices by category across Tesco, Dunnes Stores and SuperValu in Ireland. Updated twice weekly.',
  alternates: { canonical: `${BASE_URL}/shop` },
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
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-6 pb-20">
        <div className="pt-12 pb-10">
          <h1 className="type-headline text-on-background mb-3">Shop by category</h1>
          <p className="type-body-lg" style={{ color: 'var(--on-surface)' }}>
            Live grocery prices across Tesco, Dunnes Stores and SuperValu in Ireland.
            Updated twice weekly.
          </p>
        </div>

        {/* Category grid — cards on surface-container-lowest, section on surface */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {CATEGORIES.map(cat => (
            <Link key={cat.slug} href={`/shop/${cat.slug}`}
              className="rounded-2xl p-4 transition-all group hover:-translate-y-0.5"
              style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
              <div className="text-3xl mb-3">{cat.emoji}</div>
              <div className="font-semibold text-sm transition-colors group-hover:text-primary" style={{ color: 'var(--on-background)' }}>
                {cat.name}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>{cat.desc}</div>
            </Link>
          ))}
        </div>

        {/* CTA strip */}
        <div className="mt-12 rounded-2xl p-8 text-center" style={{ background: 'var(--surface-container)' }}>
          <h2 className="type-title-lg text-on-background mb-2">Want a full weekly shop?</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--on-surface)' }}>
            Tell our AI what you want to cook and get a personalised list with the best prices across all stores.
          </p>
          <Link href="/" className="btn-primary inline-flex px-6 py-3 text-sm">
            Try the AI planner free →
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
