import {
  ArrowRight,
  Check,
  ChefHat,
  Euro,
  ShoppingBasket,
  Sparkles,
} from 'lucide-react';
import { AgentMark } from './AgentMark';

const products = [
  { name: 'Chicken fillets', detail: 'Irish · 1kg', price: '€9.49', store: 'Dunnes', colour: '#7B0017', position: '0% 0%', tone: '#f7dfdf', sprite: '/images/ingredients/weekly-shop-sprite.webp' },
  { name: 'Penne pasta', detail: '500g', price: '€0.99', store: 'Aldi', colour: '#00616A', position: '100% 0%', tone: '#fff0b8', sprite: '/images/ingredients/weekly-shop-sprite.webp' },
  { name: 'Mixed peppers', detail: '3 pack', price: '€1.79', store: 'Aldi', colour: '#00616A', position: '100% 100%', tone: '#fee0c8', sprite: '/images/ingredients/weekly-shop-sprite.webp' },
  { name: 'Laundry detergent', detail: '1.5 litre', price: '€4.49', store: 'Tesco', colour: '#003A8C', position: '0% 0%', tone: '#e1f1df', sprite: '/images/ingredients/household-essentials-sprite.webp' },
  { name: 'Toilet tissue', detail: '9 roll', price: '€5.25', store: 'Dunnes', colour: '#7B0017', position: '100% 0%', tone: '#f5ead9', sprite: '/images/ingredients/household-essentials-sprite.webp' },
  { name: 'Toothpaste', detail: '100ml', price: '€1.49', store: 'Aldi', colour: '#00616A', position: '0% 100%', tone: '#e5f2e5', sprite: '/images/ingredients/household-essentials-sprite.webp' },
];

export function ProductProofSection() {
  return (
    <section id="sample-shop" className="relative overflow-hidden bg-inverse-surface px-6 py-20 text-white md:py-28">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(107,254,156,0.14),transparent_35%)]" />
      <div className="relative mx-auto max-w-7xl">
        <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <span className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-primary-container">
              <Sparkles className="size-3.5" />
              See the result
            </span>
            <h2 className="text-balance text-[clamp(2.25rem,5vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.045em]">
              From “what do we need?”
              <span className="block text-primary-container">to a week that&apos;s handled.</span>
            </h2>
          </div>
          <p className="max-w-md text-base leading-7 text-white/65">
            Your agent brings food, household essentials, preferences, budget and live availability together into one complete supermarket shop.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div
            className="receipt-card overflow-hidden rounded-[1.75rem] bg-[#fffaf0] text-on-background shadow-2xl"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, transparent 0, transparent 31px, rgba(70,60,45,0.025) 32px)',
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/5 px-6 py-5 md:px-8">
              <div>
                <div className="mb-1 flex items-center gap-2 text-sm font-bold">
                  <ShoppingBasket className="size-4 text-primary" />
                  Your agent&apos;s weekly shop
                </div>
                <p className="text-xs text-on-surface">Family of 4 · Food · Cleaning · Toiletries · €110 budget</p>
              </div>
              <span className="savings-pop rounded-full bg-primary-container px-3 py-1.5 text-xs font-extrabold text-on-primary-container">
                Ready to shop
              </span>
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-2 md:p-6">
              {products.map((product) => (
                <div key={product.name} className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                  <span
                    className="ingredient-sprite block h-10 w-[60px] shrink-0 rounded-xl transition-transform duration-300 hover:scale-[1.03]"
                    style={{
                      backgroundColor: product.tone,
                      backgroundImage: `url('${product.sprite}')`,
                      backgroundPosition: product.position,
                    }}
                    role="img"
                    aria-label={product.name}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{product.name}</p>
                    <p className="text-xs text-on-surface">{product.detail}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-extrabold">{product.price}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: product.colour }}>
                      {product.store}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid border-t border-dashed border-black/10 font-mono sm:grid-cols-3">
              {[
                ['34', 'items handled'],
                ['€106.42', 'within your budget'],
                ['6 categories', 'one complete shop'],
              ].map(([value, label]) => (
                <div key={label} className="border-b border-black/5 px-6 py-5 last:border-0 sm:border-b-0 sm:border-r">
                  <p className="text-xl font-extrabold tracking-tight">{value}</p>
                  <p className="text-xs text-on-surface">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[1.75rem] bg-primary p-6 md:p-8">
              <div className="mb-7 flex items-center gap-3">
                <AgentMark className="size-12" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary-container">
                    Your agent at work
                  </p>
                  <p className="font-bold">One request. The whole week handled.</p>
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { label: 'Household understood', detail: '4 people · family favourites', colour: '#EADFF2' },
                  { label: 'Meals planned', detail: 'food and household needs included', colour: '#FFD84D' },
                  { label: 'Shop assembled', detail: '34 supermarket items handled', colour: '#FF7A59' },
                  { label: 'Budget checked', detail: '€106.42 of €110', colour: '#6BFE9C' },
                ].map((step, index) => (
                  <div
                    key={step.label}
                    className="agent-step flex items-center gap-3 rounded-2xl bg-white/10 p-3.5"
                    style={{ animationDelay: `${220 + index * 150}ms` }}
                  >
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-[#243229]"
                      style={{ background: step.colour }}
                    >
                      <Check className="size-4" strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">{step.label}</span>
                      <span className="block text-xs text-white/55">{step.detail}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between rounded-2xl bg-primary-container px-4 py-3 text-on-primary-container">
                <span className="text-sm font-extrabold">Your weekly shop is ready</span>
                <ArrowRight className="size-5" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl bg-[#FFD84D] p-5 text-[#3d3412]">
                <ChefHat className="mb-4 size-5" />
                <p className="font-bold">Food and meals</p>
                <p className="mt-1 text-xs leading-5 opacity-70">Meals and everyday food organised around your household.</p>
              </div>
              <div className="rounded-3xl bg-[#9D2F62] p-5 text-white">
                <Euro className="mb-4 size-5 text-[#FFDDEB]" />
                <p className="font-bold">Everything else</p>
                <p className="mt-1 text-xs leading-5 text-white/65">Cleaning, toiletries and recurring essentials remembered too.</p>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-white/40">
          Illustrative shop for preview purposes. Live results use current matched prices.
        </p>
      </div>
    </section>
  );
}
