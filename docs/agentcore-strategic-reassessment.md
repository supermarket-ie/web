# AgentCore Strategic Reassessment — building an increasingly autonomous shopping agent

**Scope:** investigation + PoC design only. No production infra changed, no new runtime deployed, collection pipelines untouched. Region eu-west-1. Date 1 November 2026. Reassessed through a **product-capability lens**, correcting the prior assessment's over-weighting of cost/simplicity. Supersedes nothing operationally; complements `docs/agent-architecture-evaluation.md`.

---

## 0. The honest reframing

The prior assessment was right that the *cheapest* fix for the task-local session bug is a lightweight ECS agent. This reassessment asks a different question: **what architecture best supports an increasingly autonomous shopping assistant over 1–3 years?** Separate two things:

- **Agentic intelligence** (multi-step planning, tool orchestration, substitution reasoning, budget optimisation) is a property of **the model + the tool-loop + the prompt/plan structure** and is largely **host-independent**. AgentCore does not make the agent smarter.
- **Agent operations & governance** (session isolation, cross-session memory, governed tool access, agent identity to external services, action policy, tracing, evaluation) is where AgentCore's *services* add real value you would otherwise hand-build and maintain.

The decision is therefore **which operational/governance layers are worth buying managed, and when** — not "smart vs cheap".

---

## 1. AgentCore services — status, eu-west-1, value to *this* product

Verified against AWS docs (paraphrased; sources §12). The suite is GA in 2026 with CDK support; **eu-west-1 (Ireland) is supported** for the control plane, Runtime (incl. instances), Gateway (incl. semantic tool search), Browser, and the GA governance services. Confirm each specific feature's region at build time.

| Service | Status / eu-west-1 | What it gives | Value to our product | Verdict |
|---|---|---|---|---|
| **Runtime** | GA, Ireland | Managed microVM per session, isolation, streaming, scale | Solves cross-task routing at its layer; website still owns guest→session mapping + stream relay; ephemeral state (managed storage preview); warm-microVM billing | Optional — not uniquely required |
| **Memory** | GA, Ireland | Managed short-term + **long-term memory auto-extracting preferences/facts across sessions** | Maps to "remember preferences/favourites/recurring purchases" — but **we already have `households.memory`** | High-interest; we already have a working equivalent |
| **Gateway** | GA, Ireland | APIs→governed **MCP** tools; auth; semantic discovery; unify many tools | Valuable with **many** tools / **multiple agents** | Future-valuable |
| **Identity** | GA, Ireland | OAuth2 agent identity + scoped access to **external** services | Enables "controlled access to external services" in the autonomous future | Future-valuable |
| **Observability** | GA (unified CloudWatch), Ireland | Traces/spans/metrics | Genuine ops value; replicable from ECS via OTEL/CloudWatch | Valuable, not exclusive |
| **Policy** | GA, Ireland | Declarative restrictions on actions/tool usage | Matters as the agent gains power to *act* | Future-valuable |
| **Evaluations** | GA | Recommendation quality, tool correctness, task completion | Maps to "measure quality / task completion"; host-independent | Valuable and host-independent |

**Unique vs replicable:** Memory (long-term extraction), Gateway (managed MCP governance + discovery), Identity (agent OAuth to external services), Policy are genuinely expensive to build/maintain ourselves. Runtime and Observability are largely replicable on ECS+Supabase+CloudWatch. Evaluations is a managed convenience usable independently.

---

## 2. Three architectures, judged on capability + operations

### Option A — Lightweight AWS-native agent on ECS
AI SDK tool-loop (`streamText` + `stopWhen`) on Bedrock, existing tools, **session/turn state in Supabase**, SSE from Next.
- Planning/orchestration: full (host-independent). Memory: reuse/extend `households.memory`. Reliability: stateless tasks + Supabase → ≥2 tasks, no stickiness. Complexity: medium. Cost: lowest. Ceiling: we hand-build governance later.

### Option B — AgentCore Runtime + selected services
Website on ECS calls `InvokeAgentRuntime`; agent in AgentCore; adopt Memory/Gateway/Identity/Policy/Observability/Evaluations.
- Same model/loop = same intelligence, strongest **governance** story; website still relays streams + owns guest→session mapping/limits. Complexity highest now; cost highest (warm microVM + NAT + per-service). Ceiling: highest.

