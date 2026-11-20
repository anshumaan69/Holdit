import { pool } from "./index.js";

export async function runMigrations() {
  console.log("🔄 Running database migrations...");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Enable UUID extension
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // 1. Hotels table
    await client.query(`
      CREATE TABLE IF NOT EXISTS hotels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        city VARCHAR(100) NOT NULL,
        area VARCHAR(150),
        latitude DECIMAL(9, 6),
        longitude DECIMAL(9, 6),
        beach_distance_meters INTEGER,
        rating DECIMAL(2, 1) DEFAULT 4.5,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Room types
    await client.query(`
      CREATE TABLE IF NOT EXISTS room_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        base_price_inr DECIMAL(10, 2) NOT NULL,
        max_guests INTEGER NOT NULL DEFAULT 2,
        total_physical_inventory INTEGER NOT NULL DEFAULT 5,
        amenities JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 3. Inventory Calendar (Per-date physical availability)
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_calendar (
        id BIGSERIAL PRIMARY KEY,
        room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        total_rooms INTEGER NOT NULL,
        booked_rooms INTEGER NOT NULL DEFAULT 0,
        price_inr DECIMAL(10, 2) NOT NULL,
        CONSTRAINT uq_room_date UNIQUE (room_type_id, date),
        CONSTRAINT check_inventory_positive CHECK (booked_rooms <= total_rooms)
      );
    `);

    // 4. Holds table (Audit and persistence of Redis holds)
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE hold_status_enum AS ENUM ('HELD', 'EXPIRED', 'CANCELLED', 'CONFIRMED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;

      CREATE TABLE IF NOT EXISTS holds (
        id UUID PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        hotel_id UUID NOT NULL REFERENCES hotels(id),
        room_type_id UUID NOT NULL REFERENCES room_types(id),
        check_in DATE NOT NULL,
        check_out DATE NOT NULL,
        rooms_count INTEGER NOT NULL DEFAULT 1,
        status hold_status_enum NOT NULL DEFAULT 'HELD',
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 5. Bookings table (Final confirmed reservations)
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id VARCHAR(100) PRIMARY KEY,
        hold_id UUID UNIQUE REFERENCES holds(id),
        user_id VARCHAR(100) NOT NULL,
        hotel_id UUID NOT NULL REFERENCES hotels(id),
        room_type_id UUID NOT NULL REFERENCES room_types(id),
        check_in DATE NOT NULL,
        check_out DATE NOT NULL,
        rooms_count INTEGER NOT NULL DEFAULT 1,
        total_amount_inr DECIMAL(10, 2) NOT NULL,
        payment_reference VARCHAR(255),
        confirmed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Create indexes for high-throughput queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inventory_lookup ON inventory_calendar(room_type_id, date);
      CREATE INDEX IF NOT EXISTS idx_hotels_city ON hotels(city);
      CREATE INDEX IF NOT EXISTS idx_holds_active ON holds(status, expires_at) WHERE status = 'HELD';
    `);

    await client.query("COMMIT");
    console.log("✅ Database migrations completed successfully!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js")) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
