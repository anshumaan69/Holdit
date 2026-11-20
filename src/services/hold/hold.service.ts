import { v4 as uuidv4 } from "uuid";
import { getRedisClient, getLuaShas, loadLuaScripts } from "../../redis/index.js";
import { query } from "../../db/index.js";
import { config } from "../../config/index.js";

export interface AcquireHoldParams {
  userId: string;
  hotelId: string;
  roomTypeId: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  roomsCount?: number;
  ttlSeconds?: number;
}

export interface HoldResult {
  success: boolean;
  holdId?: string;
  expiresAt?: string;
  reason?: string;
  dateFailed?: string;
}

export class HoldService {
  private static scriptsLoaded = false;
  private static loadingPromise: Promise<void> | null = null;

  private static async ensureScripts() {
    if (this.scriptsLoaded) return;
    if (!this.loadingPromise) {
      this.loadingPromise = loadLuaScripts().then(() => {
        this.scriptsLoaded = true;
      });
    }
    await this.loadingPromise;
  }

  // Generate list of dates between checkIn (inclusive) and checkOut (exclusive)
  public static getDatesBetween(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current < end) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  /**
   * Acquire an atomic, multi-night hold on a room type.
   * Guarantees ZERO double-bookings across concurrent requests via Redis Lua.
   */
  public static async acquireHold(params: AcquireHoldParams): Promise<HoldResult> {
    await this.ensureScripts();
    const redis = getRedisClient();
    const shas = getLuaShas();

    const roomsCount = params.roomsCount || 1;
    const ttlSeconds = params.ttlSeconds || config.hold.ttlSeconds;
    const holdId = uuidv4();

    // Generate keys for every night of stay
    const dates = this.getDatesBetween(params.checkIn, params.checkOut);
    if (dates.length === 0) {
      return { success: false, reason: "CHECKOUT_MUST_BE_AFTER_CHECKIN" };
    }

    const inventoryKeys = dates.map(
      (d) => `inventory:${params.hotelId}:${params.roomTypeId}:${d}`
    );

    try {
      // Execute atomic Lua script
      const result = (await redis.evalsha(
        shas.acquireHold!,
        inventoryKeys.length,
        ...inventoryKeys,
        holdId,
        params.userId,
        params.hotelId,
        params.roomTypeId,
        roomsCount.toString(),
        ttlSeconds.toString()
      )) as [number, string, string?, string?];

      const status = result[0];

      if (status !== 1) {
        const message = result[1];
        const keyFailed = result[2];
        return {
          success: false,
          reason: message,
          dateFailed: keyFailed?.split(":").pop(),
        };
      }

      const returnedHoldId = result[2] || holdId;
      const expiresAtEpoch = Number(result[3]);
      const expiresAt = new Date(expiresAtEpoch * 1000).toISOString();

      // Asynchronously mirror hold to PostgreSQL for durability & auditing
      query(
        `INSERT INTO holds (id, user_id, hotel_id, room_type_id, check_in, check_out, rooms_count, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'HELD', $8)
         ON CONFLICT (id) DO NOTHING;`,
        [
          returnedHoldId,
          params.userId,
          params.hotelId,
          params.roomTypeId,
          params.checkIn,
          params.checkOut,
          roomsCount,
          expiresAt,
        ]
      ).catch((err) => {
        console.error("⚠️ Background DB sync error for hold:", err);
      });

      return {
        success: true,
        holdId: returnedHoldId,
        expiresAt,
      };
    } catch (err: any) {
      // Fallback if SHA was lost due to Redis restart
      if (err.message && err.message.includes("NOSCRIPT")) {
        this.scriptsLoaded = false;
        this.loadingPromise = null;
        await this.ensureScripts();
        return this.acquireHold(params);
      }
      throw err;
    }
  }

