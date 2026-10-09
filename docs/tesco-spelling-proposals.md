# Tesco spelling repair proposals — approval required

This proposal changes no production data, collector, matching rule or schedule.
The tests replay existing validators offline using public product-title fixtures.
A passing proposal is not a fresh price or permission to collect a repaired mapping.

| Canonical title now | Proposed title | Pack |
| --- | --- | --- |
| Batchelors Marrowfat Peas 420g | Batchelors Marrow Fat Peas 420g | 420g |
| Brennans Bakehouse Multiseed 500g | Brennans Bakehouse Multi Seed 500g | 500g |
| Airwick Pure Cherry Blossom Aerosol 250ml | Air Wick Pure Cherry Blossom Aerosol 250ml | 250ml |
| Airwick Pure Spring Delight Aerosol 250ml | Air Wick Pure Spring Delight Aerosol 250ml | 250ml |
| Airwick Pure Soft Cotton Aerosol 250ml | Air Wick Pure Soft Cotton Aerosol 250ml | 250ml |

Stored Tesco structured product evidence identifies the same brand, variant and
pack as the existing SuperValu and Dunnes metadata. The only proposed changes are
word spacing. No SKU, quantity, brand or variant changes accompany these titles.
The tests demonstrate that the current Tesco validator rejects the original
spelling and accepts the proposed spelling, and that both peer validators retain
compatibility. Wrong SKU, unavailable/no-price, wrong brand, wrong size and wrong
variant controls remain rejected. Stored availability is historical; current
availability and price require live verification after approval and gate checks.

Approval is still needed before an atomic, exact-before-value-guarded canonical
update. Re-read every retailer dependency and duplicate-SKU group at application
time; retain quantities, mapping IDs, peer SKUs and earlier observations. Abort on
changed evidence. This PR contains no migration or executable repair command.
Private evidence page IDs, hashes and mapping IDs remain in the operational queue.

Other cases remain held: Glenisk yoghurt spelling still has duplicate-SKU ambiguity;
Brady thin/thinly still fails pack exactness. Generic Colgate and oat-drink titles
match multiple distinct variants and are not exact replacements. Kilmeaden red
cheddar has a promising block-cheese replacement for an incorrect grated blend,
but is a separate SKU repair and is not covered by this spelling-only proposal.
