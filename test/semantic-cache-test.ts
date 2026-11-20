import { QdrantVectorService } from "../src/services/vector/qdrant.service.js";

async function testSemanticCache() {
  console.log("🧠 Testing Qdrant Semantic Caching...");

  // 1. Initialize
  await QdrantVectorService.initCollection();

  // 2. Cache an initial natural language query
  const originalQuery = "Goa mein 3 raat, 2 log, ₹8,000 budget, beach ke paas";
  const extractedFilters = {
    destination: "Goa",
    checkIn: "2026-12-01",
    checkOut: "2026-12-04",
    nights: 3,
    guests: 2,
    roomsRequired: 1,
    maxBudgetInr: 8000,
    budgetType: "total" as const,
    proximity: "beachfront" as const,
    amenities: ["wifi", "ac"],
  };

  await QdrantVectorService.cacheQuery(originalQuery, extractedFilters);

  // 3. Query with a semantically matching alternative query
  const variantQuery = "Goa mein 3 nights 2 people 8000 budget beach ke pass";
  console.log(`🔍 Searching cache for variant: "${variantQuery}"...`);

  const client = QdrantVectorService.getClient();
  const v = QdrantVectorService.generateEmbedding(variantQuery);
  const rawSearch = await client.query("holdit_semantic_cache", { query: v, limit: 3, with_payload: true });
  console.log("Raw points from Qdrant:", rawSearch.points.map(p => ({ score: p.score, query: p.payload?.query })));

  const cacheHit = await QdrantVectorService.findSimilarQuery(variantQuery);
  console.log("Vector Cache Lookup Result:", cacheHit);

  if (cacheHit.hit && cacheHit.filters) {
    console.log(`🎉 CACHE HIT! Similarity Score: ${cacheHit.score?.toFixed(4)}`);
    console.log("Retrieved Filters:", JSON.stringify(cacheHit.filters, null, 2));
  } else {
    console.log("ℹ️ Cache Miss (below similarity threshold or new query).");
  }

  // 4. Test an unrelated query (should be a Cache Miss)
  const unrelatedQuery = "Manali snowfall cottage with fireplace";
  console.log(`\n🔍 Searching cache for unrelated: "${unrelatedQuery}"...`);
  const vUnrelated = QdrantVectorService.generateEmbedding(unrelatedQuery);
  const rawUnrelated = await client.query("holdit_semantic_cache", { query: vUnrelated, limit: 1 });
  console.log("Unrelated point score:", rawUnrelated.points[0]?.score);
  const unrelatedHit = await QdrantVectorService.findSimilarQuery(unrelatedQuery);
  console.log("Unrelated Query Cache Result (Expected Hit=false):", unrelatedHit.hit);
}

testSemanticCache()
  .then(() => {
    console.log("✅ Qdrant Semantic Cache test completed successfully!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Qdrant test error:", err);
    process.exit(1);
  });
