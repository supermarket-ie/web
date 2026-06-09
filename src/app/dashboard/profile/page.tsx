import { HouseholdEditor } from '@/components/HouseholdEditor';

export const metadata = {
  title: 'Household · supermarket.ie',
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return (
    <div className="min-h-screen relative overflow-hidden noise-bg" style={{ background: 'var(--surface)' }}>
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="gradient-blob" style={{
          width: 500, height: 500,
          background: 'linear-gradient(135deg, rgba(0,106,53,0.10), rgba(107,254,156,0.07))',
          top: -200, left: -100,
        }} />
        <div className="gradient-blob" style={{
          width: 350, height: 350,
          background: 'linear-gradient(135deg, rgba(0,220,255,0.06), rgba(107,254,156,0.04))',
          top: '50%', right: -120,
        }} />
        <div className="absolute inset-0 dot-grid opacity-40" />
      </div>

      <main className="relative z-10 max-w-2xl mx-auto px-4 pt-6 pb-24">
        {/* Header card */}
        <div className="rounded-2xl overflow-hidden mb-8"
          style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          <div className="px-5 py-4 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #006A35 0%, #00944A 60%, #00a854 100%)' }}>
            {/* Cyan glow */}
            <div className="absolute pointer-events-none" style={{
              width: 200, height: 200, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(0,220,255,0.12) 0%, transparent 70%)',
              top: -60, right: -40,
            }} />
            <div className="relative">
              <h1 className="font-bold text-xl leading-tight" style={{
                background: 'linear-gradient(135deg, #ffffff, #6BFE9C)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>Household</h1>
              <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Tell us about your household so the agent can personalise every shop.
              </p>
            </div>
          </div>
        </div>

        <HouseholdEditor />
      </main>
    </div>
  );
}
