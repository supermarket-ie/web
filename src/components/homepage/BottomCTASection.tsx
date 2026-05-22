import { ScrollToTopButton } from './ScrollToTopButton';

export function BottomCTASection() {
  return (
    <section id="bottom-cta" className="py-20 px-6" style={{ background: 'var(--surface-container-low)' }}>
      <div className="max-w-xl mx-auto text-center">
        <div
          className="rounded-2xl p-8 md:p-10"
          style={{
            background: 'var(--surface-container-lowest)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.07)',
          }}
        >
          <div className="mb-6">
            <h2 className="type-headline text-on-background mb-2">Meet your grocery agent</h2>
            <p className="text-on-surface">
              Tell it about your household. It&apos;ll handle the rest — this week and every week after.
            </p>
          </div>
          <ScrollToTopButton />
          <p className="text-xs mt-4 flex items-center justify-center gap-2 text-on-surface-variant">
            100% free · No card needed · Takes 30 seconds
          </p>
        </div>
      </div>
    </section>
  );
}
