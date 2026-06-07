'use client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SwapSuggestion {
  original: string;
  substitute: string;
  saving: number;
  store: string;
  reason?: string;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse [[swap|original:X|substitute:Y|saving:1.80|store:tesco|reason:...]]
 * markers from agent output. Returns all swaps found.
 */
export function parseSwapSuggestions(content: string): SwapSuggestion[] {
  const swaps: SwapSuggestion[] = [];
  const pattern = /\[\[swap\|([^\]]+)\]\]/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const params = Object.fromEntries(
      match[1].split('|').map(p => {
        const idx = p.indexOf(':');
        return [p.slice(0, idx), p.slice(idx + 1)] as [string, string];
      })
    );
    const saving = parseFloat(params.saving ?? '0');
    if (params.original && params.substitute && saving > 0) {
      swaps.push({
        original: params.original,
        substitute: params.substitute,
        saving,
        store: params.store ?? '',
        reason: params.reason,
      });
    }
  }
  return swaps;
}

/** Strip [[swap|...]] markers from content for display */
export function stripSwapMarkers(content: string): string {
  return content.replace(/\[\[swap\|[^\]]+\]\]/g, '').replace(/\n{3,}/g, '\n\n');
}

// ─── Component ───────────────────────────────────────────────────────────────

interface SwapSuggestionCardProps {
  swaps: SwapSuggestion[];
}

export function SwapSuggestionCard({ swaps }: SwapSuggestionCardProps) {
  if (!swaps || swaps.length === 0) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {swaps.map((swap, i) => (
        <div
          key={i}
          className="rounded-xl p-4 border"
          style={{
            background: 'var(--surface-container-low)',
            borderColor: 'rgba(34,197,94,0.3)',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-base">🔄</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>
              Swap suggestion
            </span>
            <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
              Save €{swap.saving.toFixed(2)}
            </span>
          </div>

          {/* Swap arrow */}
          <div className="flex items-center gap-2 mb-2">
            <span
              className="px-2.5 py-1 rounded-lg text-sm font-medium line-through opacity-60"
              style={{ background: 'var(--surface-container)', color: 'var(--on-surface-variant)' }}
            >
              {swap.original}
            </span>
            <span className="text-sm opacity-50" style={{ color: 'var(--on-surface-variant)' }}>→</span>
            <span
              className="px-2.5 py-1 rounded-lg text-sm font-semibold"
              style={{ background: 'rgba(34,197,94,0.12)', color: 'rgb(21,128,61)' }}
            >
              {swap.substitute}
            </span>
            {swap.store && (
              <span className="text-xs opacity-60 ml-1" style={{ color: 'var(--on-surface-variant)' }}>
                @ {swap.store.charAt(0).toUpperCase() + swap.store.slice(1)}
              </span>
            )}
          </div>

          {/* Reason */}
          {swap.reason && (
            <p className="text-xs" style={{ color: 'var(--on-surface-variant)', opacity: 0.8 }}>
              {swap.reason}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
