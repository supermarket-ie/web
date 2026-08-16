import { Sandbox } from '@vercel/sandbox';
import { supabaseAdmin } from '@/lib/supabase';

const ALDI_DAIRY_CATEGORY = 'https://www.aldi.ie/products/chilled-food/dairy/k/1588161416978076002';

export const maxDuration = 120;

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') return new Response(null, { status: 404 });

  const sandbox = await Sandbox.create({
    runtime: 'node24',
    timeout: 60_000,
    networkPolicy: { allow: ['www.aldi.ie'] },
  });

  try {
    const command = await sandbox.runCommand({
      cmd: 'curl',
      args: [
        '-sS', '-L', '--max-time', '20',
        '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        '-H', 'Accept-Language: en-IE,en;q=0.9',
        '-w', '\n__STATUS__:%{http_code}\n__FINAL__:%{url_effective}\n',
        ALDI_DAIRY_CATEGORY,
      ],
    });
    const stdout = await command.stdout();
    const status = Number(stdout.match(/__STATUS__:(\d+)/)?.[1] ?? 0);
    const finalUrl = stdout.match(/__FINAL__:(.+)/)?.[1]?.trim() ?? null;
    const body = stdout.split('\n__STATUS__:')[0] ?? '';

    const result = {
      sandbox_region: sandbox.region,
      exit_code: command.exitCode,
      http_status: status,
      final_url: finalUrl,
      bytes: body.length,
      category_contains_target: /Irish Double Cream/i.test(body),
      access_denied: /Access Denied|don't have permission/i.test(body),
      euro_prices: Array.from(body.matchAll(/€\s*(\d+(?:\.\d{1,2})?)/g))
        .map((match) => Number(match[1]))
        .filter((value, index, values) => value > 0 && value < 1000 && values.indexOf(value) === index)
        .slice(0, 10),
      body_preview: body.slice(0, 160),
    };

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from('scrape_runs').insert({
      store: 'aldi',
      started_at: now,
      finished_at: now,
      target_count: 1,
      fetched: status === 200 ? 1 : 0,
      extracted: result.category_contains_target ? 1 : 0,
      inserted: 0,
      failed: result.category_contains_target ? 0 : 1,
      run_id: `preview_aldi_sandbox_${Date.now()}`,
      attempted_count: 1,
      unchanged_count: 0,
      silently_skipped_count: 0,
      retrieval_method: 'preview_canary_sandbox',
      duration_seconds: 0,
      status: result.category_contains_target ? 'success' : 'failed',
      coverage_pct: result.category_contains_target ? 100 : 0,
      threshold_pct: 100,
      threshold_breached: !result.category_contains_target,
      error_summary: JSON.stringify(result),
    });
    if (error) console.error('[aldi-sandbox-canary] failed persisting result', error.message);

    return Response.json(result);
  } finally {
    await sandbox.stop();
  }
}
