// Server-rendered visual shell shown until the live agent hydrates.
export function PlannerSSRShell() {
  return (
    <div className="flex min-h-[470px] flex-col bg-white px-5 py-6 sm:px-8 sm:py-8">
      <h2 className="sr-only">Supermarket.ie household shopping agent for Ireland</h2>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center">
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[#397250]">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#e5f7eb]">✦</span>
            Ready when you are
          </div>
          <p className="text-balance text-2xl font-semibold tracking-[-0.035em] text-[#152219] sm:text-[2rem]">What do you need for the household?</p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667169]">Thousands of tracked Irish supermarket prices and ingredient mappings.</p>
        </div>

        <div className="relative min-h-20 rounded-[1.35rem] border border-[#dfe5e0] bg-white px-5 py-5 text-[15px] text-[#8d948f] shadow-[0_14px_45px_rgba(26,54,39,0.08)]">
          Ask Supermarket.ie what your household needs…
          <span className="absolute bottom-3 right-3 flex size-10 items-center justify-center rounded-full bg-[#0b1710] text-lg text-white">↑</span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2" aria-hidden="true">
          {[
            ["Find Hellmann's mayonnaise", 'Check current products, prices and stores'],
            ['Compare Irish butter', 'See how a product compares across stores'],
            ['Plan four easy dinners', 'Turn a simple idea into a practical week'],
            ['Keep a shop under €120', 'Get a sensible household shopping strategy'],
          ].map(([label, detail]) => (
            <div key={label} className="flex items-center gap-3 rounded-2xl px-3.5 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[#e5eae6] bg-white text-[#176b3a] shadow-sm">↗</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[#26342b]">{label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-[#879089]">{detail}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-5 text-center text-[10px] leading-4 text-[#9aa19c]">Your agent can prepare drafts and remember preferences after sign-in. It will never place an order or spend money without approval.</p>
    </div>
  );
}
