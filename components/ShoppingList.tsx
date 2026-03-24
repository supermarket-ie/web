"use client";

import { GeneratedList, ShoppingListItem } from "@/lib/types";

const STORE_LABELS: Record<string, string> = {
  tesco: "Tesco",
  dunnes: "Dunnes Stores",
  supervalu: "SuperValu",
  lidl: "Lidl",
};

const STORE_COLOURS: Record<string, string> = {
  tesco: "bg-blue-50 text-blue-700 border-blue-200",
  dunnes: "bg-amber-50 text-amber-700 border-amber-200",
  supervalu: "bg-red-50 text-red-700 border-red-200",
  lidl: "bg-yellow-50 text-yellow-800 border-yellow-200",
};

function StoreBadge({ store }: { store: string }) {
  const colour = STORE_COLOURS[store] ?? "bg-gray-50 text-gray-700 border-gray-200";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colour}`}
    >
      {STORE_LABELS[store] ?? store}
    </span>
  );
}

function ItemCard({ item }: { item: ShoppingListItem }) {
  const savings =
    item.on_promotion && item.was_price
      ? ((item.was_price - item.price) * item.quantity).toFixed(2)
      : null;

  return (
    <div className="flex items-start justify-between py-3 border-b border-ink-faint last:border-0 gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-ink truncate">
            {item.display_name}
          </span>
          {item.on_promotion && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-coral/10 text-brand-coral border border-coral/20">
              On offer
            </span>
          )}
          {item.is_own_brand && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs text-ink-muted border border-ink-faint">
              Own brand
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <StoreBadge store={item.store} />
          {item.quantity > 1 && (
            <span className="text-xs text-ink-muted">× {item.quantity}</span>
          )}
          {savings && (
            <span className="text-xs text-emerald-600 font-medium">
              saving €{savings}
            </span>
          )}
        </div>
        {item.note && (
          <p className="text-xs text-ink-muted mt-1 italic">{item.note}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold text-ink">
          €{item.line_total.toFixed(2)}
        </div>
        {item.was_price && item.on_promotion && (
          <div className="text-xs text-ink-muted line-through">
            €{(item.was_price * item.quantity).toFixed(2)}
          </div>
        )}
        <div className="text-xs text-ink-muted">
          €{item.price.toFixed(2)} ea
        </div>
      </div>
    </div>
  );
}

export default function ShoppingList({
  list,
  onReset,
}: {
  list: GeneratedList;
  onReset: () => void;
}) {
  // Group items by category
  const byCategory = list.items.reduce<Record<string, ShoppingListItem[]>>(
    (acc, item) => {
      const cat = item.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    },
    {}
  );

  const categories = Object.keys(byCategory).sort();

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={onReset}
          className="text-sm text-ink-muted hover:text-ink flex items-center gap-1 mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Start over
        </button>
        <h1 className="text-2xl font-bold text-ink">Your weekly list</h1>
        <p className="text-ink-muted mt-1">
          {list.items.length} items · estimated{" "}
          <span className="font-semibold text-ink">
            €{list.total_estimate.toFixed(2)}
          </span>
          {list.savings_vs_full_price > 0 && (
            <> · saving{" "}
              <span className="text-emerald-600 font-semibold">
                €{list.savings_vs_full_price.toFixed(2)}
              </span>{" "}
              on full-price</>
          )}
        </p>
      </div>

      {/* AI Summary */}
      <div className="bg-brand-green/5 border border-brand-green/20 rounded-xl p-4 mb-6">
        <p className="text-sm text-ink leading-relaxed">{list.ai_summary}</p>
        {list.key_insights.length > 0 && (
          <ul className="mt-3 space-y-1">
            {list.key_insights.map((insight, i) => (
              <li key={i} className="text-xs text-ink-muted flex items-start gap-2">
                <span className="mt-0.5 w-1 h-1 rounded-full bg-brand-green shrink-0" />
                {insight}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Store strategy */}
      <div className="flex items-start gap-3 bg-white border border-ink-faint rounded-xl p-4 mb-8">
        <svg className="w-4 h-4 text-brand-green mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-0.5">
            Where to shop
          </p>
          <p className="text-sm text-ink">{list.store_strategy}</p>
          <div className="flex flex-wrap gap-3 mt-2">
            {Object.entries(list.store_breakdown).map(([store, breakdown]) => (
              <div key={store} className="text-xs text-ink-muted">
                <span className="font-medium text-ink">
                  {STORE_LABELS[store] ?? store}
                </span>{" "}
                · {breakdown.items} items · €{breakdown.total.toFixed(2)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Items by category */}
      <div className="space-y-6">
        {categories.map((category) => (
          <div key={category} className="bg-white rounded-xl border border-ink-faint p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
              {category}
            </h2>
            {byCategory[category].map((item, i) => (
              <ItemCard key={`${item.canonical_name}-${i}`} item={item} />
            ))}
          </div>
        ))}
      </div>

      {/* Footer CTA */}
      <div className="mt-10 bg-brand-green rounded-2xl p-6 text-white text-center">
        <h3 className="font-semibold text-lg mb-1">Get this every week</h3>
        <p className="text-sm text-white/80 mb-4">
          Your personalised list, refreshed with live prices every Monday morning.
        </p>
        <div className="flex gap-2 max-w-sm mx-auto">
          <input
            type="email"
            placeholder="your@email.com"
            className="flex-1 px-3 py-2 rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-white/50"
          />
          <button className="bg-brand-coral hover:bg-brand-coral-dark text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
            Subscribe free
          </button>
        </div>
      </div>
    </div>
  );
}
