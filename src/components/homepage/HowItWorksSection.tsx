'use client';

import { motion } from 'framer-motion';
import { MessageSquare, Bot, PiggyBank } from 'lucide-react';

const steps = [
  {
    num: '01',
    title: "Tell us what you're cooking",
    desc: 'Chat with our AI about your weekly meals. Takes 30 seconds.',
    icon: MessageSquare,
    dark: false,
  },
  {
    num: '02',
    title: 'AI builds your list',
    desc: 'Our AI scans every deal and builds a personalised list just for your household.',
    icon: Bot,
    dark: true,
  },
  {
    num: '03',
    title: 'Shop & save',
    desc: 'Use your list at any store. Updated every week with the latest prices.',
    icon: PiggyBank,
    dark: false,
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-20 px-6 bg-surface">
      <div className="max-w-6xl mx-auto">
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
          <h2 className="type-headline text-on-background">
            Three steps to smarter
            <br />
            grocery shopping
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((step, index) => (
            <motion.div
              key={step.num}
              className="rounded-2xl p-8 relative overflow-hidden"
              style={
                step.dark
                  ? { background: 'var(--primary)', color: '#fff' }
                  : { background: 'var(--surface-container-lowest)' }
              }
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.15 }}
            >
              {step.dark && (
                <div
                  className="absolute size-40 rounded-full top-0 right-0 translate-x-1/2 -translate-y-1/2"
                  style={{ background: 'var(--primary-container)', opacity: 0.12 }}
                />
              )}
              <div
                className="size-12 rounded-xl flex items-center justify-center mb-4"
                style={{
                  background: step.dark
                    ? 'rgba(255,255,255,0.15)'
                    : 'var(--surface-container)',
                }}
              >
                <step.icon
                  className="size-6"
                  style={{
                    color: step.dark ? 'var(--primary-container)' : 'var(--primary)',
                  }}
                />
              </div>
              <div
                className="type-label mb-2"
                style={{ color: step.dark ? 'var(--primary-container)' : 'var(--primary)' }}
              >
                {step.num}
              </div>
              <h3
                className="type-title-lg mb-2"
                style={{ color: step.dark ? '#fff' : 'var(--on-background)' }}
              >
                {step.title}
              </h3>
              <p style={{ color: step.dark ? 'rgba(255,255,255,0.75)' : 'var(--on-surface)' }}>
                {step.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
