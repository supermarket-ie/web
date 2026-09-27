'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ShoppingBasket, Sparkles } from 'lucide-react';
import type { HomepageShopExample } from '@/lib/homepage-shop-example';
import { EXAMPLE_PREFILL_EVENT, HOMEPAGE_EXAMPLE_ID } from '@/lib/homepage-example-handoff';
import { WEEKLY_STORE_NAMES } from '@/lib/weekly-shop';
import { trackEvent, trackEventOnce } from '@/lib/analytics';

const money = (value: number) => `€${value.toFixed(2)}`;
const checkDate = (value: string) => new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Dublin' }).format(new Date(value));

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

  function renderLine(line: HomepageShopExample['lines'][number]) {
    return <li key={line.id} className="flex items-start justify-between gap-4 border-b border-black/5 py-4 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-5">{line.offer?.name ?? line.name}</p>
        <p className="mt-1 text-xs text-[#647168]">{line.quantity} × {line.offer ? money(line.offer.price) : 'price unavailable'}
          {line.offer && <> · Checked <time dateTime={line.offer.observedAt}>{checkDate(line.offer.observedAt)}</time></>}
        </p>
      </div>
      <span className="shrink-0 text-sm font-bold tabular-nums">{line.lineTotal === null ? 'Not priced' : money(line.lineTotal)}</span>
    </li>;
  }

  return <section ref={sectionRef} id="sample-shop" className="relative scroll-mt-20 overflow-hidden bg-inverse-surface px-5 py-16 text-white sm:px-6 md:py-24">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(107,254,156,0.14),transparent_35%)]" />
    <div className="relative mx-auto max-w-6xl">
      <span className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-primary-container"><Sparkles className="size-3.5" />See the result</span>
      <h2 className="max-w-3xl text-balance text-[clamp(2rem,4vw,3.3rem)] font-extrabold leading-[1.08] tracking-[-0.04em]">A real starting shop.<span className="block text-primary-container">Ready to make your own.</span></h2>
      <p className="mt-5 max-w-2xl text-base leading-7 text-white/75">Food, cleaning and toiletries together, with matched supermarket prices. Start here, then tell your agent what your household needs.</p>

      <div className="mt-9 grid items-start gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="overflow-hidden rounded-[1.75rem] bg-[#fffaf0] text-[#17291e] shadow-2xl">
          <div className="border-b border-black/10 px-6 py-5 sm:px-8">
            <h3 className="flex items-center gap-2 font-bold"><ShoppingBasket className="size-5 text-primary" />The household essentials shop</h3>
            <p className="mt-2 text-xs leading-5 text-[#647168]">2 adults · 1 child · €100 example budget</p>
            <p className="mt-1 text-xs font-semibold text-[#397250]">{loading ? 'Checking current prices…' : example.store ? `Price example at ${WEEKLY_STORE_NAMES[example.store]}` : 'Current prices unavailable'}</p>
          </div>
          <div className="px-6 sm:px-8">
            <ul>{example.lines.slice(0, 6).map(renderLine)}</ul>
            <details className="border-t border-black/10 py-4">
              <summary className="cursor-pointer text-sm font-bold underline decoration-[#b6c7bb] underline-offset-4">See the rest of this shop</summary>
              <ul className="mt-2">{example.lines.slice(6).map(renderLine)}</ul>
            </details>
          </div>
          <div className="border-t border-dashed border-black/20 bg-white/60 px-6 py-5 sm:px-8" aria-live="polite">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-bold">{example.total !== null ? 'Example shop total' : 'Priced items subtotal'}</p>
              <p className="text-3xl font-extrabold tracking-tight tabular-nums">{example.subtotal === null ? '—' : money(example.subtotal)}</p>
            </div>
            <p className="mt-2 text-xs leading-5 text-[#647168]">{loading ? 'Loading the latest checked prices.' : example.total !== null ? 'Every product in this example is included in the total.' : 'Some products have no current matched price here. The full cost is not yet confirmed.'}</p>
            {example.oldestCheck && <p className="mt-1 text-xs text-[#647168]">Prices checked from {checkDate(example.oldestCheck)}. May change at the retailer; delivery is not included.</p>}
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-white/15 bg-white/5 p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-widest text-primary-container">Your household, your version</p>
          <h3 className="mt-4 text-2xl font-bold tracking-tight">Not your usual shop?<br />That’s the point.</h3>
          <p className="mt-4 text-sm leading-6 text-white/75">This is a starting basket, not a full week’s meal plan or an average family spend. Change the people, budget, products or dietary needs before your agent prepares your version.</p>
          <ol className="my-7 space-y-4">
            {['Open the editable request', 'Tell your agent what to change', 'Create a free account to save your shop'].map((step, index) => <li key={step} className="flex items-center gap-3 text-sm"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-primary-container">{index + 1}</span>{step}</li>)}
          </ol>
          <button type="button" onClick={makeYours} disabled={loading} className="flex w-full items-center justify-between gap-3 rounded-2xl bg-primary-container px-5 py-4 text-left font-bold text-on-primary-container transition-colors hover:bg-white disabled:opacity-50">Make this shop yours<ArrowRight className="size-5 shrink-0" /></button>
          <p className="mt-3 flex items-center gap-2 text-xs text-white/70"><Check className="size-4 shrink-0" />Edit first. Nothing sent or ordered automatically.</p>
          <p role="status" className="mt-3 text-sm text-primary-container">{notice}</p>
          <Link href="/#sample-shop" className="mt-3 inline-block text-xs text-white/70 underline underline-offset-4">Link to this example</Link>
        </div>
      </div>
    </div>
  </section>;
}
