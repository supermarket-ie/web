'use client';

import { motion } from 'framer-motion';
import { Star, Quote } from 'lucide-react';

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
    name: "Cian O'Brien",
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
    <section 
      className="py-20 px-6 relative overflow-hidden"
      style={{ background: 'var(--surface)' }}
    >
      {/* Radial gradient background */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% 50%, rgba(0,106,53,0.06) 0%, transparent 70%)',
        }}
      />

      <div className="max-w-6xl mx-auto relative z-10">
        <motion.div
          className="text-center mb-16"
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
          <h2 className="type-headline text-on-background text-balance">
            Trusted by 2,400+ Irish households
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.name}
              className="rounded-2xl p-8 relative"
              style={{ background: 'var(--surface-container-lowest)' }}
              initial={{ opacity: 0, y: 30, scale: 0.98 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              {/* Large quote mark */}
              <Quote 
                className="absolute top-6 right-6 size-10 opacity-10" 
                style={{ color: 'var(--primary)' }}
                strokeWidth={1}
              />
              
              <div className="flex items-center gap-1 mb-6">
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
                className="text-base font-medium leading-relaxed mb-8"
                style={{ color: 'var(--on-background)' }}
              >
                &ldquo;{testimonial.quote}&rdquo;
              </blockquote>
              <div className="flex items-center gap-3">
                <div
                  className="size-12 rounded-full flex items-center justify-center font-bold text-sm"
                  style={{
                    background:
                      'linear-gradient(135deg, #006A35, #6BFE9C)',
                    color: 'var(--on-primary-container)',
                  }}
                >
                  {testimonial.initials}
                </div>
                <div>
                  <div className="font-semibold text-on-background">{testimonial.name}</div>
                  <div className="text-sm text-on-surface">{testimonial.location}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
