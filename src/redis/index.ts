import { Redis } from "ioredis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let redisClient: Redis | null = null;

// SHA caches for Redis EVALSHA to avoid transferring script text repeatedly
const luaShas: {
  acquireHold?: string;
  releaseHold?: string;
  confirmHold?: string;
  rateLimiter?: string;
} = {};

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    redisClient.on("error", (err) => {
      console.error("❌ Redis Client Error:", err);
    });

    redisClient.on("connect", () => {
      console.log(`🔌 Redis connected to ${config.redis.host}:${config.redis.port}`);
    });
  }

  return redisClient;
}

// Load Lua scripts and cache their SHA hashes in Redis
export async function loadLuaScripts(): Promise<void> {
  const redis = getRedisClient();
  const luaDir = path.resolve(__dirname, "../lua");

  const acquireScript = fs.readFileSync(path.join(luaDir, "acquire_hold.lua"), "utf-8");
  const releaseScript = fs.readFileSync(path.join(luaDir, "release_hold.lua"), "utf-8");
  const confirmScript = fs.readFileSync(path.join(luaDir, "confirm_hold.lua"), "utf-8");
  const rateLimiterScript = fs.readFileSync(path.join(luaDir, "rate_limiter.lua"), "utf-8");

  const [acquireSha, releaseSha, confirmSha, rateLimiterSha] = await Promise.all([
    redis.script("LOAD", acquireScript) as Promise<string>,
    redis.script("LOAD", releaseScript) as Promise<string>,
    redis.script("LOAD", confirmScript) as Promise<string>,
    redis.script("LOAD", rateLimiterScript) as Promise<string>,
  ]);

  luaShas.acquireHold = acquireSha;
  luaShas.releaseHold = releaseSha;
  luaShas.confirmHold = confirmSha;
  luaShas.rateLimiter = rateLimiterSha;

  console.log("⚡ All Redis Lua scripts loaded and SHAs cached successfully!");
}

export function getLuaShas() {
  return luaShas;
}
