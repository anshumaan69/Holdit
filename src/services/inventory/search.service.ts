import { query } from "../../db/index.js";
import { getRedisClient } from "../../redis/index.js";
import { HoldService } from "../hold/hold.service.js";
import { BookingFilters } from "../llm/types.js";

export interface CandidateRoom {
  hotelId: string;
  hotelName: string;
  area: string;
  beachDistanceMeters: number;
  rating: number;
  roomTypeId: string;
  roomTypeName: string;
  pricePerNight: number;
  totalPrice: number;
  availableRooms: number;
  amenities: string[];
}

export class InventorySearchService {
  /**
   * Search for hotel rooms matching the extracted travel criteria
   * and dynamically verify real-time available inventory in Redis across all stay dates.
   */
  public static async searchRooms(filters: BookingFilters): Promise<CandidateRoom[]> {
    const redis = getRedisClient();
    const dates = HoldService.getDatesBetween(filters.checkIn, filters.checkOut);
    const nights = Math.max(dates.length, 1);

    // 1. Fetch matching hotels and room types from PostgreSQL
    let sql = `
      SELECT 
        h.id as hotel_id,
        h.name as hotel_name,
        h.area,
        h.beach_distance_meters,
        h.rating,
        r.id as room_type_id,
        r.name as room_type_name,
        r.base_price_inr,
        r.amenities
      FROM hotels h
      JOIN room_types r ON r.hotel_id = h.id
      WHERE LOWER(h.city) = LOWER($1)
    `;

    const params: any[] = [filters.destination];

    // Filter by beach proximity if requested
    if (filters.proximity === "beachfront") {
      sql += ` AND h.beach_distance_meters <= 100`;
    } else if (filters.proximity === "walking_distance_to_beach") {
      sql += ` AND h.beach_distance_meters <= 500`;
    }

    sql += ` ORDER BY h.rating DESC;`;

    const dbRes = await query(sql, params);
    const candidates: CandidateRoom[] = [];

    // 2. Multi-date Redis inventory inspection for every room type
    for (const row of dbRes.rows) {
      const pricePerNight = Number(row.base_price_inr);
      const totalPrice = pricePerNight * nights;

      // Budget filter check
      if (filters.maxBudgetInr && totalPrice > filters.maxBudgetInr) {
        continue;
      }

      // Check real-time Redis inventory across all requested dates
      let minAvailable = Infinity;
      for (const date of dates) {
        const key = `inventory:${row.hotel_id}:${row.room_type_id}:${date}`;
        const val = await redis.get(key);
        const count = val !== null ? parseInt(val, 10) : 0;
        if (count < minAvailable) {
          minAvailable = count;
        }
      }

      // If at least 1 room is available across all nights
      if (minAvailable > 0 && minAvailable !== Infinity) {
        candidates.push({
          hotelId: row.hotel_id,
          hotelName: row.hotel_name,
          area: row.area,
          beachDistanceMeters: Number(row.beach_distance_meters),
          rating: Number(row.rating),
          roomTypeId: row.room_type_id,
          roomTypeName: row.room_type_name,
          pricePerNight,
          totalPrice,
          availableRooms: minAvailable,
          amenities: typeof row.amenities === "string" ? JSON.parse(row.amenities) : row.amenities || [],
        });
      }
    }

    return candidates;
  }
}
