'use client';

import { motion, useInView } from 'framer-motion';
import { useRef, useEffect, useState } from 'react';
import { RefreshCw, Euro, Brain, ArrowRight } from 'lucide-react';

const benefits = [
  {
    icon: Brain,
    title: 'Remembers everything',
    desc: "Your preferences, your usual items, your budget — it never forgets and never needs reminding",
  },
  {
    icon: RefreshCw,
    title: 'Improves every week',
    desc: "The more you use it, the better it knows what you need. Like a personal shopper who's been with you for years",
  },
  {
    icon: Euro,
    title: '€80–100 saved monthly',
    desc: "Not from coupons or gimmicks — from genuinely knowing which store has the best price on the things you actually buy",
  },
];

function AnimatedCounter({ 
  end, 
  prefix = '', 
  suffix = '',
  duration = 2 
}: { 
  end: number; 
  prefix?: string; 
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (isInView) {
      let startTime: number;
      const animate = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        setCount(Math.floor(easeOutQuart * end));
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
    }
  }, [isInView, end, duration]);

  return (
    <div ref={ref} className="price" style={{ fontSize: 'clamp(3rem, 6vw, 4rem)' }}>
      {prefix}{count.toLocaleString()}{suffix}
    </div>
  );
}

export function BenefitsSection() {
  return (
    <section className="py-20 px-6 noise-bg relative" style={{ background: 'var(--surface-container-low)' }}>
      <div className="max-w-6xl mx-auto relative z-10">
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
              Why an agent, not a website
            </span>
            <h2 className="type-headline text-on-background mb-6 text-balance">
              Websites show you data.
              <br />
              Your agent does the work.
            </h2>
            <p className="type-body-lg mb-10 text-on-surface">
              Price comparison sites give you tables. Your grocery agent gives you a ready-to-go 
              weekly shop, built around your family, your meals, and today&apos;s actual prices.
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
            className="rounded-2xl p-8 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(14,14,14,0.95), rgba(14,14,14,0.9))',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
            initial={{ opacity: 0, x: 30, scale: 0.98 }}
            whileInView={{ opacity: 1, x: 0, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            {/* Glassmorphism shine */}
            <div 
              className="absolute inset-0 rounded-2xl opacity-20"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%)',
              }}
            />
            
            <div className="relative z-10">
              <h3 className="type-title-lg mb-8" style={{ color: 'var(--inverse-on-surface)' }}>
                The average Irish family spends...
              </h3>
              <div className="flex flex-col gap-6">
                <div>
                  <AnimatedCounter end={12000} prefix="€" />
                  <div style={{ color: 'var(--primary-container)' }} className="font-medium mt-1">
                    per year on groceries
                  </div>
                </div>
                <div className="h-px" style={{ background: 'rgba(249,246,245,0.1)' }} />
                <div>
                  <div className="flex items-baseline gap-1">
                    <AnimatedCounter end={1200} prefix="€" suffix="+" />
                  </div>
                  <div style={{ color: 'var(--tertiary-container)' }} className="font-medium mt-1">
                    your agent can save you per year
                  </div>
                </div>
              </div>
              <a 
                href="#bottom-cta" 
                className="btn-primary mt-8 w-full px-6 py-4 text-base gap-2 hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                Meet your agent
                <ArrowRight className="size-5" />
              </a>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
