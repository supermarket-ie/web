import type { Metadata } from 'next';
import { PlannerClient } from './PlannerClient';

export const metadata: Metadata = {
  title: 'AI Meal Planner — supermarket.ie',
  description: "Tell us what you're cooking this week. We'll build your shopping list and find the cheapest prices across Tesco, Dunnes and SuperValu.",
};

export default function PlanPage() {
  return <PlannerClient />;
}
