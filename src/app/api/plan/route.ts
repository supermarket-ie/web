import { createAgentUIStreamResponse, UIMessage } from 'ai';
import { createPlannerAgent, updateHouseholdMemory, type PlannerProfile } from '@/lib/planner-agent';
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
  const intakeMode = body.intakeMode as boolean | undefined;
  const returningUser = body.returningUser as boolean | undefined;
  const profileSummary = body.profileSummary as string | undefined;
  const hasLastList = body.hasLastList as boolean | undefined;

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

    const agent = await createPlannerAgent({
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

          // Update household memory when a grocery list is generated
          if (assistantText.includes('🛒 Your weekly grocery list')) {
            updateHouseholdMemory(subscriberId!).catch((error) => {
              console.error('[/api/plan] Memory update failed:', error);
            });
            // Link conversation to the list the agent just saved
            supabaseAdmin
              .from('saved_lists')
              .select('id')
              .eq('subscriber_id', subscriberId!)
              .gte('generated_at', new Date(Date.now() - 120000).toISOString())
              .order('generated_at', { ascending: false })
              .limit(1)
              .single()
              .then(({ data: recentList }) => {
                if (recentList) {
                  supabaseAdmin
                    .from('conversations')
                    .update({ list_id: recentList.id })
                    .eq('id', conversationId)
                    .then(() => {});
                }
              });
          }
        } catch (err) {
          console.error('[/api/plan] conversation save error:', err);
        }
      },
    });
  }

  // ── Intake / AI-driven planner flow (messages-based, multi-turn) ──
  // Frontend sends { messages: [{role,content}], intakeMode: true, token?, returningUser?, profileSummary? }

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

  if (intakeMode && Array.isArray(body.messages) && body.messages.length > 0) {
    // AI-driven intake — pass messages straight through
    apiMessages = body.messages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
  } else if (profile && !body.messages) {
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

  // Determine mode
  const isModification = !intakeMode && apiMessages.length > 1 && apiMessages.some(m => m.role === 'assistant');

  // Convert plain messages to UIMessage format for createAgentUIStreamResponse
  const uiMessages: UIMessage[] = apiMessages.map((m, i) => ({
    id: `msg-${i}`,
    role: m.role,
    parts: [{ type: 'text' as const, text: m.content }],
  }));

  const agent = await createPlannerAgent({
    subscriberId,
    profile: intakeMode ? undefined : profile,
    householdSize: body.householdSize ?? 2,
    isModification,
    intakeMode: intakeMode ?? false,
    returningUser: returningUser ?? false,
    profileSummary: profileSummary ?? undefined,
    hasLastList: hasLastList ?? false,
  });

  return createAgentUIStreamResponse({
    agent,
    uiMessages,
    onFinish: async ({ responseMessage }) => {
      // Update household memory when a grocery list is generated
      if (subscriberId && intakeMode) {
        try {
          const assistantText = responseMessage.parts
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map(p => p.text)
            .join('');

          // Only update memory + link conversation when a list was generated
          if (assistantText.includes('🛒 Your weekly grocery list')) {
            updateHouseholdMemory(subscriberId).catch((error) => {
              console.error('[/api/plan] Memory update failed:', error);
            });
            // Link conversation to the list the agent just saved (intake mode)
            const bodyConversationId = body.conversationId as string | undefined;
            if (bodyConversationId) {
              supabaseAdmin
                .from('saved_lists')
                .select('id')
                .eq('subscriber_id', subscriberId)
                .gte('generated_at', new Date(Date.now() - 120000).toISOString())
                .order('generated_at', { ascending: false })
                .limit(1)
                .single()
                .then(({ data: recentList }) => {
                  if (recentList) {
                    supabaseAdmin
                      .from('conversations')
                      .update({ list_id: recentList.id })
                      .eq('id', bodyConversationId)
                      .then(() => {});
                  }
                });
            }
          }
        } catch (error) {
          console.error('[/api/plan] onFinish error:', error);
        }
      }
    },
  });
}
