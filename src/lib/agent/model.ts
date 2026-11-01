import { anthropic } from '@ai-sdk/anthropic';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import type { LanguageModel } from 'ai';

// --- Model provider (configurable; no rebuild needed to change models) ---
//
// This mirrors the Eve runtime's `agent/agent.ts` resolveModel() EXACTLY so the
// lightweight PoC consolidates on the same model/credential contract. It is a
// deliberate copy (not a shared import) so the PoC never pulls the Eve runtime
// bundle into the Next.js server tree.
//
// AGENT_MODEL_PROVIDER = 'bedrock' (default) | 'anthropic'
//   bedrock   -> Amazon Bedrock via the AWS task role (no API key); consolidates
//                AI spend on AWS. Model id from AGENT_MODEL_ID.
//   anthropic -> direct Anthropic API via ANTHROPIC_API_KEY (one-flag rollback).
// AGENT_MODEL_ID        = Bedrock model/inference-profile id
//                         (default: eu.anthropic.claude-sonnet-4-6 — the verified
//                          ACTIVE EU regional inference profile in eu-west-1).
// AGENT_ANTHROPIC_MODEL = model id used only on the anthropic rollback path.
export function resolveAgentModel(): LanguageModel {
  const provider = (process.env.AGENT_MODEL_PROVIDER ?? 'bedrock').toLowerCase();
  if (provider === 'anthropic') {
    return anthropic(process.env.AGENT_ANTHROPIC_MODEL ?? 'claude-sonnet-5');
  }
  // The @ai-sdk/amazon-bedrock provider signs requests with SigV4 via aws4fetch
  // and does NOT use the AWS SDK default credential chain on its own, so it does
  // not pick up ECS task-role credentials automatically. Wire the AWS SDK node
  // provider chain (resolves the ECS container-credentials endpoint, i.e. the
  // task role) as the credentialProvider. No static access keys are set in the
  // task. Region follows AWS_REGION (eu-west-1).
  const bedrock = createAmazonBedrock({
    region: process.env.AWS_REGION ?? 'eu-west-1',
    credentialProvider: async () => {
      const { defaultProvider } = await import('@aws-sdk/credential-provider-node');
      const creds = await defaultProvider()();
      return {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      };
    },
  });
  return bedrock(process.env.AGENT_MODEL_ID ?? 'eu.anthropic.claude-sonnet-4-6');
}
