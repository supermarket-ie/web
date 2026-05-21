'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { HomePlanner } from '@/components/HomePlanner';
import { LiveDealChip } from '@/components/LiveDealChip';
import { ArrowRight, Sparkles } from 'lucide-react';

interface HeroSectionProps {
  listUrl: string | null;
}

export function HeroSection({ listUrl }: HeroSectionProps) {
  return (
    <section className="relative px-6 pt-10 pb-20 md:pt-14 md:pb-28 overflow-hidden noise-bg">
      {/* Animated gradient mesh background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Primary green blob - top left */}
        <motion.div
          className="gradient-blob"
          style={{
            width: '600px',
            height: '600px',
            background: 'linear-gradient(135deg, rgba(0,106,53,0.15), rgba(107,254,156,0.1))',
            top: '-200px',
            left: '-100px',
          }}
          animate={{
            x: [0, 30, -20, 0],
            y: [0, 20, -10, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Cyan accent blob - right */}
        <motion.div
          className="gradient-blob"
          style={{
            width: '500px',
            height: '500px',
            background: 'linear-gradient(135deg, rgba(0,220,255,0.08), rgba(107,254,156,0.05))',
            top: '50%',
            right: '-150px',
          }}
          animate={{
            x: [0, -20, 30, 0],
            y: [0, -30, 20, 0],
          }}
          transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
        {/* Dot grid overlay */}
        <div className="absolute inset-0 dot-grid opacity-50" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        <div className="grid gap-12 items-start lg:grid-cols-[1fr_560px] md:grid-cols-1">
          {/* Left: Copy & Trust Signals */}
          <motion.div
            className="lg:pr-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="chip-tertiary mb-6 inline-flex items-center gap-2">
              <Sparkles className="size-3.5" />
              Your personal AI grocery agent
            </div>

            <h1 className="type-display text-on-background mb-6 text-balance">
              An AI agent that{' '}
              <span
                style={{
                  background: 'linear-gradient(135deg, #006A35, #6BFE9C)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                handles your groceries
              </span>
            </h1>

            <div className="mb-6">
              <LiveDealChip />
            </div>

            <p className="type-body-lg mb-8 max-w-lg text-on-surface">
              Tell it about your household once. It learns what you buy, tracks prices across 
              Tesco, Dunnes, SuperValu & Aldi, and builds your perfect weekly shop — every single week.
            </p>

            <div className="flex flex-col gap-3 mb-10">
              {[
                'Knows your household, preferences & budget',
                'Tracks prices across every major Irish supermarket',
                'Gets smarter the more you use it',
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
                    <Sparkles className="size-3 text-on-primary-container" strokeWidth={3} />
                  </div>
                  <span className="font-medium text-sm text-on-background">{item}</span>
                </motion.div>
              ))}
            </div>

            {listUrl && (
              <Link 
                href="/dashboard" 
                className="btn-secondary px-8 py-4 text-lg inline-flex gap-2 hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                Open my agent <ArrowRight className="size-5" />
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
              className="rounded-2xl overflow-hidden p-4 sm:p-6"
              style={{
                background: 'var(--surface-container-lowest)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.03)',
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
