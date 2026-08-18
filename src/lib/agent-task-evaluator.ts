import 'server-only';
import {
  type AgentTask,
  listActiveProductAgentTasks,
  markAgentTaskEvaluated,
  taskIsInCooldown,
  updateAgentTaskBaseline,
  updateAgentTaskStatus,
} from '@/lib/agent-tasks';
import { getCurrentProductSnapshot } from '@/lib/catalogue-resolution';
import { resend } from '@/lib/resend';
import { supabaseAdmin } from '@/lib/supabase';

type ProductSnapshot = Awaited<ReturnType<typeof getCurrentProductSnapshot>>;

type TriggerDecision = {
  triggered: boolean;
  title?: string;
  body?: string;
  dedupeValue?: string;
  completeAfterTrigger?: boolean;
};

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function euro(value: number): string {
  return `€${value.toFixed(2)}`;
}

export function evaluateTaskCondition(
  task: Pick<AgentTask, 'condition' | 'canonical_name' | 'baseline'>,
  current: ProductSnapshot,
): TriggerDecision {
  const name = task.canonical_name ?? 'Product';
  const baselinePrice = numeric(task.baseline?.best_price);
  const baselinePromotion = bool(task.baseline?.any_promotion);

  switch (task.condition.kind) {
    case 'any_price_change': {
      if (!current || baselinePrice === null) return { triggered: false };
      const delta = Number((current.best_price - baselinePrice).toFixed(2));
      if (Math.abs(delta) < 0.01) return { triggered: false };
      const direction = delta < 0 ? 'cheaper' : 'dearer';
      return {
        triggered: true,
        title: `${name} is now ${euro(current.best_price)}`,
        body: `${name} is ${euro(Math.abs(delta))} ${direction} than when you asked me to watch it. The current best price is ${euro(current.best_price)} at ${current.best_store}.`,
        dedupeValue: `price:${current.best_price.toFixed(2)}:${current.best_store}`,
      };
    }

    case 'price_below': {
      if (!current || typeof task.condition.amount !== 'number') return { triggered: false };
      if (current.best_price > task.condition.amount) return { triggered: false };
      return {
        triggered: true,
        title: `${name} is below ${euro(task.condition.amount)}`,
        body: `${name} is now ${euro(current.best_price)} at ${current.best_store}, meeting the price you asked me to watch for.`,
        dedupeValue: `below:${task.condition.amount.toFixed(2)}:${current.best_price.toFixed(2)}:${current.best_store}`,
        completeAfterTrigger: true,
      };
    }

    case 'promotion_started': {
      if (!current) return { triggered: false };
      const wasOnPromotion = baselinePromotion ?? false;
      if (wasOnPromotion || !current.any_promotion) return { triggered: false };
      return {
        triggered: true,
        title: `${name} is on promotion`,
        body: `${name} has gone on promotion. The current best price is ${euro(current.best_price)} at ${current.best_store}.`,
        dedupeValue: `promotion:${current.best_price.toFixed(2)}:${current.best_store}`,
      };
    }

    case 'available': {
      const wasAvailable = bool(task.baseline?.available) ?? Boolean(task.baseline?.best_price);
      if (wasAvailable || !current) return { triggered: false };
      return {
        triggered: true,
        title: `${name} is available again`,
        body: `${name} is available again. The current best price is ${euro(current.best_price)} at ${current.best_store}.`,
        dedupeValue: `available:${current.best_price.toFixed(2)}:${current.best_store}`,
        completeAfterTrigger: true,
      };
    }

    default:
      return { triggered: false };
  }
}

