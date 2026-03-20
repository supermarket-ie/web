import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { notFound } from 'next/navigation';
import { POSTS, getPost, type Section } from '@/lib/blog';

export const revalidate = 86400;

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
  'Meal Ideas':       '#E17055',
  'Ireland Food':     '#6C5CE7',
};

function renderSection(s: Section, i: number) {
  switch (s.type) {
    case 'intro':
      return (
        <p key={i} className="text-lg text-[#4A5568] leading-relaxed border-l-4 border-[#E17055] pl-4 mb-6">
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
              <span className="text-[#E17055] mt-1 flex-shrink-0">•</span>
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
        <div key={i} className="bg-gradient-to-br from-[#FEF3E2] to-[#FFFBF7] border-2 border-[#E17055]/20 rounded-2xl p-6 text-center my-8">
          <h3 className="font-bold text-[#1D2324] mb-1">{s.heading}</h3>
          <p className="text-sm text-[#636E72] mb-4">{s.text}</p>
          <Link href={s.link}
            className="inline-block bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-6 py-3 rounded-xl font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition">
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

  return (
    <div className="min-h-screen bg-[#FFFBF7]">
      <SiteHeader />

      <main className="max-w-3xl mx-auto px-6 pb-16">
        {/* Breadcrumb */}
        <nav className="pt-6 pb-2 text-xs text-[#B2BEC3]">
          <Link href="/" className="hover:text-[#636E72]">Home</Link>
          {' · '}
          <Link href="/blog" className="hover:text-[#636E72]">Blog</Link>
          {' · '}
          <span className="text-[#636E72] line-clamp-1">{post.title}</span>
        </nav>

        {/* Post header */}
        <div className="pt-4 pb-6 border-b border-[#E8E2DC] mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white"
              style={{ background: CATEGORY_COLORS[post.category] ?? '#636E72' }}>
              {post.category}
            </span>
            <span className="text-xs text-[#B2BEC3]">{post.readingTime}</span>
            <span className="text-xs text-[#B2BEC3]">·</span>
            <span className="text-xs text-[#B2BEC3]">{formatDate(post.date)}</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1D2324] leading-tight mb-3">{post.title}</h1>
          <p className="text-[#636E72]">{post.description}</p>
        </div>

        {/* Post content */}
        <article>
          {post.content.map((section, i) => renderSection(section, i))}
        </article>

        {/* More posts */}
        {otherPosts.length > 0 && (
          <div className="mt-12">
            <h2 className="text-lg font-bold text-[#1D2324] mb-4">More from the blog</h2>
            <div className="space-y-3">
              {otherPosts.map(p => (
                <Link key={p.slug} href={`/blog/${p.slug}`}
                  className="block bg-white rounded-xl border border-[#E8E2DC] p-4 hover:border-[#E17055]/40 transition group">
                  <div className="text-xs text-[#B2BEC3] mb-1">{p.category} · {p.readingTime}</div>
                  <div className="text-sm font-semibold text-[#1D2324] group-hover:text-[#E17055] transition leading-snug">
                    {p.title}
                  </div>
                </Link>
              ))}
            </div>
            <div className="mt-4">
              <Link href="/blog" className="text-sm text-[#E17055] font-semibold hover:underline">← All posts</Link>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-[#E8E2DC] py-6 px-6 text-center text-xs text-[#B2BEC3]">
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
