import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { notFound } from 'next/navigation';
import { POSTS, getPost, type Section } from '@/lib/blog';
import { articleJsonLd } from '@/lib/structured-data';

export const revalidate = 86400;

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();

export async function generateStaticParams() {
  return POSTS.map(p => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: 'Not found' };
  return {
    title: `${post.title} | supermarket.ie`,
    description: post.description,
    alternates: { canonical: `${BASE_URL}/blog/${slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      publishedTime: post.date,
    },
  };
}

const CATEGORY_COLORS: Record<string, string> = {
  'Price Comparison': '#003A8C',
  'Saving Money':     '#5D9B8F',
  'Meal Ideas':       '#006A35',
  'Ireland Food':     '#6C5CE7',
};

// Related page links by category
const CATEGORY_RELATED: Record<string, { label: string; href: string }[]> = {
  'Price Comparison': [
    { label: 'Compare all supermarket prices', href: '/compare/supermarket-prices-ireland' },
    { label: 'Tesco vs Dunnes vs SuperValu', href: '/compare/tesco-vs-dunnes' },
    { label: 'This week\'s deals', href: '/deals' },
  ],
  'Saving Money': [
    { label: 'This week\'s best deals', href: '/deals' },
    { label: 'Cost of a weekly shop in Ireland', href: '/cost-of-weekly-shop-ireland' },
    { label: 'Try the AI grocery planner', href: '/' },
  ],
  'Meal Ideas': [
    { label: 'Browse grocery prices by category', href: '/shop' },
    { label: 'Try the AI grocery planner', href: '/' },
    { label: 'This week\'s deals', href: '/deals' },
  ],
  'Ireland Food': [
    { label: 'Compare supermarket prices Ireland', href: '/compare/supermarket-prices-ireland' },
    { label: 'Browse grocery prices by category', href: '/shop' },
    { label: 'Try the AI grocery planner', href: '/' },
  ],
};

function renderSection(s: Section, i: number) {
  switch (s.type) {
    case 'intro':
      return (
        <p key={i} className="text-lg text-[#4A5568] leading-relaxed border-l-4 border-[#006A35] pl-4 mb-6">
          {s.text}
        </p>
      );
    case 'h2':
      return (
        <h2 key={i} className="text-xl font-bold text-[#1D2324] mt-8 mb-3">{s.text}</h2>
      );
    case 'p':
      return (
        <p key={i} className="text-[#4A5568] leading-relaxed mb-4">{s.text}</p>
      );
    case 'ul':
      return (
        <ul key={i} className="space-y-2 mb-5 ml-1">
          {s.items.map((item, j) => (
            <li key={j} className="flex gap-2 text-[#4A5568]">
              <span className="text-[#006A35] mt-1 flex-shrink-0">•</span>
              <span className="leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>
      );
    case 'tip':
      return (
        <div key={i} className="bg-[#F0F7F5] border border-[#5D9B8F]/30 rounded-xl p-4 mb-5">
          <div className="text-xs font-bold text-[#5D9B8F] uppercase tracking-wide mb-1">{s.heading}</div>
          <p className="text-sm text-[#4A5568] leading-relaxed">{s.text}</p>
        </div>
      );
    case 'cta':
      return (
        <div key={i} className="rounded-2xl p-6 text-center my-8" style={{ background: '#EAE7E7' }}>
          <h3 className="font-bold text-[#2F2F2E] mb-1">{s.heading}</h3>
          <p className="text-sm text-[#5c5b5b] mb-4">{s.text}</p>
          <Link href={s.link}
            className="inline-block px-6 py-3 rounded-full font-semibold transition text-[#004a23]"
            style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
            {s.linkText}
          </Link>
        </div>
      );
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const otherPosts = POSTS.filter(p => p.slug !== slug).slice(0, 3);
  const relatedLinks = CATEGORY_RELATED[post.category] ?? CATEGORY_RELATED['Saving Money'];

  const jsonLd = articleJsonLd({
    title: post.title,
    description: post.description,
    datePublished: post.date,
    url: `/blog/${slug}`,
  });

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <SiteHeader />

      <main className="max-w-3xl mx-auto px-6 pb-16">
        <Breadcrumbs items={[{ label: 'Blog', href: '/blog' }, { label: post.title, href: `/blog/${slug}` }]} />

        {/* Post header */}
        <div className="pt-4 pb-6 mb-6" style={{ borderBottom: '1px solid rgba(175,173,172,0.2)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white"
              style={{ background: CATEGORY_COLORS[post.category] ?? '#636E72' }}>
              {post.category}
            </span>
            <span className="text-xs text-[#B2BEC3]">{post.readingTime}</span>
            <span className="text-xs text-[#B2BEC3]">·</span>
            <span className="text-xs text-[#B2BEC3]">{formatDate(post.date)}</span>
          </div>
          <h1 className="text-2xl font-bold text-[#2F2F2E] leading-tight mb-3">{post.title}</h1>
          <p className="text-[#5c5b5b]">{post.description}</p>
        </div>

        {/* Post content */}
        <article>
          {post.content.map((section, i) => renderSection(section, i))}
        </article>

        {/* AI agent CTA */}
        <div className="mt-10 rounded-2xl p-6 text-center" style={{ background: '#EAE7E7' }}>
          <div className="text-2xl mb-2">🛒</div>
          <h3 className="font-bold text-[#2F2F2E] mb-1">Let your AI agent handle this →</h3>
          <p className="text-sm text-[#5c5b5b] mb-4">
            Tell it what you need this week. It tracks prices, spots deals, and builds your list automatically.
          </p>
          <Link href="/"
            className="inline-block px-6 py-3 rounded-full font-semibold transition text-[#004a23]"
            style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
            Try the AI planner free →
          </Link>
        </div>

        {/* Related content */}
        <div className="mt-10">
          <h2 className="text-base font-bold text-[#2F2F2E] mb-3">Related</h2>
          <div className="space-y-2">
            {relatedLinks.map(link => (
              <Link key={link.href} href={link.href}
                className="block bg-white rounded-xl p-3 text-sm font-medium text-[#006A35] hover:text-[#004a23] transition"
                style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
                {link.label} →
              </Link>
            ))}
          </div>
        </div>

        {/* More posts */}
        {otherPosts.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-bold text-[#2F2F2E] mb-4">More from the blog</h2>
            <div className="space-y-3">
              {otherPosts.map(p => (
                <Link key={p.slug} href={`/blog/${p.slug}`}
                  className="block bg-white rounded-xl p-4 transition group" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
                  <div className="text-xs mb-1" style={{ color: 'rgba(175,173,172,0.8)' }}>{p.category} · {p.readingTime}</div>
                  <div className="text-sm font-semibold text-[#2F2F2E] group-hover:text-[#006A35] transition leading-snug">
                    {p.title}
                  </div>
                </Link>
              ))}
            </div>
            <div className="mt-4">
              <Link href="/blog" className="text-sm text-[#006A35] font-semibold hover:underline">← All posts</Link>
            </div>
          </div>
        )}
      </main>

      <SiteFooter />

      {/* Article structured data */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });
}
