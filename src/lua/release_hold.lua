-- release_hold.lua
-- Atomically releases a held room and restores inventory across all dates.
-- KEYS[1] = hold_id
-- ARGV[1] = reason ("EXPIRED" or "CANCELLED")

local hold_id = KEYS[1]
local reason = ARGV[1] or "EXPIRED"
local hold_key = "hold:" .. hold_id
local hold_keys_set = "hold_keys:" .. hold_id

local status = redis.call("HGET", hold_key, "status")

if not status then
    return {0, "HOLD_NOT_FOUND"}
end

if status ~= "HELD" then
    return {0, "INVALID_STATUS_OR_ALREADY_RESOLVED", status}
end

local rooms_count = tonumber(redis.call("HGET", hold_key, "rooms_count") or "1")
local inventory_keys = redis.call("SMEMBERS", hold_keys_set)

-- Re-increment inventory for every night held
for i, key in ipairs(inventory_keys) do
    redis.call("INCRBY", key, rooms_count)
end

-- Update hold record status
redis.call("HSET", hold_key, "status", reason)

-- Remove from active holds sorted set and remove tracking set
redis.call("ZREM", "active_holds:zset", hold_id)
redis.call("DEL", hold_keys_set)

return {1, "HOLD_RELEASED", hold_id, reason}
