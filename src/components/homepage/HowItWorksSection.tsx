import { MessageSquare, Brain, Zap, ShoppingCart, TrendingDown, Bell } from 'lucide-react';

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="relative border-b border-[#e2e8e3] bg-white px-6 py-20">
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="mb-16">
          <span
            className="type-label inline-flex items-center px-3 py-1.5 rounded-full mb-4"
            style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}
          >
            What your agent does
          </span>
          <h2 className="type-headline text-on-background text-balance">
            Like having a personal shopper
            <br />
            who never sleeps
          </h2>
        </div>

        {/* Bento Grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Card 1 - Learns you */}
          <div
            className="relative overflow-hidden rounded-2xl border border-[#e0e7e2] p-8 shadow-[0_10px_32px_rgba(27,55,38,0.05)]"
            style={{ background: 'var(--surface-container-lowest)' }}
          >
            <div
              className="size-12 rounded-xl flex items-center justify-center mb-4"
              style={{ background: 'var(--surface-container)' }}
            >
              <Brain className="size-6" style={{ color: 'var(--primary)' }} />
            </div>
            <h3 className="type-title-lg mb-2 text-on-background">
              Learns your household
            </h3>
            <p className="text-on-surface">
              Family size, dietary needs, favourite meals, cleaning products, toiletries, budget and recurring essentials — your agent remembers it all and gets better every week.
            </p>
          </div>

          {/* Card 2 - Agent capabilities (large) */}
          <div
            className="relative overflow-hidden rounded-2xl p-8 shadow-[0_18px_50px_rgba(0,106,53,0.2)] md:row-span-2"
            style={{ background: '#006A35' }}
          >
            {/* Decorative blobs */}
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
                <Zap className="size-6" style={{ color: 'var(--primary-container)' }} />
              </div>
              <h3 className="type-title-lg mb-2 text-white">
                Works for you 24/7
              </h3>
              <p className="mb-8" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Your agent isn&apos;t a search engine. It actively monitors prices, spots opportunities, and keeps track of your complete supermarket shop so you don&apos;t have to.
              </p>

              {/* Agent capabilities */}
              <div
                className="rounded-xl p-5 space-y-5"
                style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)' }}
              >
                <div className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--primary-container)' }}>
                  Your agent can
                </div>
                {[
                  { icon: ShoppingCart, text: 'Plan meals and build your complete weekly shop' },
                  { icon: TrendingDown, text: 'Remember cleaning, toiletries and recurring essentials' },
                  { icon: Bell, text: 'Keep the whole shop within your household budget' },
                  { icon: MessageSquare, text: 'Answer questions about products across Irish supermarkets' },
                ].map((item) => (
                  <div key={item.text} className="flex items-start gap-3">
                    <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.12)' }}>
                      <item.icon className="size-4" style={{ color: 'var(--primary-container)' }} />
                    </div>
                    <span className="text-sm font-medium text-white leading-snug">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Card 3 - Conversational */}
          <div
            className="relative overflow-hidden rounded-2xl border border-[#e0e7e2] p-8 shadow-[0_10px_32px_rgba(27,55,38,0.05)]"
            style={{ background: 'var(--surface-container-lowest)' }}
          >
            <div
              className="size-12 rounded-xl flex items-center justify-center mb-4"
              style={{ background: 'var(--surface-container)' }}
            >
              <MessageSquare className="size-6" style={{ color: 'var(--primary)' }} />
            </div>
            <h3 className="type-title-lg mb-2 text-on-background">
              Just talk to it
            </h3>
            <p className="text-on-surface">
              &ldquo;We need five dinners, school lunches, detergent and toilet roll.&rdquo; Your agent handles the rest — no forms, no clicking through categories.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
