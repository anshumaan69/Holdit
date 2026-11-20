import { getRedisClient, getLuaShas, loadLuaScripts } from "../../redis/index.js";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class RateLimiterService {
  private static scriptsLoaded = false;

  private static async ensureScripts() {
    if (!this.scriptsLoaded) {
      await loadLuaScripts();
      this.scriptsLoaded = true;
    }
  }

  /**
   * Check sliding window rate limit using atomic Redis Lua script
   * @param key Unique key, e.g. "rl:stream:127.0.0.1"
   * @param windowMs Window size in milliseconds (e.g. 60,000 for 1 min)
   * @param maxRequests Maximum requests allowed within window
   */
  public static async checkLimit(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    await this.ensureScripts();
    const redis = getRedisClient();
    const shas = getLuaShas();

    const nowMs = Date.now();

    const result = (await redis.evalsha(
      shas.rateLimiter!,
      1,
      key,
      nowMs.toString(),
      windowMs.toString(),
      maxRequests.toString()
    )) as [number, number, number];

    const [allowed, remaining, retryAfterSeconds] = result;

    return {
      allowed: allowed === 1,
      remaining,
      retryAfterSeconds,
    };
  }
}
