'use client';

export interface RefreshData {
  hasRecentList: boolean;
  daysSince: number;
  lastList: {
    id: string;
    name: string;
    created_at: string;
    total: number;
  };
  priceDiff: {
    cheaper: number;
    dearer: number;
    promoSwaps: number;
    cheaperAmount: number;
    dearerAmount: number;
    netChange: number;
  };
  thisWeekTotal: number;
}

interface SmartRefreshCardProps {
  data: RefreshData;
  onSameAgain: () => void;
  onModify: () => void;
}

export function SmartRefreshCard({ data, onSameAgain, onModify }: SmartRefreshCardProps) {
  const { lastList, priceDiff, thisWeekTotal, daysSince } = data;
  const saving = priceDiff.netChange > 0;
  const stale = daysSince >= 14;

  return (
    <div
      className="rounded-2xl p-4 mb-4"
      style={{
        background: 'var(--surface-container-lowest)',
        border: '1px solid var(--surface-container)',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium" style={{ color: 'var(--on-surface-variant)' }}>
          This week&apos;s update
        </p>
        <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
          {daysSince === 0 ? 'Today' : daysSince === 1 ? 'Yesterday' : `${daysSince}d ago`}
        </span>
      </div>

      <p className="text-sm mb-3" style={{ color: 'var(--on-surface)' }}>
        Based on your last shop{' '}
        <span className="font-semibold">€{lastList.total.toFixed(2)}</span>
        {stale && (
          <span className="ml-1 text-xs" style={{ color: 'var(--on-surface-variant)' }}>
            — it&apos;s been a while, want to update anything?
          </span>
        )}
      </p>

      <div className="space-y-1.5 mb-3">
        {priceDiff.cheaper > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span>🟢</span>
            <span style={{ color: 'var(--on-surface)' }}>
              <strong>{priceDiff.cheaper} item{priceDiff.cheaper !== 1 ? 's' : ''}</strong> cheaper
              this week{' '}
              <span style={{ color: '#16a34a' }}>−€{priceDiff.cheaperAmount.toFixed(2)}</span>
            </span>
          </div>
        )}
        {priceDiff.dearer > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span>🔴</span>
            <span style={{ color: 'var(--on-surface)' }}>
              <strong>{priceDiff.dearer} item{priceDiff.dearer !== 1 ? 's' : ''}</strong> more
              expensive{' '}
              <span style={{ color: '#dc2626' }}>+€{priceDiff.dearerAmount.toFixed(2)}</span>
            </span>
          </div>
        )}
        {priceDiff.promoSwaps > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span>🏷️</span>
            <span style={{ color: 'var(--on-surface)' }}>
              <strong>{priceDiff.promoSwaps} item{priceDiff.promoSwaps !== 1 ? 's' : ''}</strong>{' '}
              on promotion at a different store
            </span>
          </div>
        )}
        {priceDiff.cheaper === 0 && priceDiff.dearer === 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span>✅</span>
            <span style={{ color: 'var(--on-surface)' }}>
              Prices stable — your usual shop is the same this week
            </span>
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-between py-2 px-3 rounded-xl mb-3"
        style={{ background: saving ? 'var(--primary-container)' : 'var(--surface-container)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--on-surface-variant)' }}>
          Net this week
        </span>
        <div className="text-right">
          <span className="text-base font-bold" style={{ color: saving ? 'var(--primary)' : 'var(--on-surface)' }}>
            €{thisWeekTotal.toFixed(2)}
          </span>
          {priceDiff.netChange !== 0 && (
            <span
              className="text-xs ml-1.5"
              style={{ color: saving ? '#16a34a' : '#dc2626' }}
            >
              {saving ? `you save €${priceDiff.netChange.toFixed(2)}` : `+€${Math.abs(priceDiff.netChange).toFixed(2)}`}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSameAgain}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}
        >
          Same again →
        </button>
        <button
          onClick={onModify}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80 active:scale-[0.98]"
          style={{
            background: 'var(--surface-container)',
            color: 'var(--on-surface)',
            border: '1px solid var(--outline-variant)',
          }}
        >
          Change things
        </button>
      </div>
    </div>
  );
}
