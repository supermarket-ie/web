import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';
import { getCurrentProductSnapshot } from '@/lib/catalogue-resolution';
import { resend } from '@/lib/resend';

export type AgentProactivity = 'important_only' | 'useful_updates' | 'quiet';

export type HouseholdRelevanceResult = {
  subscriberId: string;
  canonicalName: string;
  priority: number;
  persisted: boolean;
  emailed: boolean;
  reason: 'not_relevant' | 'deduped' | 'stored' | 'emailed';
};

type PurchaseRow = {
  subscriber_id: string;
  list_id: string | null;
  price_paid: number;
  observed_at: string;
};

type HouseholdPurchaseProfile = {
  subscriberId: string;
  purchaseCount: number;
  lastPrice: number;
  lastBoughtAt: string;
  cadenceDays: number | null;
};

const IN_APP_THRESHOLD = 50;
const IMPORTANT_EMAIL_THRESHOLD = 82;
const USEFUL_EMAIL_THRESHOLD = 68;
const MAX_HISTORY_DAYS = 180;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function dayDiff(later: string | Date, earlier: string | Date) {
  return Math.max(0, (new Date(later).getTime() - new Date(earlier).getTime()) / 86_400_000);
}

function buildProfiles(rows: PurchaseRow[]): HouseholdPurchaseProfile[] {
  const grouped = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.subscriber_id) ?? [];
    existing.push(row);
    grouped.set(row.subscriber_id, existing);
  }

  const profiles: HouseholdPurchaseProfile[] = [];
  for (const [subscriberId, purchases] of grouped) {
    purchases.sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());

    // Treat multiple rows from the same saved list as one purchase occasion.
    const occasions = new Map<string, PurchaseRow>();
    for (const purchase of purchases) {
      const key = purchase.list_id ?? purchase.observed_at.slice(0, 10);
      if (!occasions.has(key)) occasions.set(key, purchase);
    }
    const unique = [...occasions.values()].sort(
      (a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime(),
    );
    if (unique.length < 2) continue;

    const gaps: number[] = [];
    for (let i = 0; i + 1 < unique.length; i += 1) {
      const gap = dayDiff(unique[i].observed_at, unique[i + 1].observed_at);
      if (gap >= 3 && gap <= 120) gaps.push(gap);
    }

    profiles.push({
      subscriberId,
      purchaseCount: unique.length,
      lastPrice: Number(unique[0].price_paid),
      lastBoughtAt: unique[0].observed_at,
      cadenceDays: median(gaps),
    });
  }
  return profiles;
}

function currentWeekKey(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  const week = Math.ceil((days + start.getUTCDay() + 1) / 7);
  return `${now.getUTCFullYear()}-w${String(week).padStart(2, '0')}`;
}

function notificationHtml(title: string, body: string, shopUrl: string, unsubscribeUrl?: string) {
  const unsubscribe = unsubscribeUrl
    ? `<p style="margin-top:24px;font-size:12px;color:#777"><a href="${unsubscribeUrl}" style="color:#777">Unsubscribe</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f5f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f251f"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%"><tr><td style="padding-bottom:20px;font-size:20px;font-weight:700">supermarket<span style="color:#006a35">.ie</span></td></tr><tr><td style="background:#fff;border:1px solid #e7e7df;border-radius:14px;padding:28px"><div style="font-size:12px;font-weight:700;color:#006a35;text-transform:uppercase;letter-spacing:.08em">Worth knowing</div><h1 style="font-size:24px;line-height:1.2;margin:10px 0 12px">${title}</h1><p style="font-size:16px;line-height:1.55;margin:0 0 20px;color:#464b46">${body}</p><a href="${shopUrl}" style="display:inline-block;background:#006a35;color:#fff;text-decoration:none;padding:11px 16px;border-radius:10px;font-weight:700">Open my shop</a></td></tr><tr><td>${unsubscribe}</td></tr></table></td></tr></table></body></html>`;
}

function scoreProfile(profile: HouseholdPurchaseProfile, current: NonNullable<Awaited<ReturnType<typeof getCurrentProductSnapshot>>>) {
  const saving = Number((profile.lastPrice - current.best_price).toFixed(2));
  const savingPct = profile.lastPrice > 0 ? saving / profile.lastPrice : 0;
  const daysSinceLast = dayDiff(new Date(), profile.lastBoughtAt);
  const dueRatio = profile.cadenceDays && profile.cadenceDays > 0 ? daysSinceLast / profile.cadenceDays : 0;

  let priority = Math.min(28, profile.purchaseCount * 6);
  priority += daysSinceLast <= 90 ? 8 : 0;
  if (saving >= 0.5) priority += Math.min(28, saving * 6);
  if (savingPct >= 0.15) priority += 10;
  if (current.any_promotion) priority += 12;
  if (dueRatio >= 0.65) priority += Math.min(18, 8 + (dueRatio - 0.65) * 20);

  const isMeaningfulPriceDrop = saving >= 0.5 || savingPct >= 0.15;
  const isUsefulPromotion = current.any_promotion && saving >= 0.25;
  const isDue = Boolean(profile.cadenceDays && dueRatio >= 0.75);

  return {
    priority: Math.min(100, Math.round(priority)),
    saving,
    savingPct,
    daysSinceLast,
    dueRatio,
    isMeaningfulPriceDrop,
    isUsefulPromotion,
    isDue,
  };
}

