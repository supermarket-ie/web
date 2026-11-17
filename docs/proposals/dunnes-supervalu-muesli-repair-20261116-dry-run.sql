-- Guarded Dunnes/SuperValu re-point batch dunnes-supervalu-muesli-20261116 (generated 2026-11-16T22:30:00.000Z).
-- Run ONLY through the postgres supervised bridge. NOT APPLIED. Dry run ends in ROLLBACK.
-- Offers MOVE with their history (keyed by store_product_id). Only an EMPTY sku-less placeholder may be removed.
begin;
do $held$ begin raise exception 'HELD: identity_not_established for dunnes:100673561'; end $held$;
-- Proposed changes (NOT executable until identityVerifiedBy is recorded on each op):
--   move dunnes:100673561 (7d80821c-7231-4e2f-b09c-36a463d1cc78) 1cca7ae6-2118-4871-be9a-d8eeb359f0ed -> ac3ad0c4-b393-451b-b9a2-9e4a6bb87b7c; retire empty placeholder 55b87c18-db0c-4f1d-83d0-4531c7e004f0
rollback;
