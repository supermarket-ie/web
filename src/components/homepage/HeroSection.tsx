import { HomePlanner } from '@/components/HomePlanner';
import { PlannerSSRShell } from '@/components/PlannerSSRShell';
import { HideAfterHydration } from '@/components/HideAfterHydration';
import { LiveDealChip } from '@/components/LiveDealChip';

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-[#f8faf8] px-4 pb-20 pt-6 sm:px-6 sm:pt-8 md:pb-28">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-420px] size-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(169,236,191,0.28),rgba(248,250,248,0)_68%)]" />
        <div className="absolute -right-48 top-44 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(255,216,77,0.08),rgba(248,250,248,0)_70%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl">
        <div id="grocery-agent" className="relative scroll-mt-20">
          <div className="absolute -inset-8 -z-10 rounded-[3rem] bg-[radial-gradient(circle_at_top,rgba(118,224,153,0.2),transparent_66%)] blur-2xl" />
          <div className="overflow-hidden rounded-[1.8rem] border border-[#dfe6e0] bg-white shadow-[0_28px_90px_rgba(25,57,38,0.12)]">
            <HideAfterHydration>
              <PlannerSSRShell />
            </HideAfterHydration>
            <HomePlanner />
          </div>
        </div>

        <div className="relative mx-auto mt-5 h-10 max-w-xl overflow-hidden opacity-90">
          <LiveDealChip />
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-xs font-medium text-[#7c867f]">
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
