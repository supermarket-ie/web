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
    window.location.assign(`/?agent_prompt=${encodeURIComponent(nextRequest)}`);
  }

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-[#cfe5d5] bg-[#123d28] px-5 py-6 text-white shadow-[0_18px_55px_rgba(17,61,39,0.14)] sm:px-7 sm:py-7">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#a9e9bc]">
        <Sparkles className="size-4" />
        {eyebrow}
      </div>
      <h2 className="max-w-2xl text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-[1.8rem]">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#d6e9dc]">{description}</p>

      <form onSubmit={submit} className="mt-5 flex flex-col gap-2 rounded-2xl bg-white p-2 shadow-lg sm:flex-row">
        <label htmlFor={`agent-request-${context}`} className="sr-only">What would you like Supermarket.ie to do?</label>
        <input
          id={`agent-request-${context}`}
          value={request}
          onChange={event => setRequest(event.target.value)}
          className="min-w-0 flex-1 rounded-xl px-3 py-3 text-sm text-[#17241c] outline-none placeholder:text-[#88928b]"
          placeholder="Tell Supermarket.ie what you need…"
        />
        <button
          type="submit"
          disabled={!request.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#6BFE9C] px-5 py-3 text-sm font-bold text-[#073b20] transition hover:bg-[#82ffa9] disabled:opacity-50"
        >
          Ask the agent <ArrowRight className="size-4" />
        </button>
      </form>
      <p className="mt-3 text-[11px] text-[#a9c8b3]">Start without signing up. Register only when you want the agent to remember, save or monitor something.</p>
    </section>
  );
}
