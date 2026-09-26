import { dunnesPackSignature } from '../dunnes-discovery';

const text = (value: string) => value.toLowerCase().replace(/[’']/g, '')
  .replace(/\b(?:litres?|liters?)\b/g, 'l').replace(/\bkilograms?\b/g, 'kg').replace(/\bgrams?\b/g, 'g')
  .replace(/\s+/g, ' ').trim();
const PROCESSED = /\b(?:puffs?|snacks?|juice|smoothie|yog[uh]rt|puree|purée|cake|biscuits?|bread|crisps?|sauce|soup|rings|powder|granules|rice)\b/;
const PRODUCE = /^(?:(?:fresh|loose|mini|organic|irish|baby|red|green)\s+)*(bananas?|apples?|carrots?|onions?|potatoes?|tomatoes?|peppers?|broccoli|mushrooms?)\b/;

function amount(value: string, unit: string) {
  return Number(value) * (unit === 'kg' || unit === 'l' ? 1000 : unit === 'cl' ? 10 : 1);
}

function packSignature(value: string) {
  const normalized = text(value).replace(/\bdozen\b/g, '12 pack').replace(/(\d+)-(pack|pk|rolls?)\b/g, '$1 $2').replace(/\b(\d+(?:\.\d+)?)\s*gm\b/g, '$1g')
    .replace(/\b(\d+(?:\.\d+)?)\s+(kg|g|ml|l)\b/g, '$1$2');
  const pack = dunnesPackSignature(normalized);
  const trailingCount = normalized.match(/\b(?:eggs?|bananas?|apples?|peppers?|fillets?)\s+(\d+)\b/);
  const leadingCount = normalized.match(/\b(\d+)\s+(?:[a-z]+\s+){0,4}(?:eggs?|bananas?|apples?|peppers?|fillets?)\b/);
  const singleUnit = /\b(?:one|single|1)\s+(?:\d+(?:\.\d+)?\s*(?:kg|g|l|ml)\s+)?(?:bottle|carton|can|tin|tub|bar)\b/.test(normalized);
  return { ...pack, count: pack.count ?? (trailingCount ? Number(trailingCount[1]) : leadingCount ? Number(leadingCount[1]) : singleUnit ? 1 : null) };
}

/** A requested measure/count needs positive pack evidence before pricing. */
export function hasConfirmedRequestedPack(expectedName: string, evidence: string[]) {
  const requested = packSignature(expectedName);
  const packs = evidence.map(packSignature);
  return (requested.amount === null || packs.some(pack => pack.amount !== null)) &&
    ((requested.count ?? 1) <= 1 || packs.some(pack => pack.count === requested.count));
}

/** Reject explicit contradictions; absence of a conflict does not prove a match. */
export function hasProductIdentityConflict(expectedName: string, actualName: string, category?: string | null) {
  const expected = text(expectedName);
  const actual = text(actualName);
  const freshProduce = (/^(?:fruit|vegetables?)$/i.test(category ?? '') || PRODUCE.test(expected)) && !PROCESSED.test(expected);
  if (freshProduce && PROCESSED.test(actual)) return true;
  const produce = expected.match(PRODUCE)?.[1].replace(/(?:es|s)$/, '');
  if (freshProduce && produce && !actual.includes(produce)) return true;
  if (/\beggs?\b/.test(expected) && !/\bnoodles?\b/.test(expected) && /\bnoodles?\b/.test(actual)) return true;

  const expectedPack = packSignature(expected);
  const actualPack = packSignature(actual);
  const range = expected.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)?\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/);
  if (range && actualPack.amount !== null) {
    const unit = range[4];
    const dimension = unit === 'kg' || unit === 'g' ? 'g' : 'ml';
    if (actualPack.unit !== dimension || actualPack.amount < amount(range[1], range[2] ?? unit) || actualPack.amount > amount(range[3], unit)) return true;
  } else if (!range && expectedPack.amount !== null && actualPack.amount !== null &&
    (expectedPack.unit !== actualPack.unit || expectedPack.amount !== actualPack.amount)) return true;

  if (!/\d\s*(?:-|–|to)\s*\d/.test(expected) && expectedPack.count !== null && actualPack.count !== null && expectedPack.count !== actualPack.count) return true;
  if ((expectedPack.count ?? 1) > 1 && /\b(?:single|loose)\b/.test(actual)) return true;
  if (/\bloose\b/.test(expected) && (actualPack.multipack || (actualPack.count ?? 1) > 1 ||
    /\b[2-9]\d*\s+(?:\w+\s+){0,4}(?:bananas?|apples?|peppers?)\b/.test(actual))) return true;

  return [['salted', 'unsalted'], ['white', 'wholemeal'], ['fresh', 'frozen'], ['whole milk', 'low fat milk', 'skimmed milk']].some(group => {
    const found = (value: string) => group.filter(term => new RegExp(`\\b${term}\\b`).test(value));
    const left = found(expected), right = found(actual);
    return left.length > 0 && right.length > 0 && left.some(term => !right.includes(term));
  });
}
