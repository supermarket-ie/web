import type { Metadata } from 'next';
import Link from 'next/link';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '@/lib/supabase';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { TokenPersist } from '@/components/TokenPersist';
import { SavedListView } from '@/components/SavedListView';

export const metadata: Metadata = {
  title: 'Your grocery list — supermarket.ie',
  description: 'Your personalised AI grocery list with the best prices across Irish supermarkets.',
  robots: { index: false, follow: false },
};

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');

interface MagicLinkPayload {
  email: string;
  subscriberId: string;
  familySize: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts the actual grocery list content from conversation messages.
 * Filters out AI narration / planning commentary.
 * Returns the last assistant message that looks like a real grocery list.
 */
function extractListContent(messages: Array<{ role: string; content: string }>): string | null {
  // Walk backward to find the last assistant message that contains a real list
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.content || msg.content.length < 100) continue;

    const content = msg.content;

    // Skip pure narration messages
    const narrationPatterns = [
      /^(Now let me|Perfect,? I have|Let me (get|check|look|find)|I('ll| will) now|Great,? (let|I)|OK,? (let|I)|Alright,? (let|I))/i,
      /^(I'm going to|I need to|First,? (let|I)|Here's what I'm)/i,
    ];
    const firstLine = content.split('\n')[0].trim();
    if (narrationPatterns.some(p => p.test(firstLine))) {
      // But if it also has store totals or many list items, keep it
      const hasStoreSection = /🏪|store total/i.test(content);
      const listItemCount = (content.match(/^- /gm) || []).length;
      if (!hasStoreSection && listItemCount < 5) continue;
    }

    // Check if this looks like a grocery list:
    // Has store totals emoji/section, OR has at least 5 list items
    const hasStoreMarker = /🏪|Store total/i.test(content);
    const listItems = (content.match(/^- /gm) || []).length;

    if (hasStoreMarker || listItems >= 5) {
      return content;
    }
  }

  // Fallback: return the last long assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].content?.length > 200) {
      return messages[i].content;
    }
  }

  return null;
}

// ── Error pages ───────────────────────────────────────────────────────────────

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

function EmptyListPage({ token }: { token: string }) {
  return (
    <>
      <SiteHeader />
      <TokenPersist token={token} familySize="2" email="" />
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16" style={{ background: 'var(--surface)' }}>
        <div className="rounded-2xl max-w-md w-full p-8 text-center" style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
          <div className="text-5xl mb-4">🛒</div>
          <h1 className="text-2xl font-bold mb-3" style={{ color: 'var(--on-background)' }}>No list yet</h1>
          <p className="mb-6" style={{ color: 'var(--on-surface)' }}>
            Chat with our AI planner to build your personalised grocery list with the best prices across stores.
          </p>
          <Link
            href="/"
            className="inline-flex items-center px-6 py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #006A35, #00944A)' }}
          >
            Plan my groceries →
          </Link>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default async function ListPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; list?: string; intent?: string; list_id?: string }>;
}) {
  const { token, list: listId, intent, list_id } = await searchParams;

  // Auth
  let payload: MagicLinkPayload | null = null;
  if (token) {
    try {
      payload = jwt.verify(token, SECRET!) as MagicLinkPayload;
    } catch {
      // expired or invalid
    }
  }
  if (!payload) return <ExpiredPage />;

  // Fetch saved lists for this subscriber
  const { data: savedLists } = await supabaseAdmin
    .from('saved_lists')
    .select('id, name, meals_prompt, family_size, store_totals, is_default, created_at, generated_at, items')
    .eq('subscriber_id', payload.subscriberId)
    .order('created_at', { ascending: false })
    .limit(10);

  // Pick which list to show (specific or most recent)
  const lists = savedLists ?? [];
  const activeList = listId
    ? lists.find(l => l.id === listId) ?? lists[0]
    : lists[0];

  if (!activeList) {
    return <EmptyListPage token={token!} />;
  }

  // Get the conversation linked to this list (for fallback content)
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id, messages')
    .eq('subscriber_id', payload.subscriberId)
    .eq('list_id', activeList.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // Extract list content using the narration-stripping helper
  let listContent: string | null = null;
  let conversationId: string | null = null;

  if (conversation) {
    conversationId = conversation.id;
    const messages = (conversation.messages ?? []) as Array<{ role: string; content: string }>;
    listContent = extractListContent(messages);
  }

  // Structured items from saved_lists.items
  const structuredItems = (activeList.items && Array.isArray(activeList.items) && activeList.items.length > 0 &&
    typeof activeList.items[0] === 'object' && 'canonical_name' in activeList.items[0])
    ? activeList.items as Array<{ canonical_name: string; store: string; price: number; quantity?: number; category?: string; store_product_name?: string; on_promotion?: boolean }>
    : null;

  const storeTotals = (activeList.store_totals ?? []) as Array<{ store: string; total: number; item_count?: number }>;

  // Household memory for intelligence section
  const { data: householdData } = await supabaseAdmin
    .from('households')
    .select('memory')
    .eq('subscriber_id', payload.subscriberId)
    .single();
  const householdMemory = householdData?.memory ?? null;

  return (
    <>
      <SiteHeader />
      <TokenPersist token={token!} familySize={activeList.family_size ?? '2'} email={payload.email} />
      <SavedListView
        listContent={listContent}
        structuredItems={structuredItems}
        storeTotals={storeTotals}
        listName={activeList.name}
        createdAt={activeList.created_at}
        conversationId={conversationId}
        token={token!}
        allLists={lists.map(l => ({
          id: l.id,
          name: l.name,
          store_totals: (l.store_totals ?? []) as Array<{ store: string; total: number; item_count?: number }>,
          created_at: l.created_at,
        }))}
        activeListId={activeList.id}
        householdMemory={householdMemory}
        intent={intent}
        targetListId={list_id}
      />
      <SiteFooter />
    </>
  );
}
