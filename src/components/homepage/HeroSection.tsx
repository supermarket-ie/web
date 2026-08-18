import { HomePlanner } from '@/components/HomePlanner';
import { PlannerSSRShell } from '@/components/PlannerSSRShell';
import { HideAfterHydration } from '@/components/HideAfterHydration';
import { LiveDealChip } from '@/components/LiveDealChip';
import { Check, Sparkles } from 'lucide-react';
import { SessionLink } from './SessionLink';
import { AgentMark } from './AgentMark';

export function HeroSection() {
  return (
    <section className="relative overflow-hidden px-6 pb-20 pt-8 noise-bg md:pb-28 md:pt-12">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="gradient-blob -left-40 -top-52 size-[620px] bg-[radial-gradient(circle,rgba(107,254,156,0.2),transparent_68%)]" />
        <div className="gradient-blob -right-56 top-40 size-[560px] bg-[radial-gradient(circle,rgba(0,220,255,0.1),transparent_68%)]" />
        <div className="absolute inset-0 dot-grid opacity-35" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl">
        <div className="grid items-center gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
          <div className="max-w-xl">
            <div className="chip-tertiary mb-6 inline-flex items-center gap-2">
              <Sparkles className="size-3.5" />
              Ireland&apos;s personal supermarket agent
            </div>

            <h1 className="mb-6 text-balance text-[clamp(2.5rem,4.5vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.045em] text-on-background">
              Your whole shop,
              <span className="block bg-gradient-to-r from-[#006A35] to-[#12a85b] bg-clip-text text-transparent">
                planned around you.
              </span>
            </h1>

            <p className="mb-7 max-w-lg text-lg leading-8 text-on-surface md:text-xl">
              Tell your agent what your household needs—from food and meals to cleaning, toiletries and pet care. It remembers your preferences and helps you build the right shop each week.
            </p>

            <div className="mb-7 h-10">
              <LiveDealChip />
            </div>

            <div className="mb-8 grid gap-3 sm:grid-cols-2">
              {[
                'Food and meals planned',
                'Household essentials included',
                'One complete shop on budget',
                'Your regular items remembered',
              ].map((item) => (
                <div key={item} className="flex items-center gap-2.5 text-sm font-semibold text-on-background">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-container">
                    <Check className="size-3 text-on-primary-container" strokeWidth={3} />
                  </span>
                  {item}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <a href="#grocery-agent" className="btn-primary px-6 py-3.5 text-sm">
                Meet my supermarket agent
              </a>
              <SessionLink />
            </div>
            <p className="mt-4 text-xs font-medium text-on-surface-variant">
              Free to use · No card needed · Start in 30 seconds
            </p>
          </div>

          <div id="grocery-agent" className="relative scroll-mt-24">
            <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-primary-container/25 to-tertiary-container/15 blur-2xl" />
            <div className="mb-3 flex items-center justify-between px-2 text-xs font-semibold text-on-surface">
              <span className="inline-flex items-center gap-2">
                <AgentMark className="size-7" />
                Your supermarket agent is ready
              </span>
              <span>Built for Irish households</span>
            </div>
            <div
              className="overflow-hidden rounded-[1.5rem] border border-black/[0.04] bg-surface-lowest p-4 shadow-[0_24px_80px_rgba(20,60,38,0.13)] sm:p-6"
              style={{ minHeight: '500px' }}
            >
              <HideAfterHydration>
                <PlannerSSRShell />
              </HideAfterHydration>
              <HomePlanner />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
