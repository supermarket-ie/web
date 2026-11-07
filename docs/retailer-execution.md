# Retailer Execution — Supermarket.ie

### 7 November 2026 — database restored,116 Tesco renewals and targeted selection

The existing supermarket-ie Supabase project was restored on7November through the connected management tool. ACTIVE_HEALTHY status and SQL access were verified before any Tesco request. The restored ledger retained502 fresh trusted Tesco offers,692 charged requests since31October and14 protected pending reservations. No infrastructure, credentials, egress gate setting, cooldown or identity safeguard was changed.

The supervised collector then processed all133 eligible offers initially expiring on8November in batches of at most10, advancing automatically between ordinary batches under the standing authorisation. Final database reconciliation:116 new guarded renewal observations, four unavailable/no-regular-price offers, three pack holds and ten unacknowledged reservations. Fresh coverage remains502; total charging is825/1,000, leaving175. Total pending is24 (the original14 plus ten from this continuation). No pending URL was re-fetched. There is no active collector lease, and no eligible renewal expiring before9November remains; the remaining17 old observations are deferred/pending and must not be described as renewed.

The SQL connector intermittently reported a two-minute confirmation expiry. Interrupted invocations were reconciled from database pages/receipts and closed with the existing owner-conditional cleanup before advancing to unrequested products. A supervisor interruption with six completed products and no pending write was resumed through the existing resume protocol, preserving the original batch and counters. Read-only permission inspection confirmed Supabase was already set to Allow all actions; no permission expansion was made or requested as a batch prerequisite. A pending reservation remains an unknown outcome, not proof of a Tesco denial.

Added an optional ordinary-selection --mapping-ids filter so an independently reviewed eligible product can be collected without sending requests for known mismatches earlier in the bulk selector. It accepts1–10 distinct validated UUIDs within the batch limit, treats UUID case consistently, filters before deduplication/limit, and checks the returned IDs again. It only narrows ordinary renewal/expansion selection: pending/recent, failed status, prior-success, freshness, shared-SKU exclusion when requested, live identity, immutable mapping, lease/cooldown, receipt and guarded finalisation rules remain unchanged. It cannot be combined with resume, evidence-only acquisition, acquisition-page handoff or audited hold re-entry. The selected immutable run snapshot still supports normal resume without resupplying IDs. Eight focused PostgreSQL tests passed before final case-normalisation refinements; full155-test collector plus50-test identity validation and required validate are running.

Independent source review identified Green Isle Yorkshire Puddings230g as an ordinary, non-held expansion candidate. Retained manufacturerGREEN ISLE, barcode05391520183188, structured/net230g, marketing explicitly12 light and crispy Yorkshire puddings and12 portions corroborate canonical Green Isle12 Yorkshire Puddings230g. A separate new guarded live fetch is still required after validate and merge; no retained price has been promoted. Several other ordinary candidates have known juice/drink, recipe, size, count or completely unrelated-product conflicts and must not be fetched merely to fill a batch. This operator CLI change requires no database migration or ECS rollout. Automated Dunnes/SuperValu governor deployment, migration and schedule status remains as recorded in its separate operational entries.

### 7 November 2026 — daily Dunnes/SuperValu refresh prepared, NOT DEPLOYED

The owner requested daily checks of displayed prices. The prepared change
updates the existing AWS cadence to daily and raises the bounded scheduled
selection from 1,000 to 2,500, with complete paginated retrieval before queueing.
Current eligible inventories are 1,053 Dunnes and 1,851 SuperValu. Keep exact
matching, source timestamps, batches and receipt idempotency intact. The
watchdog now checks daily execution and observations older than 30 hours.
Production remains on the previous cadence until the worker image and Terraform
changes are deployed from the existing authorised AWS workspace. See
`docs/daily-retailer-refresh.md`; no live collection or schedule changed here.

### 5 November 2026 — next20 source targets attempted and reconciled

PR #333 passed required validate and merged. The next two selected source tranches,20 previously unchecked mappings from the original671 cohort, were then attempted through the existing supervised evidence-only collector. Seventeen captures are durably saved and three reservations remain pending. No completed or pending retailer URL was repeated. These checks inserted no prices; fresh trusted Tesco coverage remains502.

Production reconciliation confirms692 requests charged since31October, leaving308 under the original1,000 cap. Pending reservations increased from11 to14. The gate lease is released and all stopped invocations were reconciled; no collector is currently active. In the original671 cohort,42 now have completed new source-only checks and629 lack a completed new check. Of those629, three were attempted in this continuation and are pending;626 have not yet been attempted. Do not describe all629 as untouched, or the17 saved captures as17 new trusted prices.

A connector response explicitly reported that its SQL confirmation expired after two minutes. Other capture checkpoints were not acknowledged around interruptions. Completed database rows were reconciled before advancing to the candidates not yet requested. The second and fourth interrupted runs were closed with the normal owner-conditional cleanup, retaining pending reservations and cooldowns. No unacknowledged capture mutation or retailer request was replayed, no source was retimestamped and no security control changed.

The saved multipacks include Muller Rice6x170g, Glenisk4x105g, Kellogg's Squares4x28g, Walkers6x25g, Philadelphia4x35g, Felix4x10g and Pedigree Rodeo7sticks123g. Peer headings that list one unit's mass cannot establish a whole-pack match automatically; existing identity and quantity checks remain required. Jacob's Malted Milk200g, Flahavan's Jumbo Oat Flakes500g and Green Isle Yorkshire Puddings230g passed ordinary source identity checks but still lack a fresh independent matching peer for audited re-entry. A read-only search across all fresh Dunnes/SuperValu offers found no matching Malted Milk200g, Jumbo Oat Flakes500g or Yorkshire Puddings230g offer; the organic1kg oats are different and were not substituted. Some other pages are unavailable, have recipe/formulation conflicts or remain insufficiently identified. All are evidence outcomes, not approvals.

