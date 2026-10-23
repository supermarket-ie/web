# AWS production cutover runbook — supermarket.ie

Last updated: 22 October 2026.

Goal: serve the production domain from AWS ECS Fargate (behind the ALB
`smie-prod-alb-48303444.eu-west-1.elb.amazonaws.com`) with valid HTTPS and no
TLS/downtime gap, while keeping Vercel live for instant rollback. Retailer
collection, background workers, scheduled jobs and (until the flip) writes stay
disabled.

This runbook is the source of truth for the DNS cutover. All AWS cert/listener
preparation described here is already DONE and verified against the ALB via
`curl --resolve` (no production DNS was changed). What remains is operator-driven
DNS changes plus flipping `test_mode` — each called out below and gated on your
explicit approval.

---

## 0. Current state (verified)

TLS staged on the ALB HTTPS listener (SNI), all ISSUED:

| Cert ARN (short) | Hostname | Issuer | Role |
|---|---|---|---|
| `cca36c0b` | aws-preview.supermarket.ie | Amazon (ACM) | listener default |
| `a2cf0cf8` | supermarket.ie (apex) | Amazon (ACM) | SNI |
| `a6079f96` | www.supermarket.ie | Let's Encrypt | SNI |

Verified against the ALB (forced resolve, not production DNS):
- `www.supermarket.ie` → HTTP/2 200, `ssl_verify_result=0`, canonical = www.
- `supermarket.ie/<path>?<q>` → 301 → `https://www.supermarket.ie/<path>?<q>`.
- `aws-preview.supermarket.ie` → 200 (unchanged).

App: image `14d960e-prod`, 2/2 ECS tasks healthy, both ALB targets healthy.
Posture now = READ-ONLY (`APP_ENV=preview`, `SUPABASE_READ_ONLY=true`,
`DISABLE_RETAILER_COLLECTION=true`, `DISABLE_OUTBOUND_EMAIL=true`, all
`*_WORKER_ENABLED=false`).

## 1. Current production DNS — ROLLBACK BASELINE

Record these exactly; they are the rollback targets.

```
apex  supermarket.ie       A      216.198.79.1                          TTL 86400
www   www.supermarket.ie   CNAME  e2ae0df6f59fc39f.vercel-dns-017.com   TTL ~34000
apex  supermarket.ie       CAA    (none — unrestricted)
```

Vercel is the current host for both apex and www. `216.198.79.1` is a Vercel
stable anycast IP.

## 2. The apex constraint (decide the mechanism BEFORE apex cutover)

Register365 uses plain DNS; the apex is a plain **A record**. An AWS ALB has **no
static IP** (its IPs rotate), so you must NOT point the apex A record at raw ALB
IPs. No Route 53 zone and no Global Accelerator exist yet. Choose one:

- **Option A — Global Accelerator (recommended if staying on Register365).** Put
  a Global Accelerator in front of the ALB; it provides two static anycast IPs.
  Apex A records point to those. ~\$18/mo + data transfer. Smallest DNS change,
  keeps Register365 as the DNS host, fast rollback. Requires a billable AWS
  resource (needs your approval before I provision it).
- **Option B — Route 53.** Migrate the `supermarket.ie` zone to Route 53 and use
  an apex ALIAS → ALB (free, auto-tracks ALB IPs). Changes the authoritative
  nameservers at the registrar — larger change, slower to roll back.
- **Option C — leave apex on Vercel.** Move only `www` to AWS now; apex keeps its
  current Vercel A record (Vercel continues apex→www 301). Zero apex risk; defer
  the apex decision. The ALB already has its own apex→www redirect staged for
  whenever apex does move.

The **www cutover does not depend on this** — www is a CNAME and can move to the
ALB immediately with valid TLS already staged.

Chosen mechanism: **Option A — Global Accelerator** (keeps Register365 as DNS
host; apex A records point at two static anycast IPs). Provisioned by the
`enable_global_accelerator=true` toggle (billable; see Section 7 cost).

### Corrected sequencing principle (IMPORTANT)

