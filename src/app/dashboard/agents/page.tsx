import { redirect } from 'next/navigation';

// Permanent redirect — /dashboard/agents → /dashboard/automations
export default function AgentsRedirect() {
  redirect('/dashboard/automations');
}