Keep progressing by triaging retained identities and selecting new supported evidence targets, preserving budget for separate live-price requests. The308 remaining requests cannot cover626 untouched mappings plus price verification. Broader acquisition beyond the existing cap requires a separate budget decision; it is not implied by the size of the remaining investigation queue. Pending URLs and material mismatches remain excluded.

### 5 November 2026 — audited ham replacements reach 502

PR #332 passed required validate and merged before collection resumed. Rechecking the existing retained repair shortlist against current production state found two newly eligible, one-to-one replacement hints: Brady Family Traditional Ham80g and Brady Family Crumbed Ham80g. Both were processed through the existing audited stage, separate current source capture, source-verified activation, immutable one-use approval and separate fresh guarded price request. All four collection runs completed successfully; both price requests were accepted and both approvals consumed.

Production reconciliation confirms 502 fresh trusted Tesco prices. Cumulative charging since31October is672/1,000, leaving328 requests. Eleven historical pending reservations remain untouched; no new unresolved request or collector lease remains. Of the original671 historical mappings,25 have new source-only checks and646 remain without one. These are investigation candidates, not ready price offers.

Fresh source proved manufacturerBRADY FAMILY, exact respective retained barcodes, structured80g/net80g and the Traditional versus Crumbed recipes. Fresh independent Dunnes and SuperValu full80g product records corroborated each canonical identity. Old mismatched ham titles/SKUs, including misleading nitrite wording, remain only in immutable repair history and were not inherited as product claims. No retained-source price was promoted; no other retailer mapping was relabelled. There was no new parser/database change or ECS deployment.

The remaining reviewed repair hints are blocked by shared old SKU ownership, absent fresh matching peers, insufficient complete identity, or protected recent/pending targets. McCain is already fresh and was not fetched again. Shared old-SKU hints remain excluded by the existing one-to-one repair guard; do not remove that guard to increase coverage. A future audited separation workflow would need to retain every original owner, bind the replacement to an independently proven canonical identity and confirm a unique target with a new source before activation. Existing quantity, peer, held-URL and unknown-reservation safeguards remain unchanged.

### 5 November 2026 — continuous recovery verified at 500

The continuous recovery session completed five separately fetched guarded live prices: Barilla Pesto Rosso200g, Knorr Creamy Vegetable Soup579g, Green Isle Baby Carrots450g, Tesco Tuna Chunks in Brine4x145g and Cirio Plum Peeled Tomatoes400g. Database reconciliation confirms 500 fresh trusted Tesco offers, 668/1,000 charged requests and 332 remaining. All five one-use approvals were consumed. No new pending reservation was created; eleven historical unknown reservations remain untouched. Completed runs have released their supervisor leases.

PR #331 passed required validate, merged normally and its private net/drained migration was applied and verified. Node/SQL proof and identity/parser/transaction suites passed all250 local tests; TypeScript and lint passed. The helper is SECURITY INVOKER with execute restricted to postgres. Security advisory output remained unchanged. Raw source quantities408g and250g remain immutable; only independently corroborated net580g/400g was used for new live prices. Other retailer peers were neither relabelled nor declared equivalent.

A supervisor interruption was reconciled from the durable approval ledger: two decisions existed, so processing resumed at offset2 and recorded only the remaining three. Workspace maintenance had removed a dependency symlink target; npm ci restored the pinned dependencies before resuming. No completed URL or unknown reservation was replayed.

Thirteen further source-only checks since the earlier ten-product tranche inserted no cached prices. Of the original671 eligible historical mappings,23 now have new source-only checks and648 have not yet received one. These648 are investigation candidates, not648 ready price offers; retained evidence already identifies material blockers for many. The latest two source checks found Batchelors title200g versus structured250g without an explicit net declaration, and Jacob's Mediterraneo crackers title/net8x31.25g versus structured per-unit31.25g. Both remain held. Jacob's additionally has a mass-only250g peer and canonical title, so fixing arithmetic alone cannot waive the explicit inner-count proof. No draft multipack migration was applied. Organic celery lacks a complete same-pack independent anchor; loose courgette lacks supported selling quantity and sweet potato's explicit800g conflicts with canonical1kg. Preserve all these holds.

Further expansion requires positive pack evidence or audited mapping corrections, rather than automatically retrying held URLs or spending requests on known identity conflicts. The571 never-proven mappings still require an explicit initial-enrolment workflow. This checkpoint is a completed supervised session, not a background job; no collector is currently active. Continue authorised work from the durable ledger, keeping the original1,000-request cap and avoiding repeated confirmation between routine batches.

### 5 November 2026 — continuous acquisition and explicit pack proofs

Eight further source-only captures completed without price writes or new pending reservations. Fresh trusted Tesco coverage remains 495; conservative charging is now 658/1,000, leaving 342. Eleven historical pending reservations remain untouched and no collector lease is active.

The next guarded recovery route recognises a manufacturer-led offer under an abbreviated, unbranded canonical name only with matching original identity, exact product words, full source title/structured quantity and a fresh independently matching manufacturer peer. Other peers remain unverified. The Barilla Rosso wording exception is bounded to that manufacturer and recipe; its retained ingredients match the independently checked Dunnes offer. Conflicting brands, recipes, counts, quantities and GTINs still fail.

