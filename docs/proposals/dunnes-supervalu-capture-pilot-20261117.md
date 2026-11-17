# Dunnes/SuperValu direct-capture pilot: 10 pairs (17 Nov 2026, PROPOSED, not executed)

Goal: turn deterministic exact candidates into independently verified comparisons.
The protected ledger (`retailer_offer_pair_reviews`) needs each side to cite a
`retailer_identity_responses` row with `source_kind='captured_product'`. That row
must match `store_product_id`, `store`, `sku`, `body_sha256` and `retrieved_at`, and
be no more than 14 days old. Search listings, LLM output and shared canonical
records are not evidence for it.

## Why no qualifying capture exists today (verified in code and data)

- `captureIdentityResponse` marks `captured_product` only when the requested URL,
  final URL and product URL are all the same.
- **Dunnes:** production only calls the gateway search API
  (`dunnes-queue-worker-base.ts`, `fetchCandidates`). So every one of the 14,940
  retained Dunnes bodies is `captured_listing`. No code fetches a Dunnes product
  page. The www product page was Cloudflare-blocked when probed from Vercel in
  August.
- **SuperValu:** all 41 SuperValu runs used `vercel_direct_product_page`, which
  GETs the stored product URL. Yet the only 38 retained SuperValu bodies come
  from the search-remap path. So on the direct path `captureIdentityResponse`
  returns `null` every time.
  - The most likely cause is that `parseSupervaluProductPage` yields `sku: null`.
    It keeps a JSON-LD or preloaded `sku` only when that value is a string, and
    its HTML fallback hard-codes `null`.
  - Other possibilities are that `sources()` can't parse entity-encoded JSON-LD,
    or that the page redirects.
  - This is unconfirmed until one live page is examined.
- Retention only runs after a successful price finalisation. There is no
  evidence-only mode for Dunnes or SuperValu.

## Pilot pairs (both fresh, same price within 25%, one owner per SKU, canonical URL form, distinct brands)

| # | Dunnes SKU (store_product_id) | Dunnes title | € | SuperValu SKU (store_product_id) | SuperValu title | € |
|---|---|---|---|---|---|---|
| 1 | 100111838 (be36ca21) | Schwartz Mild Chilli Powder 38g | 3.40 | 1020898000 (dd427a8b) | Schwartz Chilli Powder Mild (38 g) | 3.40 |
| 2 | 100130071 (ff54f373) | Avonmore Low Fat Super Milk 1 Litre | 1.75 | 1018392000 (e8a41dfe) | Avonmore Low Fat Super Milk (1 L) | 1.75 |
| 3 | 100208293 (8da72c38) | Flahavan's Vitamin Rich Oat Drink 1L | 2.99 | 1727584002 (618163fe) | Flahavan's Vitamin Rich Oat Drink (1 L) | 2.99 |
| 4 | 100229900 (d4d00bd7) | Brennans Bakehouse Multiseed 500g | 2.75 | 1767390001 (1ac5cf20) | Brennans Bakehouse Multiseed (500 g) | 2.75 |
| 5 | 100270493 (1162e800) | Cadbury Flake Chocolate Dessert 75g | 1.69 | 1021952001 (98947531) | Cadbury Flake Chocolate Dessert (75 g) | 1.69 |
| 6 | 100287114 (7d02724b) | Bens Original Wholegrain Microwave Rice 220g | 2.79 | 1025148002 (0ace1dbc) | Ben's Original Wholegrain Microwave Rice (220 g) | 2.79 |
| 7 | 100296880 (c7e013a2) | Odlums Gluten Free Plain Flour 1kg | 4.00 | 1909679000 (183746ee) | Odlums Gluten Free Plain Flour (1 kg) | 4.00 |
| 8 | 100297898 (2d054901) | Ballygowan Hint of Fruit Summer Fruits Bottle 1.5L | 1.85 | 1808966005 (4c4a66f5) | Ballygowan Hint of Fruit Summer Fruits Bottle (1.5 L) | 1.85 |
| 9 | 100303949 (3491d359) | Dettol All-In-One Disinfectant Spray, Crisp Linen 300ml | 4.00 | 1966162000 (103673ab) | Dettol Crisp Linen All In One Disinfectant Spray (300 ml) | 4.00 |
| 10 | 100313142 (38b42686) | Domestos Power 5 Toilet Rim Block Lime 50 g | 2.00 | 1938993000 (648b33e9) | Domestos Power 5 Lime Toilet Rim Block (50 g) | 2.00 |