  /**
   * Release hold and return rooms back to available inventory.
   */
  public static async releaseHold(
    holdId: string,
    reason: "EXPIRED" | "CANCELLED" = "EXPIRED"
  ): Promise<{ success: boolean; reason?: string }> {
    await this.ensureScripts();
    const redis = getRedisClient();
    const shas = getLuaShas();

    try {
      const result = (await redis.evalsha(
        shas.releaseHold!,
        1,
        holdId,
        reason
      )) as [number, string, string?];

      const [status, message] = result;
      if (status !== 1) {
        return { success: false, reason: message };
      }

      // Update PostgreSQL asynchronously
      query(
        `UPDATE holds SET status = $1, updated_at = NOW() WHERE id = $2;`,
        [reason, holdId]
      ).catch((err) => console.error("⚠️ DB sync error on release:", err));

      return { success: true };
    } catch (err: any) {
      if (err.message && err.message.includes("NOSCRIPT")) {
        this.scriptsLoaded = false;
        this.loadingPromise = null;
        await this.ensureScripts();
        return this.releaseHold(holdId, reason);
      }
      throw err;
    }
  }

  /**
   * Confirm hold into a permanent booking after payment gateway webhook.
   */
  public static async confirmHold(
    holdId: string,
    bookingId: string,
    totalAmountInr: number,
    paymentRef?: string
  ): Promise<{ success: boolean; reason?: string }> {
    await this.ensureScripts();
    const redis = getRedisClient();
    const shas = getLuaShas();

    try {
      const result = (await redis.evalsha(
        shas.confirmHold!,
        1,
        holdId,
        bookingId
      )) as [number, string, string?];

      const [status, message] = result;
      if (status !== 1) {
        return { success: false, reason: message };
      }

      // Finalize booking in PostgreSQL
      const holdRes = await query(`SELECT * FROM holds WHERE id = $1;`, [holdId]);
      if (holdRes.rowCount && holdRes.rowCount > 0) {
        const hold = holdRes.rows[0];
        await query(
          `INSERT INTO bookings (id, hold_id, user_id, hotel_id, room_type_id, check_in, check_out, rooms_count, total_amount_inr, payment_reference)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
          [
            bookingId,
            holdId,
            hold.user_id,
            hold.hotel_id,
            hold.room_type_id,
            hold.check_in,
            hold.check_out,
            hold.rooms_count,
            totalAmountInr,
            paymentRef || null,
          ]
        );

        // Update Postgres inventory calendar booked count
        const dates = this.getDatesBetween(
          new Date(hold.check_in).toISOString().split("T")[0],
          new Date(hold.check_out).toISOString().split("T")[0]
        );

        for (const date of dates) {
          await query(
            `UPDATE inventory_calendar 
             SET booked_rooms = booked_rooms + $1 
             WHERE room_type_id = $2 AND date = $3;`,
            [hold.rooms_count, hold.room_type_id, date]
          );
        }

        await query(`UPDATE holds SET status = 'CONFIRMED', updated_at = NOW() WHERE id = $1;`, [holdId]);
      }

      return { success: true };
    } catch (err: any) {
      if (err.message && err.message.includes("NOSCRIPT")) {
        this.scriptsLoaded = false;
        this.loadingPromise = null;
        await this.ensureScripts();
        return this.confirmHold(holdId, bookingId, totalAmountInr, paymentRef);
      }
      throw err;
    }
  }

  /**
   * Retrieve current hold status and details.
   */
  public static async getHold(holdId: string): Promise<Record<string, string> | null> {
    const redis = getRedisClient();
    const data = await redis.hgetall(`hold:${holdId}`);
    if (Object.keys(data).length > 0) {
      return data;
    }

    // Fallback to PostgreSQL
    const res = await query(`SELECT * FROM holds WHERE id = $1;`, [holdId]);
    if (res.rowCount && res.rowCount > 0) {
      const row = res.rows[0];
      return {
        hold_id: row.id,
        user_id: row.user_id,
        hotel_id: row.hotel_id,
        room_type_id: row.room_type_id,
        status: row.status,
        expires_at: Math.floor(new Date(row.expires_at).getTime() / 1000).toString(),
      };
    }

    return null;
  }
}
