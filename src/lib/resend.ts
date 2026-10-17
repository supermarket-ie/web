import { Resend } from 'resend';
import { outboundEmailBlocked, OUTBOUND_EMAIL_BLOCKED_REASON } from './preview-guard';

const realResend = new Resend(process.env.RESEND_API_KEY);

/**
 * Resend client with a preview/kill-switch safety guard.
 *
 * In the isolated preview (`APP_ENV=preview`) or when `DISABLE_OUTBOUND_EMAIL`
 * is set, `emails.send` is short-circuited: it logs and returns a benign
 * success-shaped result WITHOUT contacting Resend, so no real email is sent.
 * In production this is a no-op and the real client is used unchanged.
 */
function guardedSend(args: Parameters<typeof realResend.emails.send>[0]) {
  if (outboundEmailBlocked()) {
    const to = (args as { to?: unknown })?.to;
    console.warn('[resend] outbound email suppressed', { reason: OUTBOUND_EMAIL_BLOCKED_REASON, to });
    return Promise.resolve({
      data: { id: 'suppressed-preview' },
      error: null,
    } as Awaited<ReturnType<typeof realResend.emails.send>>);
  }
  return realResend.emails.send(args);
}

export const resend = {
  ...realResend,
  emails: {
    ...realResend.emails,
    send: guardedSend,
  },
} as unknown as Resend;