A second narrow proof reconciles drained retailer structured mass with explicit whole-pack net mass only when title and net contents agree exactly, structured mass equals the explicit drained total, and all counts agree. Raw source snapshots remain immutable. Node parsing, approval and live verification use the same positive projection; the database independently checks it through a private invoker-only helper. The newly captured tuna and Cirio tomatoes satisfy this proof. Processed peas do not: structured302g differs from explicit drained293g, so that offer stays held. Galia melon is unavailable and the Glenisk target redirects unsafely; neither is retried.

Five candidates are awaiting independent approval and separate new live price requests after required validate, normal merge and database migration verification. No price from retained evidence is promoted. This supervised CLI/data change requires no ECS rollout. The source-only lane still requires genuine prior success, so the 571 never-proven mappings are not silently enrolled. Continue across bounded batches under the existing 1,000-request cap; stop only for an actual blocker, safeguard or exhausted budget.

### 5 November 2026: ranked tranche verified at 495

The first ten-product evidence tranche produced three separately fetched guarded
prices: 100 baking cases, pepperoni baguettes2x125g and six large free-range eggs.
Source-only captures inserted no prices. The final egg request ran only after
PR #329 passed required validate and merged, then completed successfully.

Reconciled coverage is 495 fresh Tesco offers. Cumulative charging is650/1,000,
leaving350. All three runs completed without a new unresolved request; eleven
historical pending reservations remain preserved and no collector lease is active.

The remaining seven targets comprise two unavailable offers, three unsupported
quantities, one original mass-versus-piece mapping conflict and one formulation
conflict. Their evidence and peer mappings remain unchanged. Do not treat a
matching barcode as permission to override another material identity conflict.

### 5 November 2026: first ranked evidence tranche and explicit egg counts

The first ranked ten-product source-only run completed successfully and inserted
no prices. Two independently reviewed products then received separate new live
guarded prices, reaching 494. Cumulative charging is 649/1,000, with eleven
historical pending reservations and no new unresolved attempt. The final
terminal status read failed after successful close; database reconciliation
confirmed all captures and released ownership. Do not rerun completed URLs.

A matching canonical barcode did not override the cucumber mapping's original
350g versus single-piece conflict. Other holds remain for missing quantity,
availability or formulation. Preserve all original source evidence and peer
records; count/style differences do not establish cross-retailer equivalence.

The audit now recognises the explicit trailing egg count in Free Range Eggs 6.
It does not treat Eggs 200 g as a count or infer an absent count. Six-pack,
twelve-pack and missing-count regression cases preserve the quantity floor.
The unchanged database helper accepts matching six and rejects twelve against
the original six-pack mapping. Fresh source, exact barcode, full identity and
one-use approval remain required before a new price fetch.

### 5 November 2026: verified 492-price checkpoint

The final reviewed four-product run completed four new guarded prices, including
both untouched water offers after the validated PR #327 spelling correction.
Live reconciliation is 492 fresh trusted Tesco offers, 637 charged requests
since 31 October, 363 requests left and eleven preserved historical pending
reservations. No new unresolved request was created across this continuation's
five successful batches: thirteen expansion additions, ten renewals and two
availability holds from twenty-five requests.

Peer records were not edited or declared equivalent to recover Tesco offers.
The canonical/source variants, mass, barcode and manufacturer checks still
apply; do not retry earlier held URLs during their exclusion period. The pending
Pepperoni capture remains unknown and must not be replayed.

No collector is active. Routine four-day renewal eligibility remains for at least
one hundred products; visible 1 November observations expire on 8 November,
not today. Expansion is eight short of 500. Remaining form/flavour/count
uncertainties need independent evidence before another price request.

### 5 November 2026: 488-price reconciliation and documented brand spelling

Coverage is 488 fresh trusted Tesco prices. This continuation renewed ten prices
and added nine products from eleven reviewed expansion requests, with two
availability holds and no new unresolved requests. Cumulative requests since
31 October are 633, leaving 367. Eleven historical pending reservations remain
preserved, including the Pepperoni capture whose saved SQL must not be replayed.
The separately approved, previously untouched Triple Cheese count-proof product
completed a fresh guarded receipt successfully.

The audit recognises the exact Deep RiverRock / Deep River Rock spelling pair
used on Coca-Cola HBC's Irish brand page. No general joined-word brand matching
or identity-conflict exemption is introduced. Manufacturer, recipe, variant,
barcode, complete measure, multipack, fresh-source, one-use approval and normal
finalisation checks remain mandatory. A corrected text normalizer does not
authorise retrying a held URL before its normal exclusion period.

Generic Tesco offer recovery is separate from cross-retailer equivalence.
Whirlers 130g cannot compare as Sizzlers 90g; reduced-salt gravy cannot compare
as a chicken variant; a 750g fruit bag cannot compare as one loose piece. All
peer records were retained unchanged and those comparison claims remain
unverified. Additional four-day renewal candidates remain eligible.

### 5 November 2026: verified 479-price checkpoint

Fresh trusted Tesco coverage is 479. The conservative cumulative request count
is 612 since 31 October, leaving 388 under the original 1,000-request cap.
Twenty-eight ordinary reviewed requests added seventeen guarded prices across
three successful groups. A separate count-proof request has an expired,
unacknowledged price checkpoint and remains pending without a price. Total
unresolved reservations are eleven. Keep all pending evidence and do not replay
saved SQL, retry unknown URLs or infer a successful price from captured content.

The interrupted ordinary ten-product group resumed only six untouched URLs
after natural lease expiry; its counters and four saved outcomes were retained.
The final eight-product group completed six guarded prices, one brand hold and
one unavailable redirect. No collector is active. Current approvals and fresh
independent evidence must be checked before the next bounded expansion.

### Explicit counts and retained formulation evidence

