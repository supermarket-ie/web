import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { cancelAgentTask } from '../lib/tasks';
import { agentSupabase } from '../lib/supabase';
import { requireSubscriber } from '../lib/subscriber';

export default defineTool({
  description: 'Cancel one persistent watch belonging to the signed-in household. Use only when the user asks to stop or cancel a specific watch.',
  inputSchema: z.object({
    taskId: z.string().uuid(),
  }),
  async execute({ taskId }, ctx) {
    const subscriberId = requireSubscriber(ctx);

    const { data: task, error: taskError } = await agentSupabase
      .from('agent_tasks')
      .select('baseline')
      .eq('id', taskId)
      .eq('subscriber_id', subscriberId)
      .single();

    if (taskError) throw new Error(`Could not find watch: ${taskError.message}`);

    const legacyAlertId = task?.baseline && typeof task.baseline === 'object'
      ? (task.baseline as Record<string, unknown>).legacy_alert_id
      : null;

    if (typeof legacyAlertId === 'string') {
      const { error: alertError } = await agentSupabase
        .from('price_alerts')
        .update({ active: false })
        .eq('id', legacyAlertId)
        .eq('subscriber_id', subscriberId);
      if (alertError) throw new Error(`Could not cancel linked price alert: ${alertError.message}`);
    }

    const updated = await cancelAgentTask(subscriberId, taskId);
    return { cancelled: true, task_id: updated.id };
  },
});
