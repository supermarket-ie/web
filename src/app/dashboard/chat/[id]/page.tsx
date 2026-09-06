import { SiteHeader } from '@/components/SiteHeader';
import { ConversationChat } from '@/components/ConversationChat';

export const metadata = {
  title: 'Chat',
  robots: { index: false, follow: false },
};

export default async function ChatPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ prefill?: string }> }) {
  const { id } = await params;
  const { prefill } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="min-h-screen" style={{ background: 'var(--surface-container-lowest)' }}>
        <ConversationChat conversationId={id} prefill={prefill} />
      </main>
    </>
  );
}
