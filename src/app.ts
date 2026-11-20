import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { searchStreamRoutes } from "./routes/search.stream.js";
import { holdsRoutes } from "./routes/holds.route.js";
import { getRedisClient } from "./redis/index.js";
import { pool } from "./db/index.js";
import { QdrantVectorService } from "./services/vector/qdrant.service.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  // Enable CORS
  await app.register(cors, {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  });

  // Health check endpoint
  app.get("/health", async () => {
    const redis = getRedisClient();
    const redisPing = await redis.ping();
    const dbRes = await pool.query("SELECT 1 as healthy;");

    return {
      status: "healthy",
      service: "HoldIt Core Engine",
      redis: redisPing === "PONG" ? "connected" : "degraded",
      postgres: dbRes.rows[0]?.healthy === 1 ? "connected" : "degraded",
      timestamp: new Date().toISOString(),
    };
  });

  // Register feature routes
  await app.register(searchStreamRoutes);
  await app.register(holdsRoutes);

  return app;
}
