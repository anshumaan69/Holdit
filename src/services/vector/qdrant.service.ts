import { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { config } from "../../config/index.js";
import { BookingFilters } from "../llm/types.js";

export class QdrantVectorService {
  private static client: QdrantClient | null = null;
  private static initialized = false;

  public static getClient(): QdrantClient {
    if (!this.client) {
      this.client = new QdrantClient({
        url: config.qdrant.url,
        apiKey: config.qdrant.apiKey,
        timeout: 5000,
        checkCompatibility: false,
      });
    }
    return this.client;
  }

  /**
   * Initialize Qdrant collection for semantic caching
   */
  public static async initCollection(): Promise<void> {
    if (this.initialized) return;
    const client = this.getClient();

    try {
      const exists = await client.collectionExists(config.qdrant.collectionName);

      if (!exists.exists) {
        console.log(`🧠 Creating Qdrant collection: ${config.qdrant.collectionName}`);
        await client.createCollection(config.qdrant.collectionName, {
          vectors: {
            size: config.qdrant.vectorSize,
            distance: "Cosine",
          },
        });
        console.log("✅ Qdrant semantic cache collection ready!");
      }
      this.initialized = true;
    } catch (err) {
      console.error("❌ Error initializing Qdrant collection:", err);
      throw err;
    }
  }

  /**
   * Fast, deterministic local semantic embedding function.
   * Generates a normalized 128-dimensional dense vector representing the semantic tokens of the query.
   */
  public static generateEmbedding(text: string): number[] {
    const vector = new Array(config.qdrant.vectorSize).fill(0);
    const normalized = text.toLowerCase().trim().replace(/[^\w\s]/g, "");
    const tokens = normalized.split(/\s+/).filter(Boolean);

    // Hash tokens and character bigrams into vector coordinates
    for (const token of tokens) {
      const hash = crypto.createHash("sha256").update(token).digest();
      for (let i = 0; i < hash.length && i < config.qdrant.vectorSize; i++) {
        vector[i] += (hash[i] / 255.0 - 0.5);
      }
      // N-grams for morphological similarity
      for (let j = 0; j < token.length - 2; j++) {
        const trigram = token.substring(j, j + 3);
        const triHash = crypto.createHash("md5").update(trigram).digest();
        const idx = triHash[0] % config.qdrant.vectorSize;
        vector[idx] += 0.2;
      }
    }

    // L2 Normalize vector so Cosine Similarity is accurate
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] = vector[i] / norm;
      }
    }

    return vector;
  }

  /**
   * Search for semantically similar previous query in Qdrant
   */
  public static async findSimilarQuery(
    rawQuery: string
  ): Promise<{ hit: boolean; filters?: BookingFilters; score?: number }> {
    await this.initCollection();
    const client = this.getClient();
    const queryVector = this.generateEmbedding(rawQuery);

    try {
      const searchResult = await client.query(config.qdrant.collectionName, {
        query: queryVector,
        limit: 1,
        with_payload: true,
      });

      if (searchResult.points && searchResult.points.length > 0) {
        const top = searchResult.points[0];
        if (top.score >= config.qdrant.similarityThreshold && top.payload?.filters) {
          return {
            hit: true,
            filters: top.payload.filters as BookingFilters,
            score: top.score,
          };
        }
      }

      return { hit: false };
    } catch (err) {
      console.error("⚠️ Qdrant vector search lookup error:", err);
      return { hit: false };
    }
  }

  /**
   * Store extracted filters in Qdrant semantic cache
   */
  public static async cacheQuery(
    rawQuery: string,
    filters: BookingFilters
  ): Promise<void> {
    await this.initCollection();
    const client = this.getClient();
    const vector = this.generateEmbedding(rawQuery);

    try {
      await client.upsert(config.qdrant.collectionName, {
        points: [
          {
            id: uuidv4(),
            vector,
            payload: {
              query: rawQuery,
              filters,
              cachedAt: new Date().toISOString(),
            },
          },
        ],
      });
      console.log(`💾 Stored query in Qdrant semantic cache: "${rawQuery}"`);
    } catch (err) {
      console.error("⚠️ Failed to store embedding in Qdrant:", err);
    }
  }
}
