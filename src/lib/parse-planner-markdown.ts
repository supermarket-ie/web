// Shared markdown parser for planner-generated list content.
// Used by /api/subscribe (inline save on new signup) and
// /api/lists/save-from-planner (save for returning users).
//
// NOTE: This parser is intentionally kept simple and best-effort.
// Longer-term the planner agent should emit structured JSON alongside
// the markdown display, and this file can be retired.

export interface PlannerItem {
  canonical_name: string;
  category: string;
  store: string;
  price: number;
  quantity: number;
  on_promotion: boolean;
}

export interface PlannerStoreTotal {
  store: string;
  total: number;
  item_count: number;
}

export function parseMarkdownList(content: string): {
  items: PlannerItem[];
  storeTotals: PlannerStoreTotal[];
} {
  const lines = content.split('\n');
  const items: PlannerItem[] = [];
  let currentCategory = '';
  const storeCounts: Record<string, number> = {};

  for (const line of lines) {
    // Category headers: **Dairy & Eggs** or ## Dairy
    const catMatch =
      line.match(/^\*\*(.+?)\*\*\s*$/) ?? line.match(/^#{1,3}\s+(.+)$/);
    if (catMatch) {
      const candidate = catMatch[1].trim();
      // Skip store-total lines that look like headers
      if (
        !candidate.match(/^(tesco|dunnes|supervalu|aldi|lidl)/i) &&
        !candidate.includes('€')
      ) {
        currentCategory = candidate;
        continue;
      }
    }

    // Item lines: "- Chicken Fillets — Tesco €4.99"
    // Also handles bold names and parenthetical notes
    const itemMatch = line.match(
      /^[-•]\s+\*?\*?(.+?)\*?\*?\s+[—–-]+\s+(Tesco|Dunnes|SuperValu|Aldi|Lidl)\s+€(\d+(?:\.\d{1,2})?)/i,
    );
    if (itemMatch) {
      const name = itemMatch[1].replace(/\s*\(.*?\)\s*/g, '').trim();
      const store = itemMatch[2].toLowerCase();
      const price = parseFloat(itemMatch[3]);
      const isPromo = /on (offer|sale|promotion|promo)|was €|~~€/i.test(line);

      if (name && store && !isNaN(price)) {
        items.push({
          canonical_name: name,
          category: currentCategory || 'Other',
          store,
          price,
          quantity: 1,
          on_promotion: isPromo,
        });
        storeCounts[store] = (storeCounts[store] ?? 0) + 1;
      }
    }
  }

  // Parse store totals section
  const storeTotals: PlannerStoreTotal[] = [];
  let inTotals = false;
  for (const line of lines) {
    if (/store total|🏪/i.test(line)) {
      inTotals = true;
      continue;
    }
    if (inTotals && line.trim() === '') break;
    if (inTotals) {
      const m = line.match(
        /\*?\*?(tesco|dunnes|supervalu|aldi|lidl)\*?\*?:?\s*€?(\d+(?:\.\d{2})?)\s*(?:\((\d+)\s*items?\))?/i,
      );
      if (m) {
        const store = m[1].toLowerCase();
        const total = parseFloat(m[2]);
        const explicitCount = m[3] ? parseInt(m[3], 10) : undefined;
        if (!isNaN(total)) {
          storeTotals.push({
            store,
            total,
            item_count: explicitCount ?? storeCounts[store] ?? 0,
          });
        }
      }
    }
  }

  return { items, storeTotals };
}
