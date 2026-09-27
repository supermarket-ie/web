'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Carrot, Check, ChevronDown, Layers, Milk, Package, ShoppingBasket, Smile, Sparkles, Wheat } from 'lucide-react';
import type { HomepageShopExample } from '@/lib/homepage-shop-example';
import { EXAMPLE_PREFILL_EVENT, HOMEPAGE_EXAMPLE_ID } from '@/lib/homepage-example-handoff';
import { WEEKLY_STORE_NAMES } from '@/lib/weekly-shop';
import { trackEvent, trackEventOnce } from '@/lib/analytics';

const money = (value: number) => `€${value.toFixed(2)}`;
const checkDate = (value: string) => new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Dublin' }).format(new Date(value));

// Decorative, bundled line icons: no remote product-image dependency.
const LINE_ICONS = [Milk, Carrot, Wheat, Sparkles, Smile, Layers];

export function ProductProofContent({ example, loading = false }: { example: HomepageShopExample; loading?: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || loading) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        trackEventOnce('homepage_example_viewed', { example_id: HOMEPAGE_EXAMPLE_ID });
        observer.disconnect();
      }
    }, { threshold: 0.15 });
    observer.observe(section);
    return () => observer.disconnect();
  }, [loading]);

  function makeYours() {
    const request = new CustomEvent(EXAMPLE_PREFILL_EVENT, { detail: example.prompt, cancelable: true });
    if (window.dispatchEvent(request)) {
      setNotice('Finish your current agent request, or sign in if your free preview has ended, then try again.');
      return;
    }
    setNotice('Review your request above. Nothing has been sent yet.');
    trackEvent('homepage_example_selected', { example_id: HOMEPAGE_EXAMPLE_ID });
    document.getElementById('grocery-agent')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderLine(line: HomepageShopExample['lines'][number], index: number) {
    const Icon = index < 6 ? LINE_ICONS[index] : Package;
    return <li key={line.id} className="flex items-start gap-3 border-b border-[#e4e9df] py-3.5 last:border-0 sm:gap-4">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#dde6d8] bg-[#edf2e7] text-[#52684e]"><Icon className="size-5" strokeWidth={1.5} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-[13px] font-semibold leading-5 sm:text-sm">{line.offer?.name ?? line.name}</p>
          <span className="shrink-0 pt-0.5 text-xs font-bold tabular-nums sm:text-sm">{line.lineTotal === null ? 'Not priced' : money(line.lineTotal)}</span>
        </div>
        <p className="mt-0.5 text-xs leading-5 text-[#647168]">{line.quantity} × {line.offer ? money(line.offer.price) : loading ? 'checking price…' : 'price unavailable'}</p>
        {line.offer && <p className="text-[10px] leading-4 text-[#6b776e]">Checked <time dateTime={line.offer.observedAt}>{checkDate(line.offer.observedAt)}</time></p>}
      </div>
    </li>;
  }

  return <section ref={sectionRef} id="sample-shop" aria-labelledby="sample-shop-title" className="relative isolate scroll-mt-20 overflow-hidden bg-[#101c16] px-5 py-14 text-white sm:px-8 sm:py-20 lg:py-24">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_90%_10%,rgba(132,192,147,0.16),transparent_60%)]" />
    <div className="mx-auto grid max-w-6xl items-start gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-x-16 lg:gap-y-0">
      <div className="lg:col-start-1 lg:row-start-1 lg:pt-7">
        <p className="mb-6 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[#b9d6bc]"><span aria-hidden="true" className="h-px w-8 bg-[#b9d6bc]/50" />See the result</p>
        <h2 id="sample-shop-title" className="max-w-lg text-balance text-[clamp(2.25rem,4vw,3.5rem)] font-extrabold leading-[1.06] tracking-[-0.045em]">A real starting shop.<span className="mt-2 block text-[#b9e5b5]">Ready to make your own.</span></h2>
        <p className="mt-6 max-w-md text-base leading-7 text-[#bdc9c0]">Food, cleaning and toiletries together, with matched supermarket prices. A little less planning. A useful place to start.</p>
      </div>

      <div className="relative min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 hidden translate-x-2 translate-y-2 rotate-2 rounded-[1.75rem] border border-white/15 bg-white/5 sm:block" />
        <div className="overflow-hidden rounded-[1.5rem] bg-[#fcfaf4] text-[#17291e] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.45)] sm:rounded-[1.75rem]">
          <div className="border-b border-[#e4e9df] px-5 pb-5 pt-6 sm:px-7">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#52684e]"><ShoppingBasket aria-hidden="true" className="size-4" />The starting basket</span>
              <span className="rounded-full bg-[#e6eedf] px-2.5 py-1 text-[10px] font-semibold text-[#426039]">{loading ? 'Checking prices…' : example.store ? WEEKLY_STORE_NAMES[example.store] : 'Prices unavailable'}</span>
            </div>
            <h3 className="text-xl font-bold tracking-[-0.025em]">The household essentials shop</h3>
            <p className="mt-2 text-xs leading-5 text-[#647168]">2 adults · 1 child · €100 example budget</p>
          </div>
          <div className="px-5 sm:px-7">
            <ul>{example.lines.slice(0, 6).map(renderLine)}</ul>
            <details className="group border-t border-[#e4e9df]">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-xs font-bold text-[#426039] outline-offset-4 focus-visible:outline-2 focus-visible:outline-[#426039] [&::-webkit-details-marker]:hidden">See the rest of this shop<ChevronDown aria-hidden="true" className="size-4 transition-transform motion-reduce:transition-none group-open:rotate-180" /></summary>
              <ul className="pb-2">{example.lines.slice(6).map((line, index) => renderLine(line, index + 6))}</ul>
            </details>
          </div>
          <div className="border-t border-dashed border-[#b9c7b2] bg-[#edf3e7] px-5 py-5 sm:px-7" aria-live="polite">
            <div className="flex items-end justify-between gap-3">
              <p className="pb-1 text-xs font-bold text-[#42563c]">{example.total !== null ? 'Example shop total' : 'Priced items subtotal'}</p>
              <p className="text-4xl font-extrabold leading-none tracking-[-0.05em] tabular-nums">{example.subtotal === null ? '—' : money(example.subtotal)}</p>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-[#596d53]">{loading ? 'Loading the latest checked prices.' : example.total !== null ? 'Every product in this example is included in the total.' : 'Some products have no current matched price here. The full cost is not yet confirmed.'}</p>
            {example.oldestCheck && <p className="mt-1 text-[10px] leading-4 text-[#647168]">Prices checked from {checkDate(example.oldestCheck)}. May change at the retailer; delivery is not included.</p>}
          </div>
        </div>
      </div>

      <div className="lg:col-start-1 lg:row-start-2 lg:mt-9">
        <h3 className="text-lg font-semibold tracking-tight">Your household. Your version.</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-[#bdc9c0]">Change the people, budget, products or dietary needs. This is a starting basket, not a full week’s meal plan or an average family spend.</p>
        <ol className="my-6 space-y-3 border-l border-white/15 pl-4">
          {['Open the request and make it yours', 'Let your agent prepare your version', 'Create a free account to save your shop'].map((step, index) => <li key={step} className="flex items-start gap-3 text-sm leading-6 text-[#d7e1d8]"><span aria-hidden="true" className="font-mono text-xs leading-6 text-[#8fa893]">0{index + 1}</span>{step}</li>)}
        </ol>
        <button type="button" onClick={makeYours} disabled={loading} className="group flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-primary-container px-5 py-4 text-left font-bold text-on-primary-container shadow-[0_6px_24px_rgba(107,254,156,0.08)] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-container disabled:cursor-wait disabled:opacity-50 sm:max-w-md">Make this shop yours<ArrowRight aria-hidden="true" className="size-5 shrink-0 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" /></button>
        <p className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-[#bdc9c0]"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#b9e5b5]" />Edit first. Nothing sent or ordered automatically.</p>
        <p role="status" className={notice ? 'mt-3 text-sm leading-6 text-primary-container' : 'sr-only'}>{notice}</p>
        <Link href="/#sample-shop" className="mt-4 inline-flex min-h-11 items-center text-xs text-[#bdc9c0] underline decoration-white/25 underline-offset-4 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-container">Link to this example</Link>
      </div>
    </div>
  </section>;
}
