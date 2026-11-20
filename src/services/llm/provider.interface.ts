import { BookingFilters } from "./types.js";

export interface ILLMProvider {
  name: string;
  parseNaturalLanguageQuery(query: string): Promise<BookingFilters>;
}