### Option C — Hybrid: lightweight agent on ECS + selective AgentCore services
Option A's loop + Supabase state, consuming specific AgentCore services where they beat DIY (Memory, Gateway, Evaluations, Policy/Identity), execution staying on ECS.
- Full planning; optional managed memory/governance bolted on incrementally (each flag-gated, reversible). Reliability = A (fixes the bug the proven way). Complexity medium/incremental. Cost A + only services used (no warm microVM/NAT). Ceiling high; can later move execution to Runtime if justified.

### Capability-weighted comparison

| Criterion | A (ECS) | B (Runtime+services) | C (Hybrid) |
|---|---|---|---|
| Multi-step planning / orchestration | Full | Full | Full |
| Persistent cross-session memory | DIY (have it) | Managed | DIY now, managed optional |
| Governed tools / multi-agent future | DIY | Managed | Add Gateway when needed |
| External-service agent identity | DIY | Managed | Add Identity when needed |
| Action policy as autonomy grows | DIY | Managed | Add Policy when needed |
| Quality evaluation | DIY/managed | Managed | Add Evaluations early (cheap) |
| Reliability ≥2 tasks, no stickiness | Yes | Yes | Yes |
| Complexity now | Medium | High | Medium |
| Cost now | Lowest | Highest | Low–medium |
| Long-term extensibility | Medium | Highest | High |
| Reversibility | Easy | Medium | Easy, per-service |

---

## 3. Recommendation

**Adopt Option C (Hybrid), sequenced to reduce to Option A today and grow into AgentCore's governance services as autonomy demands them.**