Missing structured size does not authorise guessing. The parser may retain an
explicit count stated by the retailer, marked as title-count evidence, while
leaving ambiguous counts and unsupported dimensions unknown. Reacquire evidence
through the supervised source-only mode; do not alter old immutable pages.
Review retained product details independently before authorising a new live
price request. A changed retained formulation detail blocks that request.
Recent failed price requests keep their existing exclusion even after a code
or metadata correction. Metadata repair receipts are separate from price writes.

### Evidence naming and pack totals

The reviewed collector recognises bounded naming equivalents after independently
checking brand, SKU, barcode, quantity and pack. Explicit multipacks compare
total amounts and retain count checks. Apply the corresponding pack-total
migration before running the updated reviewer. A matching canonical barcode
can establish Tesco identity even when a peer relationship remains unverified;
this does not approve that peer or create an exact comparison. Missing independent
identity evidence continues to block recovery. Keep live batches at ten or fewer.

### 4 November 2026 — evidence-only production outcome

The continuation recorded twenty renewals, three new trusted Tesco products and
ten source-only acquisitions, with zero network-access failures. Source capture
alone qualified no follow-up: redirects, unavailable products, changed identity
and missing pack evidence blocked further exact collection. Coverage was 416,
with 511 requests remaining under conservative authorisation accounting.
The historical seven pending requests remain protected. A raw selector result
or cross-retailer canonical overlap must not be treated as an independent exact
identity decision.


**Last updated:** 10 September 2026

This document records retailer-specific execution/handoff findings. Read `PROJECT_STATE.md` first for overall architecture and strategy.

## Objective

Target execution flow:

`Supermarket.ie prepared basket → shopper chooses retailer → retailer trolley populated → shopper reviews/pays retailer`

Supermarket.ie remains outside retailer payment and does not capture retailer passwords, payment credentials or retailer session tokens merely to populate carts.

**Mainstream product requirement: no browser extension.**

## Status matrix

| Retailer | Platform / context | Known identifiers | Cart primitive | Auth/session boundary | Current status |
|---|---|---|---|---|---|
| SuperValu | Instacart Storefront | `store_sku`, `store_url`, `rsid`/retailer store ID, price/name | Store-scoped cart; single + bulk add observed in client | `anonymousCart:false`; OIDC login required | Product-link handoff proven; authenticated cart mechanics understood; acceptable no-extension runtime unresolved |
| Dunnes | **Instacart Storefront** | Stable numeric `store_sku`, `rsid` URLs; production gateway store ID `258` | `/api/stores/258/cart`; server advertises `GET, POST` | Unauthenticated cart GET returns `401`; auth/session required | Cart path/auth boundary proven read-only; exact authenticated POST model still to confirm |
| Tesco | Tesco Ireland + historical Pepesto integration | Existing store product mapping; exact Tesco product URLs used in prior tests | Pepesto checkout protocol tested with a three-product Tesco basket and continuation turns | Pepesto browser-driving checkout protocol | Prior basket-handoff work exists and must be recovered before new implementation |
| Aldi | Retailer catalogue pipeline | Existing catalogue mapping | No established online grocery checkout | — | No execution adapter target currently |

## SuperValu

### Price-refresh recovery — 10 September 2026

The Vercel-native product-page refresh was transport-healthy but degraded at
55.0% on 10 September: every page fetch completed, while 263 products failed
identity validation and 187 yielded no parsed product data. The main false
failure was fallback metadata parsing that truncated apostrophes and inch marks.
The direct worker also did not read the `__PRELOADED_STATE__` product data used
by the historical Playwright implementation.

The recovery path parses delimiter-aware metadata and embedded retailer state,
captures/validates retailer SKU when exposed, and keeps canonical size checks
fail closed. Repeated failures are deprioritised behind healthier missing-price
gaps after two unsuccessful attempts since the last success, while remaining
eligible for later repair work. This is pricing-pipeline logic only and does not
change the authenticated-cart status described below.

### Data available

The SuperValu data pipeline captures `store_sku`, `store_url`, retailer product name, current price and store-scoped URLs containing `rsid`.

### PR #21

Branch: `agent/retailer-handoff`

Draft PR #21 established the retailer abstraction and a truthful `product_links` handoff. It should not be described as trolley population.

### Live cart findings — 29 August 2026

Read-only Storefront inspection established:

- SuperValu uses Instacart Storefront.
- `rsid` maps to retailer-store context.
- cart is store scoped.
- normal add contract uses a POST to a `stores/{retailerStoreId}/cart` resource.
- product add data includes quantity, SKU, catalog source and selected shopping-mode ID.
- client code contains single and bulk add models: `AddProductLineItemToCart` and `AddProductLineItemsToCart`.
- quantity update uses `SetLineItemQuantity`.
- cart can be built/reviewed before final slot/payment stages.
- live SuperValu configuration has anonymous cart disabled.
- Add while logged out triggers retailer authentication.
- auth references include `sts.supervalu.ie`.

### Security/product boundary

Do not replay SuperValu auth/session tokens server-side, capture passwords, bypass retailer login, or report `authenticated_cart` until a real trolley has been populated through a legitimate user-authorised path.

### Browser bridge experiment

Branch `agent/supervalu-browser-bridge-poc`, draft PR #56, proved a possible browser-side interaction model using SuperValu's visible Add button. It required an extension.

Product decision: **reject extension requirement for mainstream UX.**

A normal supermarket.ie webpage cannot execute authenticated SuperValu cart operations in the shopper's SuperValu origin because of browser same-origin/security boundaries.

## Dunnes

### Platform correction

Current Dunnes grocery should **not** be described as a separate Wynshop execution platform in project state. Current production code explicitly calls the **Instacart Storefront API**.

Production Dunnes refresh configuration:

