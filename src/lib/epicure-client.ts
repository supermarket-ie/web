/**
 * Epicure MCP client — ingredient embedding API
 * https://epicure.kaikaku.ai / https://epicure-mcp.kaikaku.ai/mcp
 *
 * Exposes two high-level functions used by the planner agent:
 *   - getPairings(ingredients)   → what goes well with these ingredients
 *   - getSubstitutes(ingredient) → semantically nearest ingredients
 *
 * Uses stateless HTTP POST with MCP session lifecycle.
 * Sessions are short-lived (one call per session to keep it simple).
 */

const MCP_URL = 'https://epicure-mcp.kaikaku.ai/mcp';
const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
};

// ── MCP session helpers ───────────────────────────────────────────────────────

async function initSession(): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'supermarket-ie', version: '1.0' },
      },
    }),
  });

  const sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('Epicure: no session ID returned');
  return sessionId;
}

async function callTool(sessionId: string, name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { ...HEADERS, 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

  const text = await res.text();
  // Parse SSE lines: "data: {...}"
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      const obj = JSON.parse(line.slice(5));
      const content = obj?.result?.content ?? [];
      return content.map((c: { text?: string }) => c.text ?? '').join('\n');
    }
  }
  throw new Error(`Epicure: no data in response for tool ${name}`);
}

// ── Canonical name normalisation ──────────────────────────────────────────────
// Epicure uses simple lowercase names like "chicken", "beef", "garlic"
// Our canonical_names are like "Chicken Breast 500g", "Minced Beef 500g"
// Strip qualifiers to map to Epicure's 1,790 canonical vocabulary.

const STRIP_PATTERN = /\b(\d+(\.\d+)?\s*(g|kg|ml|l|pack|packs?|piece|pieces?|pack|litre|litres?|lb|oz|x\d+|\d+-pack))\b/gi;
const BRAND_SUFFIXES = /\b(free range|organic|fresh|frozen|smoked|salted|unsalted|low fat|full fat|skimmed|semi-skimmed|whole|lean|extra lean|baby|mini|large|small|medium)\b/gi;

export function toEpicureName(canonicalName: string): string {
  return canonicalName
    .toLowerCase()
    .replace(STRIP_PATTERN, '')       // remove sizes
    .replace(BRAND_SUFFIXES, '')      // remove qualifiers
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PairingResult {
  ingredient: string;
  clusters: string;
  bridges: string[];
  rawText: string;
}

export interface SubstituteResult {
  ingredient: string;
  substitutes: Array<{ name: string; similarity: number }>;
}

/**
 * Get flavour pairings for a list of ingredients.
 * Returns rich cluster + bridge data from 4.14M recipes.
 */
export async function getPairings(ingredients: string[]): Promise<PairingResult | null> {
  try {
    const epicureNames = ingredients.map(toEpicureName).filter(Boolean);
    if (epicureNames.length === 0) return null;

    const sessionId = await initSession();
    const text = await callTool(sessionId, 'find_pairings', {
      ingredients: epicureNames,
      top_k: 8,
    });

    if (text.includes('Could not resolve')) return null;

    // Extract bridges from the text
    const bridgeMatch = text.match(/BRIDGES[^:]*:([\s\S]*?)(?:\n\n|$)/);
    const bridges: string[] = [];
    if (bridgeMatch) {
      const lines = bridgeMatch[1].trim().split('\n');
      for (const line of lines) {
        const name = line.match(/^\s{2}(\w[\w\s]*?)\s*->/)?.[1];
        if (name) bridges.push(name.trim());
      }
    }

    return {
      ingredient: epicureNames.join(', '),
      clusters: text,
      bridges,
      rawText: text,
    };
  } catch (e) {
    console.error('[epicure] getPairings error:', e);
    return null;
  }
}

/**
 * Get nearest-neighbour substitutes for a single ingredient.
 * Uses cosine similarity in 300-D embedding space.
 */
export async function getSubstitutes(ingredient: string, topK = 6): Promise<SubstituteResult | null> {
  try {
    const epicureName = toEpicureName(ingredient);
    if (!epicureName) return null;

    const sessionId = await initSession();
    const text = await callTool(sessionId, 'neighbors', {
      ingredient: epicureName,
      top_k: topK,
    });

    if (text.includes('Could not resolve') || text.includes('not found')) return null;

    // Parse JSON neighbors response
    const parsed = JSON.parse(text);
    const substitutes = (parsed.neighbors ?? []).map((n: { name: string; sim: number }) => ({
      name: n.name.replace(/_/g, ' '),
      similarity: n.sim,
    }));

    return { ingredient: epicureName, substitutes };
  } catch (e) {
    console.error('[epicure] getSubstitutes error:', e);
    return null;
  }
}