The full ids are in the private `capture-pilot.json`. 82 of the 93 candidates pass
these filters. Oral-B Pro-Expert (€6.00 vs €2.90) is excluded for review.

## Proposed steps and request budget

| Step | What | Retailer requests | Writes |
|---|---|---|---|
| 0a | SuperValu diagnostic: GET pilot #1's product page once, run `parseSupervaluProductPage` and `captureIdentityResponse` locally, and report which check fails. Save the body as a private fixture. | 1 | none |
| 0b | Dunnes probe: GET pilot #1's www product URL once from the AWS egress. Record status, final URL, and whether the body embeds the SKU and name. | 1 | none |
| 1 | Fix the SuperValu direct-path capture (e.g. accept a numeric SKU) with a test on the saved fixture. Owner reviews, merges and deploys. | 0 | code only |
| 2 | SuperValu captures come from the next scheduled daily run, which already GETs about 1,850 product pages. Optionally run 10 targeted `q=` runs to get them sooner (these write normal prices). | 0 (or 10) | normal price + `captured_product` rows |
| 3 | Only if 0b shows the page is reachable and carries product data: an evidence-only Dunnes product-page capture through the Dunnes governor (30 req/min, breaker). It writes only `retailer_identity_responses`, never prices. | 10 | evidence rows only |
| 4 | Automated evidence checks (below), then an independent review. The owner inserts approved edges into the ledger through the postgres bridge. | 0 | ledger rows (owner) |

Total: 12 retailer requests (or 22 with targeted SuperValu runs). That is well
under the governor limits. No Tesco or Apify spend.

If 0b shows Dunnes is blocked, no Dunnes `captured_product` is possible with
current infrastructure, and the pilot can't approve any Dunnes↔SuperValu edge.
Using a gateway response as product evidence would be a policy change for you to
decide. It is not proposed here.

## Evidence checks per side (fail closed)

- The DB-computed `body_sha256` equals SHA-256 of the stored body. The parser
  version is known.
- The requested URL equals the final URL, which equals the stored `store_url`.
  The path ends in the mapped SKU.
- A product node in the body has `sku` equal to `store_sku`, and its normalised
  title equals the retained title. Multiple copies must agree.
- The response is bound to the exact `store_product_id`, and is no more than 14
  days old at review time.
- `compare()` is re-run on the captured evidence. This checks brand rule, pack
  amount and count (structured quantity allowed for captured_product), variant
  words, and structured variant, flavour and formulation. It also compares GTINs
  (checksum-valid and equal when both are present) and ingredients when both are
  present. Any contradiction means `not_comparable`. Any gap means it stays
  `unverified`.
- A reviewer rationale is recorded. Model output may be cited as context only.

## Expected results (honest)

- **If both captures succeed:** titles, packs and prices already agree, so most
  of the 10 should verify as `exact_product`. Product pages may also expose
  GTINs and ingredients that settle or overturn individual pairs. The milk,
  oat-drink and spray formulations are the most likely to show a difference.
- **If Dunnes product pages are blocked:** 0 pairs can verify, and the finding
  is that Dunnes needs a policy decision or a new capture route.
- **Separately:** the SuperValu fix gives `captured_product` evidence for every
  SuperValu SKU in the daily run. That also unlocks the Muesli Flahavan's check
  on the SuperValu side.
