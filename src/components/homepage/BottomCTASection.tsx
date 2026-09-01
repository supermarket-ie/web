import { ScrollToTopButton } from './ScrollToTopButton';

export function BottomCTASection() {
  return (
    <section id="bottom-cta" className="border-t border-[#e1e8e3] bg-white px-6 py-20">
      <div className="max-w-xl mx-auto text-center">
        <div
          className="rounded-2xl p-8 md:p-10"
          style={{
            background: 'var(--surface-container-lowest)',
            border: '1px solid #dce5de',
            borderTop: '4px solid #006A35',
            boxShadow: '0 14px 45px rgba(18,54,34,0.08)',
          }}
        >
          <div className="mb-6">
            <h2 className="type-headline text-on-background mb-2">Meet your supermarket agent</h2>
            <p className="text-on-surface">
              Tell it what your household eats, uses and regularly needs. It&apos;ll handle the complete shop—this week and every week after.
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