- `STORE_ID = 258`
- `GATEWAY_BASE = https://storefrontgateway.dunnesstoresgrocery.com/api`
- `SITE_URL = https://www.dunnesstoresgrocery.com`
- delivery shopping-mode ID: `22222222-2222-2222-2222-222222222222`
- search endpoint: `/api/stores/258/search`
- Storefront request headers include `x-site-host`, `x-site-location`, `x-correlation-id` and `x-shopping-mode`

Mapped products already carry stable SKUs and store-scoped retailer URLs.

### Read-only cart experiment — 29 August 2026

Experiment branch: `agent/dunnes-cart-probe`

The original HTML probe was blocked by Cloudflare, so the experiment was corrected to use the **same Dunnes Storefront gateway transport already used by our production refresh**. This is important: the successful production path does not depend on scraping the Dunnes HTML page.

The Vercel-side probe performed only read operations/metadata checks. It did **not** authenticate a shopper, POST to a cart, mutate a cart, or use Pepesto.

Results:

- `GET /api/stores/258/search` using production-style headers → **200 application/json**
- `OPTIONS /api/stores/258/cart` → **405**, with `Allow: GET, POST`
- unauthenticated `GET /api/stores/258/cart` → **401 application/json**

Conclusions:

1. Dunnes has a store-scoped Storefront cart resource at `/api/stores/258/cart`.
2. That resource supports POST cart mutation.
3. The cart is authentication/session-bound.
4. The underlying retailer execution architecture is materially closer to SuperValu than previously understood.
5. A shared **Instacart Storefront execution layer** should now be preferred over independent SuperValu/Dunnes cart plumbing, subject to confirmation of Dunnes' authenticated POST domain model.

### What is not yet proven

We have **not** sent a Dunnes cart POST and therefore have not truthfully established the exact authenticated content type/domain-model or request body. Do not claim the SuperValu `AddProductLineItemsToCart` body is identical until verified.

The most likely next source of proof should be common Storefront client behaviour or Pepesto's recorded protocol, rather than mutating a cart merely to learn the API.

The temporary one-shot GitHub workflow used to invoke the sanitized probe was removed after the experiment.

### Native Dunnes UX

Dunnes publicly exposes:

- product-level Add to Cart controls while browsing;
- saved lists/favourites;
- past purchases/order history;
- multi-item **Add selected to cart** from a prior order.

Those first-party features are consistent with the existence of a bulk cart primitive, but do not alone prove its wire contract.

## Tesco / Pepesto — PRIOR CHECKOUT WORK EXISTS

This section is critical. **Do not describe the prior Pepesto work as search/retrieval only.**

### Existing branch and access

Existing branch: `pepesto-tesco-adapter`

Historical adapter: `src/lib/pepesto-tesco.ts`

API base: `https://s.pepesto.com/api`

Credential retrieval was server-side through:

`supabaseAdmin.rpc('get_pepesto_api_key')`

Do not expose the returned value.

### Phase 1 — Tesco product retrieval

Earlier work used `/credits`, `/search` and `/retrieve` to improve Tesco product discovery/pricing where direct retailer scraping was difficult.

### Phase 2 — Pepesto checkout protocol reverse-engineering

On 21 August 2026, we deliberately moved from product retrieval into **basket creation / checkout protocol investigation**.

Repo history includes:

- `add one-time Pepesto checkout protocol test`
- `add three-product Pepesto checkout protocol test`
- `schedule three-product Pepesto checkout protocol test`
- `add one-time Pepesto checkout continuation`
- `add one-time Pepesto checkout recovery turn`
- `add fresh recorded Pepesto checkout session`
- `schedule fresh Pepesto checkout recording`

The three-product protocol test used known Tesco product URLs and implemented:

1. `/products` with `supermarket_domain: 'tesco.ie'` and exact preferred Tesco URLs.
2. Select exact returned product matches.
3. Extract Pepesto `session_token`s.
4. Build `skus` with `session_token` + `num_units_to_buy`.
5. `/session` to create the basket session.
6. Receive `session_id`.
7. `/checkout` with `continue_session_id`.
8. Record the returned checkout instruction.
9. Continue the same session in later `/checkout` turns.

The instruction parser explicitly handled:

- `load_page`
- `await_element`
- `run_js`
- `prompt_user_action`
- `await_js_out_change`
- `done`

This proves that prior work already used Pepesto as a reference implementation for retailer basket creation and began translating that learning into Supermarket.ie handoff work.

### Recorded sessions / cost discipline

Historical `scrape_runs` records still exist.

Known Tesco session:

`76a090b1-f7f9-437d-b505-2b996f00718a`

Historical three-product cost:

- `/products`: €0.04
- `/session`: €1.20
- first `/checkout`: €0.00
- continuation/recovery checkout turns: €0.00

Do not pay to recreate this protocol unless a decisive retailer-specific instruction cannot otherwise be recovered.

## Pepesto current execution model

Pepesto's current public documentation confirms that `/checkout` is a turn-by-turn **browser-driving** protocol. The client repeatedly receives instructions such as page loading, DOM waits, JavaScript execution, user prompts and completion state.

Pepesto explicitly describes compatible clients such as a mobile WebView, browser extension or Playwright environment. It does not automate payment.

### Public no-key / MCP path

Pepesto's hosted Agent-to-Cart MCP can receive a shopping list without an API key or upfront credit use. However, the current consumer journey is:

`AI/MCP → Pepesto link → Pepesto mobile app → checkout-driving loop → retailer cart/login`

On desktop, Pepesto shows a QR code to continue in the mobile app.

Therefore the free MCP path is useful for **studying Pepesto and validating retailer coverage**, but it is not evidence of a browser-only supermarket.ie handoff.

### Dockable / iframe UI

