# Prepared spelling-only repair (not applied)

`prepareSpellingRepair` generates a SQL document for the five identities reviewed
in PR #254. It has no database client and is not called by the application,
discovery pipeline, migration runner or collection process. Production execution
still requires explicit approval; no canonical or mapping data has been changed.

Supply a private manifest of all five full `products` rows (`expectedProduct`)
and every linked full `store_products` row (`expectedMappings`). Do not commit
that manifest or generated production SQL. The SKU/URL and title allowlist is
fixed. Before approval, rerun the PR #254 identity/negative controls against the
latest structured Tesco evidence and linked SuperValu/Dunnes identities.

The SQL document defaults to `ROLLBACK`. It has short lock and statement timeouts,
locks the dependency tables for its short transaction, refuses active Tesco leases
or cooldowns, and compares complete product and retailer snapshots. It refuses
missing rows, changed dependencies and partially applied states. Only all five
canonical titles can change, atomically; an already applied complete repair is a
no-op. No store mapping, historical price or timestamp is updated. Review the
broad short-lived table locks with the production operator before any approved
execution; they prevent concurrent dependency changes, including phantom rows.

Isolated PGlite tests execute the generated SQL, verify rollback, atomic application,
idempotence, peer drift, lease/cooldown holds and injection-resistant quoting.
The public identity fixtures retain all five Tesco SKU/direct URLs and run the
existing Tesco, SuperValu and Dunnes validators plus negative controls. Approval
of a title repair alone does not establish live price or availability, authorise
retries, or override any collection hold.
