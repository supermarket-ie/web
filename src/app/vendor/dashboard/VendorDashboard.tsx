'use client';
import { useState, useCallback } from 'react';
import Link from 'next/link';

interface Vendor {
  id: string; name: string; slug: string; email: string;
  status: string; plan: string; description: string | null;
  eircode: string | null; delivery_radius_km: number;
  click_and_collect: boolean; categories: string[];
}

interface VendorProduct {
  id: string; vendor_id: string; product_id: string | null;
  custom_name: string | null; price: number; in_stock: boolean;
  products: { id: string; canonical_name: string; category: string | null } | null;
}

interface CanonicalProduct { id: string; canonical_name: string; category: string | null; }

function StatusBadge({ status }: { status: string }) {
  const cfg = status === 'active'
    ? { bg: '#F0FAF7', text: '#5D9B8F', label: 'Live ✓' }
    : status === 'pending'
    ? { bg: '#FEF3E2', text: '#E17055', label: 'Pending review' }
    : { bg: '#FAEAEC', text: '#7B0017', label: 'Suspended' };
  return <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: cfg.bg, color: cfg.text }}>{cfg.label}</span>;
}

function PlanBadge({ plan }: { plan: string }) {
  const cfg = plan === 'featured'
    ? { bg: '#1D2324', text: '#fff', label: '⭐ Featured' }
    : plan === 'pro'
    ? { bg: '#E17055', text: '#fff', label: '🚀 Pro' }
    : { bg: '#F5F0EB', text: '#636E72', label: 'Free' };
  return <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: cfg.bg, color: cfg.text }}>{cfg.label}</span>;
}

