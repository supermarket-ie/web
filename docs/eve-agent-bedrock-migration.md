# Eve agent: failure diagnosis + Bedrock / AgentCore migration plan

Status: investigation complete, read-only. No production change made.
Date: 30 October 2026. Region: eu-west-1, account 611622961299.

---

## 1. Confirmed cause of the current failure

**The agent is NOT failing on Anthropic credits, key, model id, or networking.**
It is failing inside Eve's workflow transport.

### Architecture (as deployed)
- The customer-facing agent is the **Eve** framework (`eve@0.39.0`, AI SDK
  `ai@7.0.66`), code under `agent/**`. It still uses the Vercel-AI-SDK-era
  Anthropic provider: `agent/agent.ts` →
  `model: anthropic('claude-sonnet-5')` from `@ai-sdk/anthropic@4.0.38`, calling
  the Anthropic API directly with the `ANTHROPIC_API_KEY` secret. **Bedrock is
  not used anywhere.**
- The ECS container (`Dockerfile` + `docker-entrypoint.sh`) runs **two**
  processes:
  - Next.js on `0.0.0.0:3000` (`PORT`), the ALB target.
  - The Eve Nitro agent server on `127.0.0.1:4274` (`EVE_NEXT_PRODUCTION_PORT`).
  - `withEve` rewrites `/eve/v1/*` from :3000 → `127.0.0.1:4274`.

### Root cause
Eve runs the `@workflow/world-local` workflow world. Each agent turn is a
durable workflow; its steps are delivered by an HTTP **self-`fetch`** to a base
URL resolved as:
`WORKFLOW_LOCAL_BASE_URL` (UNSET in prod) → else `http://localhost:${PORT}` =
`http://localhost:3000`.

That self-delivery fails with `TypeError: fetch failed`. CloudWatch
`/ecs/smie-prod` web streams show, for every turn:
```
[world-local] Queue delivery failed at the transport (loop 2), retrying { … error: 'TypeError: fetch failed' }
[workflow-sdk] Re-executing inline steps owned by this queue message — a previous delivery crashed mid-body …
… loop 3 … loop 4 … then abandoned
```
Last 7 days: **14** transport failures, **0** handler-level
`Queue message failed (HTTP …)`, **0** `[eve-session-context]` logs, **0**
completed turns. The turn steps partially execute in-process but the transport
never acknowledges, so no turn settles and the user gets no reply.

### Hypotheses ruled out, with evidence
| Hypothesis | Verdict | Evidence |
|---|---|---|
| Anthropic credits exhausted | **No** | Read-only one-off ECS task (live `smie-prod:12` task def, same subnets/SG, real injected key) → `POST api.anthropic.com/v1/messages` returned **HTTP 200** with real `usage` tokens. A credit problem returns HTTP 400 "credit balance is too low". |
| API key missing / invalid | **No** | Secret `smie-prod/anthropic` present, wired into the task; 108 chars, `sk-ant-` prefix; authenticated (200). |
| Invalid model id `claude-sonnet-5` | **No** | Present in `@ai-sdk/anthropic` model-id union; the 200 response echoed `model: claude-sonnet-5`. |
| Networking / egress blocked | **No** | SG `sg-0f382e9d266cbb4dc` allows all egress; both subnets public via `igw-0fd4fc237da34c490`; Anthropic round-trip 934 ms. |
| `localhost` → IPv6 `::1` mismatch | **No** | Container probe: `dns.lookup('localhost')` → `127.0.0.1` only. |
| Service down | **No** | `www.supermarket.ie` → HTTP 200; ECS svc 2/2, rollout COMPLETED. |

**Conclusion:** the defect is the `world-local` transport being unsuitable for
this two-process ECS layout (the self-delivery HTTP hop to the app's own port
does not succeed). This is a post-migration configuration/runtime gap, not a
model-provider problem.

---

## 2. Recommended architecture

Two independent problems, two independent fixes. **Both are required.**

