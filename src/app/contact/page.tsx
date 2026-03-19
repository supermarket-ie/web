import type { Metadata } from 'next';
import { ContactForm } from './ContactForm';

export const metadata: Metadata = {
  title: 'Contact Us · supermarket.ie',
  description: "Get in touch with the supermarket.ie team. We'd love to hear about partnerships, vendor opportunities, or just your ideas.",
};

export default function ContactPage() {
  return <ContactForm />;
}
