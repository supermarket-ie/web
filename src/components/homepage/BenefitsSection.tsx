'use client';

import { motion } from 'framer-motion';
import { Clock, Euro, Brain, ArrowRight } from 'lucide-react';

const benefits = [
  {
    icon: Clock,
    title: 'Save 2+ hours every week',
    desc: 'No more hunting through apps and leaflets',
  },
  {
    icon: Euro,
    title: '€80–100 saved monthly',
    desc: 'Real savings from real deals across all stores',
  },
  {
    icon: Brain,
    title: 'Less decision fatigue',
    desc: 'One smart list, zero stress',
  },
];

export function BenefitsSection() {
  return (
    <section className="py-20 px-6" style={{ background: 'var(--surface-container-low)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <span
              className="type-label inline-flex items-center px-3 py-1.5 rounded-full mb-4"
              style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}
            >
              Why supermarket.ie
            </span>
            <h2 className="type-headline text-on-background mb-6">
              Groceries without
              <br />
              the mental load
            </h2>
            <p className="type-body-lg mb-10 text-on-surface">
              Stop spending your Sunday evening comparing flyers. We do the hard work so you can
              focus on what matters.
            </p>

            <div className="flex flex-col gap-6">
              {benefits.map((b, index) => (
                <motion.div
                  key={b.title}
                  className="flex gap-4"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                >
                  <div
                    className="size-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--surface-container)' }}
                  >
                    <b.icon className="size-6" style={{ color: 'var(--primary)' }} />
                  </div>
                  <div>
                    <h3 className="font-bold mb-1 text-on-background">{b.title}</h3>
                    <p className="text-sm text-on-surface">{b.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Stats card */}
          <motion.div
            className="rounded-2xl p-8"
            style={{
              background: 'var(--inverse-surface)',
              color: 'var(--inverse-on-surface)',
            }}
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <h3 className="type-title-lg mb-8" style={{ color: 'var(--inverse-on-surface)' }}>
              The average Irish family spends...
            </h3>
            <div className="flex flex-col gap-6">
              <div>
                <div
                  className="price"
                  style={{
                    fontSize: 'clamp(3rem, 6vw, 4rem)',
                    color: 'var(--primary-container)',
                  }}
                >
                  €12,000
                </div>
                <div style={{ color: 'rgba(249,246,245,0.5)' }}>per year on groceries</div>
              </div>
              <div className="h-px" style={{ background: 'rgba(249,246,245,0.1)' }} />
              <div>
                <div
                  className="price"
                  style={{
                    fontSize: 'clamp(3rem, 6vw, 4rem)',
                    color: 'var(--tertiary-container)',
                  }}
                >
                  €1,200+
                </div>
                <div style={{ color: 'rgba(249,246,245,0.5)' }}>potential yearly savings with us</div>
              </div>
            </div>
            <a href="#bottom-cta" className="btn-primary mt-8 w-full px-6 py-4 text-base gap-2">
              Start planning today
              <ArrowRight className="size-5" />
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
