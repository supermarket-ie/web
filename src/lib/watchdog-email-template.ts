// Email template for the Price Watchdog daily cron.
// Follows the same design language as weekly-email-templates.ts.

export interface WatchdogItem {
  canonical_name: string;
  last_store: string;
  last_price: number;
  best_store_now: string;
  best_price_now: number;
  change: number; // negative = cheaper
  direction: 'cheaper' | 'dearer';
}

export interface StoreSplitInfo {
  groups: Record<string, { items: string[]; total: number }>;
  worthSplitting: boolean;
  topStores: string[];
}

export interface WatchdogEmailParams {
  cheaperItems: WatchdogItem[];
  totalSavings: number;
  storeSplit: StoreSplitInfo;
  dashboardUrl: string;
  unsubscribeUrl: string;
  nudge?: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatPrice(price: number): string {
  return `€${price.toFixed(2)}`;
}

function storeColor(store: string): string {
  switch (store.toLowerCase()) {
    case 'tesco': return '#00539F';
    case 'dunnes': return '#6B2D8B';
    case 'supervalu': return '#E31837';
    default: return '#006A35';
  }
}

function storeLabel(store: string): string {
  const labels: Record<string, string> = {
    tesco: 'Tesco',
    dunnes: 'Dunnes',
    supervalu: 'SuperValu',
    aldi: 'Aldi',
    lidl: 'Lidl',
  };
  return labels[store.toLowerCase()] ?? store;
}

function ctaButton(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="background-color: #006A35; border-radius: 8px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="17%" strokecolor="#006A35" fillcolor="#006A35">
        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-->
        <a href="${href}" style="display: inline-block; background-color: #006A35; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px; line-height: 1;">${label}</a>
        <!--<![endif]-->
      </td>
    </tr>
  </table>`;
}

// ---------------------------------------------------------------------------
// Savings rows (top 5 cheaper items)
// ---------------------------------------------------------------------------

function savingsRowsHTML(items: WatchdogItem[]): string {
  return items.slice(0, 5).map((item, i) => {
    const saving = Math.abs(item.change);
    return `
    <tr>
      <td style="padding: 0 0 ${i < Math.min(items.length, 5) - 1 ? '10' : '0'}px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 8px; border: 1px solid #e8e8e8;">
          <tr>
            <td style="padding: 12px 16px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-size: 14px; font-weight: 700; color: #1A1A1A;">${item.canonical_name}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 6px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-right: 10px; vertical-align: middle;">
                          <span style="font-size: 13px; color: #999; text-decoration: line-through;">${formatPrice(item.last_price)}&nbsp;${storeLabel(item.last_store)}</span>
                        </td>
                        <td style="padding-right: 10px; vertical-align: middle;">
                          <span style="font-size: 15px; font-weight: 700; color: ${storeColor(item.best_store_now)};">${formatPrice(item.best_price_now)}</span>
                          <span style="font-size: 11px; font-weight: 600; color: ${storeColor(item.best_store_now)}; text-transform: uppercase; letter-spacing: 0.5px;">&nbsp;${storeLabel(item.best_store_now)}</span>
                        </td>
                        <td style="vertical-align: middle;">
                          <span style="background: #DCFCE7; color: #166534; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 700;">&darr; ${formatPrice(saving)}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
  }).join('');
}

// ---------------------------------------------------------------------------
// Store-split section (rendered only when worthSplitting)
// ---------------------------------------------------------------------------

