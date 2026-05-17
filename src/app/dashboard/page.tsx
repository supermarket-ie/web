import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { Dashboard } from '@/components/Dashboard';

export const metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-surface noise-bg">
      <SiteHeader />
      <Dashboard />
      <SiteFooter />
    </div>
  );
}
