import { pool, query } from "./index.js";
import { getRedisClient } from "../redis/index.js";

export async function seedDatabase() {
  console.log("🌱 Seeding database with Goa boutique hotels & inventory...");

  const redis = getRedisClient();

  // Clear existing data for clean seed
  await query("TRUNCATE TABLE bookings, holds, inventory_calendar, room_types, hotels CASCADE;");

  // 1. Insert Goa Hotels
  const hotelRes = await query(`
    INSERT INTO hotels (name, city, area, latitude, longitude, beach_distance_meters, rating)
    VALUES
      ('Calangute Ocean Villa', 'Goa', 'Calangute', 15.5435, 73.7553, 50, 4.8),
      ('Anjuna Palms Boutique Resort', 'Goa', 'Anjuna', 15.5800, 73.7420, 150, 4.6),
      ('Morjim Sunset Suites', 'Goa', 'Morjim', 15.6150, 73.7370, 80, 4.9)
    RETURNING id, name;
  `);

  const hotels = hotelRes.rows;
  console.log(`📍 Inserted ${hotels.length} hotels.`);

  // 2. Insert Room Types
  const roomTypesData = [
    { hotel_id: hotels[0].id, name: "Sea Facing Deluxe Suite", base_price_inr: 2500, max_guests: 2, total_rooms: 2 }, // Intentionally low inventory (2 rooms) to test race condition!
    { hotel_id: hotels[1].id, name: "Garden Pool Villa", base_price_inr: 2200, max_guests: 3, total_rooms: 3 },
    { hotel_id: hotels[2].id, name: "Beachfront Wooden Cottage", base_price_inr: 2600, max_guests: 2, total_rooms: 1 }, // Only 1 room!
  ];

  const roomTypeIds: Array<{ id: string; hotel_id: string; total_rooms: number; price: number }> = [];

  for (const rt of roomTypesData) {
    const res = await query(
      `INSERT INTO room_types (hotel_id, name, base_price_inr, max_guests, total_physical_inventory, amenities)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, hotel_id, total_physical_inventory, base_price_inr;`,
      [rt.hotel_id, rt.name, rt.base_price_inr, rt.max_guests, rt.total_rooms, JSON.stringify(["wifi", "ac", "pool", "breakfast"])]
    );
    roomTypeIds.push({
      id: res.rows[0].id,
      hotel_id: res.rows[0].hotel_id,
      total_rooms: res.rows[0].total_physical_inventory,
      price: Number(res.rows[0].base_price_inr),
    });
  }

  console.log(`🛏️ Inserted ${roomTypeIds.length} room types.`);

  // 3. Generate 30 days of inventory calendar in Postgres AND sync to Redis
  const today = new Date();
  const pipeline = redis.pipeline();

  for (const rt of roomTypeIds) {
    for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
      const date = new Date(today);
      date.setDate(today.getDate() + dayOffset);
      const dateStr = date.toISOString().split("T")[0];

      // Insert into PostgreSQL
      await query(
        `INSERT INTO inventory_calendar (room_type_id, date, total_rooms, booked_rooms, price_inr)
         VALUES ($1, $2, $3, 0, $4)
         ON CONFLICT (room_type_id, date) DO UPDATE SET total_rooms = EXCLUDED.total_rooms;`,
        [rt.id, dateStr, rt.total_rooms, rt.price]
      );

      // Seed into Redis for lightning fast atomic checks
      // Key format: inventory:{hotel_id}:{room_type_id}:{YYYY-MM-DD}
      const redisKey = `inventory:${rt.hotel_id}:${rt.id}:${dateStr}`;
      pipeline.set(redisKey, rt.total_rooms);
    }
  }

  await pipeline.exec();
  console.log("⚡ 30-day inventory synced to PostgreSQL and Redis successfully!");
}

if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  seedDatabase()
    .then(() => {
      console.log("🌱 Seed complete!");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Seed error:", err);
      process.exit(1);
    });
}