1. **Fix the workflow transport (restores the agent — do this first).**
   The model swap alone will NOT make turns complete, because turns die at the
   `world-local` self-delivery hop before the model is ever called in the normal
   path. Options, smallest first:
   - **(a) Set `WORKFLOW_LOCAL_BASE_URL` to a reachable self-origin** for the
     web task (e.g. `http://127.0.0.1:3000`) and verify the workflow delivery
     route is actually served on that origin. Lowest effort; must be validated
     against the exact `fetch failed` in a preview task, because the production
     failure occurs with the Next server up (so it is more than "unset base
     URL" — the delivered request is being refused/aborted at the HTTP layer).
   - **(b) Point the workflow world at the Eve server origin directly**
     (`http://127.0.0.1:4274`) if that is where the `/eve/v1/.../flow` delivery
     route is mounted, bypassing the Next rewrite hop.
   - **(c) Use Eve's non-local workflow world** appropriate for a long-running
     server (the `AgentWorkflowWorldDefinition` in `defineAgent`), if a
     server/SQS-backed world is supported in this Eve version, so turns do not
     depend on an HTTP self-delivery at all.
   The correct choice is confirmed in a **preview** task (see §5) by watching
   for `[eve-session-context]` + a completed turn.

2. **Migrate model access to Amazon Bedrock (consolidates spend on AWS).**
   `defineAgent({ model })` accepts a `LanguageModel` instance, so this is a
   drop-in: replace `anthropic('claude-sonnet-5')` with a Bedrock model from
   `@ai-sdk/amazon-bedrock`, keeping all tools, prompts, capabilities and limits
   unchanged. Make the model id configurable via env so models can be changed
   without rebuilding (see §5).

**Recommended end state:** keep the existing Eve agent on **ECS Fargate**
(`smie-prod-svc`), fix the workflow transport, and point the model at **Bedrock
via the EU inference profile**, using the ECS task role for auth (no API key).
Do **not** adopt AgentCore now (see §4).

---

## 3. Bedrock model selection and estimated cost

### Availability verified (eu-west-1)
Foundation models incl. `anthropic.claude-sonnet-4-5-20250929-v1:0`,
`anthropic.claude-sonnet-4-6`, `anthropic.claude-sonnet-5`,
`anthropic.claude-haiku-4-5-20251001-v1:0`. **EU system inference profiles**
ACTIVE: `eu.anthropic.claude-sonnet-4-5-20250929-v1:0`,
`eu.anthropic.claude-sonnet-4-6`, `eu.anthropic.claude-opus-4-x`. A live admin
Converse call to `eu.anthropic.claude-sonnet-4-6` succeeded.

Newer Claude models on Bedrock must be invoked through an **inference profile**
(regional `eu.*` or `global.*`), not the bare foundation-model id.

### Recommendation
Primary: **`eu.anthropic.claude-sonnet-4-6`** (EU regional profile) — current
Sonnet-class, agent/tool-optimised, keeps data in-EU, and is the closest
equivalent to today's `claude-sonnet-5`. Keep the id in an env var so it can be
changed (e.g. to a Haiku profile for cheaper traffic) without a rebuild.

### Cost (indicative; confirm on the Bedrock pricing page at apply time)
Sonnet-4.5/4.6-class Bedrock rates are roughly **$3/1M input, $15/1M output**
(EU profile pricing sits a little above US on-demand; treat these as planning
figures, not a quote). Content rephrased for compliance with licensing
restrictions. Sources:
[Bedrock pricing](https://aws.amazon.com/bedrock/pricing/),
[Sonnet 4.5 EU specs](https://metatext.io/llm/amazon-bedrock-eu.anthropic.claude-sonnet-4-5-20250929-v10).

Worked estimate for a shopping turn (~6k input incl. household/catalogue
context + tool loop, ~700 output):
- input 6,000 × $3/1M = $0.018
- output 700 × $15/1M = $0.0105
- ≈ **$0.03 per turn**. At 2,000 turns/month ≈ **$60/month** in model spend.
Prompt caching (cache-read ~$0.30/1M) materially lowers this for the large
stable system/context prefix. Haiku-class for simple lookups would cut per-turn
cost by ~3–5×. There is **no Bedrock platform fee** — you pay per token only.

Consolidation benefit: this moves agent model spend from a separate Anthropic
invoice onto the AWS bill, under the task role (no stored API key).

---

## 4. Is AgentCore justified? — No (not now)

AgentCore Runtime is a managed agent-hosting service billed per component
(Runtime by vCPU-hour + GB-hour, Gateway per 1k tool calls, Memory per GB/record,
plus a NAT gateway in the reference stack). Content rephrased for compliance.
Sources:
[AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/),
[component breakdown](https://camelai.com/blog/camelrun-vs-aws-bedrock-agentcore).

| Factor | Keep Eve on ECS + Bedrock | Move Eve to AgentCore Runtime |
|---|---|---|
| Effort to restore service | Low (config + model swap) | High (re-host the Eve runtime, re-plumb auth/session/tools) |
| Fixes the actual bug | Yes (transport fix) | Not inherently — the `world-local` transport issue is Eve-internal and would still need solving |
| Model access | Bedrock via task role | Bedrock via task role (same) |
| Session handling | Eve's existing durable sessions | Would need to reconcile Eve sessions with AgentCore sessions |
| Observability | CloudWatch (already in place) | CloudWatch + AgentCore traces (marginal gain) |
| Cost | Token-only, reuses existing Fargate | Adds Runtime + possible Gateway/Memory + NAT charges |
| Added complexity | None beyond current | Significant new surface area |

The task is to **restore a working agent quickly** and **not rebuild working
functionality to adopt a new service**. AgentCore would be a re-host that does
not by itself fix the transport bug and adds cost and complexity. **Prefer Eve
on ECS with Bedrock.** Revisit AgentCore only if later requirements (managed
multi-tenant isolation, built-in tool gateway, managed memory) clearly outweigh
the migration cost.

---

## 5. Implementation effort and deployment plan

Effort: **small** (≈ half a day of code + a preview validation pass), gated on
reproducing and fixing the transport issue in preview first.

### Code changes (dev first)
1. Add dependency `@ai-sdk/amazon-bedrock` (pin an exact version compatible with
   `@ai-sdk/provider@4.0.7`, which Eve's anthropic provider uses). Verify in
   preview that it loads under `ai@7`.
2. `agent/agent.ts` — make the model provider configurable:
   ```ts
   import { defineAgent } from 'eve';
   import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
   import { anthropic } from '@ai-sdk/anthropic';

   const bedrock = createAmazonBedrock({ region: process.env.AWS_REGION ?? 'eu-west-1' });
   const modelId = process.env.AGENT_MODEL_ID ?? 'eu.anthropic.claude-sonnet-4-6';
   const useBedrock = (process.env.AGENT_MODEL_PROVIDER ?? 'bedrock') === 'bedrock';

   export default defineAgent({
     model: useBedrock ? bedrock(modelId) : anthropic(process.env.AGENT_ANTHROPIC_MODEL ?? 'claude-sonnet-5'),
     limits: { maxInputTokensPerSession: 250_000, maxOutputTokensPerSession: 40_000 },
   });
   ```
   Model is now swappable by env (`AGENT_MODEL_PROVIDER`, `AGENT_MODEL_ID`) with
   no rebuild. The Anthropic path stays as a one-flag rollback.
   NOTE: `scripts/branded-intersection-infer.ts` asserts the configured model
   equals `claude-sonnet-5`; update that guard if the shared model changes.
3. Fix the workflow transport (§2 item 1): set `WORKFLOW_LOCAL_BASE_URL` (or the
   Eve workflow-world config) via Terraform task env, and **prove in preview**
   that a turn completes.

### AWS / Terraform changes
- **IAM (required):** attach a Bedrock invoke policy to role `smie-prod-task`
  (currently only `smie-prod-task-sqs-produce`, no Bedrock access). Minimal:
  `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` on the EU
  Claude inference-profile ARN(s) and the underlying `foundation-model/*` they
  route to. Add via `infra/terraform` (keep least-privilege to the chosen
  profile).
- **Task env:** `AGENT_MODEL_PROVIDER=bedrock`, `AGENT_MODEL_ID=eu.anthropic.claude-sonnet-4-6`,
  `WORKFLOW_LOCAL_BASE_URL=<verified self-origin>` on `smie-prod-svc`.
- `ANTHROPIC_API_KEY` can remain wired as the rollback path until Bedrock is
  proven in production, then be removed.

### Deploy + rollback
1. Land code on a branch; green `validate` CI; merge via squash (ruleset
   "Protect main").
2. Build the prod image: `Build & push deploy image to ECR` workflow
   (`workflow_dispatch`, `image_mode=prod`), tag `<sha>-prod`.
3. Validate in **preview** (`aws-preview.supermarket.ie`) first: confirm a real
   turn completes (`[eve-session-context]` log + assistant reply), tools run,
   prices come from `latest_prices`, and Bedrock usage shows in CloudWatch.
4. Production rollout: `terraform apply -var image_tag=<sha>-prod` in
   `infra/terraform` (adds the IAM policy + task env, rolls the service).
5. **Rollback capability:** (a) flip `AGENT_MODEL_PROVIDER=anthropic` (env-only,
   no rebuild) to revert to the direct Anthropic key, and/or (b)
   `terraform apply -var image_tag=<previous-sha>-prod` to roll the service back
   to the prior task definition. The single image serves both providers, so
   rollback is a variable change.

### Validation checklist (Phase 4)
- Agent answers a customer query end-to-end (no `world-local` transport errors).
- Product search, retailer price comparison, shopping recommendations work via
  the existing tools.
- Prices/promotions come from real Supermarket.ie data (`latest_prices`,
  trusted catalogue tools) — the behavioural `price_truth` gate still holds.
- CloudWatch shows Bedrock invocations + token usage; no `TypeError: fetch
  failed`; error handling degrades gracefully if Bedrock throttles.

### Explicitly out of scope / untouched
Tesco, Dunnes, SuperValu collection pipelines, schedules, mapping/price data.

---

## 6. AWS permissions / configuration changes required (summary)
- **IAM:** add Bedrock invoke permissions to `smie-prod-task` for the chosen EU
  Claude inference profile (none today).
- **Task env (`smie-prod-svc`):** `AGENT_MODEL_PROVIDER`, `AGENT_MODEL_ID`,
  `WORKFLOW_LOCAL_BASE_URL` (or the equivalent Eve workflow-world setting).
- **Secrets:** no new secret needed for Bedrock (task-role auth); keep
  `smie-prod/anthropic` until Bedrock is proven, then retire it.
- **No** VPC/NAT change (egress already open); **no** new service; **no**
  AgentCore resources.
