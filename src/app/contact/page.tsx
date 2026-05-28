import type { Metadata } from 'next';
import { ContactForm } from './ContactForm';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();

export const metadata: Metadata = {
  title: 'Contact Us · supermarket.ie',
  description: "Get in touch with the supermarket.ie team. We'd love to hear about partnerships, vendor opportunities, or just your ideas.",
  alternates: { canonical: `${BASE_URL}/contact` },
};

export default function ContactPage() {
  return <ContactForm />;
}
