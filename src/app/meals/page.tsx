import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Popular Irish Meal Plans with Live Prices | supermarket.ie',
  description: 'Browse popular meal ideas with live ingredient prices from Tesco, Dunnes Stores and SuperValu in Ireland. See exactly what each meal costs before you shop.',
};

const MEALS = [
  { slug: 'spaghetti-bolognese', name: 'Spaghetti Bolognese', emoji: '🍝', serves: 4, time: '45 mins' },
  { slug: 'chicken-stir-fry', name: 'Chicken Stir Fry', emoji: '🥢', serves: 2, time: '20 mins' },
  { slug: 'vegetable-lasagne', name: 'Vegetable Lasagne', emoji: '🥗', serves: 4, time: '60 mins' },
  { slug: 'irish-stew', name: 'Irish Stew', emoji: '🍲', serves: 4, time: '2 hours' },
  { slug: 'sausage-pasta', name: 'Sausage Pasta', emoji: '🍜', serves: 3, time: '25 mins' },
  { slug: 'overnight-oats', name: 'Overnight Oats', emoji: '🥣', serves: 1, time: '5 mins' },
];

export default function MealsPage() {
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
        <div className="pt-10 pb-8">
          <h1 className="text-3xl font-bold text-[#1D2324] mb-3">Popular meals & ingredient prices</h1>
          <p className="text-[#636E72]">
            See the cost of ingredients for popular Irish meals across Tesco, Dunnes Stores and SuperValu. Prices updated twice weekly.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {MEALS.map(meal => (
            <Link key={meal.slug} href={`/meals/${meal.slug}`}
              className="bg-white rounded-2xl border border-[#E8E2DC] p-4 flex items-center gap-4 hover:border-[#E17055]/40 hover:shadow-sm transition">
              <div className="text-3xl">{meal.emoji}</div>
              <div className="flex-1">
                <div className="font-semibold text-[#1D2324]">{meal.name}</div>
                <div className="text-xs text-[#B2BEC3] mt-0.5">Serves {meal.serves} · {meal.time}</div>
              </div>
              <div className="text-[#E17055]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-10 bg-gradient-to-br from-[#FEF3E2] to-[#FFFBF7] border-2 border-[#E17055]/20 rounded-2xl p-6 text-center">
          <h2 className="font-bold text-[#1D2324] mb-2">Don't see your meal?</h2>
          <p className="text-sm text-[#636E72] mb-4">Our AI can price up any meal from Irish supermarkets. Just tell it what you want to cook.</p>
          <Link href="/" className="inline-block bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-6 py-3 rounded-xl font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition">
            Try the AI planner →
          </Link>
        </div>
      </main>

      <footer className="border-t border-[#E8E2DC] py-6 px-4 text-center text-xs text-[#B2BEC3]">
        <Link href="/" className="hover:text-[#636E72]">supermarket.ie</Link>
        {' · '}
        <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="hover:text-[#636E72]">Price comparison</Link>
      </footer>
    </div>
  );
}
