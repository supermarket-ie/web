import { defineAgent } from 'eve';
import { anthropic } from '@ai-sdk/anthropic';

export default defineAgent({
  // Use the project's configured Anthropic account directly. The Vercel AI
  // Gateway model is restricted without paid Gateway credits, while this
  // project already has ANTHROPIC_API_KEY configured in production.
  model: anthropic('claude-sonnet-5'),
  limits: {
    maxInputTokensPerSession: 250_000,
    maxOutputTokensPerSession: 40_000,
  },
});
