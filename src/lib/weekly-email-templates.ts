// Email templates for the 3-tier weekly digest system.
// All templates use inline CSS for email-client compatibility.

export interface Deal {
  product_name: string;
  store: string;
  current_price: number;
  was_price: number;
  saving: number;
}

export interface PriceChange {
  canonical_name: string;
  last_store: string;
  last_price: number;
  best_store_now: string;
  best_price_now: number;
  change: number;
  direction: 'cheaper' | 'dearer';
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatPrice(price: number): string {
  return `€${price.toFixed(2)}`;
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-IE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function storeColor(store: string): string {
  switch (store.toLowerCase()) {
    case 'tesco': return '#00539F';
    case 'dunnes': return '#6B2D8B';
    case 'supervalu': return '#E31837';
    default: return '#006A35';
  }
}

function dealRowsHTML(deals: Deal[]): string {
  return deals.map((deal, i) => `
    <tr>
      <td style="padding: 0 0 ${i < deals.length - 1 ? '12' : '0'}px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 8px; border: 1px solid #e8e8e8;">
          <tr>
            <td style="padding: 14px 18px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-size: 15px; font-weight: 700; color: #1A1A1A;">${deal.product_name}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 3px;">
                    <span style="font-size: 11px; font-weight: 600; color: ${storeColor(deal.store)}; text-transform: uppercase; letter-spacing: 0.5px;">${deal.store}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 10px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-right: 10px;">
                          <span style="font-size: 20px; font-weight: 800; color: #006A35;">${formatPrice(deal.current_price)}</span>
                        </td>
                        <td style="padding-right: 10px;">
                          <span style="font-size: 13px; color: #999; text-decoration: line-through;">${formatPrice(deal.was_price)}</span>
                        </td>
                        <td>
                          <span style="background: #DCFCE7; color: #166534; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 700;">Save ${formatPrice(deal.saving)}</span>
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
  `).join('');
}

function priceChangeRowsHTML(changes: PriceChange[]): string {
  const drops = changes.filter(c => c.direction === 'cheaper').slice(0, 5);
  const rises = changes.filter(c => c.direction === 'dearer').slice(0, 3);
  const combined = [...drops, ...rises];
  if (!combined.length) return '';

  return combined.map((c, i) => {
    const isCheaper = c.direction === 'cheaper';
    const badge = isCheaper
      ? `<span style="background: #DCFCE7; color: #166534; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 700;">&darr; ${formatPrice(Math.abs(c.change))} cheaper</span>`
      : `<span style="background: #FEE2E2; color: #991B1B; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 700;">&uarr; ${formatPrice(Math.abs(c.change))} dearer</span>`;

    return `
    <tr>
      <td style="padding: 0 0 ${i < combined.length - 1 ? '10' : '0'}px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 8px; border: 1px solid #e8e8e8;">
          <tr>
            <td style="padding: 12px 16px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-size: 14px; font-weight: 700; color: #1A1A1A;">${c.canonical_name}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 6px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-right: 10px;">
                          <span style="font-size: 13px; color: #666;">Was ${formatPrice(c.last_price)} @ ${c.last_store}</span>
                        </td>
                        <td style="padding-right: 10px;">
                          <span style="font-size: 14px; font-weight: 700; color: #1A1A1A;">${formatPrice(c.best_price_now)} @ ${c.best_store_now}</span>
                        </td>
                        <td>${badge}</td>
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

// Shared outer wrapper
function emailWrapper(innerContent: string, unsubscribeUrl: string, pageTitle = 'Your weekly grocery update'): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${pageTitle}</title>
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

          ${innerContent}

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
// Tier 1 — New subscriber, no history
// ---------------------------------------------------------------------------

export function generateTier1Email(
  deals: Deal[],
  magicLink: string,
  unsubscribeUrl: string,
): string {
  const dealsSection = deals.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0">${dealRowsHTML(deals)}</table>`
    : `<p style="margin: 0; color: #666; font-size: 15px; text-align: center; padding: 16px 0;">No promotions this week &mdash; check back next Monday!</p>`;

  const inner = `
    <!-- Hero -->
    <tr>
      <td style="background: linear-gradient(135deg, #006A35 0%, #00873E 100%); background-color: #006A35; border-radius: 12px 12px 0 0; padding: 28px 28px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <span style="font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500;">${formatDate()}</span>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 6px;">
              <span style="font-size: 24px; font-weight: 800; color: #ffffff; line-height: 1.2;">This week&rsquo;s best grocery deals</span>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 8px;">
              <span style="font-size: 14px; color: rgba(255,255,255,0.85); line-height: 1.5;">Your grocery agent found ${deals.length} price drops across Tesco, Dunnes &amp; SuperValu.</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Deals -->
    <tr>
      <td style="background: #fafafa; padding: 20px 28px 24px; border-radius: 0 0 12px 12px; border: 1px solid #e8e8e8; border-top: none;">
        ${dealsSection}
      </td>
    </tr>

    <!-- Personalise nudge -->
    <tr>
      <td style="padding: 20px 0 8px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #F0FDF4; border-radius: 10px; border: 1px solid #BBF7D0;">
          <tr>
            <td style="padding: 18px 20px;">
              <p style="margin: 0 0 6px 0; font-size: 15px; font-weight: 700; color: #166534;">Get a personalised list next week</p>
              <p style="margin: 0 0 14px 0; font-size: 14px; color: #166534; line-height: 1.5;">Tell me about your household and I&rsquo;ll find savings on the things <em>you</em> actually buy.</p>
              ${ctaButton(magicLink, 'Set up my grocery agent &rarr;')}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Spacer before footer -->
    <tr><td style="height: 24px;"></td></tr>
  `;

  return emailWrapper(inner, unsubscribeUrl, "This week's best grocery deals");
}

// ---------------------------------------------------------------------------
// Tier 2 — Has shopping history, no household profile
// ---------------------------------------------------------------------------

export function generateTier2Email(
  priceChanges: PriceChange[],
  deals: Deal[],
  sameAgainLink: string,
  magicLink: string,
  unsubscribeUrl: string,
): string {
  const hasChanges = priceChanges.length > 0;
  const drops = priceChanges.filter(c => c.direction === 'cheaper');
  const rises = priceChanges.filter(c => c.direction === 'dearer');

  const heroSubtitle = drops.length > 0
    ? `I found ${drops.length} price drop${drops.length > 1 ? 's' : ''} on your usual items this week.`
    : 'I checked the prices on your usual items.';

  const changesSection = hasChanges
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0">${priceChangeRowsHTML(priceChanges)}</table>`
    : `<p style="margin: 0; color: #666; font-size: 14px; padding: 8px 0;">No notable price changes on your usual items this week.</p>`;

  const dealsSection = deals.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0">${dealRowsHTML(deals.slice(0, 3))}</table>`
    : '';

  const riseNote = rises.length > 0
    ? `<p style="margin: 12px 0 0 0; font-size: 13px; color: #999;">${rises.length} item${rises.length > 1 ? 's have' : ' has'} gone up in price since your last shop.</p>`
    : '';

  const inner = `
    <!-- Hero -->
    <tr>
      <td style="background: linear-gradient(135deg, #006A35 0%, #00873E 100%); background-color: #006A35; border-radius: 12px 12px 0 0; padding: 28px 28px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <span style="font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500;">${formatDate()}</span>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 6px;">
              <span style="font-size: 24px; font-weight: 800; color: #ffffff; line-height: 1.2;">I checked prices on your usual items</span>
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

    <!-- Price changes section -->
    <tr>
      <td style="background: #fafafa; padding: 20px 28px 8px; border: 1px solid #e8e8e8; border-top: none;">
        <p style="margin: 0 0 14px 0; font-size: 13px; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">Price changes on your items</p>
        ${changesSection}
        ${riseNote}
      </td>
    </tr>

    ${dealsSection ? `
    <!-- This week's deals -->
    <tr>
      <td style="background: #fafafa; padding: 20px 28px 8px; border: 1px solid #e8e8e8; border-top: none;">
        <p style="margin: 0 0 14px 0; font-size: 13px; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">Best deals this week</p>
        ${dealsSection}
      </td>
    </tr>
    ` : ''}

    <!-- CTAs -->
    <tr>
      <td style="background: #fafafa; padding: 20px 28px 24px; border-radius: 0 0 12px 12px; border: 1px solid #e8e8e8; border-top: none;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding-bottom: 12px;">
              ${ctaButton(sameAgainLink, 'Same again? &rarr;')}
            </td>
          </tr>
          <tr>
            <td>
              <a href="${magicLink}" style="font-size: 14px; color: #006A35; text-decoration: underline;">Plan a new list instead</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr><td style="height: 24px;"></td></tr>
  `;

  return emailWrapper(inner, unsubscribeUrl, 'Your agent found savings on your items');
}

// ---------------------------------------------------------------------------
// Tier 3 — Has household profile, AI-generated content
// ---------------------------------------------------------------------------

export function generateTier3Email(
  aiContent: string,
  magicLink: string,
  unsubscribeUrl: string,
): string {
  // Convert newlines to <br> for email display
  const formattedContent = aiContent
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n\n/g, '</p><p style="margin: 0 0 14px 0; font-size: 15px; color: #333; line-height: 1.6;">')
    .replace(/\n/g, '<br />');

  const inner = `
    <!-- Hero -->
    <tr>
      <td style="background: linear-gradient(135deg, #006A35 0%, #00873E 100%); background-color: #006A35; border-radius: 12px 12px 0 0; padding: 28px 28px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <span style="font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500;">${formatDate()}</span>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 6px;">
              <span style="font-size: 24px; font-weight: 800; color: #ffffff; line-height: 1.2;">Your weekly grocery update</span>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 8px;">
              <span style="font-size: 14px; color: rgba(255,255,255,0.85);">From your grocery agent &mdash; personalised for your household</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- AI content -->
    <tr>
      <td style="background: #ffffff; padding: 24px 28px 8px; border: 1px solid #e8e8e8; border-top: none;">
        <p style="margin: 0 0 14px 0; font-size: 15px; color: #333; line-height: 1.6;">${formattedContent}</p>
      </td>
    </tr>

    <!-- CTA -->
    <tr>
      <td style="background: #ffffff; padding: 8px 28px 24px; border-radius: 0 0 12px 12px; border: 1px solid #e8e8e8; border-top: none;">
        ${ctaButton(magicLink, 'Build my list this week &rarr;')}
      </td>
    </tr>

    <tr><td style="height: 24px;"></td></tr>
  `;

  return emailWrapper(inner, unsubscribeUrl, 'Your weekly grocery update from your agent');
}
