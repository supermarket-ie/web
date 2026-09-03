import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { listActiveAgentTasks } from '../lib/tasks';
import { requireSubscriber } from '../lib/subscriber';

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) =>
      ctx.session.auth.current?.principalType === 'user'
        ? defineTool({
            description: 'List the signed-in household\'s active product watches and reminders. Use when the user asks what you are watching, tracking or monitoring for them.',
            inputSchema: z.object({}),
            async execute(_input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const tasks = await listActiveAgentTasks(subscriberId);
              return tasks.map(task => ({
                id: task.id,
                type: task.type,
                canonical_name: task.canonical_name,
                product_family: task.product_family,
                condition: task.condition,
                notification_channel: task.notification_channel,
                last_triggered_at: task.last_triggered_at,
                created_at: task.created_at,
                source_request: task.source_request,
              }));
            },
          })
        : null,
  },
});
