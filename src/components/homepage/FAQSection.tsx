'use client';

import { motion } from 'framer-motion';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

const faqs = [
  {
    question: 'How does supermarket.ie compare prices?',
    answer:
      'We track prices from Tesco, Dunnes Stores, SuperValu, Lidl, and Aldi across Ireland. Our system updates daily to ensure you always see the most current prices and deals available.',
  },
  {
    question: 'Is supermarket.ie really free?',
    answer:
      "Yes, 100% free! We believe every Irish family deserves access to the best grocery prices. We're supported by affiliate partnerships, not by charging our users.",
  },
  {
    question: 'How much can I actually save?',
    answer:
      'Most families save €80-100 per month by switching to the cheapest options we recommend. Over a year, that adds up to €1,000-1,200 in savings on the same groceries you already buy.',
  },
  {
    question: 'How does the AI meal planning work?',
    answer:
      "Tell our AI about your household size, dietary preferences, and what you like to eat. It creates a personalised weekly meal plan and shopping list optimised for the best deals available this week.",
  },
  {
    question: 'Which supermarkets do you cover?',
    answer:
      'We currently track prices from Tesco Ireland, Dunnes Stores, and SuperValu — the three largest supermarket chains in Ireland. We\'re working on adding Lidl and Aldi coverage soon.',
  },
  {
    question: 'How often are prices updated?',
    answer:
      'Prices are updated daily. We also track weekly specials and promotional deals as soon as they become available, so your shopping list always reflects the current best prices.',
  },
];

export function FAQSection() {
  return (
    <section className="py-20 px-6 bg-surface">
      <div className="max-w-3xl mx-auto">
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
            FAQ
          </span>
          <h2 className="type-headline text-on-background">Frequently asked questions</h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="border-b"
                style={{ borderColor: 'var(--outline-variant)' }}
              >
                <AccordionTrigger className="text-left font-semibold text-on-background hover:no-underline py-5">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-on-surface pb-5">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  );
}
