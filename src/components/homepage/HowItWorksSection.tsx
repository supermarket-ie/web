'use client';

import { motion } from 'framer-motion';
import { MessageSquare, Bot, PiggyBank, Check } from 'lucide-react';

const mockListItems = [
  { name: 'Milk 2L', store: 'Tesco', price: '€1.89', saving: '€0.30' },
  { name: 'Brennans Bread', store: 'Dunnes', price: '€1.75', saving: '€0.25' },
  { name: 'Chicken Fillets 500g', store: 'Aldi', price: '€4.99', saving: '€1.50' },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-20 px-6 noise-bg relative" style={{ background: 'var(--surface)' }}>
      <div className="max-w-6xl mx-auto relative z-10">
        <motion.div
          className="mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <span
            className="type-label inline-flex items-center px-3 py-1.5 rounded-full mb-4"
            style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}
          >
            How it works
          </span>
          <h2 className="type-headline text-on-background text-balance">
            Three steps to smarter
            <br />
            grocery shopping
          </h2>
        </motion.div>

        {/* Bento Grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Step 1 - Small card */}
          <motion.div
            className="rounded-2xl p-8 relative overflow-hidden"
            style={{ background: 'var(--surface-container-lowest)' }}
            initial={{ opacity: 0, y: 30, scale: 0.98 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <div
              className="size-12 rounded-xl flex items-center justify-center mb-4"
              style={{ background: 'var(--surface-container)' }}
            >
              <MessageSquare className="size-6" style={{ color: 'var(--primary)' }} />
            </div>
            <div className="type-label mb-2" style={{ color: 'var(--primary)' }}>
              01
            </div>
            <h3 className="type-title-lg mb-2 text-on-background">
              Tell us what you&apos;re cooking
            </h3>
            <p className="text-on-surface">
              Chat with our AI about your weekly meals. Takes 30 seconds.
            </p>
          </motion.div>

          {/* Step 2 - Large 2x1 card with mock UI */}
          <motion.div
            className="rounded-2xl p-8 relative overflow-hidden md:row-span-2"
            style={{ background: '#006A35' }}
            initial={{ opacity: 0, y: 30, scale: 0.98 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            {/* Decorative blob */}
            <div
              className="absolute size-64 rounded-full top-0 right-0 translate-x-1/3 -translate-y-1/3"
              style={{ background: 'var(--primary-container)', opacity: 0.12 }}
            />
            <div
              className="absolute size-40 rounded-full bottom-0 left-0 -translate-x-1/4 translate-y-1/4"
              style={{ background: 'var(--primary-container)', opacity: 0.08 }}
            />
            
            <div className="relative z-10">
              <div
                className="size-12 rounded-xl flex items-center justify-center mb-4"
                style={{ background: 'rgba(255,255,255,0.15)' }}
              >
                <Bot className="size-6" style={{ color: 'var(--primary-container)' }} />
              </div>
              <div className="type-label mb-2" style={{ color: 'var(--primary-container)' }}>
                02
              </div>
              <h3 className="type-title-lg mb-2 text-white">
                AI builds your list
              </h3>
              <p className="mb-6" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Our AI scans every deal and builds a personalised list just for your household.
              </p>

              {/* Mock grocery list UI */}
              <div 
                className="rounded-xl p-4 space-y-3"
                style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)' }}
              >
                <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--primary-container)' }}>
                  Your smart list
                </div>
                {mockListItems.map((item, i) => (
                  <motion.div
                    key={item.name}
                    className="flex items-center justify-between py-2 border-b border-white/10 last:border-0"
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.3, delay: 0.4 + i * 0.1 }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="size-5 rounded-full flex items-center justify-center" style={{ background: 'var(--primary-container)' }}>
                        <Check className="size-3" style={{ color: '#006A35' }} strokeWidth={3} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{item.name}</div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{item.store}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-white">{item.price}</div>
                      <div className="text-xs" style={{ color: 'var(--primary-container)' }}>Save {item.saving}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Step 3 - Small card */}
          <motion.div
            className="rounded-2xl p-8 relative overflow-hidden"
            style={{ background: 'var(--surface-container-lowest)' }}
            initial={{ opacity: 0, y: 30, scale: 0.98 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div
              className="size-12 rounded-xl flex items-center justify-center mb-4"
              style={{ background: 'var(--surface-container)' }}
            >
              <PiggyBank className="size-6" style={{ color: 'var(--primary)' }} />
            </div>
            <div className="type-label mb-2" style={{ color: 'var(--primary)' }}>
              03
            </div>
            <h3 className="type-title-lg mb-2 text-on-background">
              Shop & save
            </h3>
            <p className="text-on-surface">
              Use your list at any store. Updated every week with the latest prices.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
