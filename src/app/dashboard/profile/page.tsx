import { SiteHeader } from '@/components/SiteHeader';
import { HouseholdEditor } from '@/components/HouseholdEditor';

export const metadata = {
  title: 'Your profile · supermarket.ie',
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <SiteHeader />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--on-background)' }}>
          Your profile
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--on-surface-variant)' }}>
          Your household details help the agent personalise your grocery lists.
        </p>
        <HouseholdEditor />
      </main>
    </div>
  );
}
