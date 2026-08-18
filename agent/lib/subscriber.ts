import type { ToolContext } from 'eve/tools';

export function requireSubscriber(ctx: ToolContext): string {
  const caller = ctx.session.auth.current;
  if (caller?.principalType !== 'user' || !caller.principalId) {
    throw new Error('A signed-in Supermarket.ie account is required for this action.');
  }
  return caller.principalId;
}
