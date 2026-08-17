import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export const faqs = [
  {
    question: 'What exactly is a supermarket agent?',
    answer:
      "It's an AI that works specifically for your household. It learns what you eat, use and regularly need, then helps plan and build your complete supermarket shop. Think of it as a personal shopper that remembers your household.",
  },
  {
    question: 'Does it cover household items as well as food?',
    answer:
      'Yes. The aim is to handle the full supermarket shop: food and drink, cleaning and laundry, toiletries, baby products, pet supplies and other everyday household essentials.',
  },
  {
    question: 'Is it really free?',
    answer:
      "Yes, completely free. We're building Ireland's definitive supermarket agent and want as many households as possible to help shape it.",
  },
  {
    question: 'How does it learn about my household?',
    answer:
      "Just chat with it. Tell it about your family, favourite meals, budget, dietary needs and the products you regularly use. The more you use it, the less you need to explain.",
  },
  {
    question: 'Which supermarkets does it understand?',
    answer:
      'Your agent currently works with product and pricing information from Tesco Ireland, Dunnes Stores, SuperValu and Aldi. That coverage helps it make better choices while assembling your shop.',
  },
  {
    question: 'How fresh is the product information?',
    answer:
      'Product and price information is refreshed multiple times per week, so the agent can work from current availability and promotions rather than a static catalogue.',
  },
  {
    question: 'Can I ask it individual product questions?',
    answer:
      'Absolutely. You can ask about anything from dinner ingredients to detergent, toiletries or pet food. Product and price questions are capabilities of the agent—not the limit of what it does.',
  },
];

export function FAQSection() {
  return (
    <section className="px-6 py-20" style={{ background: 'var(--surface)' }}>
      <div className="mx-auto max-w-3xl">
        <div className="mb-12 text-center">
          <span className="type-label mb-4 inline-flex rounded-full bg-surface-container px-3 py-1.5 text-on-surface">
            FAQ
          </span>
          <h2 className="type-headline text-on-background">Questions about your agent</h2>
        </div>

        <Accordion className="w-full">
          {faqs.map((faq, index) => (
            <AccordionItem
              key={faq.question}
              value={`item-${index}`}
              className="border-b"
              style={{ borderColor: 'var(--outline-variant)' }}
            >
              <AccordionTrigger className="py-4 text-left font-semibold text-on-background hover:no-underline">
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