Full customer-facing production posture is configured and verified on AWS
**BEFORE** any production DNS change — NOT after. A previous draft moved www DNS
first, which would have sent live customers to a read-only app with suppressed
auth email. The correct order is: configure prod posture → verify via
`--resolve` → provision/verify Global Accelerator → lower TTLs → flip DNS.

## 3. Configure AWS for full production operation (agent) — BEFORE any DNS change

The service is only reachable via `--resolve`/the ALB name at this point, so this
is safe to do ahead of cutover with no customer impact.

Set in `infra/terraform/terraform.tfvars`, then `tofu apply`:
- `test_mode = false` → `APP_ENV=production`, `SUPABASE_READ_ONLY=false`
  (read-write Supabase; writes enabled for auth/registration/shop/Eve).
- `enable_outbound_email_on_aws = true` → `DISABLE_OUTBOUND_EMAIL=false`
  (transactional magic-link + registration-verification email WORK). This is the
  corrected flag — launching with it false silently suppresses all auth email.
- `public_base_url = "https://www.supermarket.ie"` (production canonical base URL
  the app advertises; image `14d960e-prod` already bakes the www canonical).

KEEP DISABLED (Vercel keeps running these; no duplicate execution on AWS):
- `enable_workers = false`, `worker_desired_count = 0` (no SQS consumer).
- `enable_retailer_workers_on_aws = false` → `DISABLE_RETAILER_COLLECTION=true`,
  all `*_WORKER_ENABLED=false` (no retailer collection, no scheduled jobs).
- `QUEUE_BACKEND` stays `vercel`.

Note on duplication: transactional email is triggered only by a user hitting the
host that serves them; once www is on AWS, Vercel no longer serves those users,
so there is no double-send. Scheduled/notification email is never *triggered* on
AWS (no cron runner, consumers off), so enabling outbound email does not cause
duplicate scheduled sends.

Verify (via `--resolve www.supermarket.ie:443:<ALB_IP>`), no DNS change:
- Task def shows `APP_ENV=production`, `SUPABASE_READ_ONLY=false`,
  `DISABLE_OUTBOUND_EMAIL=false`, `DISABLE_RETAILER_COLLECTION=true`; 2/2 healthy.
- `/`, `/shop`, `/api/products`, Eve `/eve/v1/info` → 200; canonical = www; `www`
  host no longer `noindex`.
- A sign-in / registration email send path reaches Resend (confirm via app
  response + Resend dashboard / a single controlled address). Retailer worker
  route still refuses. Avoid creating unnecessary test data.

## 4. Provision + verify Global Accelerator (agent) — BEFORE any DNS change

1. Set `enable_global_accelerator = true`, `tofu apply`. Record the two static
   IPs from the `global_accelerator_static_ips` output.
2. Verify against the static IPs (still no production DNS change):
   - `curl -sI --resolve www.supermarket.ie:443:<GA_IP> https://www.supermarket.ie/`
     → 200, valid TLS.
   - `curl -s -D - -o /dev/null --resolve supermarket.ie:443:<GA_IP> https://supermarket.ie/`
     → 301 → `https://www.supermarket.ie/`, valid TLS.
   Both GA IPs must pass. The accelerator's endpoint group health check against
   the ALB must read HEALTHY.

## 5. Lower TTLs (operator, ~24h ahead) — NON-destructive

At Register365, preserving the existing rollback targets:
- apex `supermarket.ie` A: TTL 86400 → **60** (value stays `216.198.79.1` for now).
- `www.supermarket.ie` CNAME: TTL → **60** (target stays the Vercel CNAME for now).
Wait for the OLD apex TTL (up to 24h) to expire so resolvers adopt the short TTL.
No traffic moves in this step.

## 6. DNS cutover (operator DNS + agent verify) — the only traffic-moving step

Only after Sections 3–5 are done and you give explicit approval. Do www and apex
together or www-first; both have valid TLS pre-staged so there is no cert gap.

Operator changes at Register365 (exact values in Section 8):
1. Add apex CAA: `0 issue "amazonaws.com"` and `0 issue "letsencrypt.org"`.
2. apex `supermarket.ie` A → the two Global Accelerator static IPs (replaces
   `216.198.79.1`).
