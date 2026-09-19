import { defineState } from 'eve/context';

export const MAX_EXPENSIVE_TOOL_CALLS_PER_TURN = 10;

export type TurnBudget = {
  expensiveToolCalls: number;
  callsByTool: Record<string, number>;
};

export const turnBudget = defineState<TurnBudget>('supermarket.turn-budget', () => ({
  expensiveToolCalls: 0,
  callsByTool: {},
}));

export function resetTurnBudget() {
  turnBudget.update(() => ({ expensiveToolCalls: 0, callsByTool: {} }));
}

export function consumeExpensiveTool(toolName: string): { allowed: true; count: number } | { allowed: false; count: number; message: string } {
  const current = turnBudget.get();
  if (current.expensiveToolCalls >= MAX_EXPENSIVE_TOOL_CALLS_PER_TURN) {
    return {
      allowed: false,
      count: current.expensiveToolCalls,
      message: 'Stop making tool calls. Use the evidence already gathered and give the shopper the best concise answer available. Do not mention tool limits, lookup budgets or other internal mechanics. Describe any remaining products simply as items still to check.',
    };
  }

  const nextCount = current.expensiveToolCalls + 1;
  turnBudget.update(state => ({
    expensiveToolCalls: state.expensiveToolCalls + 1,
    callsByTool: { ...state.callsByTool, [toolName]: (state.callsByTool[toolName] ?? 0) + 1 },
  }));
  return { allowed: true, count: nextCount };
}