Pepesto publicly provides a `dockable.js` embed for its hosted basket/review UI (`app.pepesto.com`). Current docs say the actual checkout action subsequently redirects into Pepesto's mobile app. The iframe itself is not a demonstrated way to run authenticated retailer cart mutations from an ordinary third-party webpage.

### Strategic interpretation

Pepesto remains useful in two ways:

1. as a reference/oracle for retailer-specific checkout steps;
2. potentially as an execution backend if its app/runtime trade-off becomes acceptable.

But the preferred Supermarket.ie product remains:

`Shopping Capability Layer → retailer execution → retailer checkout`

with the Supermarket.ie experience retained as much as possible and no consumer browser extension.

## Shared Storefront direction

The latest findings materially change the adapter design assumption.

SuperValu and Dunnes both sit on Instacart Storefront-style infrastructure. Therefore the likely architecture should become:

`RetailerAdapter → InstacartStorefrontExecutionEngine → retailer-specific config/auth/store context`

rather than duplicating cart mechanics independently.

Potential retailer-specific configuration includes:

- storefront hostname
- gateway hostname
- retailer/store ID resolution
- shopping-mode resolution
- auth host/SSO behaviour
- exact cart domain-model/body if it differs
- final cart-review URL

Do not implement this as `authenticated_cart` until an actual shopper-authorised trolley population has been proven.

## Retailer adapter semantics

Execution methods must be named truthfully:

- `product_links` — mapped retailer product links only
- `guided_cart` — shopper is guided through retailer additions but cart is not automatically populated
- `authenticated_cart` — shopper-authorised retailer trolley is actually populated
- `authorised_partner_cart` — cart populated through a retailer/commerce partner integration

Do not use `authenticated_cart` or emit `retailer_trolley_prepared` merely because mappings, endpoints or protocol instructions exist.

## Transaction events

Target events:

- `basket_prepared`
- `retailer_selected`
- `handoff_started`
- `handoff_items_mapped`
- `retailer_trolley_prepared`
- `retailer_checkout_opened`
- `purchase_confirmed` only where legitimately observable

Capture retailer, mapped/total item count, approximate basket value and execution method where appropriate, while avoiding retailer credentials/payment data.

## Next investigation

1. Treat SuperValu and Dunnes as a common Instacart Storefront execution family.
2. Recover the most detailed historical Tesco/Pepesto checkout instruction payloads available without new paid sessions.
3. Inspect public Storefront/Pepesto client behaviour for the exact Dunnes authenticated cart domain model without mutating a trolley.
4. Determine whether any legitimate browser-native authenticated handoff exists; do not seek same-origin/security bypasses.
5. If a new Pepesto Dunnes/SuperValu session is genuinely the only way to expose a decisive missing instruction, tell the user before spending credits and use the smallest possible test.
6. Once an actual cart population works, bring the shared execution engine behind the existing Shopping Capability Layer and add transaction attribution.


## Pricing recovery follow-up — 19 September 2026

Fresh 1,000-product runs validated 701 SuperValu products (70.1%) and 698 Dunnes
products (69.8%). These are price-pipeline results and do not change the cart
execution status above.

Dunnes now uses a bounded deterministic query ladder for failed resolved
mappings: stored retailer title, title encoded in the retailer URL, then
canonical title. Candidates continue through exact retailer identity, size and
type safeguards; the URL title does not establish a trusted match by itself.
Retailer boilerplate and simple inflections are normalised, and failed matches
record bounded query/candidate diagnostics.

SuperValu direct-page validation similarly normalises retailer boilerplate,
simple inflections and explicit retailer pack-unit wording. Explicit size
conflicts remain rejected. The 192 empty product shells in the latest run remain
a separate remapping/discovery workload.


### Failure-cohort validation result

A post-release run re-tested 150 products per retailer that had failed in the
preceding full run. SuperValu recovered 27 (18%) and Dunnes recovered 15 (10%).
These percentages describe deliberately failure-heavy repair cohorts, not normal
scheduled-run coverage. The recovery added 27 and 15 current trusted prices
respectively. Future operational reporting must distinguish targeted validation
runs from scheduled full runs so canary thresholds do not overwrite full-run
health.

### Run-scope reporting

Direct-retailer runs now record an explicit operational scope. Scheduled
1,000-product runs are the only Dunnes/SuperValu runs used for the primary
dashboard and watchdog health signal. Targeted validation, canary, catch-up and
discovery results remain available as separate diagnostics and continue to
produce scope-labelled coverage snapshots. Do not compare a deliberately
failure-heavy repair cohort's success percentage with the scheduled full-run
threshold.

### Next deterministic recovery tranche

Dunnes direct matching now recognises equal explicit item counts when one title
uses `N Pack` and the retailer title uses a leading count plus total weight. It
continues to reject different variants, sizes and single-versus-multipack
changes. Failure samples include returned price state for the next cohort
analysis.

For SuperValu empty product shells, the direct worker performs at most two
compact Storefront searches and accepts only a unique priced candidate that
passes canonical name and pack validation (or one compatible candidate with
the same SKU). It writes the replacement product URL/SKU through the existing
finalizer. Ambiguous results and empty searches remain failures with bounded
diagnostics. This path uses retailer data only and makes no model or paid
retrieval call.

An exact validation replay can pass the previous scrape run UUID as
`failure_run=<uuid>` with `scope=targeted_validation`. The selector then limits
the new run to products that recorded a failure in that run; scheduled selection
and scheduled health remain unchanged.

### Exact-cohort production result

The deployed tranche recovered 8/123 remaining SuperValu failures. The Dunnes
diagnostics revealed one overly strict pack-notation case; after accepting
`N Pack` versus the same explicit `N x unit-size` count while retaining the
single-item/multipack and variant guards, the exact replay recovered 22/131.

