import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import {
  getAllCategories,
  getPricesByCategory,
  getWeeklyPromotions,
} from "@/lib/supabase";
import { GenerateListRequest, GeneratedList } from "@/lib/types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the AI shopping brain behind supermarket.ie — a smart grocery planning service for Irish families.

Your job is to build a personalised weekly shopping list that is genuinely useful, not just a generic product dump. You reason like a smart friend who shops well: you know the Irish supermarket landscape, you check what's on deal this week, and you make intelligent decisions about value vs convenience.

THE STORES YOU WORK WITH:
- Lidl & Aldi-equivalent: own-brand heroes, consistently cheapest on staples
- Tesco: wide range, good own-brand (Tesco Finest / Tesco Value), often has branded promotions
- SuperValu: slightly premium, strong on Irish provenance, good meat counter
- Dunnes Stores: strong on own-brand, popular for Irish households

YOUR PROCESS — follow this exactly:
1. Call get_all_categories() to see what food categories are available
2. Call get_weekly_promotions() to find what's on special this week — anchor your plan around good deals
3. For a typical weekly shop, call get_prices_by_category() for these core categories: Dairy, Meat (unless vegetarian/vegan), Fish, Vegetables, Fruit, Bakery, Frozen, Tinned, Pasta & Rice
4. For each product you include, choose the cheapest store option unless there's a compelling reason not to
5. Scale quantities sensibly for the family size
6. Consider store routing: if 80%+ of items are cheapest at one store, recommend shopping there primarily

FAMILY SIZE GUIDANCE:
- 1 person: ~20 items, ~€50-70/week
- 2 people: ~25 items, ~€80-100/week
- 3-4 people: ~28-32 items, ~€120-160/week
- 5+ people: ~32-38 items, ~€160-210/week

DIETARY RULES (apply strictly):
- vegetarian: no meat (chicken, beef, pork, bacon), include extra protein: eggs, beans, cheese
- vegan: no meat or dairy or eggs, include plant-based alternatives from available products
- gluten_free: no wheat bread, no pasta — skip those categories
- dairy_free: no milk, butter, cheese, yogurt — skip those items
- halal: no pork sausages, no bacon rashers

IMPORTANT — TONE AND STYLE:
- Sound like a smart, friendly advisor — not a robot or a coupon flyer
- The brand is premium/fintech (think Monzo, Revolut) — never say "DEAL ALERT!!" or use capitals for emphasis
- Highlight savings naturally: "salmon is on at Tesco this week — worth picking up"
- Be honest about store routing trade-offs

YOUR FINAL RESPONSE must be ONLY a valid JSON object (no markdown, no explanation outside the JSON) with this exact structure:
{
  "items": [
    {
      "canonical_name": "string",
      "display_name": "string",
      "category": "string",
      "store": "string (tesco|dunnes|supervalu|lidl)",
      "store_product_name": "string",
      "brand": "string or null",
      "is_own_brand": boolean,
      "price": number,
      "was_price": number or null,
      "on_promotion": boolean,
      "quantity": number,
      "line_total": number,
      "note": "string or null"
    }
  ],
  "total_estimate": number,
  "store_breakdown": {
    "storeName": { "items": number, "total": number }
  },
  "savings_vs_full_price": number,
  "ai_summary": "2-3 sentence friendly summary of this week's list",
  "key_insights": ["insight 1", "insight 2", "insight 3"],
  "store_strategy": "one sentence describing where to shop"
}`;

const tools: Anthropic.Tool[] = [
  {
    name: "get_all_categories",
    description:
      "Returns all available product categories in the database. Call this first to understand what food categories are available.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_weekly_promotions",
    description:
      "Returns all products currently on promotion across all stores, with their promotional prices and savings. Use this to anchor the weekly list around the best deals.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_prices_by_category",
    description:
      "Returns all products in a category with their current prices across all stores. Use this to find the cheapest option for each product type. Call this for each food category you want to include.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description:
            "The exact category name (e.g. 'Dairy', 'Meat', 'Vegetables'). Use get_all_categories first to see valid values.",
        },
      },
      required: ["category"],
    },
  },
];

async function executeToolCall(
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "get_all_categories":
      return await getAllCategories();
    case "get_weekly_promotions":
      return await getWeeklyPromotions();
    case "get_prices_by_category":
      return await getPricesByCategory(input.category as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: GenerateListRequest = await req.json();
    const { familySize, dietary = [], budget } = body;

    if (!familySize || familySize < 1 || familySize > 10) {
      return NextResponse.json(
        { error: "Invalid family size" },
        { status: 400 }
      );
    }

    const dietaryText =
      dietary.length > 0
        ? `Dietary requirements: ${dietary.join(", ")}.`
        : "No dietary restrictions.";

    const budgetText = budget ? `Weekly budget: approximately €${budget}.` : "";

    const userMessage = `Please build a weekly shopping list for a ${familySize === 1 ? "single person" : `family of ${familySize}`}. ${dietaryText} ${budgetText}

Follow your process: check categories, check promotions, then build the list category by category. Make intelligent store choices.`;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    // Agentic loop — Claude reasons, calls tools, and builds the list
    let iterations = 0;
    const MAX_ITERATIONS = 20;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      if (response.stop_reason === "end_turn") {
        // Extract the final JSON from the response
        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          throw new Error("No text response from agent");
        }

        let rawText = textBlock.text.trim();

        // Strip any accidental markdown code fences
        rawText = rawText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "");

        const list: GeneratedList = JSON.parse(rawText);

        // Validate required fields
        if (!list.items || !Array.isArray(list.items)) {
          throw new Error("Invalid list format from agent");
        }

        return NextResponse.json({ list });
      }

      if (response.stop_reason === "tool_use") {
        // Push assistant's response (with tool use blocks) to history
        messages.push({ role: "assistant", content: response.content });

        // Execute all tool calls and collect results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === "tool_use") {
            try {
              const result = await executeToolCall(
                block.name,
                block.input as Record<string, unknown>
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result),
              });
            } catch (err) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
                is_error: true,
              });
            }
          }
        }

        // Add tool results back into the conversation
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // Unexpected stop reason
      throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
    }

    throw new Error("Agent exceeded maximum iterations");
  } catch (err) {
    console.error("generate-list error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
