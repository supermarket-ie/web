# AWS migration — Phase 2: containerisation & local verification

Branch: `infra/aws-migration`. No AWS resources provisioned. No production
infrastructure, DNS, Supabase data, scrapers, schedules, or email touched.

## 1. What was done

- Authored `Dockerfile`, `.dockerignore`, `docker-entrypoint.sh`, and
  `.env.aws-preview.example` (variable names only).
- Verified the real build command `eve build && next build` succeeds on Node 24.
- Verified the built app starts and serves HTTP, including the Eve agent mount.

## 2. Key finding — the app is TWO processes off Vercel

`eve build` produces a standalone Eve agent server (a Nitro `node-server` under
`.output/`). On Vercel, `withEve` lets Vercel serve the agent. **Off Vercel**,
`withEve` (in `next.config.ts`) rewrites `/eve/v1/*` to a **separate Eve HTTP
process** at `http://127.0.0.1:<EVE_NEXT_PRODUCTION_PORT>` (default **4274**),
or to `EVE_NEXT_PRODUCTION_ORIGIN` if set.

Consequences for every non-Vercel deployment:

1. The container must run **both** `eve start` (port 4274) and `next start`
   (port 3000). `docker-entrypoint.sh` does this and stops the container if
   either child dies.
2. **The proxy target port is baked into `.next` at build time** (it appears in
   `routes-manifest.json` / `required-server-files.json`). So
   `EVE_NEXT_PRODUCTION_PORT` **must be identical at build time and run time**.
   The Dockerfile keeps both at the 4274 default. If you change it, change it in
   both the builder `ENV` and the runner `ENV`.

This refines the Phase 1 assessment, which described Eve as purely "in-process".
It ships in one image, but runs as two cooperating processes.

## 3. Build verification results

Command run (locally, Node v25.8.0; target runtime is Node 24):

```
CI=true <placeholder env> npm run build
```

Results:
- `eve build` ✅ — emitted the Nitro agent server to `.output/` (~9 MB bundle).
- `next build` ✅ — "Compiled successfully", TypeScript passed, all routes
  prerendered (static + SSG `generateStaticParams` + dynamic), `BUILD_ID`
  produced. Next 16.1.6 with Turbopack.

Important build detail — **database at build time**:
- The app has an escape hatch in `src/lib/product-catalogue-data.ts`:
  when `CI=true` **and** `NEXT_PUBLIC_SUPABASE_URL === https://example.supabase.co`,
  the product catalogue returns empty, so prerendering needs no database.
- Without that, SSG pages (e.g. `/shop/[category]`) try to fetch from Supabase
  at build and fail if the DB is unreachable (observed: `TypeError: fetch failed`
  → "Product catalogue unavailable" → build abort). This mirrors the repo's own
  CI, which builds with the same placeholder.
- The Dockerfile sets `CI=true` + the placeholder URL at build time, so the
  image builds offline with **zero database access**. Real values are injected
  at **runtime** only.

The placeholder build env matches `.github/workflows/ci.yml` exactly; the values
are non-secret and are never used to reach a real service.

## 4. Runtime verification results

Started via `docker-entrypoint.sh` (Eve on 4274, Next on 3000-equivalent) with
placeholder env and an unreachable Supabase URL (so no production side effects):

| Endpoint | Result | Meaning |
| --- | --- | --- |
| `GET /` | **200** (real homepage, correct `<title>`) | Web tier serves |
| `GET /terms` | **200** | Static page serves |
| `GET /eve/v1/info` (via Next → Eve proxy) | **200**, real agent JSON | Two-process wiring works |
| `GET /api/products` | **503** | Correct graceful degradation with no DB (DependencyUnavailableError), not a crash |

Observed non-blocking warning at boot:
`[QueueClient] Region not detected — defaulting to "iad1"`. The `@vercel/queue`
client instantiates at startup. Harmless in preview (no messages are sent), but
confirms the queue layer loads — it is replaced in a later phase.

## 5. Reproducible local build & run

> Requires a container runtime (Docker/Podman). This machine had none installed,
> so the image build itself was not executed here; the underlying
> `eve build && next build` and the two-process entrypoint were verified directly
> with Node. Running `docker build` on any machine with Docker reproduces it.

