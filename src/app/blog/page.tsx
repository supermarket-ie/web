import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { POSTS } from '@/lib/blog';

export const metadata: Metadata = {
  title: 'Blog — Grocery Tips & Price Comparisons Ireland | supermarket.ie',
  description: 'Practical guides on saving money at Irish supermarkets, price comparisons between Tesco, Dunnes and SuperValu, and meal ideas with live ingredient costs.',
};

const CATEGORY_COLORS: Record<string, string> = {
  'Price Comparison': '#003A8C',
  'Saving Money':     '#5D9B8F',
  'Meal Ideas':       '#006A35',
  'Ireland Food':     '#6C5CE7',
};

export default function BlogPage() {
  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-6 pb-16">
        <div className="pt-10 pb-8">
          <h1 className="text-3xl font-bold text-[#2F2F2E] mb-3">Blog</h1>
          <p className="text-[#5c5b5b]">
            Practical guides on saving money at Irish supermarkets, live price comparisons, and meal ideas with real ingredient costs.
          </p>
        </div>

        <div className="space-y-4">
          {POSTS.map(post => (
            <Link key={post.slug} href={`/blog/${post.slug}`}
              className="block bg-white rounded-2xl p-5 hover:shadow-sm transition group" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white"
                  style={{ background: CATEGORY_COLORS[post.category] ?? '#636E72' }}>
                  {post.category}
                </span>
                <span className="text-xs text-[#B2BEC3]">{post.readingTime}</span>
                <span className="text-xs text-[#B2BEC3]">·</span>
                <span className="text-xs text-[#B2BEC3]">{formatDate(post.date)}</span>
              </div>
              <h2 className="font-bold text-[#2F2F2E] group-hover:text-[#006A35] transition mb-1 leading-snug">
                {post.title}
              </h2>
              <p className="text-sm text-[#5c5b5b] line-clamp-2">{post.description}</p>
              <div className="text-xs text-[#006A35] mt-3 font-semibold">Read more →</div>
            </Link>
          ))}
        </div>
      </main>

      <footer className="py-6 px-6 text-center text-xs" style={{ borderTop: '1px solid rgba(175,173,172,0.2)', color: 'rgba(175,173,172,0.8)' }}>
        <Link href="/" className="hover:text-[#636E72]">supermarket.ie</Link>
        {' · '}
        <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="hover:text-[#636E72]">Price comparison</Link>
        {' · '}
        <Link href="/shop" className="hover:text-[#636E72]">Browse categories</Link>
      </footer>
    </div>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });
}
