-- confirm_hold.lua
-- Atomically transitions a hold to CONFIRMED status upon verified payment.
-- KEYS[1] = hold_id
-- ARGV[1] = booking_id

local hold_id = KEYS[1]
local booking_id = ARGV[1]
local hold_key = "hold:" .. hold_id
local hold_keys_set = "hold_keys:" .. hold_id

local status = redis.call("HGET", hold_key, "status")

if not status then
    return {0, "HOLD_NOT_FOUND"}
end

if status ~= "HELD" then
    return {0, "HOLD_EXPIRED_OR_NOT_ACTIVE", status}
end

-- Update status to CONFIRMED
redis.call("HSET", hold_key,
    "status", "CONFIRMED",
    "booking_id", booking_id
)

-- Remove from active holds sorted set (no longer an expiring hold)
redis.call("ZREM", "active_holds:zset", hold_id)
redis.call("DEL", hold_keys_set)

return {1, "HOLD_CONFIRMED", hold_id, booking_id}
