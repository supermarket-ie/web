import { SiteHeader } from '@/components/SiteHeader';
import { ConversationChat } from '@/components/ConversationChat';

export const metadata = {
  title: 'Chat',
  robots: { index: false, follow: false },
};

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <SiteHeader />
      <main className="min-h-screen" style={{ background: 'var(--surface-container-lowest)' }}>
        <ConversationChat conversationId={id} />
      </main>
    </>
  );
}
