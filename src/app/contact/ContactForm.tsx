'use client';

import { useState } from 'react';
import Link from 'next/link';

const SUBJECTS = [
  'Vendor / Partnership',
  'Feature idea',
  'Press enquiry',
  'General question',
  'Something else',
];

export function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setStatus('sent');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      {/* Header */}
      <header className="px-6 py-4 border-b border-[#E8E2DC] bg-white">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2">
            <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
              <defs><linearGradient id="contactBagGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#006A35"/><stop offset="100%" stopColor="#6BFE9C"/></linearGradient></defs>
              <path d="M8 12C8 10.8954 8.89543 10 10 10H30C31.1046 10 32 10.8954 32 12V32C32 34.2091 30.2091 36 28 36H12C9.79086 36 8 34.2091 8 32V12Z" fill="url(#contactBagGrad)"/>
              <path d="M14 10V8C14 5.79086 15.7909 4 18 4H22C24.2091 4 26 5.79086 26 8V10" stroke="#004a23" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M14 22h12M20 17v10" stroke="#004a23" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-[18px] font-bold tracking-tight text-[#1D2324]">
              supermarket<span className="text-[#1D2324]">.ie</span>
            </span>
          </Link>
          <Link href="/" className="text-sm text-[#636E72] hover:text-[#1D2324] transition">← Back</Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        {status === 'sent' ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-[#5D9B8F]/10 flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-[#5D9B8F]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-[#1D2324] mb-3">Message sent!</h1>
            <p className="text-[#636E72] mb-8 max-w-sm mx-auto">
              Thanks for reaching out. We read every message and will get back to you soon.
            </p>
            <Link href="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-semibold transition-all text-[#004a23]" style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
              Back to homepage
            </Link>
          </div>
        ) : (
          <>
            {/* Header copy */}
            <div className="mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium mb-4 text-[#006A35]" style={{ background: '#EAE7E7' }}>
                <span className="w-2 h-2 bg-[#00B894] rounded-full"></span>
                We'd love to hear from you
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-[#1D2324] mb-3">Get in touch</h1>
              <p className="text-[#636E72] text-lg leading-relaxed">
                Whether you're a supermarket or food brand interested in partnering with us, have a feature idea, or just want to say hello — drop us a message.
              </p>
            </div>

            {/* Nudge cards */}
            <div className="grid sm:grid-cols-3 gap-3 mb-10">
              {[
                { emoji: '🏪', title: 'Vendors & Partners', desc: 'Get your products in front of Ireland\'s smartest shoppers' },
                { emoji: '💡', title: 'Ideas & Feedback', desc: 'Help us build something people actually love to use' },
                { emoji: '📰', title: 'Press & Media', desc: 'Writing about Irish food tech? We\'d love to chat' },
              ].map(card => (
                <div key={card.title} className="bg-white border border-[#E8E2DC] rounded-xl p-4">
                  <div className="text-2xl mb-2">{card.emoji}</div>
                  <div className="font-semibold text-[#1D2324] text-sm mb-1">{card.title}</div>
                  <div className="text-xs text-[#636E72] leading-snug">{card.desc}</div>
                </div>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-[#E8E2DC] p-6 md:p-8 space-y-5">
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-semibold text-[#1D2324] mb-2">Your name</label>
                  <input
                    type="text" required value={form.name}
                    onChange={e => update('name', e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full px-4 py-3 rounded-xl border-2 border-[#E8E2DC] focus:border-[#5D9B8F] focus:outline-none transition text-[#1D2324] placeholder:text-[#B2BEC3] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#1D2324] mb-2">Email address</label>
                  <input
                    type="email" required value={form.email}
                    onChange={e => update('email', e.target.value)}
                    placeholder="jane@example.com"
                    className="w-full px-4 py-3 rounded-xl border-2 border-[#E8E2DC] focus:border-[#5D9B8F] focus:outline-none transition text-[#1D2324] placeholder:text-[#B2BEC3] text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#1D2324] mb-2">What's it about?</label>
                <div className="flex flex-wrap gap-2">
                  {SUBJECTS.map(s => (
                    <button key={s} type="button"
                      onClick={() => update('subject', s)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                        form.subject === s
                          ? 'border-[#006A35] bg-[#EAE7E7] text-[#006A35]'
                          : 'border-[rgba(175,173,172,0.3)] text-[#5c5b5b]'
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#1D2324] mb-2">Message</label>
                <textarea
                  required value={form.message}
                  onChange={e => update('message', e.target.value)}
                  placeholder="Tell us what's on your mind…"
                  rows={5}
                  className="w-full px-4 py-3 rounded-xl border-2 border-[#E8E2DC] focus:border-[#5D9B8F] focus:outline-none transition text-[#1D2324] placeholder:text-[#B2BEC3] text-sm resize-none"
                />
              </div>

              {status === 'error' && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {errorMsg}
                </div>
              )}

              <button type="submit" disabled={status === 'submitting'}
                className="w-full py-3.5 rounded-full font-semibold transition-all disabled:opacity-60 text-[#004a23]" style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
                {status === 'submitting' ? 'Sending…' : 'Send message →'}
              </button>

              <p className="text-center text-xs text-[#B2BEC3]">
                We reply to every message, usually within 1–2 business days.
              </p>
            </form>
          </>
        )}
      </main>

      <footer className="py-8 px-6 border-t border-[#E8E2DC] mt-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-[#B2BEC3]">
          <Link href="/" className="font-bold text-[#1D2324]">supermarket.ie</Link>
          <div className="flex gap-5">
            <Link href="/privacy" className="hover:text-[#636E72] transition">Privacy</Link>
            <Link href="/terms" className="hover:text-[#636E72] transition">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
