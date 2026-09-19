'use client';

import { FormEvent, useEffect, useState } from 'react';

type Coverage = {
  store: string;
  catalogue_products: number;
  mapped_products: number;
  resolved_products: number;
  live_trusted_products: number;
  ever_observed_products: number;
  never_observed_products: number;
  stale_products: number;
  expiring_within_24h: number;
  top_100_demanded_live: number;
  live_coverage_pct: number;
  demand_coverage_pct: number;
  latest_run_status: string | null;
  latest_run_coverage_pct: number | null;
  latest_auxiliary_run_scope: string | null;
  latest_auxiliary_run_status: string | null;
  latest_auxiliary_run_coverage_pct: number | null;
};

type HealthPayload = {
  generated_at: string;
  alerts: Array<{ severity: 'warning' | 'critical'; store: string; code: string; message: string }>;
  coverage: Coverage[];
  comparison: {
    catalogue_products: number;
    both_live: number;
    supervalu_only: number;
    dunnes_only: number;
    neither_live: number;
    both_live_pct: number;
    either_live_pct: number;
  };
  category_coverage: Array<{
    category: string;
    catalogue_products: number;
    supervalu_live: number;
    dunnes_live: number;
    both_live: number;
    neither_live: number;
    supervalu_pct: number;
    dunnes_pct: number;
  }>;
  latest_run_failures: Record<string, Record<string, number>>;
};

type ResolutionCandidate = { sku: string; name: string; price: number; url: string };
type ResolutionItem = {
  failure_id: string;
  store: 'supervalu' | 'dunnes';
  canonical_name: string;
  store_product_name: string;
  failure_reason: string;
  demand_units: number;
  demand_rank: number | null;
  candidates: ResolutionCandidate[];
  exactCandidates: ResolutionCandidate[];
  classification: string;
};

function title(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-2xl border border-[#dfe5df] bg-white p-5 shadow-[0_8px_30px_rgba(31,54,42,0.05)]">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#718077]">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-[#21382c]">{value}</p>
      {detail ? <p className="mt-1 text-sm text-[#728077]">{detail}</p> : null}
    </div>
  );
}

