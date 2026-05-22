import { Star, Quote } from 'lucide-react';

const testimonials = [
  {
    quote:
      "I told it about my family once and now it just knows what we need. Last week it spotted that our usual chicken fillets were €2 cheaper at Dunnes. Felt like having a friend who works in the supermarket.",
    name: 'Sarah Murphy',
    location: 'Mum of 3, Dublin',
    initials: 'SM',
  },
  {
    quote:
      "It's not a price comparison site — it actually thinks about what we eat. Suggested a batch cook on Sunday that used up things already on our list. Saved us €90 in the first month.",
    name: "Cian O'Brien",
    location: 'Family of 4, Cork',
    initials: 'CO',
  },
  {
    quote:
      "I just text it what meals I want this week and it comes back with everything I need, from the cheapest stores. No more spreadsheets, no more three different apps.",
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
        <div className="text-center mb-16">
          <span
            className="type-label inline-flex items-center px-3 py-1.5 rounded-full mb-4"
            style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}
          >
            Real households, real results
          </span>
          <h2 className="type-headline text-on-background text-balance">
            What people say about their agent
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((testimonial) => (
            <div
              key={testimonial.name}
              className="rounded-2xl p-8 relative"
              style={{ background: 'var(--surface-container-lowest)' }}
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
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
