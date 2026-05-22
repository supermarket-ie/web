import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export const faqs = [
  {
    question: 'What exactly is a "grocery agent"?',
    answer:
      "It's an AI that works specifically for your household. Unlike a price comparison website where you search for individual products, your agent knows what you buy, remembers your preferences, and proactively builds your weekly shop. Think of it like a personal shopper who has memorised your entire household's needs.",
  },
  {
    question: 'Is it really free?',
    answer:
      "Yes, completely free. Your agent has full access to pricing across Tesco, Dunnes, SuperValu, and Aldi. We're building the future of grocery shopping in Ireland and want as many households as possible using it.",
  },
  {
    question: 'How much can my agent actually save me?',
    answer:
      "Most households save €80–100 per month. Your agent doesn't just find the cheapest item — it optimises your entire basket, splitting across stores when it makes sense and factoring in this week's deals on things you actually buy.",
  },
  {
    question: 'How does it learn about my household?',
    answer:
      "Just chat with it. Tell it about your family, what you like to eat, your budget, any dietary needs. It remembers everything. The more you use it, the less you need to explain — it starts anticipating what you need.",
  },
  {
    question: 'Which supermarkets does it cover?',
    answer:
      "Your agent tracks real-time prices from Tesco Ireland, Dunnes Stores, SuperValu, and Aldi — covering over 1,700 products. It knows what's on promotion, what's gone up, and what's cheapest where.",
  },
  {
    question: 'How fresh are the prices?',
    answer:
      "Prices are updated multiple times per week. Your agent always works with current shelf prices and live promotions — not stale data from last month.",
  },
  {
    question: 'Can I just ask it random questions about prices?',
    answer:
      'Absolutely. "What\'s the cheapest butter right now?" "Is Tesco or Dunnes better for dairy?" "What\'s on offer this week?" Your agent can answer anything about Irish grocery prices instantly.',
  },
];

export function FAQSection() {
  return (
    <section className="py-20 px-6" style={{ background: 'var(--surface)' }}>
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <span
            className="type-label inline-flex items-center px-3 py-1.5 rounded-full mb-4"
            style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}
          >
            FAQ
          </span>
          <h2 className="type-headline text-on-background">Questions about your agent</h2>
        </div>

        <Accordion className="w-full">
          {faqs.map((faq, index) => (
            <AccordionItem
              key={index}
              value={`item-${index}`}
              className="border-b"
              style={{ borderColor: 'var(--outline-variant)' }}
            >
              <AccordionTrigger className="text-left font-semibold text-on-background hover:no-underline py-4">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-on-surface">
                <p>{faq.answer}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
