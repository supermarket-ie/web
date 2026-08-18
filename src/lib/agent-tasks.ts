import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';

export type AgentTaskType =
  | 'price_watch'
  | 'promotion_watch'
  | 'availability_watch'
  | 'basket_watch'
  | 'reminder';

export type AgentTaskStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export type AgentTaskCondition = {
  kind: 'any_price_change' | 'price_below' | 'promotion_started' | 'available' | 'basket_saving' | 'at_time';
  amount?: number;
  currency?: 'EUR';
  threshold?: number;
  scheduledFor?: string;
};

export interface AgentTask {
  id: string;
  subscriber_id: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  canonical_name: string | null;
  product_family: string | null;
  source_request: string;
  condition: AgentTaskCondition;
  baseline: Record<string, unknown> | null;
  notification_channel: 'email' | 'in_app';
  cooldown_minutes: number;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
  trigger_count: number;
  created_at: string;
  updated_at: string;
}

export async function createAgentTask(input: {
  subscriberId: string;
  type: AgentTaskType;
  sourceRequest: string;
  condition: AgentTaskCondition;
  canonicalName?: string | null;
  productFamily?: string | null;
  baseline?: Record<string, unknown> | null;
  notificationChannel?: 'email' | 'in_app';
  cooldownMinutes?: number;
}) {
  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .insert({
      subscriber_id: input.subscriberId,
      type: input.type,
      status: 'active',
      canonical_name: input.canonicalName ?? null,
      product_family: input.productFamily ?? null,
      source_request: input.sourceRequest,
      condition: input.condition,
      baseline: input.baseline ?? null,
      notification_channel: input.notificationChannel ?? 'email',
      cooldown_minutes: input.cooldownMinutes ?? 1440,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create agent task: ${error.message}`);
  return data as AgentTask;
}

export async function listActiveAgentTasks(subscriberId: string) {
  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .select('*')
    .eq('subscriber_id', subscriberId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list agent tasks: ${error.message}`);
  return (data ?? []) as AgentTask[];
}

export async function listActiveTasksForProduct(canonicalName: string) {
  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .select('*')
    .eq('status', 'active')
    .eq('canonical_name', canonicalName)
    .in('type', ['price_watch', 'promotion_watch', 'availability_watch']);

  if (error) throw new Error(`Failed to list product watches: ${error.message}`);
  return (data ?? []) as AgentTask[];
}

export async function listActiveProductAgentTasks(limit = 500) {
  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .select('*')
    .eq('status', 'active')
    .not('canonical_name', 'is', null)
    .in('type', ['price_watch', 'promotion_watch', 'availability_watch'])
    .order('last_evaluated_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw new Error(`Failed to list active agent tasks: ${error.message}`);
  return (data ?? []) as AgentTask[];
}

export async function updateAgentTaskStatus(
  subscriberId: string,
  taskId: string,
  status: AgentTaskStatus,
) {
  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('subscriber_id', subscriberId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update agent task: ${error.message}`);
  return data as AgentTask;
}

export async function updateAgentTaskBaseline(
  taskId: string,
  baseline: Record<string, unknown> | null,
) {
  const { error } = await supabaseAdmin
    .from('agent_tasks')
    .update({ baseline, updated_at: new Date().toISOString() })
    .eq('id', taskId);

  if (error) throw new Error(`Failed to update agent task baseline: ${error.message}`);
}

export function taskIsInCooldown(task: AgentTask, now = new Date()): boolean {
  if (!task.last_triggered_at || task.cooldown_minutes <= 0) return false;
  const last = new Date(task.last_triggered_at).getTime();
  return now.getTime() - last < task.cooldown_minutes * 60_000;
}

export async function markAgentTaskEvaluated(taskId: string, triggered = false) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { last_evaluated_at: now, updated_at: now };
  if (triggered) {
    patch.last_triggered_at = now;
    const { data: current } = await supabaseAdmin
      .from('agent_tasks')
      .select('trigger_count')
      .eq('id', taskId)
      .single();
    patch.trigger_count = Number(current?.trigger_count ?? 0) + 1;
  }

  const { error } = await supabaseAdmin
    .from('agent_tasks')
    .update(patch)
    .eq('id', taskId);

  if (error) throw new Error(`Failed to mark agent task evaluated: ${error.message}`);
}