Build the image:
```
docker build -t supermarket-ie:preview .
```

Run it (inject real/isolated values at runtime; NEVER the prod service-role key):
```
docker run --rm -p 3000:3000 \
  -e CI=false \
  -e NEXT_PUBLIC_SUPABASE_URL=... \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  -e SUPABASE_SERVICE_ROLE_KEY=...   # preview: RESTRICTED/READ-ONLY key \
  -e MAGIC_LINK_SECRET=... -e VENDOR_MAGIC_LINK_SECRET=... \
  -e CRON_SECRET=... -e REVALIDATE_SECRET=... \
  -e RESEND_API_KEY=... -e ANTHROPIC_API_KEY=... \
  -e NEXT_PUBLIC_SITE_URL=https://<preview-url> \
  -e NEXT_PUBLIC_BASE_URL=https://<preview-url> \
  -e APP_ENV=preview \
  supermarket-ie:preview
```
Then: `curl -i http://localhost:3000/` and `curl -i http://localhost:3000/eve/v1/info`.

Verify the toolchain without Docker (what was done here):
```
npm ci
CI=true NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x \
RESEND_API_KEY=x MAGIC_LINK_SECRET=x VENDOR_MAGIC_LINK_SECRET=x \
CRON_SECRET=x REVALIDATE_SECRET=x ANTHROPIC_API_KEY=x \
NEXT_PUBLIC_SITE_URL=http://localhost:3000 NEXT_PUBLIC_BASE_URL=http://localhost:3000 \
npm run build
# then start both processes:
sh docker-entrypoint.sh   # with the same env exported
```

## 6. Hosting decision — App Runner vs ECS Fargate

| Factor | App Runner | ECS Fargate |
| --- | --- | --- |
| Setup effort | Lowest (managed URL, TLS, autoscale) | Higher (ALB, TG, SG, task def) |
| HTTPS preview URL | Built-in `*.awsapprunner.com` | Needs ALB + ACM (+ CloudFront) |
| Two processes in one container | Fine (single container, one entrypoint) | Fine |
| Outbound static IP (Tesco egress) | Hard — no clean NAT/EIP control | Native via subnet NAT Gateway + EIP |
| SQS consumer / long workers | Awkward (request-driven) | Natural (standalone service/task) |
| Scheduled jobs | External trigger needed | EventBridge → service, standard |
| Cost at idle (preview) | Low; can scale compute to 0 while idle | ~always-on task + ALB |
| Rework toward production | Likely migrate to Fargate for egress/workers | None — same platform scales up |

**Recommendation: use ECS Fargate for the preview.** App Runner is faster to a
URL, but the production design needs controllable **outbound static egress** for
Tesco (NAT Gateway + Elastic IP) and standalone **SQS consumer/worker** tasks —
neither fits App Runner cleanly. Starting on Fargate avoids re-platforming later,
which is exactly the "no unnecessary rework" goal. The web container itself is
identical on both, so this decision is reversible.

For the **fastest** first URL we can optionally run the single web task **without
CloudFront** initially (ALB DNS over HTTPS via ACM), then add CloudFront when
needed. Preview uses the **AWS-generated hostname** — no production DNS changes.

## 7. Recommended preview architecture (unchanged from Phase 1, refined)

```
Client ──HTTPS──> ALB (ACM cert, eu-west-1)
                    │
            ECS Fargate service (1 task, awsvpc)
            └─ one container, docker-entrypoint.sh:
                 ├─ Eve agent server  (127.0.0.1:4274)
                 └─ next start         (0.0.0.0:3000)  ← ALB target
            env from SSM Parameter Store / Secrets Manager
            │
            ├─ Supabase  (external; RESTRICTED read-only key)
            ├─ Anthropic (external; agent)
            └─ Resend    (external; email NOT scheduled in preview)

Deferred to production phase (NOT in preview):
  SQS (6 queues) + consumer service, EventBridge Scheduler (cron),
  NAT Gateway + EIP (Tesco egress), shared ISR cache (S3/Redis) for >1 task.
```

Image → **ECR**. Logs → **CloudWatch**. Preview URL = ALB hostname (no prod DNS).

## 8. Updated cost estimate (preview, eu-west-1, rough monthly)

