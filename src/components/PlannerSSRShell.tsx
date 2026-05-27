// Server component — no 'use client' directive
// Renders a static visual shell of the planner chat for SEO/crawlers.
// The live HomePlanner hydrates on top of this via absolute positioning.

export function PlannerSSRShell() {
  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto overflow-hidden">
      {/* SEO-only structured text — visible to crawlers, not intrusive visually */}
      <h2 className="sr-only">
        AI grocery planner for Ireland — compare prices across Tesco, Dunnes Stores, SuperValu, Aldi
      </h2>

      {/* Initial assistant message */}
      <div className="flex-1 space-y-3 mb-4 overflow-hidden">
        <div className="flex justify-start">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}
            aria-hidden="true"
          >
            S
          </div>
          <div
            className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm"
            style={{
              background: 'var(--surface-container-lowest)',
              border: '1px solid var(--surface-container)',
            }}
          >
            <p style={{ color: 'var(--on-surface)' }}>
              👋 Hey! I&apos;m your grocery planning assistant. Tell me what you need — household
              size, any dietary requirements, budget — and I&apos;ll build you a priced weekly list.
            </p>
            {/* Suggestion buttons — static, non-interactive */}
            <div className="flex flex-wrap gap-1.5 mt-2" aria-hidden="true">
              {[
                '👨\u200d👩\u200d👧\u200d👦 Family of 4, full week',
                '🧑 Just me, dinners only',
                '🥗 2 adults, vegetarian, €100',
              ].map((label) => (
                <div
                  key={label}
                  className="px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{
                    background: 'var(--primary-container)',
                    color: 'var(--on-primary-container)',
                    border: '1px solid var(--primary)',
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Static input placeholder */}
      <div
        className="sticky bottom-0 z-10 pt-2 w-full"
        style={{ background: 'var(--surface-container-lowest)' }}
      >
        <div className="relative w-full">
          <div
            className="w-full px-4 py-3 pr-12 rounded-xl text-sm"
            style={{
              background: 'var(--surface-container-low)',
              border: '1.5px solid var(--surface-container)',
              color: 'var(--on-surface-variant)',
              minHeight: '46px',
            }}
            aria-hidden="true"
          >
            Tell me what you need...
          </div>
          <div
            className="absolute right-3 bottom-3 w-8 h-8 rounded-lg flex items-center justify-center opacity-40"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}
            aria-hidden="true"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
              />
            </svg>
          </div>
        </div>
        <p className="text-xs mt-1.5 text-center" style={{ color: 'var(--on-surface-variant)' }}>
          Prices from Tesco, Dunnes, SuperValu &amp; Aldi · Free
        </p>
      </div>
    </div>
  );
}
