# Shopping Agent Architecture Evaluation — Eve vs AgentCore vs Lightweight

**Status:** investigation + PoC planning only. No production infrastructure changed; no new runtime deployed. Date 1 November 2026. Region eu-west-1, account 611622961299. Current prod: Eve on ECS Fargate, Amazon Bedrock `eu.anthropic.claude-sonnet-4-6`, **pinned to one task** as the current workaround.

---

## 0. The problem we are actually solving

The single-task pin works but removes redundancy and horizontal scale. Root cause (precise, because it decides which options genuinely fix it):

- Eve runs the `@workflow/world-local` workflow transport, which keeps each **session's turn state in-process on the task that created the session**.
- The browser flow is two separate HTTP requests: `POST /eve/v1/session` (creates the session on one task) then `GET /eve/v1/session/:id/stream` (SSE, opened separately).
- With ≥2 ECS tasks the ALB routes those two requests independently, and ALB `lb_cookie` stickiness is unreliable for this flow (the ALB re-issues a fresh `AWSALB` cookie on the stream GET; the Eve client doesn't reliably echo it). The stream lands on a task that doesn't own the session → empty stream → "agent hangs".

Requirement: **the two requests of one conversation must reach the same stateful compute**, OR **session state must not be task-local** — without fragile cookie stickiness.

**Not the problem:** Bedrock, the model, IAM, the tools, or Supabase. Those all work today.

---

## 1. What the existing implementation is made of (coupling to Eve)

- **Business logic is already decoupled from Eve.** The 25+ tools under `agent/tools/*` are thin `defineTool({ inputSchema, execute, toModelOutput })` wrappers; the real work is framework-agnostic functions in `src/lib/shopping/**` and `agent/lib/**` (`groundHouseholdShop`, `resolveCatalogueProduct`, `resolveHouseholdShopProposal`, `householdShopModelSummary`) over Supabase. These port to any runtime with near-zero change.
- **Eve-specific surface:** `defineTool`/`toModelOutput`; per-turn `defineState` budget (`agent/lib/turn-budget.ts`); `defineDynamic` `turn.started` context injection (`agent/instructions/session-context.ts`, pulls household context from Supabase per turn); `eveChannel` auth (`supermarketSessionAuth` cookie + `supermarketGuestAuth`); and the **client protocol** (`useEveAgent` from `eve/react` in `src/components/HomePlanner.tsx`).
- **The frontend is coupled to Eve's event protocol.** `useEveAgent` consumes Eve SSE events (`session.started`, `turn.started`, `step.started`, `message.appended`, structured tool results like the `household_shop` card). Replacing the runtime means re-implementing that contract or changing the frontend — the biggest hidden cost.
- **Durable state already lives in Supabase, rebuilt per turn.** The agent doesn't rely on Eve's workflow store for business durability — only for in-flight turn delivery.
- **Spend/limit accounting is per-turn, in-process** (`defineState`), NOT cross-task safe → the spend circuit breaker must be rebuilt on shared Supabase regardless of option.

---

## 2. AgentCore Runtime — verified characteristics (not assumed)

From AWS docs (paraphrased; sources in §9):

- **Session routing:** each session gets a dedicated microVM; the Runtime keeps session→microVM affinity. The client calls `InvokeAgentRuntime` (Runtime ARN + payload + `sessionId`) and AgentCore routes every call for that `sessionId` to the same microVM. **This eliminates cross-task routing** — but only because the *client* passes the same `sessionId`. **Our ECS website stays the client** and still owns guest identity, guest→sessionId mapping, and relaying the stream to the browser.
- **AgentCore does NOT map sessions to users.** Per AWS, your backend maintains user↔session relationships and per-user session lifecycle/limits. Guest rate-limiting/concurrency stay on ECS.
- **Session state is ephemeral by default.** MicroVM memory/disk sanitized on termination; managed session storage is **preview**. No automatic durable workflow persistence — confirms the brief's warning. Our Supabase-per-turn model covers durability.
- **Streaming:** `InvokeAgentRuntime` streams; the hosted container serves `POST /invocations` (HTTP/SSE) on :8080. We relay chunks to the browser SSE.
- **Session limits:** up to 8h microVM; configurable idle timeout (default 15 min keeps the microVM warm = billed).
- **Hosting contract:** any custom container implementing `/invocations` can run; Eve could in principle be hosted inside AgentCore with glue to speak that contract, but it's non-trivial, not a drop-in.

**Net:** AgentCore solves routing at its layer but pushes session mapping, guest limits, and stream relay back onto ECS, and gives no durable persistence. Not free of the responsibilities we'd migrate to escape.

---

## 3. Options compared

### Option A — Eve with a shared durable workflow world (stay on ECS)
Replace `world-local` with a custom workflow world module (`experimental.workflow.world` accepts a package exporting `createWorld`) backed by shared Supabase/Postgres or SQS.

- **Effort:** Medium-High. Eve bundles only `world-local` and `world-vercel` (Vercel decommissioned); no Supabase/SQS world, so we author/maintain a custom world against Eve's internal workflow-world contract (queue, runs, steps, events, streams, hooks) — substantial, under-documented, the riskiest build.
- **Reliability/scale:** High once built; matches house architecture.
- **Streaming/sessions:** preserved; **frontend unchanged**.
- **Tools/Supabase:** unchanged. **Rollback:** easy (flag back to `world:'local'` + single task).
- **Risk:** reverse-engineering an internal Eve contract that can change across releases.

### Option B — AgentCore Runtime (agent in AgentCore, website on ECS)
Website calls `InvokeAgentRuntime` with a per-conversation `sessionId` and relays the stream.

- **Effort:** High. B1 host Eve in AgentCore (wrap to `/invocations`, map sessions) — keeps tools/prompts but fragile glue; B2 run a lightweight agent in the microVM (merges with C) — simpler container, still needs frontend protocol work.
- **Reliability/scale:** High, managed, scales across sessions.
- **Streaming/sessions:** AgentCore streams; website relays SSE and owns guest→session mapping/lifecycle.
- **Tools/Supabase:** port fine; microVM needs VPC/egress + IAM to Supabase/Bedrock.
- **Operational:** new service type, IAM/VPC, NAT (~$33/mo), AgentCore observability.
- **Cost:** microVM billed per-second while warm (15-min idle keep-alive) → for bursty guest chat, **often more expensive than ECS**.
- **Rollback:** medium (keep ECS/Eve path live; revert by pointing website back).

### Option C — Lightweight AWS-native agent on ECS (replace Eve)
Small in-house loop using the AI SDK (`ai` + `@ai-sdk/amazon-bedrock`, already in repo) driving existing tools, session/turn state in Supabase, SSE from Next.

- **Effort:** Medium. The loop (`streamText` + tools + `stopWhen`) is small; tools already plain functions. Must re-implement the SSE event protocol (or change the frontend), per-turn context injection, conversation persistence, and the structured `household_shop` card streaming. State in Supabase → **naturally multi-task, no stickiness** → directly fixes the root problem.
- **Reliability/scale:** High and simple; standard ECS scaling, no exotic runtime.
- **Tools/Supabase/guest-auth:** reuse directly. **Operational:** same as today. **Cost:** ECS + Bedrock tokens only — cheapest. **Rollback:** keep Eve image as prior tag; env flag selects runtime.
- **Risk:** we own more agent code; lose Eve built-ins (subagents, compaction, hooks) — only some used.

### Summary matrix

| Dimension | A: Eve + shared world | B: AgentCore | C: Lightweight on ECS |
|---|---|---|---|
| Fixes cross-task routing | Yes (shared state) | Yes (session affinity) | Yes (stateless + shared Supabase) |
| Effort | Medium-High (risky custom world) | High (glue + new service) | Medium |
| Keeps frontend unchanged | **Yes** | No | No |
| Keeps tools/Supabase | Yes | Yes | Yes |
| New infra to operate | None | AgentCore + NAT + IAM/VPC | None |
| Durable session persistence | Custom (Supabase) | Not automatic (preview) | Supabase (native) |
| Monthly cost vs today | ~same | **Higher** | **Lowest** |
| Rollback | Easiest | Medium | Easy |
| Main risk | Eve internals | Cost + ops surface + glue | We own more agent code |

---

## 4. Expected monthly costs (planning figures — confirm on AWS pricing at build time)

Assume ~2,000 conversations/month, ~4 turns each (~8,000 turns), Sonnet-4.x ≈ $3 / 1M input, $15 / 1M output.

- **Bedrock tokens (all options, same):** ≈ $0.03/turn → **≈ $240/mo**; lower with prompt caching / Haiku routing. Dominates, option-independent.
- **Option A / C compute:** existing ECS Fargate (2 small tasks) ≈ **$30–70/mo**.
- **Option B compute:** microVM $0.0895/vCPU-hr + $0.00945/GB-hr billed while warm, plus NAT (~$33/mo) + observability → **≈ $150–300+/mo over A/C for no token savings**.

**Conclusion:** tokens are the real spend and option-independent; A and C are cheapest and roughly equal; B adds meaningful fixed + per-session cost.

---

## 5. Recommendation

**Primary: Option C (lightweight AWS-native agent on ECS), delivered as a flag-gated PoC — with Option A as fallback.**

1. Directly removes the root cause (Supabase state + stateless tasks = no stickiness), using the architecture we already operate.
2. Lowest complexity/cost, nothing new to operate (no AgentCore/NAT/new IAM-VPC/observability, no reverse-engineering Eve internals).
3. The expensive part is already portable; AI SDK + Bedrock are proven in prod here.
4. AgentCore isn't justified: it solves routing but re-imposes session mapping/guest limits/stream relay on ECS, adds cost + ops surface, gives no durable persistence — adopting a managed runtime without escaping the responsibilities.

**Retain or replace Eve?** Replace for the customer agent *if* the PoC shows the frontend-protocol rework is contained; otherwise **fall back to Option A** (keep Eve, build the shared world, frontend untouched). Decide at the end of PoC Phase 1. The hard dependency to de-risk first is the `useEveAgent` streaming contract.

---

## 6. Phased PoC + migration plan (no production change until validated)

- **Phase 0 — De-risk the frontend protocol (0.5–1 day).** Catalogue the exact Eve SSE event types `useEveAgent`/`HomePlanner.tsx` consume (incl. the `household_shop` card). Decides C-vs-A.
- **Phase 1 — PoC agent loop, server-side (2–3 days).** `src/lib/agent/`: `streamText` + Bedrock + existing tools, `stopWhen` ≤5 steps, max-output-tokens, per-request timeout. New `POST /api/agent/chat` (SSE) persisting turn state in Supabase; validate on an isolated preview task; prove multi-task by running 2 preview tasks with NO stickiness and confirming conversations complete.
- **Phase 2 — Safeguards on shared Supabase (2–3 days).** Circuit breaker + rate limits as atomic Supabase RPCs enforced before any Bedrock call (see §7).
- **Phase 3 — Frontend adapter (1–3 days, sized by Phase 0).** Adapt `HomePlanner.tsx` to the new SSE contract, or a shim emitting Eve-shaped events so the frontend is unchanged; keep the `household_shop` card.
- **Phase 4 — Preview validation.** Full multi-turn conversations (search, retailer comparison, shopping-list) on 2 preview tasks, real data, safeguards active, Bedrock usage/spend observed.
- **Phase 5 — Production cutover (incremental, reversible).** Deploy behind `AGENT_RUNTIME=lightweight|eve` (default `eve`); flip via targeted `tofu apply` (website task def only); **raise desired_count/autoscale_min/max back to ≥2** and confirm conversations survive cross-task routing with NO stickiness; keep the Eve + single-task path as instant rollback.

**Preserved throughout:** product catalogue + pricing tools, Tesco/Dunnes/SuperValu collection pipelines (never touched), Bedrock model config, the Anthropic rollback provider.

**If Phase 0 shows large frontend rework:** switch to Option A for Phases 1–4 (custom Supabase-backed Eve world; frontend unchanged), same Phase 5 cutover.

---

## 7. Spending & abuse safeguards (architecture-independent, ECS request path + shared Supabase)

- **Guest identity:** signed HttpOnly guest-id cookie (primary key); client IP (`x-forwarded-for` first hop) as a *secondary* abuse signal only, allowing shared IPs (NAT/carrier) — never a hard per-IP block.
- **Rate limits (atomic Supabase RPC):** ≤10 msgs/hour, ≤30/day per guest; ≤1 concurrent active request per guest (claimed-lock row released on completion/timeout); ≤15 messages/conversation.
- **Model usage caps (in the loop):** `maxOutputTokens: 2000`/response; `stopWhen` ≤5 steps/user message; input/context trimmed to a shopping-appropriate budget; hard per-request wall-clock timeout. Applied to every model invocation incl. retries and tool loops.
- **Daily Bedrock spend circuit breaker (shared, atomic, fail-closed):** Supabase RPC that **reserves** estimated max cost (tokens×rate + retry headroom) against a per-UTC-day ledger before each call; admits only if `reserved + spent ≤ $10/day`; reconciles actuals after; **fails closed** with a friendly "assistant busy, try again shortly" if the ledger is unavailable; atomicity via a single `UPDATE ... RETURNING`/`SELECT ... FOR UPDATE` RPC so tasks/sessions can't race. An estimated application ceiling, **not** an AWS billing cap; accounts for in-flight reservations + delayed usage reporting.
- **AWS Budgets alerts (notification only):** monthly Bedrock-service-scoped budget, alerts at $25/$50/$100 via the Cost Explorer "Amazon Bedrock" dimension where available. Not a hard cap.
- **Monitoring (no raw prompts):** Supabase `agent_usage` + CloudWatch metrics for daily requests, estimated spend, input/output tokens, rate-limit rejections, breaker blocks, model errors/throttles, guest-vs-authenticated split. Counts/totals/outcomes only.

---

## 8. Deliverables summary

1. **Recommended architecture:** Option C (lightweight AWS-native on ECS, Supabase-backed stateless turns) as a flag-gated PoC, Option A fallback. Reject Option B.
2. **Eve retain/replace:** replace if PoC Phase 0/3 shows contained frontend work; else retain via Option A. Decide end of Phase 1.
3. **Effort:** ~8–13 engineer-days for Option C to preview validation; A similar-to-slightly-higher; B highest.
4. **Monthly AWS cost:** Bedrock tokens ≈ $240/mo (option-independent) + ECS ≈ $30–70/mo for A/C; B adds ≈ $150–300+/mo.
5. **AgentCore services required:** none under the recommendation. (If B: AgentCore Runtime; optionally Gateway/Memory/Identity; plus NAT.)
6. **Phased plan:** §6.
7. **Spending safeguards:** §7 — ECS request path + shared atomic fail-closed Supabase; works across tasks/sessions for any runtime.

---

## 9. Sources (AWS official, paraphrased for licensing compliance)

- AgentCore sessions & isolation: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html
- AgentCore how-it-works: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-how-it-works.html
- Lifecycle settings (idle timeout / maxLifetime): https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html
- HTTP /invocations contract & streaming: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html
- InvokeAgentRuntime: https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_InvokeAgentRuntime.html
- Managed session storage (preview): https://aws.amazon.com/about-aws/whats-new/2026/03/bedrock-agentcore-runtime-session-storage/
- AgentCore pricing: https://aws.amazon.com/bedrock/agentcore/pricing/
- Bedrock pricing: https://aws.amazon.com/bedrock/pricing/

*Content from external sources was rephrased for compliance with licensing restrictions.*
