import 'server-only';
import type { HouseholdBriefing, BriefingInsight } from '@/lib/household-briefing';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function insightAccent(insight: BriefingInsight): string {
  if (insight.kind === 'price_rise') return '#9a3412';
  if (insight.kind === 'promotion') return '#006a35';
  return '#245c3b';
}

function actionLabel(insight: BriefingInsight): string {
  if (insight.kind === 'price_rise') return 'Review alternatives';
  return 'Review my shop';
}

export function generateHouseholdBriefingEmail(input: {
  briefing: HouseholdBriefing;
  shopUrl: string;
  agentUrl: string;
  unsubscribeUrl: string;
}): string {
  const { briefing, shopUrl, agentUrl, unsubscribeUrl } = input;

  const cards = briefing.insights.map((insight, index) => `
    <tr>
      <td style="padding:0 0 12px 0">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e7e7df;border-radius:12px">
          <tr><td style="padding:18px 20px">
            <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${insightAccent(insight)}">${index + 1} · ${escapeHtml(insight.kind.replaceAll('_', ' '))}</div>
            <div style="font-size:17px;line-height:1.35;font-weight:750;color:#1f251f;margin-top:6px">${escapeHtml(insight.title)}</div>
            <div style="font-size:14px;line-height:1.55;color:#5a605a;margin-top:6px">${escapeHtml(insight.body)}</div>
            <div style="margin-top:12px"><a href="${escapeHtml(shopUrl)}" style="font-size:13px;font-weight:700;color:#006a35;text-decoration:none">${actionLabel(insight)} →</a></div>
          </td></tr>
        </table>
      </td>
    </tr>`).join('');

  const body = briefing.quiet
    ? `<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#fff;border:1px solid #e7e7df;border-radius:12px;padding:22px;font-size:16px;line-height:1.55;color:#404640">Nothing important has changed in your usual shop this week. I’ll keep an eye on it and only flag something when it is worth your attention.</td></tr></table>`
    : `<table width="100%" cellpadding="0" cellspacing="0">${cards}</table>`;

  return `<!doctype html>
<html><body style="margin:0;background:#f5f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f251f">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:34px 16px">
<table width="540" cellpadding="0" cellspacing="0" style="width:100%;max-width:540px">
<tr><td style="padding-bottom:24px;font-size:20px;font-weight:750">supermarket<span style="color:#006a35">.ie</span></td></tr>
<tr><td style="padding-bottom:8px;font-size:12px;font-weight:800;color:#006a35;text-transform:uppercase;letter-spacing:.09em">Your household briefing</td></tr>
<tr><td style="padding-bottom:8px;font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-.02em">${briefing.quiet ? 'Nothing needs your attention.' : escapeHtml(briefing.summary)}</td></tr>
<tr><td style="padding-bottom:22px;font-size:15px;line-height:1.5;color:#606660">Based on the products your household actually buys — not a generic deals list.</td></tr>
<tr><td>${body}</td></tr>
<tr><td align="center" style="padding:22px 0 10px"><a href="${escapeHtml(agentUrl)}" style="display:inline-block;background:#006a35;color:#fff;text-decoration:none;font-size:15px;font-weight:750;padding:13px 22px;border-radius:9px">Ask your shopping agent</a></td></tr>
<tr><td align="center" style="padding-top:18px;font-size:12px;color:#8a8e8a">supermarket.ie — your household shopping agent<br/><a href="${escapeHtml(unsubscribeUrl)}" style="color:#8a8e8a">Unsubscribe</a></td></tr>
</table></td></tr></table></body></html>`;
}
