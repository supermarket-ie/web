// Wait for the single Apify collector lease instead of failing a timed run (24 Nov 2026).
// Only ONE Apify run may hold the gate (tesco_egress_pool apify-tesco-ie-20261108). A timed one-off run that starts
// while another run holds the lease (or the gate is in its transport cooldown) used to die with
// "apify_begin_tesco_run: apify_gate_unavailable" and its whole tranche was missed. apify_begin_tesco_run is the
// FIRST write of a batch (no budget reservation, request or page precedes it), so retrying exactly that refusal is
// side-effect free. Any other error is rethrown unchanged; with waitMs = 0 behaviour is unchanged.
export const GATE_UNAVAILABLE = 'apify_begin_tesco_run: apify_gate_unavailable';

export async function withApifyLeaseWait<T>(run: () => Promise<T>, opts: {
  waitMs: number; pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>;
  log?: (e: Record<string, unknown>) => void;
}): Promise<T> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 60_000;
  const deadline = now() + Math.max(0, opts.waitMs);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes(GATE_UNAVAILABLE)) throw e;
      const remaining = deadline - now();
      if (remaining <= 0) { opts.log?.({ event: 'lease_wait_exhausted', attempt }); throw e; }
      const wait = Math.min(pollMs, remaining);
      opts.log?.({ event: 'lease_wait', attempt, retryInSeconds: Math.round(wait / 1000), remainingSeconds: Math.round(remaining / 1000) });
      await sleep(wait);
    }
  }
}
