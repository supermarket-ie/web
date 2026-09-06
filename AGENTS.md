# supermarket.ie agent instructions

Before investigating, planning, or changing this repository, read
`PROJECT_STATE.md` in full and then read any specialist document it identifies
for the task, including `docs/retailer-execution.md` for retailer work.

After any material production finding, architecture decision, retailer-feed
change, deployment, migration, or operational change, update
`PROJECT_STATE.md` in the same pull request. Do not rely on chat history as the
project source of truth.

Where live state may have changed, verify GitHub `main`, Vercel production and
Supabase before acting. Do not treat a merged pull request as a successful
production release until the deployment and relevant production behaviour have
been verified.
