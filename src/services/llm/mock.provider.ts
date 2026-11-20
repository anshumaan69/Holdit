import { ILLMProvider } from "./provider.interface.js";
import { BookingFilters, BookingFiltersSchema } from "./types.js";

/**
 * Intelligent Rule & Pattern Based Provider for Hindi / Hinglish / English Travel Queries.
 * Provides instant, zero-cost, out-of-the-box extraction until external LLM API keys are provided.
 */
export class MockLLMProvider implements ILLMProvider {
  public name = "mock_intelligent_parser";

  public async parseNaturalLanguageQuery(rawQuery: string): Promise<BookingFilters> {
    const text = rawQuery.toLowerCase();

    // 1. Destination Extraction
    let destination = "Goa";
    if (text.includes("goa") || text.includes("calangute") || text.includes("anjuna") || text.includes("morjim")) {
      destination = "Goa";
    } else if (text.includes("manali")) {
      destination = "Manali";
    } else if (text.includes("mumbai")) {
      destination = "Mumbai";
    }

    // 2. Nights Extraction (e.g. "3 raat", "3 nights", "3 days", "2 n")
    let nights = 1;
    const nightMatch = text.match(/(\d+)\s*(raat|night|nights|days|din)/i);
    if (nightMatch) {
      nights = parseInt(nightMatch[1], 10);
    }

    // 3. Guests Extraction (e.g. "2 log", "4 people", "2 adults", "3 guests")
    let guests = 2;
    const guestMatch = text.match(/(\d+)\s*(log|people|adults|guests|persons|bande)/i);
    if (guestMatch) {
      guests = parseInt(guestMatch[1], 10);
    }

    // 4. Budget Extraction (e.g. "₹8,000", "8000 budget", "rs 8000", "8k")
    let maxBudgetInr: number | undefined;
    const budgetMatch = text.match(/(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\s*k)?\s*(?:budget|rupaye|rupees)?/i);
    if (budgetMatch) {
      let numStr = budgetMatch[1].replace(/,/g, "");
      let num = parseFloat(numStr);
      if (text.includes(`${num}k`)) num *= 1000;
      if (num > 500) {
        maxBudgetInr = num;
      }
    }

    // 5. Proximity / Location Preference (e.g. "beach ke paas", "near beach", "beachfront")
    let proximity: "beachfront" | "walking_distance_to_beach" | "city_center" | "any" = "any";
    if (text.includes("beach") || text.includes("samundar") || text.includes("kinare")) {
      proximity = "beachfront";
    } else if (text.includes("city") || text.includes("bazar") || text.includes("center")) {
      proximity = "city_center";
    }

    // 6. Amenities
    const amenities: string[] = [];
    if (text.includes("pool") || text.includes("swimming")) amenities.push("pool");
    if (text.includes("wifi")) amenities.push("wifi");
    if (text.includes("breakfast") || text.includes("nashta")) amenities.push("breakfast");
    if (text.includes("ac")) amenities.push("ac");

    // 7. Dates (Default to upcoming weekend or tomorrow onwards)
    const today = new Date();
    const checkInDate = new Date(today);
    checkInDate.setDate(today.getDate() + 2); // default: 2 days from now

    const checkOutDate = new Date(checkInDate);
    checkOutDate.setDate(checkInDate.getDate() + nights);

    const checkIn = checkInDate.toISOString().split("T")[0];
    const checkOut = checkOutDate.toISOString().split("T")[0];

    const parsedData = {
      destination,
      checkIn,
      checkOut,
      nights,
      guests,
      roomsRequired: Math.ceil(guests / 2),
      maxBudgetInr: maxBudgetInr || 8000,
      budgetType: "total" as const,
      proximity,
      amenities,
    };

    return BookingFiltersSchema.parse(parsedData);
  }
}
