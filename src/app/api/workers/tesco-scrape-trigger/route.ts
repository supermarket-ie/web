/**
 * /api/workers/tesco-scrape-trigger — Vercel Cron trigger endpoint
 *
 * STATUS: DISABLED — returns 503 until TESCO_VERCEL_WORKER_ENABLED=true is set.
 * The EC2/systemd scraper remains the sole production scheduler.
 * Do not activate until:
 *   1. A real Vercel Queue consumer exists (no inline processing here).
 *   2. At least two parallel EC2 validation runs have completed successfully.
 *   3. Paul has explicitly approved the cutover in writing.
 *
 * Security requirements enforced:
 *   - TESCO_VERCEL_WORKER_ENABLED must be exactly 'true' or the endpoint returns 503.
 *   - SCRAPE_CRON_SECRET must be set or the endpoint returns 503.
 *   - Every request must supply Authorization: Bearer <SCRAPE_CRON_SECRET>.
 *   - Vercel Cron sends its own Authorization header; this endpoint validates it
 *     against SCRAPE_CRON_SECRET, NOT against Vercel's built-in cron auth token
 *     (which would require VERCEL_AUTOMATION_BYPASS_SECRET — a separate concern).
 *
 * Required environment variables (none yet set on Vercel):
 *   TESCO_VERCEL_WORKER_ENABLED  — must be 'true' to enable; anything else = 503
 *   SCRAPE_CRON_SECRET           — shared secret; must be set or endpoint returns 503
 *   TESCO_METHOD                 — 'scrapingbee' | 'playwright' (default: scrapingbee)
 *
 * Future environment variables (for Queue consumer, not yet implemented):
 *   VERCEL_QUEUE_URL             — Queue endpoint URL
 *   VERCEL_QUEUE_TOKEN           — Queue auth token
 *
 * Vercel cron config (add to vercel.json when activating — NOT YET ADDED):
 *   "crons": [
 *     { "path": "/api/workers/tesco-scrape-trigger", "schedule": "0 5 * * 1" },
 *     { "path": "/api/workers/tesco-scrape-trigger", "schedule": "0 5 * * 4" }
 *   ]
 */

export async function POST(req: Request): Promise<Response> {
  // ---- Guard 1: feature flag ----
  // Returns 503 (not 401) so monitoring can distinguish "disabled" from "auth failure".
  if (process.env.TESCO_VERCEL_WORKER_ENABLED !== 'true') {
    return Response.json(
      { error: 'Worker not enabled', detail: 'Set TESCO_VERCEL_WORKER_ENABLED=true to activate.' },
      { status: 503 }
    );
  }

  // ---- Guard 2: secret must be configured ----
  const cronSecret = process.env.SCRAPE_CRON_SECRET;
  if (!cronSecret) {
    // Log server-side only; do not expose in response
    console.error('[tesco-scrape-trigger] SCRAPE_CRON_SECRET is not set — rejecting all requests');
    return Response.json(
      { error: 'Worker misconfigured' },
      { status: 503 }
    );
  }

  // ---- Guard 3: authorisation ----
  const authHeader = req.headers.get('authorization') ?? '';
  const suppliedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!suppliedToken || suppliedToken !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ---- Stub: Queue not yet implemented ----
  // When Vercel Queues are available, this block enqueues batches of products
  // for the separate /api/workers/tesco-batch-worker consumer.
  // No inline product processing occurs here — this endpoint only triggers the queue.
  //
  // Sketch of future implementation:
  //
  //   const runId = new Date().toISOString().replace(/[^0-9]/g,'').substring(0,12);
  //   // ... fetch and sort products (stalest-first) ...
  //   // ... split into batches of BATCH_SIZE (e.g. 50) ...
  //   for (const [idx, batch] of batches.entries()) {
  //     await fetch(process.env.VERCEL_QUEUE_URL!, {
  //       method: 'POST',
  //       headers: {
  //         Authorization: `Bearer ${process.env.VERCEL_QUEUE_TOKEN}`,
  //         'Content-Type': 'application/json',
  //       },
  //       body: JSON.stringify({
  //         run_id: runId,
  //         batch_index: idx,
  //         total_batches: batches.length,
  //         products: batch,
  //       }),
  //     });
  //   }
  //   return Response.json({ run_id: runId, batches_enqueued: batches.length });

  return Response.json(
    {
      status: 'stub',
      detail: 'Queue consumer not yet implemented. No work was performed.',
    },
    { status: 501 }
  );
}

// Only POST is accepted — Vercel Cron uses POST.
export async function GET(): Promise<Response> {
  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
