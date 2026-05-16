'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { HomePlanner } from '@/components/HomePlanner';
import { LiveDealChip } from '@/components/LiveDealChip';
import { ArrowRight, Check } from 'lucide-react';

interface HeroSectionProps {
  listUrl: string | null;
}

export function HeroSection({ listUrl }: HeroSectionProps) {
  return (
    <section className="px-6 pt-10 pb-20 md:pt-14 md:pb-28 bg-surface">
      <div className="max-w-7xl mx-auto">
        <div className="grid gap-12 items-start lg:grid-cols-[1fr_600px] md:grid-cols-1">
          {/* Left: Copy & Trust Signals */}
          <motion.div
            className="lg:pr-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="chip-tertiary mb-6">
              Free weekly shopping lists for Irish households
            </div>

            <h1 className="type-display text-on-background mb-6">
              Plan your weekly shop{' '}
              <span
                style={{
                  background: 'linear-gradient(135deg, var(--primary), var(--primary-container))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                in seconds
              </span>
            </h1>

            <div className="mb-6">
              <LiveDealChip />
            </div>

            <p className="type-body-lg mb-8 max-w-lg text-on-surface">
              Tell us about your household. Our AI builds your complete weekly grocery list with the
              best prices across Tesco, Dunnes, SuperValu & Aldi.
            </p>

            <div className="flex flex-col gap-3 mb-10">
              {[
                'Takes 30 seconds — just tap a few buttons',
                'Compares Tesco, Dunnes, SuperValu & Aldi prices',
                "Finds this week's deals automatically",
              ].map((item, index) => (
                <motion.div
                  key={item}
                  className="flex items-center gap-3"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.3 + index * 0.1 }}
                >
                  <div
                    className="size-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--primary-container)' }}
                  >
                    <Check className="size-3 text-on-primary-container" strokeWidth={3} />
                  </div>
                  <span className="font-medium text-sm text-on-background">{item}</span>
                </motion.div>
              ))}
            </div>

            {listUrl && (
              <Link href={listUrl} className="btn-secondary px-8 py-4 text-lg inline-flex gap-2">
                View my list <ArrowRight className="size-5" />
              </Link>
            )}
          </motion.div>

          {/* Right: Chat Interface */}
          <motion.div
            className="relative"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div
              className="rounded-2xl p-6"
              style={{
                background: 'var(--surface-container-lowest)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.08)',
                minHeight: '500px',
              }}
            >
              <HomePlanner />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
