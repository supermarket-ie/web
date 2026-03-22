'use client';
import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="py-12 px-6" style={{ background: 'var(--inverse-surface)', color: 'var(--inverse-on-surface)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
          <Link href="/" className="font-extrabold text-xl" style={{ color: 'var(--inverse-on-surface)', letterSpacing: '-0.02em' }}>
            supermarket<span style={{ color: 'var(--primary-container)' }}>.ie</span>
          </Link>
          <nav className="flex gap-6 text-sm" style={{ color: 'rgba(249,246,245,0.5)' }}>
            <Link href="/privacy" className="hover:text-white transition">Privacy</Link>
            <Link href="/terms"   className="hover:text-white transition">Terms</Link>
            <Link href="/contact" className="hover:text-white transition">Contact</Link>
          </nav>
        </div>
        <p className="text-center text-sm pt-8" style={{ color: 'rgba(249,246,245,0.3)' }}>
          © 2026 Superdata Ltd · supermarket.ie · Made with ❤️ in Ireland
        </p>
      </div>
    </footer>
  );
}
