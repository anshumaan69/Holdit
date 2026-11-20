-- acquire_hold.lua
-- Atomically verifies inventory across all requested dates and acquires a time-bounded hold.
-- KEYS: List of inventory keys, e.g.:
--       KEYS[1] = "inventory:hotel_101:deluxe:2026-12-01"
--       KEYS[2] = "inventory:hotel_101:deluxe:2026-12-02"
-- ARGV:
--       ARGV[1] = hold_id
--       ARGV[2] = user_id
--       ARGV[3] = hotel_id
--       ARGV[4] = room_type_id
--       ARGV[5] = required_rooms (integer)
--       ARGV[6] = ttl_seconds (integer, e.g. 900)

local required_rooms = tonumber(ARGV[5])
local ttl_seconds = tonumber(ARGV[6])
local hold_id = ARGV[1]
local user_id = ARGV[2]
local hotel_id = ARGV[3]
local room_type_id = ARGV[4]

-- Get synchronized server time directly from Redis to eliminate clock skew
local redis_time = redis.call("TIME")
local current_time = tonumber(redis_time[1])
local expires_at = current_time + ttl_seconds

local hold_key = "hold:" .. hold_id
local hold_keys_set = "hold_keys:" .. hold_id

-- 1. Phase 1: Atomically inspect availability across EVERY requested date
for i, key in ipairs(KEYS) do
    local available = redis.call("GET", key)
    if not available or tonumber(available) < required_rooms then
        -- Even if 1 night is sold out, reject immediately without touching any inventory
        return {0, "INSUFFICIENT_INVENTORY", key, available or "0"}
    end
end

-- 2. Phase 2: Decrement inventory across all dates
for i, key in ipairs(KEYS) do
    redis.call("DECRBY", key, required_rooms)
    redis.call("SADD", hold_keys_set, key)
end

-- 3. Phase 3: Store Hold Record Hash
redis.call("HSET", hold_key,
    "hold_id", hold_id,
    "user_id", user_id,
    "hotel_id", hotel_id,
    "room_type_id", room_type_id,
    "rooms_count", required_rooms,
    "status", "HELD",
    "created_at", current_time,
    "expires_at", expires_at,
    "nights_count", #KEYS
)

-- Set hold record expiry slightly longer than hold TTL to allow audit trail check
redis.call("EXPIRE", hold_key, ttl_seconds + 300)
redis.call("EXPIRE", hold_keys_set, ttl_seconds + 300)

-- 4. Phase 4: Register in active TTL Sorted Set for background reconciliation sweeper
redis.call("ZADD", "active_holds:zset", expires_at, hold_id)

return {1, "HOLD_ACQUIRED", hold_id, tostring(expires_at)}
