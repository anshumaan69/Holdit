import { z } from "zod";

export const BookingFiltersSchema = z.object({
  destination: z.string().min(1, "Destination is required"),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkIn must be YYYY-MM-DD"),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkOut must be YYYY-MM-DD"),
  nights: z.number().int().min(1).default(1),
  guests: z.number().int().min(1).default(2),
  roomsRequired: z.number().int().min(1).default(1),
  maxBudgetInr: z.number().positive().optional(),
  budgetType: z.enum(["total", "per_night"]).default("total"),
  proximity: z.enum(["beachfront", "walking_distance_to_beach", "city_center", "any"]).default("any"),
  amenities: z.array(z.string()).default([]),
});

export type BookingFilters = z.infer<typeof BookingFiltersSchema>;

export interface LLMParseResult {
  filters: BookingFilters;
  confidence: number;
  source: "llm" | "semantic_cache";
  latencyMs: number;
}
