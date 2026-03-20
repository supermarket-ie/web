import type { Metadata } from 'next';
import Link from 'next/link';
import { POSTS } from '@/lib/blog';

export const metadata: Metadata = {
  title: 'Blog — Grocery Tips & Price Comparisons Ireland | supermarket.ie',
  description: 'Practical guides on saving money at Irish supermarkets, price comparisons between Tesco, Dunnes and SuperValu, and meal ideas with live ingredient costs.',
};

const CATEGORY_COLORS: Record<string, string> = {
  'Price Comparison': '#003A8C',
  'Saving Money':     '#5D9B8F',
  'Meal Ideas':       '#E17055',
  'Ireland Food':     '#6C5CE7',
};

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-[#FFFBF7]">
      <header className="px-4 py-4 border-b border-[#E8E2DC] bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-bold text-lg text-[#1D2324]">supermarket<span className="text-[#E17055]">.ie</span></Link>
          <Link href="/" className="text-xs bg-[#E17055] text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-[#D4604A] transition">
            Build my list →
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pb-16">
        <div className="pt-10 pb-8">
          <h1 className="text-3xl font-bold text-[#1D2324] mb-3">Blog</h1>
          <p className="text-[#636E72]">
            Practical guides on saving money at Irish supermarkets, live price comparisons, and meal ideas with real ingredient costs.
          </p>
        </div>

        <div className="space-y-4">
          {POSTS.map(post => (
            <Link key={post.slug} href={`/blog/${post.slug}`}
              className="block bg-white rounded-2xl border border-[#E8E2DC] p-5 hover:border-[#E17055]/40 hover:shadow-sm transition group">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white"
                  style={{ background: CATEGORY_COLORS[post.category] ?? '#636E72' }}>
                  {post.category}
                </span>
                <span className="text-xs text-[#B2BEC3]">{post.readingTime}</span>
                <span className="text-xs text-[#B2BEC3]">·</span>
                <span className="text-xs text-[#B2BEC3]">{formatDate(post.date)}</span>
              </div>
              <h2 className="font-bold text-[#1D2324] group-hover:text-[#E17055] transition mb-1 leading-snug">
                {post.title}
              </h2>
              <p className="text-sm text-[#636E72] line-clamp-2">{post.description}</p>
              <div className="text-xs text-[#E17055] mt-3 font-semibold">Read more →</div>
            </Link>
          ))}
        </div>
      </main>

      <footer className="border-t border-[#E8E2DC] py-6 px-4 text-center text-xs text-[#B2BEC3]">
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
