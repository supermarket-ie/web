# Dunnes usage-ranked discovery

Production manual operation: `[ops] Dunnes usage-ranked discovery`.

The operation snapshots up to 250 usage-ranked branded canonical products without an exact Dunnes SKU, queues bounded discovery batches, writes exact mappings only after conservative brand/product/variant/pack validation, stages different-pack matches in `store_product_alternative_candidates`, records rejected/no-match results, and finalizes trusted exact prices with `source = 'dunnes_direct'`.

The production dispatcher validates that the authorizing GitHub issue is open, authored by `supermarket-ie`, exactly matches the allowlisted operation title, and has not already been dispatched for its current issue version.
