import {
  ArrowRight,
  Check,
  ChefHat,
  Euro,
  ShoppingBasket,
  Sparkles,
  TrendingDown,
} from 'lucide-react';

const products = [
  { name: 'Chicken fillets', detail: 'Irish · 1kg', price: '€9.49', store: 'Dunnes', colour: '#7B0017', icon: '🍗' },
  { name: 'Penne pasta', detail: '500g', price: '€0.99', store: 'Aldi', colour: '#00616A', icon: '🍝' },
  { name: 'Irish milk', detail: '2 litre', price: '€2.35', store: 'Tesco', colour: '#003A8C', icon: '🥛' },
  { name: 'Mixed peppers', detail: '3 pack', price: '€1.79', store: 'Aldi', colour: '#00616A', icon: '🫑' },
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
              Not another price table.
              <span className="block text-primary-container">A shop that&apos;s ready to go.</span>
            </h2>
          </div>
          <p className="max-w-md text-base leading-7 text-white/65">
            Your agent turns meals, household preferences and current prices into one clear
            recommendation—then explains exactly where the saving comes from.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="overflow-hidden rounded-[1.75rem] bg-[#f8f6f1] text-on-background shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/5 px-6 py-5 md:px-8">
              <div>
                <div className="mb-1 flex items-center gap-2 text-sm font-bold">
                  <ShoppingBasket className="size-4 text-primary" />
                  Your recommended weekly shop
                </div>
                <p className="text-xs text-on-surface">Family of 4 · 5 dinners · Lunches · €110 budget</p>
              </div>
              <span className="rounded-full bg-primary-container px-3 py-1.5 text-xs font-extrabold text-on-primary-container">
                €12.34 saved
              </span>
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-2 md:p-6">
              {products.map((product) => (
                <div key={product.name} className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-low text-2xl" aria-hidden="true">
                    {product.icon}
                  </span>
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

            <div className="grid border-t border-black/5 sm:grid-cols-3">
              {[
                ['34', 'items'],
                ['€106.42', 'recommended total'],
                ['2 stores', 'best-value split'],
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
              <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-white/10">
                <TrendingDown className="size-6 text-primary-container" />
              </div>
              <p className="mb-1 text-sm font-semibold text-white/60">Cheapest single store</p>
              <div className="mb-5 flex items-end justify-between gap-4">
                <p className="text-4xl font-extrabold tracking-tight">€118.76</p>
                <ArrowRight className="mb-2 size-5 text-white/40" />
              </div>
              <div className="rounded-2xl bg-white/10 p-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span>Recommended split</span>
                  <span className="font-extrabold">€106.42</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-black/20">
                  <div className="h-full w-[79%] rounded-full bg-primary-container" />
                </div>
                <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-primary-container">
                  <Check className="size-3.5" />
                  €12.34 stays in your pocket
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl bg-white/10 p-5">
                <ChefHat className="mb-4 size-5 text-primary-container" />
                <p className="font-bold">5 dinners planned</p>
                <p className="mt-1 text-xs leading-5 text-white/55">Ingredients reused intelligently across meals.</p>
              </div>
              <div className="rounded-3xl bg-white/10 p-5">
                <Euro className="mb-4 size-5 text-tertiary-container" />
                <p className="font-bold">Budget protected</p>
                <p className="mt-1 text-xs leading-5 text-white/55">Better-value swaps without changing the plan.</p>
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
