import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3080", 10),
  host: process.env.HOST || "0.0.0.0",

  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6398", 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  db: {
    url: process.env.DATABASE_URL || "postgres://holdit_user:holdit_password@localhost:5455/holdit_db",
  },

  qdrant: {
    url: process.env.QDRANT_URL || "http://localhost:6333",
    apiKey: process.env.QDRANT_API_KEY || undefined,
    collectionName: "holdit_semantic_cache",
    vectorSize: 128, // Using 128-dim embeddings for lightweight semantic matching
    similarityThreshold: parseFloat(process.env.QDRANT_SIMILARITY_THRESHOLD || "0.80"),
  },

  llm: {
    provider: (process.env.LLM_PROVIDER || "mock") as "mock" | "gemini" | "openai",
    geminiApiKey: process.env.GEMINI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  },

  hold: {
    ttlSeconds: parseInt(process.env.HOLD_TTL_SECONDS || "900", 10), // 15 mins default
  },
};
