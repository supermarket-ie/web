# Tesco mapping-recovery plan — recover hundreds of trusted prices by repairing/discovering mappings

Written 30 October 2026. A quantified, implementable plan to grow Tesco trusted
coverage beyond the current 323 by REPAIRING and DISCOVERING correct Tesco
mappings — not by more supervised expansion runs or circuit-breaker tweaks.
Read-only investigation; nothing changed. All figures from uncapped prod reads.

Hard invariants (unchanged, enforced by existing code): never auto-overwrite a
canonical identity, never clear historical holds, never retry unknown-outcome
(pending) requests, never accept a price without exact identity verification. The
existing 323 are protected by the separate supervised renewal process.

## 1. The backlog, quantified (2,461 Tesco mappings; 1 canonical product each)

State of every Tesco mapping (distinct canonical products; 685 of the 2,461 share
a SKU with another canonical = duplicate mappings):

| State | Count | Meaning |
| --- | --- | --- |
| A. Fresh trusted | **323** | current coverage (protected by renewal) |
| C. Unproven, never succeeded | **870** | `url_status='resolved'` but no success receipt — never collected a trusted price |
| G. Held on an identity reason | **813** | fetched, identity-rejected, parked by the `held` predicate |
| F. Shared-SKU deferred | **313** | SKU mapped by >1 canonical; campaign defers them |
| B. URL failed | **81** (80 audit-invalidated) | mapping invalidated by the 2026-09-20 risk audit |
| H. Eligible, never attempted | **45** | pass all gates, simply not yet fetched |
| I. Eligible, other | **12** | eligible, benign prior skip |
| E. Pending (unknown outcome) | **4** | preserve; never retry |

Unique canonical products vs duplicate mappings vs previously-attempted URLs:
2,461 unique canonical products; 685 duplicate (shared-SKU) mappings; ~813 URLs
previously attempted and identity-rejected + 4 pending + 80 audit-invalidated.

## 2. Recoverability categories (the 813 held, by dominant identity reason)

| Bucket | Held | …with ≥1 fresh peer | …with BOTH peers (→ triples) | Recovery route |
| --- | --- | --- | --- | --- |
| canonical_metadata_ambiguous | 318 | 160 | 37 | **canonical-name enrichment** (if mapping correct) OR rediscovery (if wrong) |
| wrong_pack_or_quantity | 311 | 210 | 71 | **rediscover correct SKU** (size/pack differs) |
| brand_or_ownlabel | 54 | 42 | 9 | rediscover correct SKU |
| wrong_variant_or_formulation | 39 | 25 | 8 | rediscover correct SKU |
| unavailable_or_no_regular_price (`other`) | 62 | 41 | 10 | NOT mapping-recoverable — out of stock / no regular price at Tesco; retry later via renewal |
| missing_or_absent | 12 | 12 | 4 | rediscover (SKU absent from live page) |
| transport_or_unknown | 17 | 12 | 4 | preserve; not an identity problem |

