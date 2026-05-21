'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';

export function BottomCTASection() {
  const scrollToTop = (e: React.MouseEvent) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <section id="bottom-cta" className="py-20 px-6" style={{ background: 'var(--surface-container-low)' }}>
      <div className="max-w-xl mx-auto text-center">
        <motion.div
          className="rounded-2xl p-8 md:p-10"
          style={{
            background: 'var(--surface-container-lowest)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.07)',
          }}
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <div className="mb-6">
            <h2 className="type-headline text-on-background mb-2">Meet your grocery agent</h2>
            <p className="text-on-surface">
              Tell it about your household. It&apos;ll handle the rest — this week and every week after.
            </p>
          </div>
          <button
            onClick={scrollToTop}
            className="btn-primary w-full px-6 py-4 text-lg font-bold gap-2 hover:scale-[1.02] active:scale-[0.98] transition-transform"
          >
            <Sparkles className="size-5" />
            Start chatting with your agent
          </button>
          <p className="text-xs mt-4 flex items-center justify-center gap-2 text-on-surface-variant">
            100% free · No card needed · Takes 30 seconds
          </p>
        </motion.div>
      </div>
    </section>
  );
}
