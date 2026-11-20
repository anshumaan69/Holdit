import { getRedisClient } from "../../redis/index.js";
import { HoldService } from "./hold.service.js";

/**
 * Background Sweeper Worker
 * Periodically polls the Redis active_holds:zset for holds whose TTL has expired,
 * and releases inventory back to the available pool.
 */
export class SweeperService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private intervalMs: number;

  constructor(intervalMs = 3000) {
    this.intervalMs = intervalMs;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`🧹 Sweeper worker started (interval: ${this.intervalMs}ms)`);

    this.timer = setInterval(async () => {
      try {
        await this.reconcileExpiredHolds();
      } catch (err) {
        console.error("❌ Error in sweeper reconciliation loop:", err);
      }
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log("🛑 Sweeper worker stopped.");
  }

  /**
   * Scans active_holds:zset for any hold with expires_at <= current epoch timestamp.
   */
  public async reconcileExpiredHolds(): Promise<number> {
    const redis = getRedisClient();
    const now = Math.floor(Date.now() / 1000);

    // Find all hold IDs whose expiration score is <= now
    const expiredHoldIds = await redis.zrangebyscore("active_holds:zset", 0, now, "LIMIT", 0, 100);

    if (expiredHoldIds.length === 0) {
      return 0;
    }

    console.log(`⏰ Sweeper detected ${expiredHoldIds.length} expired holds to release.`);

    for (const holdId of expiredHoldIds) {
      try {
        const res = await HoldService.releaseHold(holdId, "EXPIRED");
        if (res.success) {
          console.log(`♻️ Hold ${holdId} auto-released and inventory restored.`);
        } else {
          // If already resolved or not held, clean up from zset to prevent repeated sweeps
          await redis.zrem("active_holds:zset", holdId);
        }
      } catch (err) {
        console.error(`❌ Failed to release expired hold ${holdId}:`, err);
      }
    }

    return expiredHoldIds.length;
  }
}
