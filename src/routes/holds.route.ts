import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { HoldService } from "../services/hold/hold.service.js";
import { createRateLimitHook } from "../middleware/rate-limit.middleware.js";

const AcquireHoldSchema = z.object({
  userId: z.string().min(1),
  hotelId: z.string().uuid(),
  roomTypeId: z.string().uuid(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roomsCount: z.number().int().min(1).default(1),
  ttlSeconds: z.number().int().min(30).max(1800).optional(),
});

const ConfirmHoldSchema = z.object({
  bookingId: z.string().min(1),
  totalAmountInr: z.number().positive(),
  paymentRef: z.string().optional(),
});

export async function holdsRoutes(fastify: FastifyInstance) {
  // 1. Acquire Atomic Hold
  fastify.post(
    "/api/v1/holds/acquire",
    {
      preHandler: createRateLimitHook("acquire_hold", 60000, 25),
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = AcquireHoldSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.format() });
      }

      const result = await HoldService.acquireHold(parsed.data);

      if (!result.success) {
        return reply.status(409).send({
          success: false,
          error: "Hold Acquisition Failed",
          reason: result.reason,
          dateFailed: result.dateFailed,
        });
      }

      return reply.status(201).send({
        success: true,
        message: "Atomic 15-minute room hold successfully acquired!",
        holdId: result.holdId,
        expiresAt: result.expiresAt,
        ttlSeconds: parsed.data.ttlSeconds || 900,
      });
    }
  );

  // 2. Release Hold (Explicit Cancel or Expiration)
  fastify.post<{ Params: { id: string }; Body: { reason?: "CANCELLED" | "EXPIRED" } }>(
    "/api/v1/holds/:id/release",
    async (req, reply) => {
      const holdId = req.params.id;
      const reason = req.body?.reason || "CANCELLED";

      const result = await HoldService.releaseHold(holdId, reason);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: "Failed to release hold",
          reason: result.reason,
        });
      }

      return reply.send({
        success: true,
        message: `Hold ${holdId} released. Rooms restored to inventory.`,
      });
    }
  );

  // 3. Confirm Hold (Payment completed)
  fastify.post<{ Params: { id: string } }>(
    "/api/v1/holds/:id/confirm",
    {
      preHandler: createRateLimitHook("confirm_hold", 60000, 10),
    },
    async (req, reply) => {
      const holdId = req.params.id;
      const parsed = ConfirmHoldSchema.safeParse(req.body);

      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.format() });
      }

      const result = await HoldService.confirmHold(
        holdId,
        parsed.data.bookingId,
        parsed.data.totalAmountInr,
        parsed.data.paymentRef
      );

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: "Confirmation Failed",
          reason: result.reason,
        });
      }

      return reply.send({
        success: true,
        message: "Hold permanently confirmed into booking!",
        bookingId: parsed.data.bookingId,
        holdId,
      });
    }
  );

  // 4. Get Hold Details & Remaining TTL
  fastify.get<{ Params: { id: string } }>(
    "/api/v1/holds/:id",
    async (req, reply) => {
      const hold = await HoldService.getHold(req.params.id);

      if (!hold) {
        return reply.status(404).send({ error: "Hold not found" });
      }

      const nowEpoch = Math.floor(Date.now() / 1000);
      const expiresAtEpoch = Number(hold.expires_at || 0);
      const remainingSeconds = Math.max(0, expiresAtEpoch - nowEpoch);

      return reply.send({
        ...hold,
        remainingSeconds,
        isExpired: remainingSeconds === 0 && hold.status === "HELD",
      });
    }
  );
}
