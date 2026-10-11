# Supervised Tesco acquisition handoff

This is an operator-only extension to expansion. It is not a scheduler, mapping
repair, renewal change or a way to finalise cached prices. Review and release are
required before live use. Production validation of this proposal was read-only.

## Identity corrections

Discovery previously normalized litre words when comparing measures but not when
comparing identity words. The same unit normalization now feeds both comparisons
for canonical, Tesco and SuperValu/Dunnes titles. Quantities must still agree.

For a title that omits its quantity, discovery can use one positive, unambiguous
mass or volume from the existing direct product parser. The evidence must identify
the exact product URL as both requested and final URL, in product mode. Listings,
missing/multiple quantity fields, explicit title contradictions, multipacks and
compound measures cannot use this fallback. Structured quantity cannot override
an explicit title size. The parser still obtains this quantity from the single
packSize record of the matching product ROOT_QUERY; it was not redesigned.

The narrow phrase equivalence `petit pois`, `petits pois`, and either followed by
`peas` handles the actual Birds Eye titles. There is no general stemming, fuzzy
spelling or ingredient substitution. Extra mint, organic, flavour/formulation,
brand and pack terms remain significant. Peer titles still require explicit
quantity; no missing peer quantity is inferred from Tesco.

The direct collector validator and ordinary renewal path are unchanged. Handoff
products additionally pass corrected discovery checks on their NEW live response.

## Explicit handoff

Use the existing SQL-bridge runner with an explicitly selected list of 1–5
acquisition page IDs and `--mode expansion`. The default expansion selection and
all renewal options behave as before.

```sh
npm run tesco:supervised -- --mode expansion --limit 2 \
  --acquisition-pages PAGE_UUID_1,PAGE_UUID_2 --dry-run
```

After review/release and separate operational preflight, a deliberate
`--confirm-run` can request a new live price verification. Do not refetch either
example merely to demonstrate this implementation. A dry-run has no retailer
requests, leases, writes or finalisation. An empty/invalid selection fails closed.

The source must be a completed HTTP 200 product page in a finished
`tesco-supervised-discovery-v1` run with `pricesAllowed:false`, no active owner,
`acquisitionOnly:true`, zero source receipts/prices, a valid response hash and
original response time between reservation and run completion. Its exact SKU/URL,
recorded collector success, unique approved mapping, prior-success receipt and
current peer identities are rechecked. A missing or fresh Tesco mapping is not
silently repaired or overwritten. Evidence must still satisfy the existing
14-day discovery freshness requirement.

Any other attempt for that URL, including pending, failed or completed price
verification, prevents a new handoff. The sole exempt attempt is the exact
completed source page, bound to its page ID and body hash. Ordinary historical
attempts without this provenance remain held. Offline exports can carry
`acquisitionPageId` and `acquisitionBodySha256` only when those facts have been
established from the durable source; the writer never trusts export fields alone.

Before reservation and finalisation, the original source/run, mappings, peer
identities/prices, receipts and other attempts must still equal the snapshot
selected under the workspace lease. The new pending page is durably linked to
`sourceAcquisitionPageId` and `sourceBodySha256`. It is a distinct price request,
not a replay of acquisition. The source page is never edited, consumed by deletion
or retimestamped. Each run retains its own request counts and receipts.

The NEW response must pass both the unchanged collector validator and discovery
identity checks. Only then does the existing atomic checkpoint/finalizer append
one observation. The prior acquisition price is never used. Existing unique
receipts make repeated finalisation idempotent; a lost checkpoint acknowledgement
is reconciled without refetching. An unknown new request remains held. Current
pacing, leases, cooldowns, transport/access stops and safe resume rules apply.

## Controlled result and limits

The production read-only SQL-bridge dry-run selected exactly two products:

| Product | Tesco SKU | Original live acquisition | Proposed status |
| --- | --- | --- | --- |
| Avonmore Protein Milk Vanilla 1L | 308465836 | 10 Oct 21:46:42.365 UTC; 1,000ml; GTIN 05011056024129 | Eligible for explicitly controlled live price verification |
| Birds Eye Petits Pois 450g | 294076621 | 10 Oct 21:50:17.861 UTC; 450g; GTIN 05000116103317 | Eligible for explicitly controlled live price verification |

Both have fresh SuperValu/Dunnes peers. Their URLs are the exact Irish Tesco
product URL prefix plus SKU. The original URLs were live verified on 10 October,
not again by this dry-run. No production price, mapping or canonical record was
changed. Coverage remains 341 Tesco / 171 comparisons; renewal remains 285 due
12 October and 56 due 13 October, starting 11:28:30 Irish time.

Regression tests include the two positive examples, title/structured quantity
contradictions, unsafe/mismatched provenance, multipacks, flavour/formulation/brand
differences, duplicate SKU ownership and unknown holds. PostgreSQL integration
tests execute the real finalizer and cover distinct request accounting, original
evidence preservation, duplicate finalisation, lost acknowledgements, stale source
or peers, access restrictions, leases/cooldowns and interruption across restarts.

No new infrastructure or database migration is needed. A genuinely new mapping
without the existing prior-success receipt still requires a separately reviewed
onboarding policy; this change does not weaken that rule. The proposed handoff is
limited to finished acquisition-only runs with a single prior request per URL.
Renewals take priority from 12 October. Do not enable unattended collection.
