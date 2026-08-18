import Link from 'next/link';

type Decision = {
  canonical_name: string;
  action: 'included' | 'suggested' | 'not_added';
  confidence: 'include' | 'suggest' | 'suppress';
  reason: string;
  signals?: string[];
  sources?: string[];
  price?: number | null;
  store?: string | null;
  on_promotion?: boolean;
};

type DecisionTrace = {
  version?: number;
  prepared_at?: string;
  decisions?: Decision[];
};

function actionLabel(action: Decision['action']) {
  if (action === 'included') return 'Added';
  if (action === 'suggested') return 'Suggested';
  return 'Not added';
}

function actionTone(action: Decision['action']) {
  if (action === 'included') return { background: 'rgba(0,148,74,0.10)', color: '#007a3d' };
  if (action === 'suggested') return { background: 'rgba(232,93,4,0.10)', color: '#b84a00' };
  return { background: 'var(--surface-container)', color: 'var(--on-surface-variant)' };
}

export function ShopDecisionTrace({
  trace,
  conversationId,
}: {
  trace?: DecisionTrace | null;
  conversationId?: string | null;
}) {
  const decisions = (trace?.decisions ?? []).filter(decision => decision?.canonical_name && decision?.reason);
  if (!decisions.length) return null;

  const included = decisions.filter(decision => decision.action === 'included');
  const suggested = decisions.filter(decision => decision.action === 'suggested');
  const notAdded = decisions.filter(decision => decision.action === 'not_added');

  return (
    <div className="max-w-2xl mx-auto px-4 pt-5">
      <details
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}
      >
        <summary className="cursor-pointer list-none px-4 py-3.5 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--on-background)' }}>Why this changed</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
              {included.length > 0 ? `${included.length} added` : 'No automatic additions'}
              {suggested.length > 0 ? ` · ${suggested.length} suggested` : ''}
              {notAdded.length > 0 ? ` · ${notAdded.length} held back` : ''}
            </div>
          </div>
          <span className="text-xs font-semibold" style={{ color: '#00944A' }}>View reasons</span>
        </summary>

        <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--surface-container)' }}>
          <p className="text-xs py-3" style={{ color: 'var(--on-surface-variant)' }}>
            Supermarket.ie prepared this shop from your household pattern and this week&apos;s needs. Meal-completion ideas stay as suggestions until you approve them.
          </p>

          <div className="space-y-2">
            {decisions.map((decision, index) => {
              const tone = actionTone(decision.action);
              const prefill = `Add ${decision.canonical_name} to my shop`;
              const href = conversationId
                ? `/dashboard/chat/${conversationId}?prefill=${encodeURIComponent(prefill)}`
                : `/?prefill=${encodeURIComponent(prefill)}`;

              return (
                <div key={`${decision.canonical_name}-${decision.action}-${index}`} className="rounded-xl p-3" style={{ background: 'var(--surface-container-low)' }}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-semibold" style={{ color: 'var(--on-background)' }}>{decision.canonical_name}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={tone}>{actionLabel(decision.action)}</span>
                        {decision.on_promotion && <span className="text-[10px] font-bold" style={{ color: '#b84a00' }}>On promotion</span>}
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--on-surface)' }}>{decision.reason}</p>
                      {(decision.signals?.length ?? 0) > 0 && (
                        <p className="text-[11px] mt-1.5" style={{ color: 'var(--on-surface-variant)' }}>
                          {decision.signals!.slice(0, 3).join(' · ')}
                        </p>
                      )}
                    </div>
                    {decision.action === 'suggested' && (
                      <Link
                        href={href}
                        className="flex-shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
                        style={{ background: 'rgba(0,148,74,0.10)', color: '#007a3d' }}
                      >
                        Add
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </details>
    </div>
  );
}
