'use client';
import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="py-12 px-6" style={{ background: '#0E0E0E', color: '#F9F6F5' }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
          <Link href="/" className="font-extrabold text-xl" style={{ color: '#F9F6F5', letterSpacing: '-0.02em' }}>
            supermarket<span style={{ color: '#6BFE9C' }}>.ie</span>
          </Link>
          <div className="flex gap-6 text-sm" style={{ color: 'rgba(249,246,245,0.5)' }}>
            <Link href="/privacy" className="hover:text-white transition">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition">Terms</Link>
            <Link href="/contact" className="hover:text-white transition">Contact</Link>
          </div>
        </div>
        <div className="pt-8 text-center text-sm" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: 'rgba(249,246,245,0.3)' }}>
          © 2026 Superdata Ltd · supermarket.ie · Made with ❤️ in Ireland
        </div>
      </div>
    </footer>
  );
}
