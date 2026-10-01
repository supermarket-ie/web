'use client';

import { useState, type ComponentType } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  CookingPot,
  Home,
  Leaf,
  ListChecks,
  ReceiptText,
  Search,
  ShoppingBasket,
  Sparkles,
  TrendingDown,
  UserRound,
  WalletCards,
} from 'lucide-react';

type PrototypeState = 'new' | 'progress' | 'ready';

type ReceiptLine = {
  label: string;
  meta: string;
  price?: string;
  state?: 'resolved' | 'attention' | 'suggested';
};

type StateContent = {
  eyebrow: string;
  title: string;
  description: string;
  items: number;
  total: string;
  budget: string;
  meals: string;
  unresolved: number;
  updated: string;
  status: string;
  primaryAction: string;
  starters: { label: string; detail: string; icon: ComponentType<{ className?: string }> }[];
  sections: { title: string; lines: ReceiptLine[] }[];
};

const STATE_CONTENT: Record<PrototypeState, StateContent> = {
  new: {
    eyebrow: 'Ready when you are',
    title: 'What should we sort out for the household?',
    description: 'Start with a meal, a product, a budget or the whole weekly shop.',
    items: 0,
    total: '€0.00',
    budget: 'No target yet',
    meals: '0 of 7 dinners',
    unresolved: 0,
    updated: 'Nothing prepared yet',
    status: 'Waiting for your direction',
    primaryAction: 'Start with your agent',
    starters: [
      { label: 'Build this week’s shop', detail: 'Food, toiletries and household essentials', icon: ShoppingBasket },
      { label: 'Plan four easy dinners', detail: 'Reuse ingredients and avoid waste', icon: CookingPot },
      { label: 'Keep the shop under €100', detail: 'Make practical value-led choices', icon: WalletCards },
      { label: 'What is good value today?', detail: 'Use verified current prices and offers', icon: Search },
    ],
    sections: [],
  },
  progress: {
    eyebrow: 'Picking up your September shop',
    title: 'Your shop is taking shape.',
    description: 'I have covered the everyday essentials and four dinners. Three choices still need you.',
    items: 18,
    total: '€64.20',
    budget: '€35.80 remaining',
    meals: '4 of 7 dinners',
    unresolved: 3,
    updated: 'Updated just now',
    status: '3 decisions before this shop is ready',
    primaryAction: 'Finish this shop',
    starters: [
      { label: 'Finish the remaining dinners', detail: 'Add three practical meals', icon: CookingPot },
      { label: 'Find better-value swaps', detail: 'Keep quality while reducing cost', icon: TrendingDown },
      { label: 'We already have pasta', detail: 'Remove it and rebalance the meals', icon: Check },
      { label: 'Add household essentials', detail: 'Check cleaning and toiletries', icon: Home },
    ],
    sections: [
      { title: 'Meals this week', lines: [
        { label: 'Chicken fajitas', meta: '6 matched ingredients', price: '€12.40', state: 'resolved' },
        { label: 'Tomato and lentil pasta', meta: '5 matched ingredients', price: '€7.85', state: 'resolved' },
        { label: 'One dinner still undecided', meta: 'Choose a quick option', state: 'attention' },
      ] },
      { title: 'Everyday essentials', lines: [
        { label: 'Milk, bread and eggs', meta: 'Usual quantities', price: '€8.17', state: 'resolved' },
        { label: 'Breakfast and lunch staples', meta: '7 items matched', price: '€18.42', state: 'resolved' },
      ] },
      { title: 'Needs a choice', lines: [
        { label: 'Laundry detergent', meta: 'Two close matches', state: 'attention' },
        { label: 'Gluten-free snack', meta: 'Confirm preferred option', state: 'attention' },
      ] },
    ],
  },
  ready: {
    eyebrow: 'Your shop is ready to review',
    title: 'A complete week, within budget.',
    description: 'Twenty-four items cover five dinners, everyday essentials and the household basics you usually need.',
    items: 24,
    total: '€86.40',
    budget: '€13.60 under target',
    meals: '5 dinners covered',
    unresolved: 0,
    updated: 'Prices checked 4 min ago',
    status: 'All items resolved with current prices',
    primaryAction: 'Review my shop',
    starters: [
      { label: 'Make it a little cheaper', detail: 'Look for sensible exact alternatives', icon: TrendingDown },
      { label: 'Add one vegetarian dinner', detail: 'Reuse ingredients already in the shop', icon: Leaf },
      { label: 'Explain the retailer choice', detail: 'See coverage, price and trade-offs', icon: ReceiptText },
      { label: 'Save this as my usual week', detail: 'Use it as a starting point next time', icon: ListChecks },
    ],
    sections: [
      { title: 'Meals this week', lines: [
        { label: 'Five planned dinners', meta: 'Ingredients consolidated', price: '€39.62', state: 'resolved' },
        { label: 'Lunches and breakfasts', meta: '8 matched items', price: '€18.31', state: 'resolved' },
      ] },
      { title: 'Household essentials', lines: [
        { label: 'Milk, bread, eggs and fruit', meta: 'Usual quantities', price: '€15.18', state: 'resolved' },
        { label: 'Cleaning and toiletries', meta: '4 matched items', price: '€13.29', state: 'resolved' },
      ] },
    ],
  },
};

