'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

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
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <SiteHeader />

      <main className="max-w-2xl mx-auto px-6 py-16">
        {status === 'sent' ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
              style={{ background: 'var(--surface-container)' }}>
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--primary)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="type-title-lg text-on-background mb-3">Message sent!</h1>
            <p className="mb-8 max-w-sm mx-auto" style={{ color: 'var(--on-surface)' }}>
              Thanks for reaching out. We read every message and will get back to you soon.
            </p>
            <Link href="/" className="btn-primary inline-flex px-6 py-3">
              Back to homepage
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-12">
              <div className="chip-tertiary mb-5">We&apos;d love to hear from you</div>
              <h1 className="type-headline text-on-background mb-4">Get in touch</h1>
              <p className="type-body-lg" style={{ color: 'var(--on-surface)' }}>
                Whether you&apos;re a supermarket or food brand interested in partnering with us, have a feature idea, or just want to say hello — drop us a message.
              </p>
            </div>

            {/* Nudge cards */}
            <div className="grid sm:grid-cols-3 gap-3 mb-12">
              {[
                { emoji: '🏪', title: 'Vendors & Partners', desc: "Get your products in front of Ireland's smartest shoppers" },
                { emoji: '💡', title: 'Ideas & Feedback',   desc: "Help us build something people actually love to use" },
                { emoji: '📰', title: 'Press & Media',      desc: "Writing about Irish food tech? We'd love to chat" },
              ].map(card => (
                <div key={card.title} className="rounded-xl p-4" style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                  <div className="text-2xl mb-2">{card.emoji}</div>
                  <div className="font-semibold text-sm mb-1" style={{ color: 'var(--on-background)' }}>{card.title}</div>
                  <div className="text-xs leading-snug" style={{ color: 'var(--on-surface)' }}>{card.desc}</div>
                </div>
              ))}
            </div>

            {/* Form */}
            <div className="rounded-2xl p-6 md:p-8" style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--on-background)' }}>Your name</label>
                    <input
                      type="text" required value={form.name}
                      onChange={e => update('name', e.target.value)}
                      placeholder="Jane Smith"
                      className="w-full px-4 py-3 rounded-xl text-sm transition-all focus:outline-none"
                      style={{
                        background: 'var(--surface-container-high)',
                        color: 'var(--on-background)',
                      }}
                      onFocus={e => { e.currentTarget.style.background = 'var(--surface-container-lowest)'; e.currentTarget.style.outline = '2px solid rgba(0,106,53,0.4)'; e.currentTarget.style.outlineOffset = '-2px'; }}
                      onBlur={e =>  { e.currentTarget.style.background = 'var(--surface-container-high)'; e.currentTarget.style.outline = 'none'; }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--on-background)' }}>Email address</label>
                    <input
                      type="email" required value={form.email}
                      onChange={e => update('email', e.target.value)}
                      placeholder="jane@example.com"
                      className="w-full px-4 py-3 rounded-xl text-sm transition-all focus:outline-none"
                      style={{
                        background: 'var(--surface-container-high)',
                        color: 'var(--on-background)',
                      }}
                      onFocus={e => { e.currentTarget.style.background = 'var(--surface-container-lowest)'; e.currentTarget.style.outline = '2px solid rgba(0,106,53,0.4)'; e.currentTarget.style.outlineOffset = '-2px'; }}
                      onBlur={e =>  { e.currentTarget.style.background = 'var(--surface-container-high)'; e.currentTarget.style.outline = 'none'; }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--on-background)' }}>What&apos;s it about?</label>
                  <div className="flex flex-wrap gap-2">
                    {SUBJECTS.map(s => (
                      <button key={s} type="button" onClick={() => update('subject', s)}
                        className="px-3 py-1.5 rounded-full text-sm font-medium transition-all"
                        style={form.subject === s
                          ? { background: 'var(--primary)', color: 'var(--on-primary)' }
                          : { background: 'var(--surface-container)', color: 'var(--on-surface)' }
                        }>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--on-background)' }}>Message</label>
                  <textarea
                    required value={form.message}
                    onChange={e => update('message', e.target.value)}
                    placeholder="Tell us what's on your mind…"
                    rows={5}
                    className="w-full px-4 py-3 rounded-xl text-sm transition-all focus:outline-none resize-none"
                    style={{
                      background: 'var(--surface-container-high)',
                      color: 'var(--on-background)',
                    }}
                    onFocus={e => { e.currentTarget.style.background = 'var(--surface-container-lowest)'; e.currentTarget.style.outline = '2px solid rgba(0,106,53,0.4)'; e.currentTarget.style.outlineOffset = '-2px'; }}
                    onBlur={e =>  { e.currentTarget.style.background = 'var(--surface-container-high)'; e.currentTarget.style.outline = 'none'; }}
                  />
                </div>

                {status === 'error' && (
                  <div className="px-4 py-3 rounded-xl text-sm text-red-700" style={{ background: '#FEF2F2' }}>
                    {errorMsg}
                  </div>
                )}

                <button type="submit" disabled={status === 'submitting'} className="btn-primary w-full py-3.5 text-base">
                  {status === 'submitting' ? 'Sending…' : 'Send message →'}
                </button>

                <p className="text-center text-xs" style={{ color: 'var(--on-surface-variant)' }}>
                  We reply to every message, usually within 1–2 business days.
                </p>
              </form>
            </div>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
