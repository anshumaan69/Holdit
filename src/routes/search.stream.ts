import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { QdrantVectorService } from "../services/vector/qdrant.service.js";
import { getLLMProvider } from "../services/llm/index.js";
import { InventorySearchService } from "../services/inventory/search.service.js";
import { createRateLimitHook } from "../middleware/rate-limit.middleware.js";

export async function searchStreamRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { q?: string } }>(
    "/api/v1/search/stream",
    {
      preHandler: createRateLimitHook("search_stream", 60000, 20), // 20 searches/min
    },
    async (req, reply) => {
      const rawQuery = req.query.q;

      if (!rawQuery || rawQuery.trim().length === 0) {
        return reply.status(400).send({ error: "Missing query parameter 'q'" });
      }

      // Configure Server-Sent Events headers
      reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      reply.raw.flushHeaders();

      const sendEvent = (event: string, data: any) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // Event 1: Query received
        sendEvent("status", {
          stage: "query_received",
          query: rawQuery,
          timestamp: new Date().toISOString(),
        });

        // Event 2: Check Qdrant Semantic Cache
        const cacheStartTime = Date.now();
        const cacheResult = await QdrantVectorService.findSimilarQuery(rawQuery);

        let filters: any;

        if (cacheResult.hit && cacheResult.filters) {
          filters = cacheResult.filters;
          sendEvent("cache_hit", {
            stage: "semantic_cache_hit",
            score: cacheResult.score,
            latencyMs: Date.now() - cacheStartTime,
            filters,
          });
        } else {
          sendEvent("cache_miss", {
            stage: "cache_miss_invoking_llm",
            message: "Extracting structured travel filters with AI...",
          });

          const llm = getLLMProvider();
          const llmStartTime = Date.now();
          filters = await llm.parseNaturalLanguageQuery(rawQuery);

          sendEvent("llm_extracted", {
            stage: "llm_extraction_done",
            provider: llm.name,
            latencyMs: Date.now() - llmStartTime,
            filters,
          });

          // Save to Qdrant semantic cache asynchronously
          QdrantVectorService.cacheQuery(rawQuery, filters).catch((err) =>
            console.error("Async vector cache save error:", err)
          );
        }

        // Event 3: Search live inventory
        sendEvent("inventory_search", {
          stage: "scanning_inventory",
          destination: filters.destination,
          dates: `${filters.checkIn} to ${filters.checkOut}`,
          guests: filters.guests,
        });

        const candidates = await InventorySearchService.searchRooms(filters);

        // Stream matching rooms individually for progressive rendering
        for (const room of candidates) {
          sendEvent("room_found", {
            stage: "candidate_found",
            room,
          });
          // Small throttle for smooth streaming visualization
          await new Promise((r) => setTimeout(r, 60));
        }

        // Event 4: Completion event
        sendEvent("completed", {
          stage: "search_completed",
          totalMatches: candidates.length,
          holdAvailable: candidates.length > 0,
          holdTtlSeconds: 900,
        });

        reply.raw.end();
      } catch (err: any) {
        console.error("SSE stream error:", err);
        sendEvent("error", {
          stage: "error",
          message: err.message || "Internal streaming error",
        });
        reply.raw.end();
      }
    }
  );
}
