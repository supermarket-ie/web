import { handleCallback } from '@vercel/queue';
import { evaluateAgentTask } from '@/lib/agent-task-evaluator';
import { listActiveTasksForProduct } from '@/lib/agent-tasks';
import { evaluateHouseholdRelevanceForProduct } from '@/lib/household-relevance';
import type { AgentProductChangeEvent } from '@/lib/agent-events';

const MAX_DELIVERIES = 5;

export const POST = handleCallback<AgentProductChangeEvent>(
  async (message, metadata) => {
    if (!message?.canonicalName) throw new Error('Invalid agent product-change event');

    // Explicit user instructions are always evaluated first and keep their
    // existing notification semantics/cooldowns.
    const tasks = await listActiveTasksForProduct(message.canonicalName);
    let explicitTriggered = 0;
    for (const task of tasks) {
      const result = await evaluateAgentTask(task);
      if (result.triggered) explicitTriggered += 1;
    }

    // Separately score households that repeatedly buy the exact canonical item.
    // This can create an in-app insight at a lower threshold, while email uses
    // a higher household preference-aware threshold.
    const relevance = await evaluateHouseholdRelevanceForProduct(message.canonicalName);
    const insightsStored = relevance.filter(result => result.persisted).length;
    const proactiveEmails = relevance.filter(result => result.emailed).length;

    console.log('[agent-events] product refresh evaluated', {
      canonicalName: message.canonicalName,
      store: message.store,
      explicitTasks: tasks.length,
      explicitTriggered,
      householdsConsidered: relevance.length,
      insightsStored,
      proactiveEmails,
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
