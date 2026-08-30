import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySessionToken } from '@/lib/auth';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { TokenPersist } from '@/components/TokenPersist';
import { SavedListView } from '@/components/SavedListView';
import { ShopDecisionTrace } from '@/components/ShopDecisionTrace';

export const metadata: Metadata = {
  title: 'Your shop — supermarket.ie',
  description: 'Your household shop, prepared and managed with Supermarket.ie.',
  robots: { index: false, follow: false },
};

const CLIENT_SESSION_TOKEN = '__cookie__';

function extractListContent(messages: Array<{ role: string; content: string }>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.content || msg.content.length < 100) continue;

    const content = msg.content;
    const narrationPatterns = [
      /^(Now let me|Perfect,? I have|Let me (get|check|look|find)|I('ll| will) now|Great,? (let|I)|OK,? (let|I)|Alright,? (let|I))/i,
      /^(I'm going to|I need to|First,? (let|I)|Here's what I'm)/i,
    ];
    const firstLine = content.split('\n')[0].trim();
    if (narrationPatterns.some(p => p.test(firstLine))) {
      const hasStoreSection = /🏪|store total/i.test(content);
      const listItemCount = (content.match(/^- /gm) || []).length;
      if (!hasStoreSection && listItemCount < 5) continue;
    }

    const hasStoreMarker = /🏪|Store total/i.test(content);
    const listItems = (content.match(/^- /gm) || []).length;
    if (hasStoreMarker || listItems >= 5) return content;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].content?.length > 200) {
      return messages[i].content;
    }
  }

  return null;
}

function ExpiredPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16" style={{ background: 'var(--surface)' }}>
      <Link href="/" className="text-2xl font-bold mb-10 inline-block" style={{ color: 'var(--on-background)' }}>
        supermarket<span style={{ color: 'var(--primary)' }}>.ie</span>
      </Link>
      <div className="rounded-2xl max-w-md w-full p-8 text-center" style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
        <div className="text-5xl mb-4">🔗</div>
        <h1 className="text-2xl font-bold mb-3" style={{ color: 'var(--on-background)' }}>This link has expired</h1>
        <p className="mb-6" style={{ color: 'var(--on-surface)' }}>
          Shopping list links are valid for 7 days. Request a fresh one and we&rsquo;ll send it straight to your inbox.
        </p>
        <Link href="/list/request" className="btn-primary inline-flex px-6 py-3">
          Get a new link →
        </Link>
      </div>
    </div>
  );
}

function EmptyListPage() {
  return (
    <>
      <SiteHeader />
      <TokenPersist token={CLIENT_SESSION_TOKEN} familySize="2" email="" />
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16" style={{ background: 'var(--surface)' }}>
        <div className="rounded-2xl max-w-md w-full p-8 text-center" style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
          <div className="text-5xl mb-4">🛒</div>
          <h1 className="text-2xl font-bold mb-3" style={{ color: 'var(--on-background)' }}>No shop yet</h1>
          <p className="mb-6" style={{ color: 'var(--on-surface)' }}>
            Tell Supermarket.ie what your household needs and we&rsquo;ll prepare the shop with you.
          </p>
          <Link
            href="/"
            className="inline-flex items-center px-6 py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #006A35, #00944A)' }}
          >
            Prepare my shop →
          </Link>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}

type DecisionTrace = {
  version?: number;
  prepared_at?: string;
  decisions?: Array<{
    canonical_name: string;
    action: 'included' | 'suggested' | 'not_added';
    confidence: 'include' | 'suggest' | 'suppress';
    reason: string;
    signals?: string[];
    sources?: string[];
    price?: number | null;
    store?: string | null;
    on_promotion?: boolean;
  }>;
};

export default async function ListPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; list?: string; intent?: string }>;
}) {
  const { token: queryToken, list: listId, intent } = await searchParams;

  if (queryToken && queryToken !== CLIENT_SESSION_TOKEN) {
    const exchange = new URLSearchParams({ token: queryToken });
    if (listId) exchange.set('list', listId);
    if (intent) exchange.set('intent', intent);
    redirect(`/api/session?${exchange.toString()}`);
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('sm_session')?.value ?? '';
  const payload = verifySessionToken(sessionToken);
  if (!payload) return <ExpiredPage />;

  const { data: savedLists } = await supabaseAdmin
    .from('saved_lists')
    .select('id, name, meals_prompt, family_size, store_totals, is_default, created_at, generated_at, items, agent_decision_trace')
    .eq('subscriber_id', payload.subscriberId)
    .order('created_at', { ascending: false })
    .limit(10);

  const lists = savedLists ?? [];
  const activeList = listId
    ? lists.find(l => l.id === listId) ?? lists[0]
    : lists[0];

  if (!activeList) return <EmptyListPage />;

  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id, messages')
    .eq('subscriber_id', payload.subscriberId)
    .eq('list_id', activeList.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  let listContent: string | null = null;
  let conversationId: string | null = null;

  if (conversation) {
    conversationId = conversation.id;
    const messages = (conversation.messages ?? []) as Array<{ role: string; content: string }>;
    listContent = extractListContent(messages);
  }

  const structuredItems = (activeList.items && Array.isArray(activeList.items) && activeList.items.length > 0 &&
    typeof activeList.items[0] === 'object' && 'canonical_name' in activeList.items[0])
    ? activeList.items as Array<{ canonical_name: string; store: string; price: number; quantity?: number; category?: string; store_product_name?: string; on_promotion?: boolean }>
    : null;

  const storeTotals = (activeList.store_totals ?? []) as Array<{ store: string; total: number; item_count?: number }>;
  const decisionTrace = (activeList.agent_decision_trace ?? null) as DecisionTrace | null;

  return (
    <>
      <SiteHeader />
      <TokenPersist token={CLIENT_SESSION_TOKEN} familySize={activeList.family_size ?? '2'} email={payload.email ?? ''} />
      <ShopDecisionTrace trace={decisionTrace} conversationId={conversationId} />
      <SavedListView
        listContent={listContent}
        structuredItems={structuredItems}
        storeTotals={storeTotals}
        listName={activeList.name}
        createdAt={activeList.created_at}
        conversationId={conversationId}
        token={CLIENT_SESSION_TOKEN}
        allLists={lists.map(l => ({
          id: l.id,
          name: l.name,
          store_totals: (l.store_totals ?? []) as Array<{ store: string; total: number; item_count?: number }>,
          created_at: l.created_at,
        }))}
        activeListId={activeList.id}
        intent={intent}
        checkoutRuntimePreviewEnabled={process.env.CHECKOUT_RUNTIME_PREVIEW_ENABLED === 'true'}
      />
      <SiteFooter />
    </>
  );
}
