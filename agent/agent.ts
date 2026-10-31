import { defineAgent } from 'eve';
import { anthropic } from '@ai-sdk/anthropic';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import type { LanguageModel } from 'ai';

// --- Model provider (configurable; no rebuild needed to change models) ---
//
// AGENT_MODEL_PROVIDER = 'bedrock' (default) | 'anthropic'
//   bedrock   -> Amazon Bedrock via the AWS task role (no API key); consolidates
//                AI spend on AWS. Model id from AGENT_MODEL_ID.
//   anthropic -> direct Anthropic API via ANTHROPIC_API_KEY (one-flag rollback).
// AGENT_MODEL_ID        = Bedrock model/inference-profile id
//                         (default: eu.anthropic.claude-sonnet-4-6 — the verified
//                          ACTIVE EU regional inference profile in eu-west-1).
// AGENT_ANTHROPIC_MODEL = model id used only on the anthropic rollback path.
function resolveModel(): LanguageModel {
  const provider = (process.env.AGENT_MODEL_PROVIDER ?? 'bedrock').toLowerCase();
  if (provider === 'anthropic') {
    return anthropic(process.env.AGENT_ANTHROPIC_MODEL ?? 'claude-sonnet-5');
  }
  // Bedrock auth uses the default AWS credential chain (ECS task-role creds);
  // no access keys are set in the task. Region follows AWS_REGION (eu-west-1).
  const bedrock = createAmazonBedrock({ region: process.env.AWS_REGION ?? 'eu-west-1' });
  return bedrock(process.env.AGENT_MODEL_ID ?? 'eu.anthropic.claude-sonnet-4-6');
}

export default defineAgent({
  model: resolveModel(),
  // A direct Bedrock LanguageModel has no AI-Gateway context-window metadata, so
  // Eve cannot auto-size compaction. Provide the Claude Sonnet 4.5/4.6 window
  // (200k tokens) explicitly. Update if AGENT_MODEL_ID points at a model with a
  // different window.
  modelContextWindowTokens: Number(process.env.AGENT_MODEL_CONTEXT_WINDOW ?? 200_000),
  // Declaring the workflow world makes the production Nitro build register the
  // IN-PROCESS turn-queue handler (configureProductionNitroRoutes only does so
  // when experimental.workflow.world is defined). Without it, Eve falls back to
  // delivering each turn step over an HTTP self-fetch to `/flow`, which no
  // process serves in this two-process ECS image (Next on :3000, Eve Nitro on
  // :4274) — every turn then fails with `TypeError: fetch failed` and never
  // completes. `local` runs the turn in-process; durable household state lives
  // in Supabase (rebuilt per turn), not in the workflow store, so this is
  // correct across multiple ECS tasks for the stateless request->turn->response
  // flow. See docs/eve-agent-bedrock-migration.md for the durable-world upgrade
  // path if cross-task workflow resumption is later required.
  experimental: { workflow: { world: 'local' } },
  limits: {
    maxInputTokensPerSession: 250_000,
    maxOutputTokensPerSession: 40_000,
  },
});