Current live trusted coverage is 1,588/2,462 (64.50%) for SuperValu and
872/2,462 (35.42%) for Dunnes; demand-weighted coverage is 81.13% and 70.10%.
The latest scheduled full-run health remains 70.10% and 69.80%, because these
failure-heavy results remain scoped as `targeted_validation`. The remaining
115 SuperValu and 109 Dunnes cases require stale-mapping cleanup or discovery,
not weaker matching thresholds.

### Retailer-owned mapping discovery

SuperValu's public Storefront configuration exposes a JSON gateway at
`storefrontgateway.supervalu.ie/api`; store-scoped search for store `5550`
returns priced product identities. Recovery now uses that endpoint instead of
the unpopulated server-rendered search dictionary. It is bounded to the two
existing compact queries and applies to both empty product shells and stale
direct-name mismatches. Replacement still requires a unique canonical- and
size-compatible result, so generic or ambiguous families remain manual choices.

For Dunnes, an existing SKU or URL SKU may survive retailer title expansion
only when all meaningful canonical terms remain present and the existing
size, pack, type and variant checks pass. This is mapping cleanup, not a global
similarity-threshold reduction. Both changes use retailer-owned data and incur
no AI-token or paid scraping usage. Exact-cohort production validation is the
next step.

Production validation recovered 6/115 SuperValu mappings and 23/109 Dunnes
mappings. Live trusted coverage moved to 1,594/2,462 (64.74%) and 895/2,462
(36.35%); demand-weighted coverage moved to 81.56% and 72.51%. Remaining
failure cohorts are 109 for SuperValu (57 ambiguous remaps, 51 empty search
states and one direct-name mismatch) and 86 for Dunnes (51 no-confident-match
and 35 no-search-results). These residuals remain candidates for explicit
catalogue discovery or manual product choice, not weaker identity matching.

The subsequent compact-query validation recovered another 18/86 Dunnes
products. Dunnes now has 913/2,462 live trusted products (37.08%) and 74.44%
demand coverage. The remaining Dunnes cohort is 55 ambiguous candidates and 13
no-search-results; these require explicit catalogue/manual resolution rather
than another confidence relaxation.

### Resolution safety follow-up

The combined 177-record residual was classified before further writes: 65
search/query failures, 51 variant/size/pack conflicts, 38 insufficient-evidence
records, 15 poor or underspecified canonical identities and eight conservative
same-SKU exact candidates. No current record qualifies as a proven retailer
absence. Candidate identity and price must be reconstructed from captured
retailer evidence server-side; browser-supplied candidate fields are not a
trust boundary. Automatic exact resolution also requires exact explicit
measure/pack agreement, no variant conflict, complete canonical signals and
stored-title corroboration. Generic or malformed catalogue identities remain
unresolved pending canonical product-policy work.

Eight strict same-SKU exact Dunnes decisions increased live trusted coverage to
921/2,462 (37.41%) and demand coverage to 74.50%. The next targeted replay
confirmed that the older worker heuristic did not recognise these same strict
decisions. The worker now reuses the resolution predicate for same-SKU
candidates before its legacy fallback, ensuring accepted exact mappings remain
refreshable without weakening general candidate matching.

Production replay `e878ac5f-4242-4856-aaa2-cd0333b5aeb3` then refreshed 26/86
Dunnes products, exactly eight more than the earlier 18/86 result. Sixty remain:
47 `no_confident_match` and 13 `no_search_results`. The combined SuperValu and
Dunnes resolution queue is now 169 records. Dunnes remains at 921/2,462 live
trusted products (37.41%) and 74.50% demand coverage; SuperValu remains at
1,594/2,462 (64.74%) and 81.56% demand coverage.


## 3 November 2026 — retailer offer identity and comparison labels

`latest_prices` retains its **exact-to-canonical trusted-price** boundary.
A current price does not certify that two retailers' products are the same.
After successful guarded retailer collection, independently capture and retain
direct SKU-bound response evidence, original body hash, source URL, capture
UTC time, brand/GTIN/variant/formulation/quantity/pack and review rationale.
The separate reviewed pairwise relationship is either **Exact product**,
**Comparable alternative**, **Not comparable** or **Unverified**. Review all
three pairs before advertising a three-store exact comparison. Contradictory
packs, variants, species and diets remain rejected; missing evidence stays
unverified. AI inference proposes, never approves a record by confidence.

A comparable own-brand or different-pack alternative must be reviewed for
function, intended use, dietary compatibility and current unit price. Its
actual retailer title/pack and explicit alternative label appear beside the
price; unequal packs cannot be priced as identical basket items. Do not
change existing exact mapping/collector approval thresholds to obtain
alternative coverage. See `docs/retailer-comparison-policy.md`.

Priority remains supervised Tesco renewal before ordinary and reviewed-held
expansion, using the approved SQL bridge, 10-request maximum batches,
leases/pacing/circuit breakers and guarded finaliser. Fresh Tesco prices can
be valid without fresh peers. Preserve the seven unresolved pages, exclude
shared SKUs and never restart a stopped/unknown request.


## Wider Tesco recovery review

Use `tesco-hold-reentry-assess.ts --all-peers` through the existing SQL bridge
to enumerate zero-, one- and two-peer held mappings. Review original source
identity and provenance independently. This triage option grants no approval.
Use evidence-bound one-time operational decisions and live guarded collection
in batches of at most ten. Preserve the campaign request budget across sessions.
Brand punctuation normalisation does not establish cross-retailer equivalence.


### Explicit food counts

