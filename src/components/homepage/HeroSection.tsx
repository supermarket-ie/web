import { HomePlanner } from '@/components/HomePlanner';
import { PlannerSSRShell } from '@/components/PlannerSSRShell';
import { HideAfterHydration } from '@/components/HideAfterHydration';
import { LiveDealChip } from '@/components/LiveDealChip';
import { AgentCopyUpdate } from '@/components/homepage/AgentCopyUpdate';

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-white px-4 pb-16 pt-8 sm:px-6 sm:pt-10 md:pb-24">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-72 bg-[linear-gradient(180deg,#f1f8f3_0%,rgba(255,255,255,0)_100%)]" />
        <div className="absolute left-0 top-0 h-1 w-[68%] bg-[#006a35]" />
        <div className="absolute right-[16%] top-0 h-1 w-[16%] bg-[#f4c52d]" />
        <div className="absolute right-0 top-0 h-1 w-[16%] bg-[#d74620]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl">
        <div id="grocery-agent" className="relative scroll-mt-20">
          <AgentCopyUpdate />
          <div className="absolute -inset-x-5 -inset-y-4 -z-10 rounded-[2rem] bg-[#eaf4ed] sm:-inset-x-7" />
          <div className="overflow-hidden rounded-[1.35rem] border border-[#d7e1da] bg-white shadow-[0_18px_55px_rgba(25,57,38,0.11)] sm:rounded-[1.65rem]">
            <HideAfterHydration>
              <PlannerSSRShell />
            </HideAfterHydration>
            <HomePlanner />
          </div>
        </div>

        <div className="relative mx-auto mt-6 h-10 max-w-xl overflow-hidden opacity-95">
          <LiveDealChip />
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-xs font-semibold text-[#68756d]">
          <span>Thousands of Irish supermarket prices</span>
          <span className="hidden size-1 rounded-full bg-[#b5bdb7] sm:block" />
          <span>Ingredient-level product understanding</span>
          <span className="hidden size-1 rounded-full bg-[#b5bdb7] sm:block" />
          <span>Nothing ordered without approval</span>
        </div>
      </div>
    </section>
  );
}
