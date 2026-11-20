import { FastifyRequest, FastifyReply } from "fastify";
import { RateLimiterService } from "../services/rate-limiter/rate-limiter.service.js";

export function createRateLimitHook(actionName: string, windowMs: number, maxRequests: number) {
  return async function rateLimitHook(req: FastifyRequest, reply: FastifyReply) {
    const ip = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
    const key = `rl:${actionName}:${ip}`;

    const limitResult = await RateLimiterService.checkLimit(key, windowMs, maxRequests);

    reply.header("X-RateLimit-Limit", maxRequests);
    reply.header("X-RateLimit-Remaining", limitResult.remaining);

    if (!limitResult.allowed) {
      reply.header("Retry-After", limitResult.retryAfterSeconds);
      return reply.status(429).send({
        error: "Too Many Requests",
        message: `Rate limit exceeded for ${actionName}. Please try again in ${limitResult.retryAfterSeconds} seconds.`,
        retryAfter: limitResult.retryAfterSeconds,
      });
    }
  };
}
