import { defineAgent } from 'eve';

export default defineAgent({
  // Route through Vercel AI Gateway so the agent can use Vercel-native model
  // observability/routing while keeping the model choice easy to change later.
  model: 'anthropic/claude-haiku-4.5',
  limits: {
    maxInputTokensPerSession: 250_000,
    maxOutputTokensPerSession: 40_000,
  },
});
