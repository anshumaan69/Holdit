import { ILLMProvider } from "./provider.interface.js";
import { BookingFilters, BookingFiltersSchema } from "./types.js";
import { config } from "../../config/index.js";

/**
 * OpenAI Provider using Tool Calling
 */
export class OpenAILLMProvider implements ILLMProvider {
  public name = "openai_gpt";

  public async parseNaturalLanguageQuery(query: string): Promise<BookingFilters> {
    if (!config.llm.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is not set in environment.");
    }

    const todayStr = new Date().toISOString().split("T")[0];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llm.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a travel booking parser. Today is ${todayStr}. Extract filters accurately.`,
          },
          { role: "user", content: query },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_travel_filters",
              parameters: {
                type: "object",
                properties: {
                  destination: { type: "string" },
                  checkIn: { type: "string", description: "YYYY-MM-DD" },
                  checkOut: { type: "string", description: "YYYY-MM-DD" },
                  nights: { type: "integer" },
                  guests: { type: "integer" },
                  roomsRequired: { type: "integer" },
                  maxBudgetInr: { type: "number" },
                  proximity: {
                    type: "string",
                    enum: ["beachfront", "walking_distance_to_beach", "city_center", "any"],
                  },
                  amenities: { type: "array", items: { type: "string" } },
                },
                required: ["destination", "checkIn", "checkOut", "guests"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_travel_filters" } },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} - ${await response.text()}`);
    }

    const data: any = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("OpenAI did not return expected tool call.");
    }

    const args = JSON.parse(toolCall.function.arguments);
    return BookingFiltersSchema.parse(args);
  }
}