| Item | Assumption | Est. (USD/mo) |
| --- | --- | --- |
| Fargate task | 1× 0.5 vCPU / 1 GB, always-on | ~$18 |
| ALB | 1 ALB, low LCU | ~$18–22 |
| ECR | 1 repo, few images | ~$1 |
| CloudWatch Logs | low volume | ~$2–5 |
| SSM / Secrets Manager | handful of params | ~$0–2 |
| Data transfer | low preview traffic | ~$1–3 |
| **Preview total** | single task, no CloudFront, no NAT | **~$40–50** |

Note: 1 GB may be tight for `next start` + Eve under load; if OOM appears, move
to 1 vCPU / 2 GB (~$35 compute). Production adds SQS (cents at this volume),
EventBridge (negligible), and the main step-up: **NAT Gateway ~$32/mo + data**
for Tesco egress — kept out of the preview. App Runner alternative would be
roughly ~$5–30/mo depending on idle scaling, but is not recommended per §6.
These are planning figures; confirm with the AWS Pricing Calculator.

## 9. Required configuration & secret names (no values)

See `.env.aws-preview.example`. Summary:
- Core: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (preview = restricted/read-only),
  `MAGIC_LINK_SECRET`, `VENDOR_MAGIC_LINK_SECRET`, `CRON_SECRET`,
  `REVALIDATE_SECRET`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_URL`.
- Integrations: `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `SCRAPINGBEE_API_KEY`
  (leave unset), `GOOGLE_ANALYTICS_CREDENTIALS_JSON`, `GOOGLE_ANALYTICS_PROPERTY_ID`.
- Platform: `APP_ENV` (replaces `VERCEL_ENV`), `EVE_NEXT_PRODUCTION_PORT`.
- Safeguard flags (keep off): `TESCO_VERCEL_WORKER_ENABLED`,
  `DUNNES_VERCEL_WORKER_ENABLED`, `SUPERVALU_VERCEL_WORKER_ENABLED` and their
  `*_RUN_LIMIT` / `*_BATCH_SIZE` / `*_STAGGER` tuning vars.

## 10. Unresolved blockers / follow-ups before deploying the preview

1. **Isolated Supabase credential.** Need a restricted read-only key, or a
   Supabase branch/clone, for the preview. Until then, local verification used
   placeholders/empty-catalogue only. This is the top prerequisite.
2. **`VERCEL_ENV` → `APP_ENV` code change.** Two files read `VERCEL_ENV`
   (`src/app/page.tsx`, `src/app/preview/guest-shop/page.tsx`). A tiny change to
   read `APP_ENV` (falling back to `VERCEL_ENV`) is needed so preview gating
   works off Vercel. Not yet made (kept this phase code-free beyond infra files).
3. **Docker build not executed here** (no container runtime on this machine).
   The build command and entrypoint were proven directly with Node; run
   `docker build` in CI or on a Docker-capable machine to produce the image.
4. **Memory sizing** for the 2-process container under real traffic — validate
   0.5 vCPU/1 GB vs 1 vCPU/2 GB on first deploy.
5. **ISR shared cache** — only needed when scaling past 1 task; preview stays
   single-task to avoid it.

## 11. Exact next steps to deploy the isolated AWS preview (Phase 3)

1. Provision an **isolated Supabase** access path (read-only key or branch) and
   store secrets in **SSM/Secrets Manager** in `Supermarket-Prod`, `eu-west-1`.
2. Make the small `APP_ENV` code change (item 10.2) on this branch.
3. Create an **ECR** repo; `docker build` + push the image (via CI).
4. Create an **ECS Fargate** cluster + service (1 task, awsvpc), task role with
   read-only access to the chosen secrets; container port 3000.
5. Create an **ALB** + target group (HTTP 3000, health check `/terms`) and an
   **ACM** cert; expose over HTTPS on the **AWS-generated ALB hostname**.
6. Inject env from Secrets Manager; keep all `*_WORKER_ENABLED` off; create **no**
   EventBridge schedules; leave the Tesco egress pool empty.
7. Smoke test on the ALB URL: `/` 200, `/terms` 200, `/eve/v1/info` 200,
   `/api/*` behaves against the read-only DB. No DNS, email, or scraper actions.

Stop and report before provisioning (per the Phase 2 instruction).
