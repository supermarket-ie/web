/**
 * Scheduled task runner — the AWS replacement for Vercel Cron.
 *
 * EventBridge Scheduler runs this as a one-off ECS task (Fargate) with the env
 * var CRON_JOB set to the job key. The runner invokes the SAME route handler the
 * Vercel cron path would hit, in-process, with a synthetic authenticated Request
 * carrying `Authorization: Bearer $CRON_SECRET`. This avoids ALB idle-timeouts
 * for long (up to 300s) producer runs and keeps the cron logic byte-identical.
 *
 * Every job preserves the existing route's guards (CRON_SECRET auth, worker
 * enable flags, Tesco egress canary/lease/cooldown, idempotent finalisation,
 * preview/kill-switch guards). Nothing here bypasses them.
 *
 * Run with: QUEUE_BACKEND=sqs CRON_JOB=<key> node --import tsx src/workers/scheduled-runner.ts
 */

type RouteModule = { GET: (req: Request) => Promise<Response> };

type JobDef = {
  // Dynamic import of the route module. Route modules export extra members
  // (dynamic, maxDuration, …) and typed GET signatures vary (Request vs
  // NextRequest), so we accept `unknown` and narrow to the GET we call.
  load: () => Promise<unknown>;
  // Path + query string the Vercel cron used, so query params are preserved.
  path: string;
};

// Mirrors vercel.json `crons`. Keys are stable job identifiers for EventBridge.
const JOBS: Record<string, JobDef> = {
  'weekly-digest': {
    load: () => import('@/app/api/cron/weekly-digest/route'),
    path: '/api/cron/weekly-digest',
  },
  'check-alerts': {
    load: () => import('@/app/api/cron/check-alerts/route'),
    path: '/api/cron/check-alerts',
  },
  'agent-tasks': {
    load: () => import('@/app/api/cron/agent-tasks/route'),
    path: '/api/cron/agent-tasks',
  },
  'price-watchdog': {
    load: () => import('@/app/api/cron/price-watchdog/route'),
    path: '/api/cron/price-watchdog',
  },
  'price-watchdog-thursday': {
    load: () => import('@/app/api/cron/price-watchdog/route'),
    path: '/api/cron/price-watchdog?nudge=thursday',
  },
  'scrape-watchdog': {
    load: () => import('@/app/api/cron/scrape-watchdog/route'),
    path: '/api/cron/scrape-watchdog',
  },
  'product-embeddings': {
    load: () => import('@/app/api/cron/product-embeddings/route'),
    path: '/api/cron/product-embeddings',
  },
  'dunnes-scrape-trigger': {
    load: () => import('@/app/api/workers/dunnes-scrape-trigger/route'),
    path: '/api/workers/dunnes-scrape-trigger?limit=1000&scope=scheduled_full',
  },
  'supervalu-scrape-trigger': {
    load: () => import('@/app/api/workers/supervalu-scrape-trigger/route'),
    path: '/api/workers/supervalu-scrape-trigger?limit=1000&scope=scheduled_full',
  },
  'pepesto-tesco-retrieve': {
    load: () => import('@/app/api/workers/pepesto-tesco-retrieve/route'),
    path: '/api/workers/pepesto-tesco-retrieve',
  },
};

async function main() {
  const jobKey = process.env.CRON_JOB?.trim();
  if (!jobKey) throw new Error('CRON_JOB env var is required');
  const job = JOBS[jobKey];
  if (!job) throw new Error(`Unknown CRON_JOB "${jobKey}". Known: ${Object.keys(JOBS).join(', ')}`);

  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is required to invoke scheduled routes');

  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.supermarket.ie').replace(/\/$/, '');
  const url = `${base}${job.path}`;
  const request = new Request(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${secret}` },
  });

  console.log('[scheduled-runner] invoking', { job: jobKey, path: job.path });
  const mod = (await job.load()) as RouteModule;
  if (typeof mod.GET !== 'function') throw new Error(`Route for job "${jobKey}" has no GET handler`);
  const response = await mod.GET(request);
  const bodyText = await response.text().catch(() => '');
  console.log('[scheduled-runner] complete', {
    job: jobKey,
    status: response.status,
    body: bodyText.slice(0, 500),
  });

  // Non-2xx is surfaced as a non-zero exit so EventBridge/ECS marks the run
  // failed and alarms can fire; the route's own guards decide 2xx vs 4xx/5xx.
  process.exit(response.ok ? 0 : 1);
}

main().catch((error) => {
  console.error('[scheduled-runner] fatal', error);
  process.exit(1);
});
