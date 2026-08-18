import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';

export default defineTool({
  description: 'Set how proactive the household wants Supermarket.ie to be. Use when the user asks for important-only alerts, more useful updates, or to keep proactive messages quiet.',
  inputSchema: z.object({
    mode: z.enum(['important_only', 'useful_updates', 'quiet']),
  }),
  async execute({ mode }, ctx) {
    const subscriberId = requireSubscriber(ctx);
    const { error } = await agentSupabase
      .from('subscribers')
      .update({ agent_proactivity: mode, updated_at: new Date().toISOString() })
      .eq('id', subscriberId);
    if (error) throw new Error(`Could not update household agent preference: ${error.message}`);

    return {
      updated: true,
      mode,
      meaning: mode === 'important_only'
        ? 'Only unusually strong automatic household signals may interrupt you.'
        : mode === 'useful_updates'
          ? 'Useful automatic household signals may be surfaced more readily.'
          : 'Automatic proactive emails are suppressed; explicit watches still work.',
    };
  },
});
