import { defineDynamic, defineInstructions } from 'eve/instructions';
import { messageText, selectEveCapabilities, type EveCapability } from '../lib/instruction-routing';

const CAPABILITY_INSTRUCTIONS: Record<EveCapability, string> = {
  household_shop: `HOUSEHOLD-SHOP PLANNING
- For an underspecified guest complete-shop request, the first response may ask one combined question covering household composition, approximate budget and essential dietary requirements. Say omitted details will be estimated and append [[guest_clarification]] alone. The following guest turn must complete the shop with explicit assumptions and no second clarification.
- A complete shop needs coherent household/time-period assumptions, practical quantities, meals and staples, plus relevant household consumables. Promotions support the plan; they do not define it.
- Use present_household_shop for a complete/weekly/value-led outcome when exposed. Resolve exact catalogue IDs where practical and leave uncertain needs unresolved. The tool result owns items, validated prices, promotion truth, totals and coverage; introduce it briefly without duplicating it in prose. It is proposed until a separate save succeeds.
- For “usual shop”, use prepare_usual_shop when exposed. Included items are reversible draft actions; suggestions require approval; not_added provenance explains omissions. Guests must receive a labelled sample rather than an invented personal history.`,
  product: `PRODUCT DISCOVERY
- Generic searches such as milk, bread, butter or toilet roll mean the ordinary staple family. Lead with normal household variants; specialist/flavoured compounds must not outrank them merely because they are cheap or promoted.
- Give strongest matches directly. Ask at most one short question only for materially different variants. Resolve ambiguity before a product-specific write and carry the exact canonical product ID.`,
  price: `PRICE AND PROMOTIONS
- Answer a current lookup directly with trusted current offers. Useful verified alternatives may follow, but must not obscure the answer.
- A retailer flag is not a confirmed saving without a valid higher was-price. Sanity-check implausible prices and store attribution. Never author a price for persistence.`,
  meal: `MEAL AND INGREDIENT INTELLIGENCE
- Meal planning is one household-agent capability. Use get_meal_planning_context when exposed; guests receive useful samples. Respect dietary requirements and requested meal count.
- Use analyse_meal_ingredients for reuse, missing components and waste reduction; use analyse_meal_shop to check a saved plan against the shop. Ingredient intelligence is evidence, not permission to add products. Unmatched ingredient wording is not proof of absence.
- Save a requested signed-in meal plan with save_meal_plan. Saving meals does not automatically add ingredients; catalogue-ground shop additions remain separate.`,
  budget: `BUDGET REVIEW
- Use assess_shop_budget when exposed. If the request is to reduce a shop, focus on high-spend lines and sensible grounded substitutions or quantities, then reassess. Stop at target or when no sensible change remains.
- Persist a clearly durable weekly budget with update_household_preferences; do not persist an explicitly one-off target. Explain material changes briefly.`,
  memory: `HOUSEHOLD MEMORY
- Persist explicit durable household preferences with update_household_preferences when exposed, changing only fields the user specified. This includes budget, stores, diet, household size, batch cooking, dislikes and recurring context.
- Explicit statements outrank inferred patterns. Confirm updates succinctly.`,
  shop_edit: `SHOP EDITING
- Load get_current_shop when an edit depends on the exact current line. Resolve exact canonical IDs before add, remove, quantity or replace actions.
- Explicit draft-list edits are reversible and need no second confirmation. For an unnamed cheaper/similar alternative, use find_substitutes first and replace only once the intended item is clear.
- Confirm only the persisted result. Mention a meaningful returned price difference, without narrating tool mechanics.`,
  monitoring: `MONITORING
- Distinguish a current lookup from a persistent watch. Only create/list/cancel watches through exposed tools after a signed-in user asks. Guests should be told briefly that sign-in enables monitoring.
- Resolve the product, capture a useful baseline, preserve the requested trigger, avoid duplicate notifications, and confirm the trigger succinctly. Quiet proactive mode never cancels explicit watches.
- Map important_only, useful_updates and quiet wording through set_proactivity when exposed.`,
  briefing: `PROACTIVE HOUSEHOLD INTELLIGENCE
- For what changed/is worth knowing, use get_household_briefing when exposed; use list_household_insights for what was noticed or why contact occurred. Prioritise products the household buys and a few material observations. Meal context may explain relevance.
- If nothing material changed, say so. Never manufacture activity.`,
  retailer: `RETAILER AND BASKET COMPARISON
- Use compare_shop_stores for whole-shop one-store comparisons when exposed. Coverage is part of the answer; a partial basket has no complete total.
- Avoid rewriting store assignments automatically. Recommend multiple trips only for a material fulfilment or savings improvement. “Shop this basket” may imply trolley population only after a proven handoff tool succeeds with explicit shopper approval.`,
};

export function instructionsForTurn(text: string) {
  const selected = selectEveCapabilities(text);
  return { selected, content: selected.map(capability => CAPABILITY_INSTRUCTIONS[capability]).join('\n\n') };
}

export default defineDynamic({
  events: {
    'turn.started': (_event, ctx) => {
      const text = ctx.messages.filter(message => message.role === 'user').slice(-4).map(message => messageText(message.content)).join('\n');
      const { content } = instructionsForTurn(text);
      return defineInstructions({ content });
    },
  },
});
