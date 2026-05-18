import { createAgentUIStreamResponse, UIMessage } from 'ai';
import { createPlannerAgent, type PlannerProfile } from '@/lib/planner-agent';
import { supabaseAdmin } from '@/lib/supabase';
import jwt from 'jsonwebtoken';

export const maxDuration = 60;

const SECRET = process.env.MAGIC_LINK_SECRET;

export async function POST(req: Request) {
  const body = await req.json();

  // ── Auth ──
  let subscriberId: string | null = null;
  const token = body.token as string | undefined;
  if (token && SECRET) {
    try {
      const payload = jwt.verify(token, SECRET!) as { subscriberId: string };
      subscriberId = payload.subscriberId;
    } catch {}
  }

  // ── Extract request data ──
  const conversationId = body.conversationId as string | undefined;
  let profile = body.profile as PlannerProfile | undefined;
  const incomingMessages = (body.messages ?? []) as UIMessage[];

  // ── Conversation-based flow (useChat from ConversationChat): load context from DB ──
  if (conversationId && subscriberId && incomingMessages.length > 0) {
    const { data: convo, error: convoErr } = await supabaseAdmin
      .from('conversations')
      .select('messages, profile')
      .eq('id', conversationId)
      .eq('subscriber_id', subscriberId)
      .single();

    if (convoErr || !convo) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const convoProfile = convo.profile as PlannerProfile | null;
    if (convoProfile) profile = convoProfile;

    // Convert stored messages to UIMessage format and prepend
    const storedMessages = (convo.messages ?? []) as Array<{ role: string; content: string; timestamp?: string }>;
    const storedUIMessages: UIMessage[] = storedMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map((m, i) => ({
        id: `stored-${i}`,
        role: m.role as 'user' | 'assistant',
        parts: [{ type: 'text' as const, text: m.content }],
      }));

    // Merge: stored messages first, then incoming (which has the new user message)
    const allMessages = [...storedUIMessages, ...incomingMessages];

    const agent = createPlannerAgent({
      subscriberId,
      profile: profile ?? undefined,
      householdSize: body.householdSize ?? 2,
      isModification: true,
    });

    return createAgentUIStreamResponse({
      agent,
      uiMessages: allMessages,
      onFinish: async ({ responseMessage }) => {
        try {
          const assistantText = responseMessage.parts
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map(p => p.text)
            .join('');

          const userMsg = [...incomingMessages].reverse().find(m => m.role === 'user');
          const userText = userMsg?.parts
            ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map(p => p.text)
            .join('') ?? '';

          const updatedMessages = [
            ...storedMessages,
            { role: 'user', content: userText, timestamp: new Date().toISOString() },
            { role: 'assistant', content: assistantText, timestamp: new Date().toISOString() },
          ];

          await supabaseAdmin
            .from('conversations')
            .update({ messages: updatedMessages })
            .eq('id', conversationId)
            .eq('subscriber_id', subscriberId);
        } catch (err) {
          console.error('[/api/plan] conversation save error:', err);
        }
      },
    });
  }

  // ── Legacy/HomePlanner flow (profile or messages-based, returns data stream) ──
  // HomePlanner sends { profile, token } or { messages: [{role,content}], profile, token }
  // These are NOT UIMessages — they're plain {role, content} objects

  // If signed in but no profile in request, try loading from households table
  if (!profile && subscriberId) {
    const { data: hh } = await supabaseAdmin
      .from('households')
      .select('*')
      .eq('subscriber_id', subscriberId)
      .single();
    if (hh) {
      profile = {
        adults: hh.adults,
        children: hh.children,
        childAges: hh.child_ages ?? [],
        weeklyBudget: hh.weekly_budget ?? undefined,
        preferredStores: hh.preferred_stores ?? ['all'],
        dietary: hh.dietary ?? [],
        dislikes: hh.dislikes ?? undefined,
        meals: hh.meals ?? { breakfast: true, lunch: true, dinner: true, snacks: true },
        batchCooking: hh.batch_cooking ?? false,
        skipDays: hh.skip_days ?? undefined,
        extraContext: hh.extra_context ?? undefined,
      };
    }
  }

  // Build messages for the agent
  let apiMessages: Array<{ role: 'user' | 'assistant'; content: string }>;

  if (profile && !body.messages) {
    // Profile-based generation — synthesize a user message
    const totalPeople = profile.adults + profile.children;
    const meals: string[] = [];
    if (profile.meals.breakfast) meals.push('breakfasts');
    if (profile.meals.lunch) meals.push('lunches / packed lunches');
    if (profile.meals.dinner) meals.push('dinners');
    if (profile.meals.snacks) meals.push('snacks');

    let userMsg = `Plan a full week of groceries for my household of ${totalPeople}. I need: ${meals.join(', ')}.`;
    if (profile.batchCooking) userMsg += ' I like batch cooking.';
    if (profile.skipDays) userMsg += ` We're eating out: ${profile.skipDays}.`;
    if (profile.extraContext) userMsg += ` Also: ${profile.extraContext}`;
    userMsg += '\n\nBuild me a complete grocery list with the best prices.';

    apiMessages = [{ role: 'user', content: userMsg }];
  } else if (Array.isArray(body.messages) && body.messages.length > 0) {
    // Modification or legacy flow — messages already provided
    apiMessages = body.messages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
  } else {
    return new Response(JSON.stringify({ error: 'Messages or profile required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Determine if modification
  const isModification = apiMessages.length > 1 && apiMessages.some(m => m.role === 'assistant');

  // Convert plain messages to UIMessage format for createAgentUIStreamResponse
  const uiMessages: UIMessage[] = apiMessages.map((m, i) => ({
    id: `legacy-${i}`,
    role: m.role,
    parts: [{ type: 'text' as const, text: m.content }],
  }));

  const agent = createPlannerAgent({
    subscriberId,
    profile,
    householdSize: body.householdSize ?? 2,
    isModification,
  });

  return createAgentUIStreamResponse({
    agent,
    uiMessages,
  });
}
