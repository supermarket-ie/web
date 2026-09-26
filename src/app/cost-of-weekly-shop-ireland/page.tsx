import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { WeeklyShopCalculator } from '@/components/WeeklyShopCalculator';
import { getAllLatestPrices } from '@/lib/price-data';
import { buildWeeklyExample, WEEKLY_SHOP_PATH } from '@/lib/weekly-shop';

export const revalidate = 1800;

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();
const TITLE = 'Cost of a Weekly Shop in Ireland 2026 — Tesco, Dunnes, SuperValu | supermarket.ie';
const DESCRIPTION = 'Work out your weekly grocery shop cost in Ireland. Edit an example basket with Tesco, Dunnes and SuperValu prices, see missing prices, and plan around your household and budget.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: ['cost of weekly shop Ireland', 'how much is a weekly shop in Ireland', 'cheapest weekly shop Ireland', 'grocery prices Ireland 2026', 'average weekly grocery spend Ireland'],
  alternates: { canonical: `${BASE_URL}${WEEKLY_SHOP_PATH}` },
  openGraph: { title: 'Cost of a Weekly Shop in Ireland — Plan Your Household Shop', description: DESCRIPTION, url: `${BASE_URL}${WEEKLY_SHOP_PATH}` },
};

export default async function WeeklyShopCostPage() {
  const items = buildWeeklyExample(await getAllLatestPrices());
  const dates = items.flatMap(item => Object.values(item.offers).map(offer => offer.observedAt)).sort();
  const formatDate = (value: string) => new Date(value).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const observedLabel = dates.length ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}` : null;

  return (
    <div className="min-h-screen bg-[#f7f8f4]">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <nav aria-label="Breadcrumb" className="pb-2 pt-6 text-xs text-[#6d7c71]">
          <Link href="/" className="hover:underline">Home</Link>{' / '}<span aria-current="page">Cost of Weekly Shop</span>
        </nav>
        <header className="max-w-3xl pb-8 pt-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#397250]">Weekly shopping in Ireland</p>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-[#173525] sm:text-4xl">How Much Does a Weekly Shop Cost in Ireland?</h1>
          <p className="mt-4 text-base leading-7 text-[#53675a]">Your weekly grocery cost depends on how many people you shop for, the meals you plan, the brands you choose and what you already have. Start with the priced example below, then adapt it to your household.</p>
          <p className="mt-3 text-sm leading-6 text-[#607065]">Compare the listed products at Tesco, Dunnes Stores and SuperValu. We show the prices we can verify and make any gaps visible, so a partial basket is never presented as the cost of your whole week.</p>
          <p className="mt-4 text-xs leading-5 text-[#718076]">{observedLabel ? `Example prices observed ${observedLabel}. Individual dates and product names are shown below.` : 'Current example prices are unavailable. You can still describe your household shop; your agent will show which products it can currently price.'}</p>
        </header>

        <WeeklyShopCalculator items={items} />

        <section aria-labelledby="methodology" className="mt-10 rounded-2xl border border-[#dce3dd] bg-white p-6 sm:p-8">
          <h2 id="methodology" className="text-xl font-semibold text-[#173525]">How we calculate your basket cost</h2>
          <div className="mt-4 grid gap-5 text-sm leading-6 text-[#607065] sm:grid-cols-2">
            <p>Each line shows a specific catalogue product and the retailer product currently matched to it. We multiply its observed pack or item price by your chosen quantity, then add the priced lines for each supermarket. The example starts with two cartons of milk, two tins each of tomatoes and beans, and one of each other listed product.</p>
            <p>Prices come from our current retailer data and must have been observed within the preceding seven days when this page refreshes. We show the actual observation date for each price. Prices and availability can change before you shop; the retailer confirms the final price.</p>
            <p>Missing prices remain missing. A retailer gets a complete basket total only when every selected product has a current price there. A partial subtotal excludes unpriced lines and cannot establish which supermarket is cheapest for your whole shop.</p>
            <p>This basket is an editable example, not a survey of average Irish household spending or a nutritionally complete meal plan. Branded and own-label products can differ; the retailer names and pack descriptions help you judge the choices. Delivery, conditional vouchers and unverified loyalty discounts are excluded.</p>
          </div>
        </section>

        <section aria-labelledby="weekly-questions" className="mt-10 max-w-3xl">
          <h2 id="weekly-questions" className="text-2xl font-semibold text-[#173525]">Planning a weekly shop in Ireland</h2>
          <div className="mt-6 space-y-6 text-sm leading-6 text-[#607065]">
            <div><h3 className="mb-2 font-semibold text-[#354a3b]">What should I budget for one person, a couple or a family?</h3><p>Build the budget around the meals and quantities your household actually needs. A larger household may share ingredients and larger packs, so multiplying a single-person basket is not a reliable estimate. Enter your household size and budget above, then include lunches, snacks, toiletries and cleaning supplies you need this week.</p></div>
            <div><h3 className="mb-2 font-semibold text-[#354a3b]">Which supermarket is cheapest for my weekly shop?</h3><p>That depends on your selected products, quantities and any discounts you qualify for. Compare complete baskets containing suitable products; a retailer with fewer priced items can look cheaper simply because costs are missing. Our <Link className="font-medium text-[#21603b] underline underline-offset-4" href="/compare/supermarket-prices-ireland">Irish supermarket price guide</Link> gives more context.</p></div>
            <div><h3 className="mb-2 font-semibold text-[#354a3b]">How can I reduce my weekly grocery bill?</h3><p>Check what you already have, plan meals with shared ingredients and remove products you will not use. Review pack sizes before swapping brands. You can explore <Link className="font-medium text-[#21603b] underline underline-offset-4" href="/deals">current verified offers</Link> or ask your agent to adjust the proposed shop to your budget.</p></div>
          </div>
        </section>

        <nav aria-label="Explore groceries" className="mt-8 flex flex-wrap gap-x-5 gap-y-3 text-sm font-medium text-[#21603b]">
          <Link className="underline underline-offset-4" href="/shop/dairy">Dairy essentials</Link>
          <Link className="underline underline-offset-4" href="/shop/vegetables">Vegetables</Link>
          <Link className="underline underline-offset-4" href="/shop/household">Household supplies</Link>
          <Link className="underline underline-offset-4" href="/shop">Browse groceries</Link>
        </nav>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([
          { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Cost of a Weekly Shop in Ireland 2026', description: DESCRIPTION, url: `${BASE_URL}${WEEKLY_SHOP_PATH}` },
          { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
            { '@type': 'ListItem', position: 2, name: 'Cost of Weekly Shop', item: `${BASE_URL}${WEEKLY_SHOP_PATH}` },
          ] },
        ]).replace(/</g, '\\u003c') }} />
      </main>
      <SiteFooter />
    </div>
  );
}