Key split within canonical_metadata_ambiguous (the Heinz-type reason "candidate
does not establish full exact canonical identity"): inspection of the 37 with
both peers shows TWO sub-types — (a) the stored canonical name is too
generic/underspecified while the Tesco mapping is actually CORRECT ("Broccoli" →
live "Tesco Family Pack Broccoli"; "Cucumber" → "Tesco Whole Cucumber Each 350g";
"Courgette" → "Tesco Loose Courgettes"); and (b) a genuine mismatch ("Cheddar
Cheese Block" → live "Applewood Smoked Cheddar"; "Frozen Chips" → "Strong Roots
Proper Chips"). Sub-type (a) is unblocked by a reviewed CANONICAL-NAME enrichment
(never a Tesco-mapping change); sub-type (b) needs rediscovery.

## 3. Highest commercial value: held canonicals that already have fresh peers

Restoring a held Tesco price only builds a 2-/3-retailer comparison if the
canonical already has a fresh Dunnes/SuperValu price. Across all recoverable
buckets: **~460 held canonicals have ≥1 fresh peer**, and **~130 have BOTH**
(would become genuine three-retailer triples). The richest single pool is
`wrong_pack_or_quantity` (210 with a peer, 71 with both) followed by
`canonical_metadata_ambiguous` (160 / 37). Prioritise these over the 870 unproven
(many have no peer and build no comparison).

## 4. Existing capabilities to REUSE (do not rebuild)

The system already contains a near-complete supervised mapping-recovery pipeline;
the gap is that discovery is hard-wired to one historical audit batch.

- **Candidate discovery (search, not URL):** `tesco-candidate-discovery.ts`
  (`selectAuditedTescoDiscoveryProducts`, `createTescoCandidateDiscoveryRun`),
  Pepesto single-query search (`pepesto-tesco.ts`), the
  `pepesto-tesco-candidate-discovery` + `pepesto-tesco-retrieve` workers, and the
  `tesco_candidate_discovery_evidence` table. Already proposes AND applies a
  corrected SKU/URL — but ONLY for rows carrying the
  `tesco_mapping_audit:` invalidation marker.
- **Independent identity verification:** `classifyTescoReplacement` (new
  candidate vs canonical — the exact gate), `classifyTescoMapping`,
  `hasMaterialDuplicateCanonicalConflict`, `validateTescoCollectedIdentity`,
  `classifyIdentityOutcome`. Pure, deterministic, already used by both pipelines.
- **Guarded correction mechanic:** `finalize_tesco_candidate_discovery` RPC
  updates `store_products.store_sku/store_url/...` ONLY when the row is
  audit-invalidated (`url_status='failed' and url_last_error like
  'tesco_mapping_audit:%'`), requires exactly ONE distinct exact candidate, writes
  a `retailer_mapping_audit_decisions` trail (`restore_exact_replacement`), and a
  `price_observations` row. This is the approved, reviewable correction pattern.
- **Acquisition handoff / price_verification:** `tesco-acquisition-handoff.ts` +
  the collector's `--acquisition-pages` path verify a discovered page's identity
  on a FRESH live fetch under lock before finalising a trusted price.
- **Backlog accounting:** `countEligibleCandidates`, `listExcludedSharedSkuGroups`.

Gaps: discovery cohort is hard-wired to `tesco-risk-audit-2026-09-20-v1`; there is
NO general route that corrects an arbitrary mapping's SKU/URL (only the
audit-gated RPC + one-off migrations); no canonical-name enrichment path; no
cross-candidate conflict ledger beyond "exactly one distinct exact candidate".

## 5. The supervised mapping-recovery workflow (reuses the above)

Five stages, each supervised, each fail-closed, no new collection method:

1. **Cohort selection (generalise, don't rebuild).** Generalise
   `selectAuditedTescoDiscoveryProducts` to accept a cohort beyond the single
   audit batch: the 813 held + 80 audit-invalidated + 870 unproven, each tagged
   with its dominant reason bucket and peer-overlap, prioritised by
   BOTH-peers → ≥1-peer → demand. Read-only; no mapping change.
2. **Candidate discovery.** For each selected product, one Pepesto search keyed on
   the canonical name (existing single-query canary). Persist every candidate to
   `tesco_candidate_discovery_evidence` with its deterministic
   `classifyTescoReplacement` classification. No URL re-fetch of the known-wrong
   mapping.
3. **Independent identity verification + conflict detection.** Accept a candidate
   only when `classification='exact_replacement_candidate'` AND exactly ONE
   distinct exact SKU (existing rule) AND no material duplicate-canonical
   conflict. Anything ambiguous/mismatched/multi-candidate → HELD for review, never
   applied. (Extend the single-batch guard to the generalised cohort via the same
   invalidation marker so the RPC's guard still holds.)
4. **Approved mapping correction.** Apply via the existing guarded
   `finalize_tesco_candidate_discovery` RPC (SKU/URL/name/url_status + audit trail
   + price). Canonical identities are NEVER overwritten; only the Tesco
   `store_products` retailer mapping is corrected, and only from `failed`+audited
   state. Canonical-name enrichment (sub-type 2a) is a SEPARATE, explicitly
   reviewed `products.canonical_name` change proposal — never automatic, never
   part of collection.
5. **Trusted price collection.** Corrected mappings re-enter the normal supervised
   collector / acquisition handoff, which re-verifies identity on a fresh live
   fetch before writing a trusted price (unchanged safeguards, renewal protects it
   thereafter).

## 6. Realistic recovery by route + required changes

| Route | Addressable | Realistic yield | Code/ops change |
| --- | --- | --- | --- |
| H+I eligible, never attempted | 57 | ~45–50 prices now | NONE — run the existing supervised expansion/renewal over them |
| Canonical-name enrichment (sub-type 2a of metadata_ambiguous) | ~150–200 of 318 | ~100–150 prices, ~37 new triples | Reviewed `products.canonical_name` enrichment proposal doc + guarded SQL (same pattern as the 26-row audit); then normal collection |
| Generalised discovery (wrong_pack/variant/brand/missing + metadata sub-type 2b) | ~700 held + 63 audit-invalidated not yet tried | historically ~10 exact / ~36 attempted ≈ 25–30% exact-candidate rate → ~150–200 corrected over time | Generalise `selectAuditedTescoDiscoveryProducts` cohort + extend the RPC guard to the new audit batch; Pepesto credits |
| Unproven, never succeeded | 870 | low per-unit (many no peer); fold into discovery by peer-priority | same as discovery |
| unavailable_or_no_regular_price | 62 | 0 by mapping repair | none — renewal retries when back in stock |

**Fastest additional 100 trusted Tesco prices:** combine the two
lowest-friction routes, both of which build comparisons:
1. Run the existing supervised collector over the **57 eligible-never-attempted**
   (H+I) → ~45–50 immediately, no code change.
2. Ship a reviewed **canonical-name enrichment** batch for the generic-name
   sub-type (e.g. the "Broccoli/Cucumber/Courgette/Fusilli/scones" cases whose
   Tesco mapping is already correct) — ~37 of these have BOTH peers (instant
   triples) and ~160 have ≥1 peer. Correcting ~60–80 generic canonical names and
   re-collecting clears the remaining ~55 needed for 100, and directly grows
   three-retailer comparisons.

This reaches 100 WITHOUT the slower discovery build, using only (a) existing
collection and (b) the established guarded-SQL enrichment pattern. Generalised
discovery is the scalable follow-on for the ~700 genuinely-mismapped held
products.

## 7. Recommended sequence

1. **Now (no code):** supervised collection over the 57 eligible-never-attempted;
   confirm ~45–50 prices.
2. **Short (reviewed SQL):** canonical-name enrichment batch for generic-name
   held products with peers (audit-style evidence trail; no Tesco-mapping change);
   re-collect → ~100 total + new triples.
3. **Medium (focused code):** generalise the discovery cohort + extend the guarded
   RPC to a new audit batch so discovery runs over the wrong-SKU held pool,
   prioritised by peer overlap. Reuse every validator and the evidence table.
4. **Ongoing:** renewal keeps all recovered prices fresh (Dunnes/SuperValu
   schedules already restored).

No circuit-breaker change, no new collection method, no automatic canonical
overwrite, no cleared holds, no retried unknowns. Each correction stays
evidence-logged and reversible.
