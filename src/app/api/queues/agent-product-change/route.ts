import { handleCallback } from '@vercel/queue';
import { evaluateAgentTask } from '@/lib/agent-task-evaluator';
import { listActiveTasksForProduct } from '@/lib/agent-tasks';
import type { AgentProductChangeEvent } from '@/lib/agent-events';

const MAX_DELIVERIES = 5;

export const POST = handleCallback<AgentProductChangeEvent>(
  async (message, metadata) => {
    if (!message?.canonicalName) throw new Error('Invalid agent product-change event');

    const tasks = await listActiveTasksForProduct(message.canonicalName);
    if (tasks.length === 0) {
      console.log('[agent-events] no active watches for product', {
        canonicalName: message.canonicalName,
        store: message.store,
        messageId: metadata.messageId,
      });
      return;
    }

    let triggered = 0;
    for (const task of tasks) {
      const result = await evaluateAgentTask(task);
      if (result.triggered) triggered += 1;
    }

    console.log('[agent-events] product change evaluated', {
      canonicalName: message.canonicalName,
      store: message.store,
      tasks: tasks.length,
      triggered,
      deliveryCount: metadata.deliveryCount,
      messageId: metadata.messageId,
    });
  },
  {
    visibilityTimeoutSeconds: 120,
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= MAX_DELIVERIES) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 10 * 2 ** Math.max(0, metadata.deliveryCount - 1)) };
    },
  },
);