export function VendorDashboard({ vendor, token, vendorProducts, allProducts }: {
  vendor: Vendor; token: string;
  vendorProducts: VendorProduct[]; allProducts: CanonicalProduct[];
}) {
  const [tab, setTab] = useState<'overview'|'products'|'profile'>('overview');
  const [products, setProducts] = useState<VendorProduct[]>(vendorProducts);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const addedIds = new Set(products.map(p => p.product_id).filter(Boolean));

  async function toggleProduct(canonical: CanonicalProduct, add: boolean) {
    if (!add) {
      const vp = products.find(p => p.product_id === canonical.id);
      if (!vp) return;
      setSaving(canonical.id);
      await fetch('/api/vendor/products', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'x-vendor-token': token }, body: JSON.stringify({ id: vp.id }) });
      setProducts(p => p.filter(x => x.id !== vp.id));
      setSaving(null);
    } else {
      setSaving(canonical.id);
      const res = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vendor-token': token }, body: JSON.stringify({ productId: canonical.id, price: 0, inStock: true }) });
      const data = await res.json();
      if (data.product) setProducts(p => [{ ...data.product, products: canonical }, ...p]);
      setSaving(null);
    }
  }

  async function updatePrice(vpId: string, price: number) {
    setSaving(vpId);
    await fetch('/api/vendor/products', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-vendor-token': token }, body: JSON.stringify({ id: vpId, price }) });
    setProducts(p => p.map(x => x.id === vpId ? { ...x, price } : x));
    setSaving(null);
  }

  async function toggleStock(vpId: string, inStock: boolean) {
    setSaving(vpId);
    await fetch('/api/vendor/products', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-vendor-token': token }, body: JSON.stringify({ id: vpId, inStock }) });
    setProducts(p => p.map(x => x.id === vpId ? { ...x, in_stock: inStock } : x));
    setSaving(null);
  }

  const filteredAll = allProducts.filter(p => p.canonical_name.toLowerCase().includes(search.toLowerCase()));
  const tabClass = (t: string) => `px-4 py-2.5 text-sm font-semibold rounded-lg transition-all ${tab === t ? 'bg-white text-[#1D2324] shadow-sm' : 'text-[#636E72] hover:text-[#1D2324]'}`;

  return (
    <div className="min-h-screen bg-[#F5F0EB]">
      {/* Header */}
      <header className="px-4 md:px-6 py-4 bg-white border-b border-[#E8E2DC] shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/vendor" className="text-base font-bold text-[#1D2324] flex-shrink-0">supermarket<span className="text-[#E17055]">.ie</span></Link>
            <span className="text-[#E8E2DC]">/</span>
            <span className="text-sm font-semibold text-[#636E72] truncate">{vendor.name}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={vendor.status} />
            <PlanBadge plan={vendor.plan} />
            <Link href={`/store/${vendor.slug}`} target="_blank"
              className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-[#636E72] hover:text-[#1D2324] border border-[#E8E2DC] px-3 py-1.5 rounded-lg hover:border-[#1D2324] transition">
              View storefront ↗
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">
        {/* Pending notice */}
        {vendor.status === 'pending' && (
          <div className="bg-[#FEF3E2] border border-[#E17055]/30 rounded-2xl px-5 py-4 mb-6 flex items-start gap-3">
            <span className="text-xl flex-shrink-0 mt-0.5">⏳</span>
            <div>
              <div className="font-semibold text-[#1D2324] text-sm">Your account is under review</div>
              <div className="text-sm text-[#636E72] mt-0.5">We typically approve within 1 business day. In the meantime, you can set up your product catalogue — it&rsquo;ll be ready when you go live.</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-[#F5F0EB] rounded-xl p-1 inline-flex gap-1 mb-6">
          {(['overview','products','profile'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={tabClass(t)}>
              {t === 'overview' ? '📊 Overview' : t === 'products' ? '📦 Products' : '⚙️ Profile'}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { label: 'Products listed', value: products.length, emoji: '📦' },
                { label: 'In stock', value: products.filter(p => p.in_stock).length, emoji: '✅' },
                { label: 'Needs pricing', value: products.filter(p => !p.price || p.price === 0).length, emoji: '💰' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-2xl border border-[#E8E2DC] p-5">
                  <div className="text-2xl mb-2">{s.emoji}</div>
                  <div className="text-2xl font-bold text-[#1D2324]">{s.value}</div>
                  <div className="text-sm text-[#636E72]">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-[#E8E2DC] p-6">
              <h2 className="font-bold text-[#1D2324] mb-4">Quick actions</h2>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => { setTab('products'); setShowAddPanel(true); }}
                  className="flex items-center gap-2 bg-[#5D9B8F] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#4A8A7E] transition">
                  <span>+</span> Add products
                </button>
                <button onClick={() => setTab('profile')}
                  className="flex items-center gap-2 border-2 border-[#E8E2DC] text-[#636E72] px-4 py-2.5 rounded-xl text-sm font-semibold hover:border-[#1D2324] hover:text-[#1D2324] transition">
                  ✎ Edit profile
                </button>
                <Link href={`/store/${vendor.slug}`} target="_blank"
                  className="flex items-center gap-2 border-2 border-[#E8E2DC] text-[#636E72] px-4 py-2.5 rounded-xl text-sm font-semibold hover:border-[#1D2324] hover:text-[#1D2324] transition">
                  ↗ View storefront
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Products tab */}
        {tab === 'products' && (
          <div>
            <div className="flex items-center justify-between mb-4 gap-3">
              <h2 className="font-bold text-[#1D2324]">{products.length} product{products.length !== 1 ? 's' : ''} on your list</h2>
              <button onClick={() => setShowAddPanel(!showAddPanel)}
                className="flex items-center gap-1.5 bg-[#5D9B8F] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#4A8A7E] transition">
                + Add products
              </button>
            </div>

            {/* Add from catalogue panel */}
            {showAddPanel && (
              <div className="bg-white rounded-2xl border border-[#E8E2DC] p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-[#1D2324]">Add from catalogue</h3>
                  <button onClick={() => setShowAddPanel(false)} className="text-[#B2BEC3] hover:text-[#636E72]">✕</button>
                </div>
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
                  className="w-full px-3 py-2 rounded-lg border-2 border-[#E8E2DC] focus:border-[#5D9B8F] focus:outline-none text-sm mb-3"/>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {filteredAll.map(p => {
                    const added = addedIds.has(p.id);
                    return (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#F5F0EB] transition">
                        <div>
                          <div className="text-sm font-medium text-[#1D2324]">{p.canonical_name}</div>
                          {p.category && <div className="text-xs text-[#B2BEC3]">{p.category}</div>}
                        </div>
                        <button onClick={() => toggleProduct(p, !added)} disabled={saving === p.id}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${added ? 'bg-[#FAEAEC] text-[#D63031] hover:bg-[#FDDDD8]' : 'bg-[#F0FAF7] text-[#5D9B8F] hover:bg-[#5D9B8F] hover:text-white'}`}>
                          {saving === p.id ? '…' : added ? 'Remove' : '+ Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Product list */}
            {products.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#E8E2DC] p-10 text-center">
                <div className="text-4xl mb-3">📦</div>
                <div className="font-semibold text-[#1D2324] mb-2">No products yet</div>
                <div className="text-sm text-[#636E72]">Add products from our catalogue to appear on shoppers&rsquo; lists.</div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-[#E8E2DC] divide-y divide-[#F5F0EB]">
                {products.map(vp => {
                  const name = vp.products?.canonical_name ?? vp.custom_name ?? 'Custom product';
                  const cat = vp.products?.category ?? null;
                  return (
                    <div key={vp.id} className="flex items-center gap-3 px-4 py-3.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[#1D2324]">{name}</div>
                        {cat && <div className="text-xs text-[#B2BEC3]">{cat}</div>}
                      </div>
                      {/* Price input */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-sm text-[#636E72]">€</span>
                        <input type="number" step="0.01" min="0" defaultValue={vp.price || ''} placeholder="0.00"
                          onBlur={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== vp.price) updatePrice(vp.id, v); }}
                          className="w-20 px-2 py-1.5 text-sm font-semibold text-[#1D2324] border-2 border-[#E8E2DC] rounded-lg focus:border-[#5D9B8F] focus:outline-none text-right"/>
                      </div>
                      {/* Stock toggle */}
                      <button onClick={() => toggleStock(vp.id, !vp.in_stock)} disabled={saving === vp.id}
                        className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all ${vp.in_stock ? 'bg-[#F0FAF7] text-[#5D9B8F] hover:bg-[#5D9B8F] hover:text-white' : 'bg-[#F5F0EB] text-[#B2BEC3] hover:bg-[#E8E2DC]'}`}>
                        {saving === vp.id ? '…' : vp.in_stock ? 'In stock' : 'Out of stock'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Profile tab */}
        {tab === 'profile' && (
          <ProfileEditor vendor={vendor} token={token} />
        )}
      </div>
    </div>
  );
}

function ProfileEditor({ vendor, token }: { vendor: Vendor; token: string }) {
  const [form, setForm] = useState({ name: vendor.name, description: vendor.description ?? '', eircode: vendor.eircode ?? '', delivery_radius_km: vendor.delivery_radius_km, click_and_collect: vendor.click_and_collect });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    await fetch('/api/vendor/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-vendor-token': token }, body: JSON.stringify(form) });
    setSaved(true); setSaving(false);
    setTimeout(() => setSaved(false), 2000);
  }

  const inputClass = "w-full px-4 py-3 rounded-xl border-2 border-[#E8E2DC] focus:border-[#5D9B8F] focus:outline-none text-sm text-[#1D2324] placeholder:text-[#B2BEC3]";
  const labelClass = "block text-sm font-semibold text-[#1D2324] mb-2";

  return (
    <div className="bg-white rounded-2xl border border-[#E8E2DC] p-6 space-y-4">
      <h2 className="font-bold text-[#1D2324] mb-2">Store profile</h2>
      <div>
        <label className={labelClass}>Business name</label>
        <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inputClass}/>
      </div>
      <div>
        <label className={labelClass}>Description</label>
        <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3} className={`${inputClass} resize-none`} placeholder="Tell shoppers what makes your store special…"/>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Eircode</label>
          <input type="text" value={form.eircode} onChange={e => setForm(p => ({ ...p, eircode: e.target.value.toUpperCase() }))} className={inputClass} placeholder="D01 AB12"/>
        </div>
      </div>
      <div>
        <label className={labelClass}>Delivery radius: <strong>{form.delivery_radius_km} km</strong></label>
        <input type="range" min={0} max={50} step={1} value={form.delivery_radius_km} onChange={e => setForm(p => ({ ...p, delivery_radius_km: Number(e.target.value) }))} className="w-full accent-[#E17055]"/>
      </div>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={form.click_and_collect} onChange={e => setForm(p => ({ ...p, click_and_collect: e.target.checked }))} className="w-4 h-4 accent-[#E17055]"/>
        <span className="text-sm font-semibold text-[#1D2324]">Click & collect available</span>
      </label>
      <button onClick={handleSave} disabled={saving}
        className="w-full bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white py-3 rounded-xl font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all disabled:opacity-60">
        {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
