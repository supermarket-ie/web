# Tesco targeted evidence acquisition, 10 October 2026

## Verified release and production state

PR #255 was reviewed and merged as `5e0d88ada2daf418e380939dc8889f99f98bdcb0`.
The reviewed head `fee4c0716cf0e3aa368effc231b293e371d1a28e` passed CI #910
(444 tests, including 38 discovery tests). Its tree
`a1a0b0f7f474edf85ff93b9702376bd370e4c107` is identical to the merged tree.
Post-merge CI #911 passed. Vercel production deployment
`dpl_HKuqrVatpcevvs4x4Q7UwpbUsi27` reached READY for that commit.

Review fixed one material discovery defect: compound measures could otherwise
be accepted using only the first quantity. This is an offline discovery guard;
no production matching or collection rule was changed.

PR #256 remains a draft, unmerged and unexecuted. Its guarded SQL generator
has no execution client, defaults to ROLLBACK, checks all five original titles,
SKU/URL allowlists and retailer dependencies, refuses leases/cooldowns, and
updates atomically with idempotent handling. CI #908 passed. It is suitable for
operator review, conditional on a fresh dependency snapshot and explicit data
repair approval. Its short table locks should be reviewed before execution.

At 19:30 UTC production had 341 fresh Tesco prices and 171 three-retailer
comparisons. There were 337 products with fresh peer prices and no Tesco price;
that count does not establish that their peer mappings represent exact products.

## Targeted evidence, not a repeated catalogue audit

The private queue selects 100 demanded comparison-gap products. All 200 peer
prices and their current titles were rechecked at 19:32 UTC. No complete
unchanged-catalogue discovery evaluation was repeated.

New official manufacturer sources corroborate nine stored Tesco SKU hypotheses:
four Glenisk products, two Flahavan's products, two Kellogg's Nutri-Grain variants
and one Ben's Original sauce. The manufacturer barcode table independently
corroborates the Nutri-Grain strawberry six-pack consumer GTIN `5050083542787`
with stored Tesco SKU `267952414`, and blueberry GTIN `5050083542732` with stored
SKU `267953350`. Case barcodes are kept separate. The source is dated August
2023: this is new independent corroboration, not current Tesco availability.

Sources:

- [Kellogg's manufacturer barcode table, August 2023](https://www.kelloggsvantage.co.uk/content/dam/europe/kelloggsvantage_gb/pdf/HFSS%20Product%20List%20for%20Vantage_updated%20AUG%2023.pdf)
- [Glenisk bio organic](https://glenisk.com/products/bio-organic/),
  [Greek style](https://glenisk.com/products/organic-greek-style/) and
  [kids](https://glenisk.com/products/organic-kids-yogurts/)
- [Flahavan's organic jumbo](https://www.flahavans.ie/product/flahavans-organic-jumbo-oats/)
  and [pinhead](https://www.flahavans.ie/product/flahavans-pinhead-oatmeal-1kg/)
- [Ben's Original extra pineapple sauce](https://uk.bensoriginal.com/products/sweet-and-sour-extra-pineapple-sauce-450g-cooking-sauce)

Four canonical pack completions have supporting manufacturer and stored peer
evidence: both Nutri-Grain variants (6 x 37g), Glenisk natural (4 x 125g), and
Glenisk kids apricot (4 x 90g). They are proposals, not approved repairs or
collection-ready identities. Title/formulation differences, wrong existing SKUs,
shared ownership and collector admission checks remain blocking. Independent
facts are not copied into peer GTIN fields or fabricated as new Tesco responses.

A focused replay of nine hypotheses used the merged discovery validator, all
current owners of each tested SKU, current peer identities, stored Tesco page
provenance and current request holds. It produced zero collection-ready targets.
The private evaluation also checked incorrect size, extra formulation, wrong
brand, wrong URL/SKU, barcode checksum/case distinctions and hypothetical pack
completion. All 114 assertions passed. This is a bounded hypothesis replay,
not an exhaustive alternative-SKU search or a new accepted mapping report.

The 100-product queue has 0 collection-ready, 0 repair-ready, 0 proven multiple
exact-match ambiguities, 71 requiring evidence/review, and 29 rejected stored
proposals. Rejection of a stored proposal does not establish that Tesco has no
exact replacement. There are 52 missing canonical brands, 45 incomplete pack
descriptions, and 22 explicit peer size/brand/type warnings in this subset.
Generic peer mismatches require review before counting genuine comparisons.

## Interrupted acquisition and reconciliation

One bounded listing request was durably reserved. Its first SQL bridge
acknowledgement failed and the persistent terminal could not be recovered.
No HTTP status, response body, final URL or parsed products were checkpointed.
The request outcome is unknown; neither a Tesco transport failure nor an access
challenge has been established. Acquisition stopped without retry or egress
change. No further Tesco requests or product price collection were performed.

After expiry, the exact run/owner/lease timestamp and absence of a successor
were checked under locks. The run was closed as degraded and its expired lease
released. The pending page remains unchanged, as do all existing cooldowns and
four historical unresolved product requests. There are now five unresolved
reservations: four product requests and one listing request. No trusted prices
were inserted and no mapping, canonical record or earlier observation changed.

At reconciliation there were no active leases or active cooldowns. Five older
run rows still say running (four legacy August evaluations and the interrupted
9 October Birds Eye run); this task does not manufacture their outcomes. Those
rows are not proof of active sessions. Request holds remain authoritative.

## Renewal and next evidence step

Renewal is unchanged and none was due on 10 October. In Irish time, 285 become
due on 12 October and 56 on 13 October; none first becomes due on 14 October.
The oldest observation is 8 October at 11:28:30; its four-day renewal eligibility
is 12 October at 11:28:30 and seven-day expiry is 15 October at 11:28:30.
Renewals take priority from their due times. The listing hold is not a product
renewal target; retain it without retry. Recheck the gate before each supervised
batch. No scheduler or renewal behavior has changed.

The next evidence acquisition should reuse this ranked queue and obtain a small
approved structured brand listing only after reliable supervision is restored.
Preserve a request reservation before transport and durably spool the response
before waiting for a SQL bridge acknowledgement; reconcile without re-requesting
when an acknowledgement is lost. This is an implementation recommendation, not
a deployed change or an established defect in Tesco transport.

For continuing supply, join checksum-valid manufacturer consumer identifiers
to stored Tesco identifiers, validate brand/formulation/pack and all peer
dependencies, and request fresh listing evidence only for changed or missing
identities. Record source date, body hash, SKU, direct URL, response status and
decision fingerprint. Never call a constructed listing URL a live-verified
product URL. Keep approval-dependent repairs separate. New identities without
prior success receipts also need the existing separately reviewed onboarding
path; the expansion runner's proven-product requirement is not bypassed.

The 25–50 new-mapping target was not reached. The remaining gap is 159 prices
to 500, and 659 to 1,000. No collection yield is projected from the rejected or
evidence-only queue. Private machine-readable artifacts retain candidate IDs,
source provenance, exact stored SKU/URLs, all classification reasons, guarded
metadata proposals and operational reconciliation evidence.
