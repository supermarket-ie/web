import { agentSupabase } from './supabase';

export type AgentTaskType =
  | 'price_watch'
  | 'promotion_watch'
  | 'availability_watch'
  | 'basket_watch'
  | 'reminder';

export type AgentTaskCondition = {
  kind: 'any_price_change' | 'price_below' | 'promotion_started' | 'available' | 'basket_saving' | 'at_time';
  amount?: number;
  currency?: 'EUR';
  threshold?: number;
  scheduledFor?: string;
};

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
  const { data, error } = await agentSupabase
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
  return data;
}

export async function listActiveAgentTasks(subscriberId: string) {
  const { data, error } = await agentSupabase
    .from('agent_tasks')
    .select('*')
    .eq('subscriber_id', subscriberId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list agent tasks: ${error.message}`);
  return data ?? [];
}

export async function cancelAgentTask(subscriberId: string, taskId: string) {
  const { data, error } = await agentSupabase
    .from('agent_tasks')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('subscriber_id', subscriberId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to cancel agent task: ${error.message}`);
  return data;
}