3. `www.supermarket.ie` CNAME →
   `smie-prod-alb-48303444.eu-west-1.elb.amazonaws.com` (replaces the Vercel
   target).

Agent/operator verify as it propagates (no `--resolve`):
- `dig +short www.supermarket.ie CNAME` → the ALB name; `dig +short supermarket.ie A`
  → the GA IPs.
- `curl -sI https://www.supermarket.ie/` → 200, valid TLS.
- `curl -sI https://supermarket.ie/` → 301 → `https://www.supermarket.ie/`.
- Real journeys: sign-in, registration (auth email now delivered), shop, Eve.

Rollback (TTL 60s → ~1 min):
- `www` CNAME → `e2ae0df6f59fc39f.vercel-dns-017.com`.
- apex A → `216.198.79.1`.
- (CAA additions are harmless; leave them.)
Vercel stays live and untouched throughout, so rollback is a pure DNS revert.

## 7. Global Accelerator cost

Billable while provisioned (whether enabled or not):
- Fixed accelerator fee: $0.025/hour ≈ **$18/mo**.
- Two static IPv4 addresses: $0.005/IP/hour ≈ **$7.30/mo**.
- DT-Premium data surcharge: a few $/mo at current traffic.
≈ **$25/mo fixed** + small per-GB. Provisioned only on explicit cost approval.

## 8. Post-cutover

- Watch ECS service events + CloudWatch `/ecs/smie-prod` for errors; confirm 2/2
  tasks healthy and autoscaling steady.
- Keep Vercel deployment untouched for at least 24–48h as the rollback path.
- Remove the `_acme-challenge.www` TXT record at Register365 (no longer needed;
  the cert is issued). Keeping it is harmless.
- **Replace the Let's Encrypt www cert with an ACM-managed cert (REQUIRED
  follow-up).** The imported LE cert expires **2027-01-20** and does NOT
  auto-renew. Once `www` resolves to the ALB (no longer through Vercel's CAA),
  ACM can validate `www` via DNS. Request an ACM cert for `www.supermarket.ie`
  (DNS validation), add the ACM CNAME at Register365, wait ISSUED, then swap the
  listener SNI cert from `a6079f96` (LE) to the new ACM ARN in
  `additional_certificate_arns` and remove the LE one. ACM then auto-renews —
  removing the manual-renewal burden. Do this soon after cutover, well before
  the Jan expiry.
- Do NOT merge PR #265 or enable workers/collection/email as part of this
  cutover; those are separate, independently-approved steps.

## 9. Remaining Vercel dependencies (platform NOT yet fully independent)

The website + Eve run on AWS, but these Vercel-hosted functions remain and MUST
be migrated before declaring full independence:
- **Vercel Cron** — scheduled jobs (retailer collection triggers, price
  finalisation, scheduled notifications). AWS replacement exists in-branch
  (EventBridge Scheduler → ECS tasks) but is provisioned DISABLED.
- **Vercel Queues** — background job delivery. AWS replacement exists (SQS +
  consumer service) but desired_count=0 and `enable_workers=false`.
Migrating these is the next priority after cutover: enable the AWS worker stack
AND disable the Vercel workers in the same controlled change to avoid duplicate
execution.

## 10. Quick command reference (verification; no mutations)

```bash
ALBIP=$(dig +short smie-prod-alb-48303444.eu-west-1.elb.amazonaws.com | head -1)
# www TLS + HTTP via ALB (pre-cutover, forced resolve)
curl -s -o /dev/null -w "www http=%{http_code} verify=%{ssl_verify_result}\n" \
  --resolve www.supermarket.ie:443:$ALBIP https://www.supermarket.ie/
# apex 301 via ALB
curl -s -D - -o /dev/null \
  --resolve supermarket.ie:443:$ALBIP https://supermarket.ie/shop | grep -iE '^HTTP|^location'
# which SNI cert the ALB serves for a host
echo | openssl s_client -connect $ALBIP:443 -servername www.supermarket.ie 2>/dev/null \
  | openssl x509 -noout -subject -issuer
```
