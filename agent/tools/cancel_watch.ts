import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { updateAgentTaskStatus } from '../../src/lib/agent-tasks';
import { supabaseAdmin } from '../../src/lib/supabase';
import { requireSubscriber } from '../lib/subscriber';

export default defineTool({
  description: 'Cancel one persistent watch belonging to the signed-in household. Use only when the user asks to stop or cancel a specific watch.',
  inputSchema: z.object({
    taskId: z.string().uuid(),
  }),
  async execute({ taskId }, ctx) {
    const subscriberId = requireSubscriber(ctx);

    const { data: task } = await supabaseAdmin
      .from('agent_tasks')
      .select('baseline')
      .eq('id', taskId)
      .eq('subscriber_id', subscriberId)
      .single();

    const legacyAlertId = task?.baseline && typeof task.baseline === 'object'
      ? (task.baseline as Record<string, unknown>).legacy_alert_id
      : null;

    if (typeof legacyAlertId === 'string') {
      await supabaseAdmin
        .from('price_alerts')
        .update({ active: false })
        .eq('id', legacyAlertId)
        .eq('subscriber_id', subscriberId);
    }

    const updated = await updateAgentTaskStatus(subscriberId, taskId, 'cancelled');
    return { cancelled: true, task_id: updated.id };
  },
});
