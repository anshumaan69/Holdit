-- rate_limiter.lua
-- Distributed Sliding Window Rate Limiter using Redis Sorted Sets
-- KEYS[1] = rate_limit_key, e.g. "rl:llm:192.168.1.1"
-- ARGV[1] = current timestamp in milliseconds
-- ARGV[2] = window size in milliseconds (e.g. 60000 for 1 minute)
-- ARGV[3] = max allowed requests in window (e.g. 15)

local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local clear_before = now - window

-- 1. Remove entries older than the sliding window
redis.call("ZREMRANGEBYSCORE", key, 0, clear_before)

-- 2. Count requests currently in the window
local current_requests = redis.call("ZCARD", key)

if current_requests < limit then
    -- Allowed: record this request with a unique member
    redis.call("ZADD", key, now, now .. ":" .. math.random(1000, 9999))
    redis.call("PEXPIRE", key, window)
    return {1, limit - current_requests - 1, 0} -- [allowed: 1, remaining, retry_after: 0]
else
    -- Blocked: calculate earliest time window slides forward
    local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
    local retry_after = 1
    if oldest and oldest[2] then
        retry_after = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
        if retry_after < 1 then retry_after = 1 end
    end
    return {0, 0, retry_after} -- [allowed: 0, remaining: 0, retry_after_sec]
end
