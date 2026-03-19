'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const CATEGORIES = ['Groceries','Deli','Bakery','Butcher','Fishmonger','Pharmacy','Health & Beauty','Electronics','Restaurant','Convenience','Other'];
const STEPS = ['Business info','Location & delivery','Go live'];

export default function VendorSignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '', email: '', description: '',
    address: '', eircode: '', phone: '',
    deliveryRadiusKm: 5, minOrderValue: 0,
    clickAndCollect: false, categories: [] as string[],
  });

  function update(field: string, value: unknown) { setForm(p => ({ ...p, [field]: value })); }
  function toggleCategory(cat: string) {
    setForm(p => ({ ...p, categories: p.categories.includes(cat) ? p.categories.filter(c => c !== cat) : [...p.categories, cat] }));
  }

  async function handleSubmit() {
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/vendor/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      router.push(`/vendor/dashboard?token=${data.token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  const inputClass = "w-full px-4 py-3 rounded-xl border-2 border-[#E8E2DC] focus:border-[#5D9B8F] focus:outline-none text-sm text-[#1D2324] placeholder:text-[#B2BEC3] transition";
  const labelClass = "block text-sm font-semibold text-[#1D2324] mb-2";

  return (
    <div className="min-h-screen bg-[#FFFBF7] flex flex-col items-center justify-center px-6 py-12">
      <Link href="/vendor" className="text-[18px] font-bold text-[#1D2324] mb-8">supermarket<span className="text-[#E17055]">.ie</span></Link>

      <div className="bg-white rounded-2xl border border-[#E8E2DC] shadow-sm max-w-lg w-full p-8">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${i < step ? 'bg-[#5D9B8F] text-white' : i === step ? 'bg-[#E17055] text-white' : 'bg-[#F5F0EB] text-[#B2BEC3]'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${i === step ? 'text-[#1D2324]' : 'text-[#B2BEC3]'}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 ${i < step ? 'bg-[#5D9B8F]' : 'bg-[#E8E2DC]'}`}/>}
            </div>
          ))}
        </div>

        {/* Step 0 — Business info */}
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-[#1D2324] mb-1">Tell us about your business</h2>
            <p className="text-sm text-[#636E72] mb-5">This is what shoppers will see on your storefront.</p>
            <div>
              <label className={labelClass}>Business name <span className="text-[#E17055]">*</span></label>
              <input type="text" required value={form.name} onChange={e => update('name', e.target.value)} placeholder="e.g. Murphy's Fresh Foods" className={inputClass}/>
            </div>
            <div>
              <label className={labelClass}>Business email <span className="text-[#E17055]">*</span></label>
              <input type="email" required value={form.email} onChange={e => update('email', e.target.value)} placeholder="you@yourbusiness.ie" className={inputClass}/>
            </div>
            <div>
              <label className={labelClass}>Short description</label>
              <textarea value={form.description} onChange={e => update('description', e.target.value)} placeholder="What makes your store special? (optional)" rows={3}
                className={`${inputClass} resize-none`}/>
            </div>
            <div>
              <label className={labelClass}>What do you sell? <span className="text-[#E17055]">*</span></label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(c => (
                  <button key={c} type="button" onClick={() => toggleCategory(c)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${form.categories.includes(c) ? 'border-[#E17055] bg-[#FEF3E2] text-[#E17055]' : 'border-[#E8E2DC] text-[#636E72] hover:border-[#E17055]/50'}`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => { if (!form.name || !form.email || form.categories.length === 0) { setError('Please fill in all required fields and select at least one category'); return; } setError(''); setStep(1); }}
              className="w-full bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white py-3 rounded-xl font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all mt-2">
              Continue →
            </button>
          </div>
        )}

        {/* Step 1 — Location */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-[#1D2324] mb-1">Location & delivery</h2>
            <p className="text-sm text-[#636E72] mb-5">Help shoppers know if you can serve their area.</p>
            <div>
              <label className={labelClass}>Address</label>
              <input type="text" value={form.address} onChange={e => update('address', e.target.value)} placeholder="123 Main Street, Dublin" className={inputClass}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Eircode</label>
                <input type="text" value={form.eircode} onChange={e => update('eircode', e.target.value.toUpperCase())} placeholder="D01 AB12" className={inputClass}/>
              </div>
              <div>
                <label className={labelClass}>Phone (optional)</label>
                <input type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="01 234 5678" className={inputClass}/>
              </div>
            </div>
            <div>
              <label className={labelClass}>Delivery radius: <strong>{form.deliveryRadiusKm} km</strong></label>
              <input type="range" min={0} max={50} step={1} value={form.deliveryRadiusKm} onChange={e => update('deliveryRadiusKm', Number(e.target.value))}
                className="w-full accent-[#E17055]"/>
              <div className="flex justify-between text-xs text-[#B2BEC3] mt-1"><span>0 km (no delivery)</span><span>50 km</span></div>
            </div>
            <div>
              <label className={labelClass}>Minimum order value: <strong>€{form.minOrderValue}</strong></label>
              <input type="range" min={0} max={100} step={5} value={form.minOrderValue} onChange={e => update('minOrderValue', Number(e.target.value))}
                className="w-full accent-[#E17055]"/>
              <div className="flex justify-between text-xs text-[#B2BEC3] mt-1"><span>€0 (no minimum)</span><span>€100</span></div>
            </div>
            <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border-2 border-[#E8E2DC] hover:border-[#E17055]/30 transition">
              <input type="checkbox" checked={form.clickAndCollect} onChange={e => update('clickAndCollect', e.target.checked)} className="w-4 h-4 accent-[#E17055]"/>
              <div>
                <div className="font-semibold text-sm text-[#1D2324]">Click & collect available</div>
                <div className="text-xs text-[#636E72]">Customers can order online and pick up in store</div>
              </div>
            </label>
            <div className="flex gap-3 mt-2">
              <button onClick={() => setStep(0)} className="flex-1 border-2 border-[#E8E2DC] text-[#636E72] py-3 rounded-xl font-semibold hover:border-[#1D2324] hover:text-[#1D2324] transition-all">← Back</button>
              <button onClick={() => { setError(''); setStep(2); }} className="flex-1 bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white py-3 rounded-xl font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all">Continue →</button>
            </div>
          </div>
        )}

        {/* Step 2 — Review & submit */}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold text-[#1D2324] mb-1">You&rsquo;re almost live! 🚀</h2>
            <p className="text-sm text-[#636E72] mb-6">Review your details and submit. We&rsquo;ll review your account and email you once you&rsquo;re approved (usually same day).</p>
            <div className="bg-[#F5F0EB] rounded-xl p-4 space-y-2 mb-6 text-sm">
              <div className="flex justify-between"><span className="text-[#636E72]">Business</span><span className="font-semibold text-[#1D2324]">{form.name}</span></div>
              <div className="flex justify-between"><span className="text-[#636E72]">Email</span><span className="font-semibold text-[#1D2324]">{form.email}</span></div>
              <div className="flex justify-between"><span className="text-[#636E72]">Eircode</span><span className="font-semibold text-[#1D2324]">{form.eircode || '—'}</span></div>
              <div className="flex justify-between"><span className="text-[#636E72]">Delivery</span><span className="font-semibold text-[#1D2324]">{form.deliveryRadiusKm > 0 ? `${form.deliveryRadiusKm} km radius` : 'No delivery'}</span></div>
              <div className="flex justify-between"><span className="text-[#636E72]">Click & collect</span><span className="font-semibold text-[#1D2324]">{form.clickAndCollect ? 'Yes' : 'No'}</span></div>
              <div className="flex justify-between"><span className="text-[#636E72]">Categories</span><span className="font-semibold text-[#1D2324] text-right max-w-[60%]">{form.categories.join(', ')}</span></div>
            </div>
            {error && <p className="text-sm text-red-600 mb-4 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 border-2 border-[#E8E2DC] text-[#636E72] py-3 rounded-xl font-semibold hover:border-[#1D2324] hover:text-[#1D2324] transition-all">← Back</button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex-1 bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white py-3 rounded-xl font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all disabled:opacity-60">
                {submitting ? 'Creating account…' : 'Create my account →'}
              </button>
            </div>
          </div>
        )}

        {error && step < 2 && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </div>
      <p className="text-sm text-[#636E72] mt-6">Already listed? <Link href="/vendor/signin" className="text-[#E17055] font-semibold hover:underline">Sign in</Link></p>
    </div>
  );
}
