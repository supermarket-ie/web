export default function ListLoading() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* Store totals skeleton */}
        <div className="h-16 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-low)' }} />
        {/* Category rows skeleton */}
        {[...Array(5)].map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-24 rounded animate-pulse" style={{ background: 'var(--surface-container-low)' }} />
            {[...Array(3)].map((_, j) => (
              <div key={j} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--surface-container-low)' }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
