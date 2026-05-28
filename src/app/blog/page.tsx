import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { POSTS } from '@/lib/blog';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();

export const metadata: Metadata = {
  title: 'Blog — Grocery Tips & Price Comparisons Ireland | supermarket.ie',
  description: 'Practical guides on saving money at Irish supermarkets, price comparisons between Tesco, Dunnes and SuperValu, and meal ideas with live ingredient costs.',
  alternates: { canonical: `${BASE_URL}/blog` },
};

// Category chips use the design system's surface-container colours;
// the tertiary-container (#00DCFF) is reserved for "live" or special callouts.
const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  'Price Comparison': { bg: 'var(--store-tesco)',     text: '#fff' },
  'Saving Money':     { bg: 'var(--primary)',         text: '#fff' },
  'Meal Ideas':       { bg: 'var(--surface-container-highest)', text: 'var(--on-background)' },
  'Ireland Food':     { bg: 'var(--inverse-surface)',  text: 'var(--inverse-on-surface)' },
};

export default function BlogPage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-6 pb-20">
        <div className="pt-12 pb-10">
          <h1 className="type-headline text-on-background mb-3">Blog</h1>
          <p className="type-body-lg" style={{ color: 'var(--on-surface)' }}>
            Practical guides on saving money at Irish supermarkets, live price comparisons, and meal ideas with real ingredient costs.
          </p>
        </div>

        <div className="space-y-4">
          {POSTS.map(post => {
            const catStyle = CATEGORY_COLORS[post.category] ?? { bg: 'var(--surface-container)', text: 'var(--on-surface)' };
            return (
              <Link key={post.slug} href={`/blog/${post.slug}`}
                className="block rounded-2xl p-5 transition-all group hover:-translate-y-0.5"
                style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="type-label px-2.5 py-0.5 rounded-full"
                    style={{ background: catStyle.bg, color: catStyle.text }}>
                    {post.category}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{post.readingTime}</span>
                  <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>·</span>
                  <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{formatDate(post.date)}</span>
                </div>
                <h2 className="font-bold leading-snug mb-2 transition-colors group-hover:text-primary" style={{ color: 'var(--on-background)' }}>
                  {post.title}
                </h2>
                <p className="text-sm line-clamp-2" style={{ color: 'var(--on-surface)' }}>{post.description}</p>
                <div className="text-xs font-semibold mt-3" style={{ color: 'var(--primary)' }}>Read more →</div>
              </Link>
            );
          })}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });
}