function RetailerCard({ row }: { row: Coverage }) {
  const storeName = row.store === 'supervalu' ? 'SuperValu' : 'Dunnes';
  return (
    <section className="rounded-3xl border border-[#dce4dc] bg-white p-6 shadow-[0_16px_45px_rgba(31,54,42,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#28794a]">{storeName}</p>
          <p className="mt-1 text-4xl font-semibold text-[#20372b]">{Number(row.live_coverage_pct).toFixed(1)}%</p>
          <p className="text-sm text-[#718077]">{row.live_trusted_products.toLocaleString()} current trusted prices</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
          row.latest_run_status === 'success'
            ? 'bg-[#e7f6eb] text-[#1f7642]'
            : 'bg-[#fff1df] text-[#9a5a14]'
        }`}>
          Scheduled run: {row.latest_run_status ?? 'not recorded'}{row.latest_run_coverage_pct == null ? '' : ` · ${Number(row.latest_run_coverage_pct).toFixed(1)}%`}
        </span>
      </div>
      {row.latest_auxiliary_run_status ? (
        <p className="mt-3 text-xs text-[#718077]">
          Latest {title(row.latest_auxiliary_run_scope ?? 'targeted')} run: {row.latest_auxiliary_run_status} · {Number(row.latest_auxiliary_run_coverage_pct ?? 0).toFixed(1)}%
        </p>
      ) : null}
      <div className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><span className="block text-[#77837b]">Resolved</span><strong>{row.resolved_products.toLocaleString()}</strong></div>
        <div><span className="block text-[#77837b]">Never observed</span><strong>{row.never_observed_products.toLocaleString()}</strong></div>
        <div><span className="block text-[#77837b]">Expiring in 24h</span><strong>{row.expiring_within_24h.toLocaleString()}</strong></div>
        <div><span className="block text-[#77837b]">Top 100 demand</span><strong>{row.top_100_demanded_live}/100</strong></div>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#edf1ed]">
        <div className="h-full rounded-full bg-[#2d8a53]" style={{ width: `${Math.min(100, Number(row.live_coverage_pct))}%` }} />
      </div>
      <p className="mt-2 text-xs text-[#7b887f]">Demand-weighted coverage: {Number(row.demand_coverage_pct).toFixed(1)}%</p>
    </section>
  );
}

export default function RetailerDataHealthPage() {
  const [adminKey, setAdminKey] = useState('');
  const [data, setData] = useState<HealthPayload | null>(null);
  const [resolutions, setResolutions] = useState<ResolutionItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function load(key: string) {
    setLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${key}` };
      const [response, resolutionResponse] = await Promise.all([
        fetch('/api/admin/scrape-health', { cache: 'no-store', headers }),
        fetch('/api/admin/product-resolutions', { cache: 'no-store', headers }),
      ]);
      if (!response.ok) throw new Error(response.status === 401 ? 'That admin key was not accepted.' : 'Data health could not be loaded.');
      const payload = await response.json() as HealthPayload;
      const resolutionPayload = resolutionResponse.ok
        ? await resolutionResponse.json() as { items: ResolutionItem[] }
        : { items: [] };
      sessionStorage.setItem('supermarket_admin_key', key);
      setData(payload);
      setResolutions(resolutionPayload.items);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : 'Data health could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const saved = sessionStorage.getItem('supermarket_admin_key');
    if (saved) {
      setAdminKey(saved);
      void load(saved);
    }
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (adminKey.trim()) void load(adminKey.trim());
  }

  async function resolve(item: ResolutionItem, action: 'exact' | 'unavailable' | 'skipped', candidate?: ResolutionCandidate) {
    const confirmed = action === 'exact'
      ? window.confirm(`Confirm ${candidate?.name ?? 'this product'} is the exact same consumer product as ${item.canonical_name}.`)
      : action !== 'unavailable' || window.confirm(`Mark ${item.canonical_name} unavailable at ${title(item.store)}?`);
    if (!confirmed) return;
    setError('');
    const response = await fetch('/api/admin/product-resolutions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ failure_id: item.failure_id, action, candidate }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Resolution failed.' })) as { error?: string };
      setError(payload.error ?? 'Resolution failed.');
      return;
    }
    setResolutions((current) => current.filter((entry) => entry.failure_id !== item.failure_id));
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-[#f6f4ee] px-5 py-16 text-[#24382e]">
        <form onSubmit={submit} className="mx-auto max-w-md rounded-3xl border border-[#dce4dc] bg-white p-7 shadow-[0_18px_55px_rgba(31,54,42,0.08)]">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#28794a]">Operations</p>
          <h1 className="mt-2 text-3xl font-semibold">Retailer data health</h1>
          <p className="mt-3 text-sm leading-6 text-[#6f7d75]">Enter the existing admin API key. It is held only for this browser session.</p>
          <input
            type="password"
            value={adminKey}
            onChange={(event) => setAdminKey(event.target.value)}
            placeholder="Admin API key"
            autoComplete="off"
            className="mt-6 w-full rounded-xl border border-[#ccd7ce] px-4 py-3 outline-none focus:border-[#2d8a53]"
          />
          {error ? <p className="mt-3 text-sm text-[#a33b2f]">{error}</p> : null}
          <button disabled={loading || !adminKey.trim()} className="mt-4 w-full rounded-xl bg-[#237344] px-4 py-3 font-semibold text-white disabled:opacity-50">
            {loading ? 'Loading…' : 'Open dashboard'}
          </button>
        </form>
      </main>
    );
  }

  const failures = ['supervalu', 'dunnes'].flatMap((store) =>
    Object.entries(data.latest_run_failures[store] ?? {}).map(([reason, count]) => ({ store, reason, count })),
  );

  return (
    <main className="min-h-screen bg-[#f6f4ee] px-5 py-10 text-[#24382e]">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#28794a]">Operations</p>
            <h1 className="mt-1 text-4xl font-semibold">Retailer data health</h1>
            <p className="mt-2 text-sm text-[#718077]">Generated {new Date(data.generated_at).toLocaleString('en-IE')}</p>
          </div>
          <button onClick={() => void load(adminKey)} className="rounded-xl border border-[#bfd0c2] bg-white px-4 py-2 text-sm font-semibold text-[#286f45]">
            Refresh
          </button>
        </div>

        {data.alerts.length ? (
          <section className="mt-8 space-y-2">
            {data.alerts.map((alert) => (
              <div key={`${alert.store}:${alert.code}`} className={`rounded-xl border px-4 py-3 text-sm ${
                alert.severity === 'critical' ? 'border-[#e6b5ae] bg-[#fff0ed] text-[#8c342a]' : 'border-[#ecd2a7] bg-[#fff7e9] text-[#895716]'
              }`}>
                <span className="font-semibold">{title(alert.store)}:</span> {alert.message}
              </div>
            ))}
          </section>
        ) : null}

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          {data.coverage.map((row) => <RetailerCard key={row.store} row={row} />)}
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Both retailers" value={data.comparison.both_live.toLocaleString()} detail={`${Number(data.comparison.both_live_pct).toFixed(1)}% of catalogue`} />
          <Stat label="Either retailer" value={`${Number(data.comparison.either_live_pct).toFixed(1)}%`} detail="At least one trusted price" />
          <Stat label="SuperValu only" value={data.comparison.supervalu_only.toLocaleString()} />
          <Stat label="Neither retailer" value={data.comparison.neither_live.toLocaleString()} />
        </section>

        <section className="mt-8 rounded-3xl border border-[#dce4dc] bg-white p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Product resolution queue</h2>
              <p className="mt-1 text-sm text-[#718077]">Demand-ranked internal evidence, classified conservatively. Only server-validated exact candidates can be applied.</p>
            </div>
            <span className="rounded-full bg-[#eef5ef] px-3 py-1 text-sm font-semibold text-[#286f45]">{resolutions.length} open</span>
          </div>
          {error ? <p className="mt-4 rounded-xl bg-[#fff0ed] px-4 py-3 text-sm text-[#8c342a]">{error}</p> : null}
          <div className="mt-5 space-y-4">
            {resolutions.slice(0, 40).map((item) => (
              <article key={item.failure_id} className="rounded-2xl border border-[#e2e8e2] p-5">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#28794a]">{title(item.store)} · {title(item.failure_reason)}</p>
                    <h3 className="mt-1 text-lg font-semibold">{item.canonical_name}</h3>
                    <p className="text-sm text-[#718077]">Stored as {item.store_product_name}</p>
                    <p className="mt-1 text-xs font-medium text-[#895716]">{title(item.classification)}</p>
                  </div>
                  <div className="text-right text-sm"><strong>{item.demand_units}</strong><span className="block text-xs text-[#718077]">demanded units</span></div>
                </div>
                {item.candidates.length ? (
                  <div className="mt-4 grid gap-2">
                    {item.candidates.map((candidate) => {
                      const exact = item.exactCandidates.some((itemCandidate) => itemCandidate.sku === candidate.sku);
                      return (
                      <div key={candidate.sku} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f7f9f7] px-4 py-3">
                        <div><p className="font-medium">{candidate.name}</p><p className="text-xs text-[#718077]">SKU {candidate.sku} · €{candidate.price.toFixed(2)}</p></div>
                        {exact ? <button onClick={() => void resolve(item, 'exact', candidate)} className="rounded-lg bg-[#237344] px-3 py-2 text-sm font-semibold text-white">Apply exact match</button> : <span className="text-xs font-medium text-[#718077]">Evidence only</span>}
                      </div>
                      );
                    })}
                  </div>
                ) : <p className="mt-4 rounded-xl bg-[#fff7e9] px-4 py-3 text-sm text-[#895716]">No retailer candidate was returned.</p>}
                <div className="mt-4 flex gap-2">
                  <button onClick={() => void resolve(item, 'skipped')} className="rounded-lg border border-[#d8dfd9] px-3 py-2 text-sm font-semibold text-[#68766e]">Skip</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="overflow-hidden rounded-3xl border border-[#dce4dc] bg-white">
            <div className="border-b border-[#e4e9e4] px-6 py-5">
              <h2 className="text-xl font-semibold">Largest category gaps</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#f7f9f7] text-xs uppercase tracking-wide text-[#758179]">
                  <tr><th className="px-5 py-3">Category</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">SuperValu</th><th className="px-4 py-3">Dunnes</th><th className="px-4 py-3">Neither</th></tr>
                </thead>
                <tbody>
                  {data.category_coverage.slice(0, 12).map((row) => (
                    <tr key={row.category} className="border-t border-[#edf0ed]">
                      <td className="px-5 py-3 font-medium">{row.category}</td>
                      <td className="px-4 py-3">{row.catalogue_products}</td>
                      <td className="px-4 py-3">{Number(row.supervalu_pct).toFixed(1)}%</td>
                      <td className="px-4 py-3">{Number(row.dunnes_pct).toFixed(1)}%</td>
                      <td className="px-4 py-3 font-semibold text-[#9a5a14]">{row.neither_live}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-3xl border border-[#dce4dc] bg-white p-6">
            <h2 className="text-xl font-semibold">Latest failure mix</h2>
            <div className="mt-5 space-y-3">
              {failures.map((failure) => (
                <div key={`${failure.store}:${failure.reason}`} className="flex items-center justify-between gap-4 rounded-xl bg-[#f7f9f7] px-4 py-3">
                  <div><p className="font-medium">{title(failure.reason)}</p><p className="text-xs text-[#758179]">{title(failure.store)}</p></div>
                  <strong className="text-lg">{failure.count}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
