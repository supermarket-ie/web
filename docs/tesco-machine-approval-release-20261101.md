# Tesco automated machine approval — release and recovery

> **Superseded 1 November 2026.** The owner rejected the separate machine Auth
> account. Do not use the credentials or setup steps below. The replacement
> existing-SQL-bridge procedure is in
> `docs/tesco-operational-recovery-release-20261101.md`. The historical notes
> are retained as an audit record of the earlier proposal.

**Not deployed.** PR #286's human approval mechanism is installed; this
follow-up adds a separate, narrow Supabase Auth machine principal for the
owner-authorised automated evidence review. It does not modify canonical
products, holds, mappings or historical price observations.

## Existing evidence and queue

The existing AI-assisted review identified **93** independently supported held
unique-SKU mappings: 33 prospective three-retailer comparisons and 60 other
price opportunities. The durable input manifests are:

- `docs/tesco-hold-reentry-production-queue-20261101.jsonl` (89)
- `docs/tesco-hold-reentry-inference-addendum-20261101.jsonl` (4)

The machine approves **zero** products solely on a model verdict or similarity.
Before each signed approval the script checks the current database evidence
against the original AI-reviewed source page, page SHA-256, canonical product,
unique Tesco SKU, exact source identity, pack, variant and current retailer
equivalents. It calls the same independent exact-identity guard used at live
selection/finalisation. A mismatch stays uncertain and the campaign continues.
The model/source/decision/rationale and individual deterministic validation
result are retained in the immutable review record. Subsequent cohorts can be
added through evidence-reviewed manifests with this same contract.

## Authenticated service principal — no human impersonation

1. Through **Supabase Auth administration**, provision a dedicated account
   used only for Tesco identity approval (not a human reviewer). Give it
   server-controlled `app_metadata.tesco_reentry_machine_approver=true` and
   no `tesco_reentry_reviewer` claim. Do not provision through SQL inserts into
   `auth.users`, `user_metadata`, forged JWTs, or the collector SQL bridge.
2. Store its password and email in the supervised Work environment's restricted
   secret configuration as `TESCO_MACHINE_AUTH_EMAIL` and
   `TESCO_MACHINE_AUTH_PASSWORD`, together with the existing Supabase URL and
   publishable/anon API key. Never use the service-role key for approval.
   Rotate/revoke credentials when the campaign ends or if compromised.
3. Apply `20261101182500_tesco_machine_reentry_approvals.sql` through the
   approved production Supabase migration path. It adds a human/machine
   discriminator and a schema-validated AI evidence attestation; a single
   updated trigger takes the actor UUID and kind exclusively from a verified
   Supabase Auth JWT. RLS allows only a correctly privileged machine Auth
   principal to insert a machine approval. Existing human review records and
   their permissions are preserved; dual-role principals are rejected.
4. Test negative roles (anon, ordinary Auth, human-only Auth, service-role
   API, forged reviewer UUID/kind, user_metadata-only and dual privilege), and
   positive machine Auth insert. Confirm append-only trigger, RLS, ownership
   SELECT, 48-hour expiry, revocation, one-use ledger and changed snapshot
   rejection. All tests must be reversible without creating real approvals.

## Automatic evidence approval (after release validation)

Run under Node 24 with `npm ci` and the existing supervised SQL bridge:

```sh
node --import tsx scripts/tesco-machine-approve.ts --dry-run --limit 100
node --import tsx scripts/tesco-machine-approve.ts --confirm-approve --limit 100 --result-file tesco-machine-decisions.jsonl
```

These commands process the entire existing 93-product manifest (33 dual-peer
first). No individual human approval is requested. Read-only evidence queries
still go through the supervised bridge; only the narrow Supabase Auth-verified
Data API writes approval records. The script outputs actual approval UUIDs.
It fails closed on machine authentication/permission errors; it never switches
to a privileged SQL approval insert. An approval never itself finalises a price.
Additional AI-reviewed evidence manifests may be supplied with
`--candidate-file path/to/reviewed-candidates.jsonl` and an honest source
`--model` label; each additional row must still pass the same full current
source/mapping/peer check. This enables future held-catalogue cohorts without
changing code, SQL grants or collection tooling per product.

With live access healthy and no competing worker, use the existing supervised
collector with those review UUIDs in bounded expansion runs (≤100). It obtains
fresh Tesco pages and rechecks exact identity and snapshots under the same
lease, cooldown, shared-SKU, six-unresolved, circuit-breaker and one-use
transaction controls as PR #286. Reconcile each run before proceeding; then
return recovered identities to ordinary four-day supervised renewals.

## Access stop and measured coverage

The 1 November authorised renewal run
`406ac3c6-257f-45c1-8e6d-200d120f2e1f` completed **three requests**,
renewed **two** prices and stopped at the **network_error** safeguard with no
new pending requests. The original six pending remain. Do **not** restart
collection until current gate/cooldown/lease and the network access failure are
independently cleared by the normal approved preflight. Approvals can be
prepared separately, but their 48-hour expiry should be considered.

## Rollback

- Disable this machine Auth principal through admin control, revoke its
  sessions, and remove its server-controlled permission. Because existing JWTs
  can remain valid until expiry, remove the machine branch of the INSERT policy
  in a separately approved migration if an immediate database stop is needed.
- Stop new machine signing; append revocations to existing approvals if needed.
  Never delete the immutable review/use ledgers or alter historical holds.
- Pin the previous collector revision if a new collector regression arises.
  Reconcile any in-flight page reservations before changing ownership; never
  clear the six historical pending requests or an active cooldown.
- Retain existing trusted receipts; they continue through the normal guarded
  renewal lifecycle. AWS ECR/ECS web deployment is separate from this
  Supabase migration and the supervised ChatGPT Work collector.
