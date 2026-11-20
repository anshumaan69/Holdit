import { ILLMProvider } from "./provider.interface.js";
import { BookingFilters, BookingFiltersSchema } from "./types.js";
import { config } from "../../config/index.js";

/**
 * Google Gemini Provider using Function/Tool Calling
 */
export class GeminiLLMProvider implements ILLMProvider {
  public name = "google_gemini";

  public async parseNaturalLanguageQuery(query: string): Promise<BookingFilters> {
    if (!config.llm.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not set in environment.");
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.llm.geminiApiKey}`;

    const todayStr = new Date().toISOString().split("T")[0];

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Current date is ${todayStr}. Extract travel booking search filters from this query: "${query}"`,
            },
          ],
        },
      ],
      tools: [
        {
          function_declarations: [
            {
              name: "extract_travel_filters",
              description: "Extract structured travel booking filters",
              parameters: {
                type: "OBJECT",
                properties: {
                  destination: { type: "STRING" },
                  checkIn: { type: "STRING", description: "YYYY-MM-DD" },
                  checkOut: { type: "STRING", description: "YYYY-MM-DD" },
                  nights: { type: "INTEGER" },
                  guests: { type: "INTEGER" },
                  roomsRequired: { type: "INTEGER" },
                  maxBudgetInr: { type: "NUMBER" },
                  proximity: {
                    type: "STRING",
                    enum: ["beachfront", "walking_distance_to_beach", "city_center", "any"],
                  },
                  amenities: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                  },
                },
                required: ["destination", "checkIn", "checkOut", "guests"],
              },
            },
          ],
        },
      ],
      tool_config: {
        function_calling_config: { mode: "ANY" },
      },
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errText}`);
    }

    const data: any = await response.json();
    const call = data.candidates?.[0]?.content?.parts?.[0]?.functionCall;
    if (!call || !call.args) {
      throw new Error("Gemini did not return function call arguments.");
    }

    return BookingFiltersSchema.parse(call.args);
  }
}