function nextBaseline(
  existing: Record<string, unknown> | null,
  current: ProductSnapshot,
): Record<string, unknown> {
  if (!current) {
    return {
      ...(existing ?? {}),
      available: false,
      captured_at: new Date().toISOString(),
    };
  }

  return {
    ...(existing ?? {}),
    ...current,
    available: true,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function notificationHtml(title: string, body: string, unsubscribeUrl?: string): string {
  const unsubscribe = unsubscribeUrl
    ? `<p style="margin-top:24px;font-size:12px;color:#777"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#777">Unsubscribe</a></p>`
    : '';

  return `<!doctype html>
<html><body style="margin:0;background:#f5f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f251f">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
<tr><td style="padding-bottom:20px;font-size:20px;font-weight:700">supermarket<span style="color:#006a35">.ie</span></td></tr>
<tr><td style="background:#fff;border:1px solid #e7e7df;border-radius:14px;padding:28px">
<div style="font-size:12px;font-weight:700;color:#006a35;text-transform:uppercase;letter-spacing:.08em">Your shopping agent</div>
<h1 style="font-size:24px;line-height:1.2;margin:10px 0 12px">${escapeHtml(title)}</h1>
<p style="font-size:16px;line-height:1.55;margin:0;color:#464b46">${escapeHtml(body)}</p>
</td></tr>
<tr><td>${unsubscribe}</td></tr>
</table></td></tr></table></body></html>`;
}

async function persistNotification(input: {
  task: AgentTask;
  title: string;
  body: string;
  dedupeKey: string;
}) {
  const { data, error } = await supabaseAdmin
    .from('agent_notifications')
    .insert({
      task_id: input.task.id,
      subscriber_id: input.task.subscriber_id,
      channel: input.task.notification_channel,
      dedupe_key: input.dedupeKey,
      title: input.title,
      body: input.body,
      status: 'pending',
    })
    .select('id')
    .single();

  // Unique dedupe_key means another worker/run already claimed this exact event.
  if (error?.code === '23505') return null;
  if (error) throw new Error(`Failed to persist agent notification: ${error.message}`);
  return data?.id as string | undefined;
}

async function deliverNotification(
  task: AgentTask,
  notificationId: string,
  title: string,
  body: string,
) {
  if (task.notification_channel === 'in_app') {
    await supabaseAdmin
      .from('agent_notifications')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', notificationId);
    return;
  }

  const { data: subscriber, error } = await supabaseAdmin
    .from('subscribers')
    .select('email, unsubscribe_token')
    .eq('id', task.subscriber_id)
    .single();

  if (error || !subscriber?.email) {
    throw new Error(`Subscriber email unavailable for task ${task.id}`);
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://supermarket.ie';
  const unsubscribeUrl = subscriber.unsubscribe_token
    ? `${baseUrl}/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribe_token)}`
    : undefined;

  const { error: sendError } = await resend.emails.send({
    from: 'supermarket.ie <hello@mail.supermarket.ie>',
    to: subscriber.email,
    subject: title,
    html: notificationHtml(title, body, unsubscribeUrl),
  });

  if (sendError) throw new Error(`Resend delivery failed: ${sendError.message}`);

  await supabaseAdmin
    .from('agent_notifications')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', notificationId);
}

async function markNotificationFailed(notificationId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await supabaseAdmin
    .from('agent_notifications')
    .update({ status: 'failed', error: message.slice(0, 1000) })
    .eq('id', notificationId);
}

export async function evaluateAgentTask(task: AgentTask) {
  if (!task.canonical_name || task.status !== 'active') {
    return { taskId: task.id, checked: false, triggered: false };
  }

  const current = await getCurrentProductSnapshot(task.canonical_name);
  const decision = evaluateTaskCondition(task, current);
  const baseline = nextBaseline(task.baseline, current);

  // Always advance the baseline. This is what lets promotion_started fire again
  // only after the product has left promotion and subsequently re-entered one,
  // and makes any_price_change compare against the last observed state.
  await updateAgentTaskBaseline(task.id, baseline);

  if (!decision.triggered || !decision.title || !decision.body || !decision.dedupeValue) {
    await markAgentTaskEvaluated(task.id, false);
    return { taskId: task.id, checked: true, triggered: false };
  }

  if (taskIsInCooldown(task)) {
    await markAgentTaskEvaluated(task.id, false);
    return { taskId: task.id, checked: true, triggered: false, cooldown: true };
  }

  const dedupeKey = `${task.id}:${decision.dedupeValue}`;
  const notificationId = await persistNotification({
    task,
    title: decision.title,
    body: decision.body,
    dedupeKey,
  });

  if (!notificationId) {
    await markAgentTaskEvaluated(task.id, false);
    return { taskId: task.id, checked: true, triggered: false, duplicate: true };
  }

  try {
    await deliverNotification(task, notificationId, decision.title, decision.body);
    await markAgentTaskEvaluated(task.id, true);

    if (decision.completeAfterTrigger) {
      await updateAgentTaskStatus(task.subscriber_id, task.id, 'completed');
    }

    return { taskId: task.id, checked: true, triggered: true };
  } catch (error) {
    await markNotificationFailed(notificationId, error);
    throw error;
  }
}

export async function evaluateActiveAgentTasks(limit = 500) {
  const tasks = await listActiveProductAgentTasks(limit);
  let triggered = 0;
  let failed = 0;

  for (const task of tasks) {
    try {
      const result = await evaluateAgentTask(task);
      if (result.triggered) triggered += 1;
    } catch (error) {
      failed += 1;
      console.error(`[agent-task-evaluator] Task ${task.id} failed`, error);
    }
  }

  return {
    checked: tasks.length,
    triggered,
    failed,
  };
}