1. **Fix reliability the proven way:** lightweight ECS loop + Supabase-backed state delivers §5 fully (≥2 tasks, no stickiness, streaming + cards, context across requests, graceful recovery, independent scaling), reusing all shopping investment.
2. **Buy governance, not intelligence:** keep the loop/model (that's where smarts live); adopt the AgentCore *services* that are expensive to build well, in capability order — **Evaluations early** (cheap, host-independent) to measure the €100 plan workflow; **Memory** when we want cross-session personalisation beyond `households.memory` (prove it beats ours first); **Gateway + Identity + Policy** when multiple agents / external authenticated actions / acting (writing baskets, spending) actually arrive.
3. **Keep the Runtime door open:** migrate execution to Runtime only if a concrete need appears (hard multi-tenant isolation, hours-long autonomous jobs, true multi-agent microVM separation) — smaller step having already adopted the services.

**Not B now:** front-loads highest cost/complexity for governance not yet needed; its headline win (routing) is also delivered by C. **Not pure A:** leaves every governance layer as future DIY debt; C is A plus a cheap, reversible on-ramp.

---

## 4. Eve: retain or replace

**Replace Eve for the customer agent.** Its liability (task-local `world-local`) is exactly what blocks §5; its value (turn orchestration + client streaming protocol) is re-creatable and does not advance the vision. A loop we own is more extensible toward multi-step planning, AgentCore-service integration, and evaluation instrumentation. Gate on a Phase-0 audit of the `useEveAgent` event contract (the one real migration cost); if large, keep Eve only as a stopgap behind a shared-world fix while building the replacement.

---

## 5. Protecting the existing investment (reused as-is under A/C)

- Product catalogue + verified retailer prices (Supabase), `latest_prices` freshness model.
- Framework-agnostic shopping functions in `src/lib/shopping/**` and `agent/lib/**` (`groundHouseholdShop`, `resolveCatalogueProduct`, `resolveHouseholdShopProposal`, `householdShopModelSummary`) — become the tool implementations directly.
- Product matching & identity safeguards; price-comparison; basket optimisation; shopping-list generation.
- The structured frontend shopping cards (`household_shop` payload) — the new runtime emits the same structured result.
- The existing `households.memory` personalisation.

**Product-integrity invariants (non-negotiable, preserved by reuse):** strict product identity (no cross-identity substitution), correct missing/expired-price handling (exclude from totals, never guess), never invent prices or availability. These live in the tool/`src/lib/shopping` layer; the loop orchestrates but never authors prices.

---

## 6. Reliability & frontend integration — how C meets each §5 requirement

- **≥2 ECS tasks:** turn/session state in Supabase → any task serves any request; raise `desired_count`/`autoscale_min`/`max` ≥2.
- **No ALB stickiness:** unnecessary; no task-local session to pin.
- **Reliable streaming + structured responses:** Next route streams SSE; tool results (incl. shop card) are structured events; resumable by `conversationId` from Supabase.
- **Context across requests:** conversation/turn rows in Supabase; each turn rebuilds context + household memory.
- **Graceful recovery:** a turn is a request against shared state; a crash loses only the in-flight stream; client reconnects/retries.
- **Independent scaling:** website scales on CPU/req-count; model concurrency governed by the §7 safeguards, not task count.

---

## 7. Spending & abuse safeguards (application-enforced; AgentCore does not replace these)

AgentCore provides Policy + per-service metrics but **no managed $-spend cap**; AWS Budgets is notification-only. The enforceable ceiling is ours, identical across A/B/C, in the ECS request path on shared atomic Supabase accounting:

- **Guest identity:** signed HttpOnly guest-id cookie (primary); client IP secondary only, tolerant of shared IPs (no hard per-IP block).
- **Rate limits (atomic RPC):** ≤10 msgs/hour, ≤30/day per guest; ≤1 concurrent per guest (claimed-lock row released on completion/timeout); ≤15 msgs/conversation.
- **Model usage caps (all invocations incl. retries/tool loops):** `maxOutputTokens: 2000`/response; `stopWhen` ≤5 iterations/message; context trimmed to a shopping-appropriate budget; hard per-request timeout.
- **$10/UTC-day Bedrock circuit breaker (shared, atomic, fail-closed):** reserve estimated max cost (tokens×rate + retry headroom) before each call; admit only if `reserved + spent ≤ $10`; reconcile after; fail closed with a friendly busy message; single `UPDATE … RETURNING`/`SELECT … FOR UPDATE` so tasks/sessions can't race. Estimated application ceiling, not an AWS billing cap; accounts for in-flight reservations + delayed usage.
- **AWS Budgets alerts (notification only):** monthly Bedrock-scoped, $25/$50/$100.
- **Policy (optional):** as the agent gains acting power, add declarative action restrictions (AgentCore Policy if on Runtime, else app-level tool guards).
- **Monitoring (no raw prompts):** Supabase `agent_usage` + CloudWatch for daily requests, estimated spend, in/out tokens, rate-limit rejections, breaker blocks, model errors/throttles, guest-vs-authenticated split, and **cost per conversation / per completed shopping task**.

If execution later moves to Runtime, these controls stay in the ECS entry point that calls `InvokeAgentRuntime`, remaining effective across sessions.

---

## 8. Proof of concept — the advanced workflow, both ways

**Scenario:** *"Create a five-day dinner plan for a family of four with a €100 budget. Generate the shopping list, compare products across Tesco, Dunnes and SuperValu, and recommend the most economical basket."*

**Must demonstrate + measure:** (1) multi-step planning, (2) coordinated tool execution, (3) real catalogue + price retrieval, (4) identity-respecting substitution reasoning, (5) budget-aware basket optimisation, (6) structured shopping-list output, (7) transparent missing-data handling (excluded, never invented), (8) model usage/latency/cost.

**Agent flow (host-independent):** plan 5 dinners biased to `households.memory` + dietary/household facts → decompose to ingredient lines → batch-resolve to catalogue via the `present_household_shop` resolver (real prices, 3-retailer coverage) → substitution via `find_substitutes` under identity safeguards for over-budget/missing lines → optimise across retailers (`compare_shop_stores` + basket optimisation) under €100 → emit the structured card + transparent notes on unpriced lines.

**Two implementations (same tools/prompts):** C-impl (AI SDK loop on ECS + Supabase + Evaluations scoring) vs B-impl (same loop in AgentCore Runtime + Memory + Gateway-exposed tools + Evaluations).

**Metrics:** task completion (valid ≤€100 basket?), recommendation quality (Evaluations), tool-call correctness, substitution identity-safety, latency, tokens, **€ per completed plan**. Single agent only — add specialist sub-agents only if the eval shows the single loop fails the budget/quality bar. **Validate on ≥2 preview tasks with no stickiness** to prove reliability, not just capability.

---

## 9. Deliverables summary

1. **Recommended architecture:** Hybrid (Option C) — lightweight ECS agent (Supabase-backed stateless turns) now; adopt AgentCore services incrementally (Evaluations → Memory → Gateway/Identity/Policy). Not Runtime now.
2. **AgentCore to adopt:** Evaluations early; Memory if it beats `households.memory`; Gateway/Identity/Policy when multi-agent/external-action features arrive; skip Runtime until a concrete isolation/long-job/multi-agent need justifies it.
3. **Eve:** replace for the customer agent; gate on the `useEveAgent` audit.
4. **PoC:** §8 — €100 five-dinner workflow, C-impl vs B-impl, measured; validated on 2 non-sticky tasks.
5. **Effort:** ~10–16 eng-days for the C PoC to preview validation; +3–5 days for the B-impl comparison; Memory/Gateway/Identity/Policy are incremental few-day adds later.
6. **Costs:** §10.
7. **Phased migration:** §11 (production preserved, reversible per step).
8. **Spending + multi-task:** §7 (application-enforced, shared/atomic/fail-closed; multi-task via Supabase-backed stateless turns, no stickiness).

---

## 10. Cost at low / medium / high usage (planning figures; confirm at build time)

Sonnet-4.x ≈ $3/1M in, $15/1M out; ~$0.03–0.05/turn; ~$0.10–0.25 per completed multi-tool plan.

| Usage | Conversations/mo | ~Turns | Bedrock tokens | ECS (A/C) | AgentCore services (C add-on) | Runtime (B add-on) |
|---|---|---|---|---|---|---|
| Low | 1,000 | 4k | ~$120–200 | ~$30–70 | Evals/Memory ~$5–20 | microVM+NAT ~$80–150 |
| Medium | 5,000 | 20k | ~$600–1,000 | ~$70–150 | ~$30–80 | ~$250–500 |
| High | 20,000 | 80k | ~$2,400–4,000 | ~$150–400 | ~$100–250 | ~$800–1,800 |

Model tokens dominate at every tier and are host-independent; the $10/day breaker caps the token line. C adds only cheap consumption services; B adds warm-microVM + NAT for no token savings.

---

## 11. Phased plan (production preserved; reversible; pipelines untouched)

- **Phase 0 (0.5–1d):** audit `useEveAgent` SSE contract + `household_shop` card schema.
- **Phase 1 (3–4d):** lightweight ECS loop (`src/lib/agent/`) reusing tools; Supabase conversation/turn state; SSE route; card parity; behind `AGENT_RUNTIME` flag (default `eve`).
- **Phase 2 (2–3d):** shared/atomic Supabase safeguards (§7) + CloudWatch metrics + Budgets alerts.
- **Phase 3 (2–4d):** the §8 PoC on C-impl; wire AgentCore Evaluations; validate on 2 preview tasks, no stickiness.
- **Phase 4 (3–5d, optional/parallel):** B-impl (Runtime + Memory + Gateway) for the same PoC; compare on §8 metrics — evidence for if/when Runtime is worth it.
- **Phase 5 — cutover (flag-gated):** targeted `tofu apply` (website task def only); `AGENT_RUNTIME=lightweight`; restore `desired_count`/`autoscale_min`/`max` ≥2; confirm no-stickiness multi-task; keep Eve+single-task as instant rollback.
- **Later, demand-driven:** Memory (if it beats ours) → Gateway/Identity/Policy as features land → Runtime only if justified.

Collection pipelines never touched.

---

## 12. Sources (AWS official, paraphrased for licensing compliance)

- Services overview / multi-tenant: https://aws.amazon.com/blogs/machine-learning/building-multi-tenant-agents-with-amazon-bedrock-agentcore/
- Memory types / long-term: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-types.html ; short-term pricing: https://aws.amazon.com/about-aws/whats-new/2026/10/agentcore-memory-consumption-based-pricing/
- Gateway: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html
- Policy GA: https://aws.amazon.com/about-aws/whats-new/2026/03/policy-amazon-bedrock-agentcore-generally-available/
- Evaluations GA: https://aws.amazon.com/blogs/aws/amazon-bedrock-agentcore-adds-quality-evaluations-and-policy-controls-for-deploying-trusted-ai-agents/
- Observability (unified): https://aws.amazon.com/about-aws/whats-new/2026/07/amazon-bedrock-agentcore-unified-observability-single-log-group/
- Region support: https://docs.aws.amazon.com/general/latest/gr/bedrock_agentcore.html ; Runtime instances incl. Ireland: https://aws.amazon.com/about-aws/whats-new/2026/08/aws-bedrock-agentcore-runtime-instances-generally-available/
- Runtime sessions/isolation: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html
- Pricing: https://aws.amazon.com/bedrock/agentcore/pricing/

*Content from external sources was rephrased for compliance with licensing restrictions.*
