import { ArrowRight, Brain, Check, RefreshCw, ShoppingBasket } from 'lucide-react';

const benefits = [
  {
    icon: Brain,
    title: 'Understands your household',
    desc: 'Food preferences, regular products, budgets and everyday essentials all live in one place.',
  },
  {
    icon: RefreshCw,
    title: 'Remembers what comes around',
    desc: 'Milk, lunches, detergent, toothpaste, pet food—your agent learns the rhythm of your home.',
  },
  {
    icon: ShoppingBasket,
    title: 'Handles the whole shop',
    desc: 'Meals are one part of it. Your complete supermarket shop is assembled and ready to use.',
  },
];

const categories = [
  'Food & drink',
  'Cleaning & laundry',
  'Toiletries & personal care',
  'Baby & family',
  'Pet supplies',
  'Household essentials',
];

export function BenefitsSection() {
  return (
    <section className="relative bg-[#f5f7f5] px-6 py-20">
      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-16 md:grid-cols-2">
        <div>
          <span className="type-label mb-4 inline-flex rounded-full bg-surface-container px-3 py-1.5 text-on-surface">
            The complete household shop
          </span>
          <h2 className="type-headline mb-6 text-balance text-on-background">
            More than meal planning.
            <br />
            More than a shopping list.
          </h2>
          <p className="type-body-lg mb-10 text-on-surface">
            Supermarket.ie is the agent for everything your household gets from the supermarket.
            Tell it what matters once, then let it handle the recurring work.
          </p>

          <div className="flex flex-col gap-6">
            {benefits.map((benefit) => (
              <div key={benefit.title} className="flex gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-container">
                  <benefit.icon className="size-6 text-primary" />
                </div>
                <div>
                  <h3 className="mb-1 font-bold text-on-background">{benefit.title}</h3>
                  <p className="text-sm text-on-surface">{benefit.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[1.75rem] bg-inverse-surface p-8 text-white shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
          <div className="absolute -right-14 -top-14 size-44 rounded-full bg-accent-butter/15 blur-2xl" />
          <p className="type-label mb-3 text-primary-container">One definitive supermarket</p>
          <h3 className="mb-7 text-3xl font-extrabold tracking-[-0.035em]">
            Your whole household,
            <span className="block text-primary-container">covered.</span>
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {categories.map((category, index) => (
              <div
                key={category}
                className="flex items-center gap-2.5 rounded-xl bg-white/8 px-3 py-3 text-sm font-semibold"
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-[#26332a]"
                  style={{ background: ['#6BFE9C', '#FFD84D', '#FF7A59', '#EADFF2', '#9D2F62', '#00DCFF'][index] }}
                >
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
                {category}
              </div>
            ))}
          </div>
          <a href="#bottom-cta" className="btn-primary mt-8 w-full gap-2 px-6 py-4 text-base">
            Meet your supermarket agent
            <ArrowRight className="size-5" />
          </a>
        </div>
      </div>
    </section>
  );
}
