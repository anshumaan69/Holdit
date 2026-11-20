import { buildApp } from "./app.js";
import { config } from "./config/index.js";
import { loadLuaScripts } from "./redis/index.js";
import { QdrantVectorService } from "./services/vector/qdrant.service.js";
import { SweeperService } from "./services/hold/sweeper.service.js";

async function bootstrap() {
  console.log("🚀 Bootstrapping HoldIt Production Server...");

  // 1. Preload Redis Lua scripts & compute SHAs
  await loadLuaScripts();

  // 2. Initialize Qdrant Semantic Cache collection
  await QdrantVectorService.initCollection();

  // 3. Start background sweeper worker for expired holds reconciliation
  const sweeper = new SweeperService(4000); // Poll every 4 seconds
  sweeper.start();

  // 4. Build and start Fastify app
  const app = await buildApp();

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`\n======================================================`);
    console.log(`🏨 HoldIt Server running at http://${config.host}:${config.port}`);
    console.log(`🌊 SSE Streaming: http://${config.host}:${config.port}/api/v1/search/stream?q=...`);
    console.log(`🔒 Atomic Holds API: http://${config.host}:${config.port}/api/v1/holds/acquire`);
    console.log(`🧠 Qdrant Vector Cache: ${config.qdrant.url}`);
    console.log(`======================================================\n`);
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    sweeper.stop();
    process.exit(1);
  }

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    sweeper.stop();
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap();
