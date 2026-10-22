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

## 3. Pre-cutover (operator, ~24h ahead) — NON-destructive

1. **Lower TTLs** at Register365 so rollback is fast:
   - apex `supermarket.ie` A: TTL 86400 → **60**.
   - `www.supermarket.ie` CNAME: TTL → **60**.
   Wait for the OLD TTL to expire (apex up to 24h) before cutover so resolvers
   pick up the short TTL.
2. **Confirm the apex mechanism** (Section 2). If Option A, tell me to provision
   Global Accelerator (billable — I will ask for explicit approval) and I will
   give you the two static IPs for the apex A records.

Nothing in this step moves traffic.

## 4. Cutover window — WWW (operator DNS + agent verification)

Order matters: TLS is already valid for www on the ALB, so there is no cert gap.

1. **Operator:** at Register365, repoint
   `www.supermarket.ie` CNAME → `smie-prod-alb-48303444.eu-west-1.elb.amazonaws.com`.
   (Replaces the Vercel CNAME target.)
2. **Agent/operator verify** as it propagates:
   - `dig +short www.supermarket.ie CNAME` → the ALB name.
   - `curl -sI https://www.supermarket.ie/` → 200, valid TLS (no `--resolve`).
   - homepage, `/shop`, `/api/products`, Eve `/eve/v1/info` all 200.
3. **Agent:** flip the app to production posture — set `test_mode=false` in
   `infra/terraform/terraform.tfvars`, `tofu apply`. This sets
   `APP_ENV=production`, `SUPABASE_READ_ONLY=false` (enables writes + transactional
   email). Retailer collection, workers and scheduled jobs REMAIN disabled
   (`enable_workers=false`, `enable_retailer_workers_on_aws=false`,
   `enable_outbound_email_on_aws=false`, `DISABLE_RETAILER_COLLECTION` stays true)
   so there is no duplicate execution against the still-live Vercel workers.
4. **Agent/operator verify** real journeys in production posture on www: a sign-in
   with an existing session, a subscribe/contact write, an Eve conversation,
   SEO (`www` now indexable — canonical = www, no `noindex`).

Rollback (www): set `www` CNAME back to `e2ae0df6f59fc39f.vercel-dns-017.com`.
Because TTL is 60s, recovery is ~1 min. Optionally revert `test_mode=true`.

## 5. Cutover window — APEX (only after the Section 2 mechanism is chosen)

Because the apex cert `a2cf0cf8` is already staged on the listener and the ALB
apex→www 301 rule is live, the apex serves valid TLS and redirects to www the
instant it resolves to the ALB — zero TLS gap.

1. **Operator:** add apex CAA so both issuers used are authorised (keeps future
   renewals working):
   ```
   supermarket.ie.  CAA  0 issue "amazonaws.com"
   supermarket.ie.  CAA  0 issue "letsencrypt.org"
   ```
2. **Operator:** repoint the apex per the chosen mechanism:
   - Option A: apex `supermarket.ie` A → the two Global Accelerator static IPs.
   - Option B: switch registrar nameservers to Route 53; apex ALIAS → ALB.
   - Option C: skip — apex stays on Vercel.
3. **Agent/operator verify:**
   - `curl -sI https://supermarket.ie/` → 301 → `https://www.supermarket.ie/`,
     valid TLS.
   - `curl -sI https://www.supermarket.ie/` → still 200.

Rollback (apex): restore apex A → `216.198.79.1` (Option A) or restore the
previous registrar nameservers (Option B). TTL 60s → ~1 min recovery.

## 6. Post-cutover

- Watch ECS service events + CloudWatch `/ecs/smie-prod` for errors; confirm 2/2
  tasks healthy and autoscaling steady.
- Keep Vercel deployment untouched for at least 24–48h as the rollback path.
- Remove the `_acme-challenge.www` TXT record at Register365 (no longer needed;
  the cert is issued). Keeping it is harmless.
- Let's Encrypt `www` cert expires **2027-01-20**. It is NOT auto-renewing (manual
  DNS-01). Set a reminder to re-issue + re-import ~30 days before, OR once `www`
  points at the ALB, migrate www to an ACM-managed cert (ACM can now validate www
  because it no longer resolves through Vercel's CAA) and swap the listener SNI
  cert — removing the manual-renewal burden.
- Do NOT merge PR #265 or enable workers/collection/email as part of this
  cutover; those are separate, independently-approved steps.

## 7. Quick command reference (verification; no mutations)

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