const NAV_ITEMS = [
  { label: 'Home', icon: Home, active: true },
  { label: 'My Shop', icon: ShoppingBasket },
  { label: 'Browse', icon: Search },
  { label: 'Household', icon: UserRound },
];

function ReceiptLineItem({ line }: { line: ReceiptLine }) {
  return (
    <div className="group flex items-start gap-3 border-b border-dashed border-[#d9ddd8] py-3 last:border-b-0">
      <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${line.state === 'attention' ? 'bg-[#fff1d6] text-[#9a5b00]' : 'bg-[#e5f5e9] text-[#168049]'}`}>
        {line.state === 'attention' ? <CircleAlert className="size-3.5" /> : <Check className="size-3.5" strokeWidth={2.5} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-5 text-[#263229]">{line.label}</span>
        <span className="block text-[11px] leading-4 text-[#879089]">{line.meta}</span>
      </span>
      {line.price && <span className="font-mono text-xs font-semibold text-[#344039]">{line.price}</span>}
    </div>
  );
}

export function LivingShopPrototype() {
  const [state, setState] = useState<PrototypeState>('progress');
  const content = STATE_CONTENT[state];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f6faf7] text-[#132019]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_46%_0%,rgba(178,239,198,0.44),rgba(236,248,240,0.28)_38%,rgba(248,250,248,0)_72%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-[760px] w-[48%] bg-[url('/grocery-doodle-pattern.png')] bg-[length:500px_500px] opacity-[0.055] [mask-image:linear-gradient(to_left,black_20%,transparent_100%)]" />

      <div className="relative mx-auto max-w-[1500px] px-4 pb-20 pt-5 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-[#dbe6de] bg-white/70 p-2.5 shadow-sm backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="px-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#168049]">Living Shop concept</p>
            <p className="mt-0.5 text-xs text-[#6f7a72]">Explore how Home adapts as the household shop develops.</p>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#eef3ef] p-1" role="group" aria-label="Prototype state">
            {([['new', 'New household'], ['progress', 'In progress'], ['ready', 'Ready']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setState(value)} aria-pressed={state === value} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-all ${state === value ? 'bg-white text-[#132019] shadow-sm' : 'text-[#6c766f] hover:text-[#263229]'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[190px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <nav className="sticky top-24 space-y-1 py-2" aria-label="Signed-in navigation preview">
              {NAV_ITEMS.map(item => {
                const Icon = item.icon;
                return (
                  <button key={item.label} type="button" className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${item.active ? 'bg-white/85 font-bold text-[#176b3a] shadow-sm ring-1 ring-[#d8e7dd]' : 'font-medium text-[#56625a] hover:bg-white/55'}`}>
                    <Icon className="size-4" />{item.label}
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(310px,0.72fr)]">
            <section className="overflow-hidden rounded-[2rem] border border-[#dce5de] bg-white shadow-[0_30px_90px_rgba(34,61,43,0.13)]">
              <div className="flex min-h-[610px] flex-col px-6 py-7 sm:px-9 sm:py-9">
                <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
                  <div className="mb-7">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#397250]">
                      <span className="flex size-8 items-center justify-center rounded-full bg-[#daf2e2]"><Sparkles className="size-4" /></span>
                      {content.eyebrow}
                    </div>
                    <h1 className="max-w-2xl text-balance text-[2rem] font-bold leading-[1.12] tracking-[-0.048em] sm:text-[2.65rem]">{content.title}</h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-[#68736b] sm:text-[15px]">{content.description}</p>
                  </div>

                  {state !== 'new' && (
                    <div className="mb-5 rounded-2xl border border-[#dce9e0] bg-[#f4faf6] px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="relative flex size-9 items-center justify-center rounded-xl bg-white text-[#168049] shadow-sm">
                          <ShoppingBasket className="size-4" />
                          <span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-white bg-[#67d58d]" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-[#315c40]">Your agent is preparing the shop</p>
                          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-[#7a867e]">
                            <span className="text-[#168049]">Understand</span><span>→</span><span className="text-[#168049]">Check</span><span>→</span><span className={state === 'ready' ? 'text-[#168049]' : ''}>Prepare</span>
                          </div>
                        </div>
                        <span className="hidden text-xs font-semibold text-[#4e5b52] sm:block">{content.status}</span>
                      </div>
                    </div>
                  )}

                  <form className="relative rounded-[1.45rem] border border-[#dfe4df] bg-white shadow-[0_18px_50px_rgba(25,57,38,0.10)]" onSubmit={event => event.preventDefault()}>
                    <textarea rows={2} aria-label="Tell your agent what to change" placeholder={state === 'new' ? 'Ask about products, prices, meals, dietary needs or your household shop.' : 'Change anything, add a meal, set a budget or ask about a product…'} className="w-full resize-none bg-transparent px-5 pb-6 pt-5 pr-16 text-[15px] outline-none placeholder:text-[#929993]" />
                    <button type="submit" aria-label="Send to your agent" className="absolute bottom-3 right-3 flex size-10 items-center justify-center rounded-full bg-[#0b1710] text-white"><ArrowUp className="size-5" /></button>
                  </form>

                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {content.starters.map(starter => {
                      const Icon = starter.icon;
                      return (
                        <button key={starter.label} type="button" className="group flex items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-[#f4f8f5]">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#e2e8e3] bg-white text-[#176b3a] shadow-sm"><Icon className="size-4" /></span>
                          <span className="min-w-0"><span className="block text-sm font-semibold text-[#26342b]">{starter.label}</span><span className="mt-0.5 block truncate text-[11px] text-[#879089]">{starter.detail}</span></span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="mt-6 text-center text-[10px] text-[#9aa19c]">Your agent can prepare and change drafts. Nothing is ordered or paid for without your approval.</p>
              </div>
            </section>

            <aside className="overflow-hidden rounded-[1.75rem] border border-[#d9dfda] bg-[#fffefa] shadow-[0_24px_70px_rgba(42,53,45,0.10)]">
              <div className="border-b border-dashed border-[#cfd6d0] px-5 py-5 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#168049]">Living receipt</p><h2 className="mt-1 text-xl font-bold tracking-[-0.035em]">This week’s shop</h2></div>
                  <ReceiptText className="mt-1 size-5 text-[#839087]" />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
                  <div><p className="text-[10px] uppercase tracking-wider text-[#8b948e]">Items</p><p className="mt-0.5 font-mono text-lg font-bold">{content.items}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-[#8b948e]">Estimate</p><p className="mt-0.5 font-mono text-lg font-bold">{content.total}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-[#8b948e]">Budget</p><p className="mt-0.5 text-xs font-semibold text-[#3c493f]">{content.budget}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-[#8b948e]">Meals</p><p className="mt-0.5 text-xs font-semibold text-[#3c493f]">{content.meals}</p></div>
                </div>
              </div>

              <div className="min-h-[310px] px-5 py-3 sm:px-6">
                {content.sections.length ? content.sections.map(section => (
                  <div key={section.title} className="py-2">
                    <div className="flex items-center justify-between"><h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6f7a72]">{section.title}</h3><ChevronDown className="size-3.5 text-[#9aa19c]" /></div>
                    <div className="mt-1">{section.lines.map(line => <ReceiptLineItem key={line.label} line={line} />)}</div>
                  </div>
                )) : (
                  <div className="flex min-h-[285px] flex-col items-center justify-center text-center">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-[#edf6f0] text-[#58916c]"><ShoppingBasket className="size-5" /></span>
                    <p className="mt-4 text-sm font-semibold text-[#405047]">Your shop will take shape here</p>
                    <p className="mt-1 max-w-[220px] text-xs leading-5 text-[#8a948d]">Items, meals, prices and decisions will stay visible while you work with your agent.</p>
                  </div>
                )}
              </div>

              <div className="border-t border-dashed border-[#cfd6d0] px-5 py-5 sm:px-6">
                <div className={`mb-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${content.unresolved ? 'bg-[#fff4df] text-[#84530c]' : state === 'new' ? 'bg-[#f2f4f2] text-[#758078]' : 'bg-[#eaf7ee] text-[#267044]'}`}>
                  {content.unresolved ? <CircleAlert className="size-4" /> : state === 'new' ? <Clock3 className="size-4" /> : <Check className="size-4" />}{content.status}
                </div>
                <button type="button" className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0b1710] px-5 py-3.5 text-sm font-bold text-white shadow-sm">{content.primaryAction}<ArrowUp className="size-4 rotate-45" /></button>
                <p className="mt-3 text-center font-mono text-[10px] text-[#9aa19c]">{content.updated}</p>
              </div>
            </aside>
          </div>
        </div>

        <section className="ml-auto mt-6 max-w-[1265px] rounded-[1.75rem] border border-white/80 bg-white/65 p-5 shadow-[0_14px_50px_rgba(34,61,43,0.06)] backdrop-blur-lg sm:p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-stretch">
            <div className="flex-1"><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#168049]">The week ahead</p><h2 className="mt-1 text-lg font-bold tracking-tight">A grocery runway, not another dashboard</h2><p className="mt-2 max-w-xl text-xs leading-5 text-[#758078]">Meals, decisions, watched prices and the previous shop stay in one calm narrative below the active work.</p></div>
            {[['Meals', state === 'new' ? 'Nothing planned yet' : 'Fajitas · pasta · curry · traybake'], ['Needs attention', content.unresolved ? `${content.unresolved} choices need approval` : 'Everything resolved'], ['Watching', '3 useful price changes this week']].map(([label, value]) => (
              <div key={label} className="min-w-[190px] border-t border-[#dfe6e1] pt-3 md:border-l md:border-t-0 md:pl-5 md:pt-0"><p className="text-[10px] font-bold uppercase tracking-wider text-[#8a948d]">{label}</p><p className="mt-2 text-sm font-semibold leading-5 text-[#334138]">{value}</p></div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
