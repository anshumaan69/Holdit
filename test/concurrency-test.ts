import { HoldService } from "../src/services/hold/hold.service.js";
import { getRedisClient } from "../src/redis/index.js";
import { query } from "../src/db/index.js";
import { pool } from "../src/db/index.js";

/**
 * Concurrency Verification Harness
 * Tests HoldIt against the classic Flash Sale / Double-Booking Race Condition:
 * 1 Room Available for 3 consecutive nights.
 * 100 concurrent users attempt to hold the room at the exact same millisecond.
 *
 * Expected Outcome:
 * - Exactly 1 request succeeds (HOLD_ACQUIRED).
 * - Exactly 99 requests are rejected with INSUFFICIENT_INVENTORY.
 * - Inventory does not go negative.
 * - Zero double bookings guaranteed!
 */
async function runConcurrencyTest() {
  console.log("=================================================");
  console.log("🚀 STARTING CONCURRENCY RACE CONDITION TEST");
  console.log("=================================================");

  const redis = getRedisClient();

  // 1. Fetch the hotel and room type with only 1 room
  const hotelRes = await query(`SELECT id FROM hotels WHERE name = 'Morjim Sunset Suites' LIMIT 1;`);
  const roomRes = await query(`SELECT id FROM room_types WHERE name = 'Beachfront Wooden Cottage' LIMIT 1;`);

  if (!hotelRes.rows.length || !roomRes.rows.length) {
    throw new Error("Seed data not found. Please run 'npm run db:seed' first.");
  }

  const hotelId = hotelRes.rows[0].id;
  const roomTypeId = roomRes.rows[0].id;

  const checkIn = "2026-12-10";
  const checkOut = "2026-12-13"; // 3 nights
  const dates = HoldService.getDatesBetween(checkIn, checkOut);

  // Reset inventory to EXACTLY 1 room for these dates
  for (const date of dates) {
    const key = `inventory:${hotelId}:${roomTypeId}:${date}`;
    await redis.set(key, 1);
  }

  console.log(`🏨 Target: Morjim Sunset Suites (${roomTypeId})`);
  console.log(`📅 Dates: ${checkIn} to ${checkOut} (3 nights)`);
  console.log(`📦 Physical Inventory: 1 room available`);
  console.log(`⚡ Firing 100 concurrent 'acquireHold' requests simultaneously...`);

  const CONCURRENT_USERS = 100;
  const startTimer = Date.now();

  // Generate 100 concurrent promises
  const promises = Array.from({ length: CONCURRENT_USERS }, (_, idx) => {
    return HoldService.acquireHold({
      userId: `user_racer_${idx + 1}`,
      hotelId,
      roomTypeId,
      checkIn,
      checkOut,
      roomsCount: 1,
      ttlSeconds: 60, // 60s hold
    });
  });

  const results = await Promise.all(promises);
  const elapsedMs = Date.now() - startTimer;

  // Analyze results
  const successfulHolds = results.filter((r) => r.success);
  const rejectedHolds = results.filter((r) => !r.success);

  console.log("\n---------------- RESULTS ----------------");
  console.log(`⏱️ Completed 100 concurrent requests in: ${elapsedMs}ms`);
  console.log(`✅ Successful Holds Acquired: ${successfulHolds.length}`);
  console.log(`🚫 Rejected (Insufficient Inventory): ${rejectedHolds.length}`);

  // Check inventory keys in Redis
  console.log("\n🔍 Verifying Redis Inventory Post-Contention:");
  let allZero = true;
  for (const date of dates) {
    const key = `inventory:${hotelId}:${roomTypeId}:${date}`;
    const val = await redis.get(key);
    console.log(`   ${key} -> ${val}`);
    if (val !== "0") allZero = false;
  }

  // Critical Assertions
  if (successfulHolds.length === 1 && rejectedHolds.length === 99 && allZero) {
    console.log("\n🏆 PASS: ZERO DOUBLE-BOOKING GUARANTEE VERIFIED!");
    console.log(`🏆 Winning Hold ID: ${successfulHolds[0].holdId} (Expires: ${successfulHolds[0].expiresAt})`);
  } else {
    console.error("\n❌ FAILED: DOUBLE BOOKING DETECTED OR RACE CONDITION ANOMALY!");
    process.exit(1);
  }

  // Test Auto-Release / Rollback
  console.log("\n🔄 Testing Inventory Rollback upon Hold Release...");
  const winnerHoldId = successfulHolds[0].holdId!;
  const releaseRes = await HoldService.releaseHold(winnerHoldId, "CANCELLED");
  console.log("Release status:", releaseRes);

  let restoredToOne = true;
  for (const date of dates) {
    const key = `inventory:${hotelId}:${roomTypeId}:${date}`;
    const val = await redis.get(key);
    console.log(`   ${key} -> ${val}`);
    if (val !== "1") restoredToOne = false;
  }

  if (restoredToOne) {
    console.log("✅ PASS: Inventory fully and atomically restored to 1!");
  } else {
    console.error("❌ FAILED: Inventory restoration failed.");
    process.exit(1);
  }

  console.log("\n=================================================");
  console.log("🎉 ALL CONCURRENCY CHECKS PASSED WITH FLYING COLORS!");
  console.log("=================================================");

  await pool.end();
  redis.disconnect();
}

runConcurrencyTest().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