function emailThreshold(mode: AgentProactivity) {
  if (mode === 'quiet') return Number.POSITIVE_INFINITY;
  return mode === 'useful_updates' ? USEFUL_EMAIL_THRESHOLD : IMPORTANT_EMAIL_THRESHOLD;
}

export async function evaluateHouseholdRelevanceForProduct(canonicalName: string): Promise<HouseholdRelevanceResult[]> {
  const cutoff = new Date(Date.now() - MAX_HISTORY_DAYS * 86_400_000).toISOString();
  const [{ data: purchaseRows, error: purchaseError }, current] = await Promise.all([
    supabaseAdmin
      .from('list_items')
      .select('subscriber_id, list_id, price_paid, observed_at')
      .eq('canonical_name', canonicalName)
      .gte('observed_at', cutoff)
      .order('observed_at', { ascending: false })
      .limit(2000),
    getCurrentProductSnapshot(canonicalName),
  ]);

  if (purchaseError) throw new Error(`Failed loading household product history: ${purchaseError.message}`);
  if (!current || !purchaseRows?.length) return [];

  const profiles = buildProfiles(purchaseRows as unknown as PurchaseRow[]);
  if (!profiles.length) return [];

  const ids = profiles.map(profile => profile.subscriberId);
  const { data: subscribers, error: subscriberError } = await supabaseAdmin
    .from('subscribers')
    .select('id, email, subscribed, unsubscribe_token, agent_proactivity')
    .in('id', ids);
  if (subscriberError) throw new Error(`Failed loading household notification preferences: ${subscriberError.message}`);

  const subscriberById = new Map((subscribers ?? []).map(row => [row.id, row]));
  const results: HouseholdRelevanceResult[] = [];
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://supermarket.ie';
  const weekKey = currentWeekKey();

  for (const profile of profiles) {
    const subscriber = subscriberById.get(profile.subscriberId);
    if (!subscriber) continue;
    const scored = scoreProfile(profile, current);
    if (scored.priority < IN_APP_THRESHOLD || (!scored.isMeaningfulPriceDrop && !scored.isUsefulPromotion)) {
      results.push({ subscriberId: profile.subscriberId, canonicalName, priority: scored.priority, persisted: false, emailed: false, reason: 'not_relevant' });
      continue;
    }

    const kind = scored.isUsefulPromotion ? 'promotion' : 'price_drop';
    const title = kind === 'promotion'
      ? `${canonicalName} is on a worthwhile offer`
      : `${canonicalName} is €${Math.max(0, scored.saving).toFixed(2)} cheaper`;
    const cadenceNote = scored.isDue
      ? ' This is also around when you usually buy it.'
      : '';
    const body = `${canonicalName} is currently €${current.best_price.toFixed(2)} at ${current.best_store}, compared with €${profile.lastPrice.toFixed(2)} when you last had it in your shop.${cadenceNote}`;
    const dedupeKey = `${profile.subscriberId}:${canonicalName}:${kind}:${current.best_price.toFixed(2)}:${weekKey}`;

    const { data: insight, error: insightError } = await supabaseAdmin
      .from('household_insights')
      .insert({
        subscriber_id: profile.subscriberId,
        canonical_name: canonicalName,
        kind,
        priority: scored.priority,
        title,
        body,
        dedupe_key: dedupeKey,
        payload: {
          best_price: current.best_price,
          best_store: current.best_store,
          last_price: profile.lastPrice,
          purchase_count: profile.purchaseCount,
          cadence_days: profile.cadenceDays,
          days_since_last: Number(scored.daysSinceLast.toFixed(1)),
          saving: scored.saving,
          saving_pct: Number(scored.savingPct.toFixed(3)),
        },
      })
      .select('id')
      .single();

    if (insightError?.code === '23505') {
      results.push({ subscriberId: profile.subscriberId, canonicalName, priority: scored.priority, persisted: false, emailed: false, reason: 'deduped' });
      continue;
    }
    if (insightError) throw new Error(`Failed storing household insight: ${insightError.message}`);

    const mode = (subscriber.agent_proactivity ?? 'important_only') as AgentProactivity;
    const shouldEmail = Boolean(subscriber.subscribed && subscriber.email && scored.priority >= emailThreshold(mode));
    if (!shouldEmail) {
      results.push({ subscriberId: profile.subscriberId, canonicalName, priority: scored.priority, persisted: true, emailed: false, reason: 'stored' });
      continue;
    }

    const unsubscribeUrl = subscriber.unsubscribe_token
      ? `${siteUrl}/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribe_token)}`
      : undefined;
    const { error: sendError } = await resend.emails.send({
      from: 'supermarket.ie shopping agent <hello@mail.supermarket.ie>',
      to: subscriber.email,
      subject: title,
      html: notificationHtml(title, body, `${siteUrl}/list?source=agent-insight`, unsubscribeUrl),
    });
    if (sendError) throw new Error(`Proactive household email failed: ${sendError.message}`);

    await supabaseAdmin
      .from('household_insights')
      .update({ emailed_at: new Date().toISOString() })
      .eq('id', insight.id);

    results.push({ subscriberId: profile.subscriberId, canonicalName, priority: scored.priority, persisted: true, emailed: true, reason: 'emailed' });
  }

  return results;
}
