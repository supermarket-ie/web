'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function VendorSignInPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle'|'submitting'|'sent'|'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    try {
      await fetch('/api/vendor/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      setStatus('sent');
    } catch { setStatus('error'); }
  }

  return (
    <div className="min-h-screen bg-[#FFFBF7] flex flex-col items-center justify-center px-6 py-16">
      <Link href="/vendor" className="text-[18px] font-bold text-[#1D2324] mb-10">supermarket<span className="text-[#E17055]">.ie</span></Link>
      <div className="bg-white rounded-2xl border border-[#E8E2DC] shadow-sm max-w-md w-full p-8">
        {status === 'sent' ? (
          <div className="text-center">
            <div className="text-4xl mb-4">📬</div>
            <h1 className="text-xl font-bold text-[#1D2324] mb-2">Check your inbox</h1>
            <p className="text-[#636E72] text-sm">We&rsquo;ve sent a sign-in link to <strong className="text-[#1D2324]">{email}</strong>. Valid for 7 days.</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-[#1D2324] mb-2">Sign in to your dashboard</h1>
            <p className="text-[#636E72] text-sm mb-6">Enter your email and we&rsquo;ll send you a sign-in link.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[#1D2324] mb-2">Business email</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourbusiness.ie"
                  className="w-full px-4 py-3 rounded-xl border-2 border-[#E8E2DC] focus:border-[#5D9B8F] focus:outline-none text-sm text-[#1D2324] placeholder:text-[#B2BEC3]"/>
              </div>
              {status === 'error' && <p className="text-sm text-red-600">Something went wrong. Please try again.</p>}
              <button type="submit" disabled={status === 'submitting'}
                className="w-full bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white py-3 rounded-xl font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all disabled:opacity-60">
                {status === 'submitting' ? 'Sending…' : 'Send sign-in link →'}
              </button>
            </form>
            <p className="text-center text-sm text-[#636E72] mt-5">
              Not listed yet? <Link href="/vendor/signup" className="text-[#E17055] font-semibold hover:underline">Sign up free</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
