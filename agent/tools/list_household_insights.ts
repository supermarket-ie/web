import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';

export default defineTool({
  description: 'List recent automatic household shopping insights created by Supermarket.ie. Use when the user asks what the agent noticed recently or why it contacted them.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(10).default(5),
  }),
  async execute({ limit }, ctx) {
    const subscriberId = requireSubscriber(ctx);
    const { data, error } = await agentSupabase
      .from('household_insights')
      .select('id, canonical_name, kind, priority, title, body, payload, status, emailed_at, created_at')
      .eq('subscriber_id', subscriberId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Could not load household insights: ${error.message}`);
    return data ?? [];
  },
});