The supervised identity gates recognise explicit counts separated from stock
cubes or bagels by bounded product descriptors. Compare the count across
canonical identity, retained Tesco evidence and retailer peers. A missing
count supplies no positive evidence. Different counts and explicit retail
multipack conflicts remain blocked. Apply the forward private-helper migration
before using the corresponding reviewed collector revision.


### Evidence acquisition for known Tesco mappings

Use the existing supervised CLI in expansion mode with `--evidence-only`,
`--evidence-mappings` containing explicit mapping identifiers, and a limit of
at most ten. Dry-run selection precedes an authorised live run. Apply the receipt-guard migration before acquisition. The run stores
fresh source evidence for resolved or failed mappings without calling the price
finaliser. Failed mapping status remains subject to evidence-bound repair. A database trigger
also rejects price receipts against evidence-only runs. The same purpose
flag is required when resuming an interrupted evidence run. Retain pending
requests for reconciliation. A source capture is not a recovered price.

Review the new source through the normal audited re-entry workflow. Only the
exact successful, finished source-only page is exempt from the recent-attempt
check for its separately approved follow-up. Other recent/pending attempts block. That workflow fetches a new live price and
consumes a one-time decision. Evidence pages retain their original timestamps.

### Bounded wording review

Retained-source review normalises stir fry/stirfry and multipurpose cleaning
wording only after separate brand, pack and variant checks. These equivalents
do not establish a peer relationship or override a quantity or flavour conflict.

For unsized generic canonical names, a single peer must positively corroborate
the same branded whole-pack amount, with that brand also anchored in the original
Tesco mapping. Missing amounts and conflicting canonical packs remain blocked.

### Independently corroborated branded whole packs

A single peer may establish a manufacturer-branded, fully measured Tesco identity when its
brand, original mapping, canonical name, total quantity, barcode (if supplied)
and variant checks agree positively. Retailer own-label offers remain excluded
from this route. Preserve all peer evidence, including any
conflicting other mapping; that peer remains unverified. Never remove a peer
from a review snapshot to manufacture approval. Missing quantities, different
rice recipes and different named product ranges remain blocked.

### Evidence-first target repair

Use `scripts/tesco-repair-mapping.ts --stage PRIVATE_MANIFEST --dry-run` for
an explicitly reviewed retained-source hint. Each row supplies `mapping_id`,
`source_page_id`, `target_sku`, `source_body_sha256` and an independent
`review_reason`. Stage at most ten with `--confirm-repair` and a private
`--result-file`. Every mutation emits a unique batch before execution; an
unknown acknowledgement requires audit-ledger reconciliation, never replay.

Staging writes only the new target URL/SKU and failed status plus the atomic
prior-state audit. Use the EXISTING supervised collector's `--evidence-only`
mode on those mapping IDs. Independently inspect each completed new page,
including formulation, preparation and packaging. An activation manifest
supplies `audit_id`, the fresh `source_page_id`, `source_body_sha256` and a new
`review_reason`; use `--activate PRIVATE_MANIFEST --dry-run`, then
`--confirm-repair` only for supported records. Activation appends another audit
and changes retailer title, brand, GTIN and resolved status without a price.
Never alter the canonical identity or barcode to fit a candidate.

Only then use the ordinary evidence-bound one-use review and a separately
fetched guarded price. Failed/unknown acquisitions stay failed; preserve the
source record, both mapping snapshots and all pending requests. The operation
will not clear a lease/cooldown, reuse a pre-staging source, mutate an audit,
or retry a destination attempted since the selected hint.

### Interrupted supervisor evidence

Capture every supervised runner invocation's complete stdout in a new private
file outside the git repository, with restrictive permissions and shell
`pipefail` enabled. The JSONL stream includes source-bound SQL and may contain
retailer evidence; never publish it. Preserve the original stdin bridge and
pacing. After an interruption, inspect pending reservations, receipts, saved
captures and the exact audit batch before any continuation. A saved statement
is evidence to reconcile, not authority to replay an unknown mutation. If no
result was captured for a reserved request, retain it as pending and do not
fetch it again. A lease is allowed to expire naturally; do not clear it to
restart work early.

### Database reply deadlines

The three supervised SQL-bridge scripts allow 180 seconds for each connector
reply, accommodating its two-minute confirmation window. This is separate from
the unchanged thirty-second retailer network timeout and ten-minute egress
lease. Do not extend a lease or retry a request on timeout. Reconcile the exact
saved SQL, pending reservations and receipts. An incomplete evidence run with
no unresolved request can resume its untouched URLs using the same mode and
`--evidence-only` purpose; completed URLs and all circuit-breaker counters carry
forward. Source activation requires that acquisition to finish successfully.

### Explicit count evidence for plural whole packs

A mass-only plural catalogue title is not an explicit one-item assertion. An
inferred single-item default may yield to an explicit source count only for a
manufacturer-branded identity with unchanged total measure and a fresh,
independently branded peer explicitly corroborating that count and full measure.
Keep explicit canonical counts, singular items, manufacturer anchors, variants,
barcodes, structured quantity and own-label exclusions intact. A peer that omits
the count cannot supply the positive count proof; never discard it from the
snapshot or approve its equivalence implicitly.

### Server and live inferred-count proof

Only the server-derived evidence snapshot may establish the private plural-pack
proof. The canonical and source must share recipe/product words, manufacturer
and complete structured quantity; a fresh branded peer must explicitly state
the same count and complete measure. Preserve every peer in the snapshot.
The ordinary material conflict function and original retailer-title check stay
unchanged. The live handler may resolve the legacy pack predicate only for that
same proof and an unchanged new live identity; explicit original counts and
measures still block. No missing-price, recipe, barcode or ordinary collection
failure can inherit this exception.