function storeSplitHTML(storeSplit: StoreSplitInfo): string {
  const { groups, topStores } = storeSplit;
  const storeRows = topStores.slice(0, 3).map(store => {
    const g = groups[store];
    const itemCount = g.items.length;
    const sample = g.items.slice(0, 3).join(', ') + (g.items.length > 3 ? ` +${g.items.length - 3} more` : '');
    return `
      <tr>
        <td style="padding-bottom: 8px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="width: 8px; background-color: ${storeColor(store)}; border-radius: 3px; padding: 0;">&nbsp;</td>
              <td style="padding-left: 10px;">
                <span style="font-size: 13px; font-weight: 700; color: ${storeColor(store)};">${storeLabel(store)}</span>
                <span style="font-size: 12px; color: #666;"> &mdash; ${itemCount} item${itemCount !== 1 ? 's' : ''} &middot; ${formatPrice(g.total)}</span>
                <br />
                <span style="font-size: 11px; color: #999;">${sample}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }).join('');

  return `
  <!-- Store-split recommendation -->
  <tr>
    <td style="padding: 0 0 16px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #F0FDF4; border-radius: 10px; border: 1px solid #BBF7D0;">
        <tr>
          <td style="padding: 18px 20px;">
            <p style="margin: 0 0 4px 0; font-size: 13px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 0.5px;">Best split for maximum savings</p>
            <p style="margin: 0 0 14px 0; font-size: 14px; color: #166534; line-height: 1.5;">Your cheapest basket spreads across ${topStores.slice(0, 3).map(storeLabel).join(' &amp; ')}:</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              ${storeRows}
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  `;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function generateWatchdogEmail(params: WatchdogEmailParams): { subject: string; html: string } {
  const { cheaperItems, totalSavings, storeSplit, dashboardUrl, unsubscribeUrl, nudge } = params;
  const itemCount = cheaperItems.length;

  let subject: string;
  if (nudge === 'thursday') {
    subject = 'Planning your shop this week? \uD83D\uDED2';
  } else if (totalSavings >= 5) {
    subject = `\uD83D\uDCB0 Your agent found ${formatPrice(totalSavings)} savings on your usual items`;
  } else {
    subject = `\uD83D\uDD14 Price drops on ${itemCount} item${itemCount !== 1 ? 's' : ''} from your last shop`;
  }

  const heroSubtitle = `${itemCount} of your usual item${itemCount !== 1 ? 's are' : ' is'} cheaper right now &mdash; potential saving of ${formatPrice(totalSavings)}.`;

  const splitSection = storeSplit.worthSplitting ? storeSplitHTML(storeSplit) : '';

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Price drops on your usual items</title>
  <!--[if mso]>
  <style>body, table, td {font-family: Arial, sans-serif !important;}</style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 16px;">

        <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width: 520px; width: 100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom: 28px;">
              <span style="font-size: 20px; font-weight: 700; color: #1A1A1A; letter-spacing: -0.5px;">supermarket</span><span style="font-size: 20px; font-weight: 700; color: #006A35; letter-spacing: -0.5px;">.ie</span>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="background: linear-gradient(135deg, #006A35 0%, #00873E 100%); background-color: #006A35; border-radius: 12px 12px 0 0; padding: 28px 28px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color: rgba(255,255,255,0.2); border-radius: 20px; padding: 5px 14px;">
                          <span style="font-size: 12px; font-weight: 700; color: #ffffff;">&#x1F4B0; Savings found</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 12px;">
                    <span style="font-size: 28px; font-weight: 800; color: #ffffff; line-height: 1.2;">${formatPrice(totalSavings)} waiting for you</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 8px;">
                    <span style="font-size: 14px; color: rgba(255,255,255,0.85); line-height: 1.5;">${heroSubtitle}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Price drops -->
          <tr>
            <td style="background: #fafafa; padding: 20px 28px 8px; border: 1px solid #e8e8e8; border-top: none;">
              <p style="margin: 0 0 14px 0; font-size: 13px; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">Price drops on your usual items</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${savingsRowsHTML(cheaperItems)}
              </table>
              ${itemCount > 5 ? `<p style="margin: 12px 0 0 0; font-size: 13px; color: #999;">+${itemCount - 5} more item${itemCount - 5 !== 1 ? 's' : ''} also cheaper &mdash; see full list in your dashboard.</p>` : ''}
            </td>
          </tr>

          <!-- Store split (conditional) -->
          ${splitSection ? `
          <tr>
            <td style="background: #fafafa; padding: 16px 28px 0; border: 1px solid #e8e8e8; border-top: none;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${splitSection}
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- CTA -->
          <tr>
            <td style="background: #fafafa; padding: 20px 28px 28px; border-radius: 0 0 12px 12px; border: 1px solid #e8e8e8; border-top: none;">
              ${ctaButton(dashboardUrl, 'Plan this week \u2192')}
            </td>
          </tr>

          <!-- Spacer -->
          <tr><td style="height: 24px;"></td></tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="border-top: 1px solid #e8e8e8; padding-top: 24px; padding-bottom: 8px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <span style="font-size: 12px; color: #999;">supermarket.ie &mdash; Your personal grocery agent for Ireland</span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 8px;">
                    <a href="${unsubscribeUrl}" style="font-size: 12px; color: #bbb; text-decoration: underline;">Unsubscribe</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

  return { subject, html };
}
