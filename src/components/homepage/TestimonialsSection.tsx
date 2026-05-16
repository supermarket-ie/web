'use client';

import { motion } from 'framer-motion';
import { Star } from 'lucide-react';

const testimonials = [
  {
    quote:
      "I used to spend my Sunday comparing Tesco and Dunnes prices. Now I just check the app and I'm done in 5 minutes. Game changer.",
    name: 'Sarah Murphy',
    location: 'Mum of 3, Dublin',
    initials: 'SM',
  },
  {
    quote:
      "Finally, something that actually compares Irish supermarket prices properly. Saved us over €90 last month!",
    name: 'Cian O&apos;Brien',
    location: 'Family of 4, Cork',
    initials: 'CO',
  },
  {
    quote:
      "The AI meal planning is brilliant. It knows what's on special and builds my list around the deals.",
    name: 'Emma Kelly',
    location: 'Working professional, Galway',
    initials: 'EK',
  },
];

export function TestimonialsSection() {
  return (
    <section className="py-20 px-6 bg-surface">
      <div className="max-w-6xl mx-auto">
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <span
            className="type-label inline-flex items-center px-3 py-1.5 rounded-full mb-4"
            style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}
          >
            What shoppers say
          </span>
          <h2 className="type-headline text-on-background">
            Trusted by 2,400+ Irish households
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.name}
              className="rounded-2xl p-6"
              style={{ background: 'var(--surface-container-lowest)' }}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    className="size-5"
                    fill="var(--primary-container)"
                    stroke="var(--primary-container)"
                  />
                ))}
              </div>
              <blockquote
                className="text-base font-medium leading-relaxed mb-6"
                style={{ color: 'var(--on-background)' }}
              >
                &ldquo;{testimonial.quote}&rdquo;
              </blockquote>
              <div className="flex items-center gap-3">
                <div
                  className="size-10 rounded-full flex items-center justify-center font-bold text-sm"
                  style={{
                    background:
                      'linear-gradient(135deg, var(--primary), var(--primary-container))',
                    color: 'var(--on-primary-container)',
                  }}
                >
                  {testimonial.initials}
                </div>
                <div>
                  <div className="font-semibold text-sm text-on-background">{testimonial.name}</div>
                  <div className="text-xs text-on-surface">{testimonial.location}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
