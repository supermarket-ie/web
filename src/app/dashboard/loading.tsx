export default function DashboardLoading() {
  return (
    <div className="px-4 py-8 max-w-2xl mx-auto w-full space-y-3">
      <div className="h-48 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-low)' }} />
      <div className="h-14 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-low)' }} />
      <div className="h-14 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-low)' }} />
      <div className="h-14 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-low)' }} />
    </div>
  );
}
