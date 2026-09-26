'use client';

import { type FormEvent, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';

type AgentLandingCTAProps = {
  eyebrow?: string;
  title: string;
  description: string;
  prompt: string;
  context: 'comparison' | 'deals' | 'category' | 'product' | 'article';
};

export function AgentLandingCTA({
  eyebrow = 'Ask Ireland’s supermarket agent',
  title,
  description,
  prompt,
  context,
}: AgentLandingCTAProps) {
  const [request, setRequest] = useState(prompt);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextRequest = request.trim();
    if (!nextRequest) return;

    trackEvent('landing_agent_started', {
      context,
      landing_path: window.location.pathname,
    });
    const params = new URLSearchParams({
      agent_prompt: nextRequest,
      agent_landing: window.location.pathname,
    });
    window.location.assign(`/?${params.toString()}`);
  }

  return (
    <section className="relative overflow-hidden rounded-[1.8rem] border border-[#dfe6e0] bg-white px-5 py-6 text-[#152219] shadow-[0_28px_90px_rgba(25,57,38,0.12)] sm:px-7 sm:py-7">
      <div className="pointer-events-none absolute -right-24 -top-32 size-72 rounded-full bg-[radial-gradient(circle,rgba(169,236,191,0.3),rgba(255,255,255,0)_70%)]" />
      <div className="relative">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#397250]">
        <span className="flex size-7 items-center justify-center rounded-full bg-[#e5f7eb]"><Sparkles className="size-4" /></span>
        {eyebrow}
      </div>
      <h2 className="max-w-2xl text-balance text-2xl font-semibold tracking-[-0.04em] sm:text-[1.85rem]">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667169]">{description}</p>

      <form onSubmit={submit} className="mt-5 flex flex-col gap-2 rounded-2xl border border-[#e3e8e4] bg-[#f5f8f5] p-2 sm:flex-row">
        <label htmlFor={`agent-request-${context}`} className="sr-only">What would you like Supermarket.ie to do?</label>
        <input
          id={`agent-request-${context}`}
          value={request}
          onChange={event => setRequest(event.target.value)}
          className="min-w-0 flex-1 rounded-xl bg-transparent px-3 py-3 text-sm text-[#17241c] outline-none placeholder:text-[#88928b]"
          placeholder="Tell Supermarket.ie what you need…"
        />
        <button
          type="submit"
          disabled={!request.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0b1710] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#173124] disabled:opacity-50"
        >
          Ask the agent <ArrowRight className="size-4" />
        </button>
      </form>
      <p className="mt-3 text-[11px] text-[#8b958e]">Start without signing up. Register only when you want the agent to remember, save or monitor something.</p>
      </div>
    </section>
  );
}
