# 🏨 HoldIt
> **Production-grade AI Trip Planner with Zero Double-Booking Guarantee**  
> *Built with Node.js (TypeScript + Fastify), Redis Lua, Dedicated Qdrant Vector DB, and PostgreSQL.*

---

## 🌟 Key Features

1. **Zero Double-Booking Guarantee (Redis Lua Engine)**:
   - High-concurrency room holds using atomic Redis Lua scripts (`acquire_hold.lua`, `release_hold.lua`, `confirm_hold.lua`).
   - Verifies all nights of stay atomically. If even 1 night has 0 inventory, the request is rejected with 0 partial locks.
   - 15-minute TTL countdown timer.
2. **Background Sweeper Daemon**:
   - Reconciles expired holds from `active_holds:zset` every 4 seconds and restores inventory automatically if a user abandons checkout.
3. **Dedicated Vector DB Semantic Cache (Qdrant)**:
   - Vector database caching similar natural language queries (e.g. *"Goa mein 3 raat, 2 log..."* vs *"Goa 3 nights 2 people..."*) to eliminate redundant LLM calls and reduce latency from 3s to <15ms.
4. **Pluggable LLM Provider**:
   - Clean provider interface (`ILLMProvider`) supporting **Google Gemini (Function Calling)**, **OpenAI (Tool Calling)**, and an **Intelligent Rule-Based Parser** out-of-the-box.
5. **Real-Time Streaming (SSE)**:
   - Streams query parsing, semantic cache status, inventory scanning, candidate room cards, and live hold countdown directly to client.
6. **Distributed Sliding Window Rate Limiter**:
   - Redis Lua sliding window log protecting endpoints against bot scraping and flash-sale DDoS.

---

## 🛠️ Tech Stack & Infrastructure

- **Runtime**: Node.js v22 + TypeScript (Fastify 5)
- **In-Memory Concurrency Tier**: Redis 7.2 (Lua Scripts + TTL + ZSet)
- **Vector Search Engine**: Qdrant v1.13.2 (Dedicated Vector DB Container)
- **Relational Storage**: PostgreSQL 16 (Durable Source of Truth)
- **Orchestration**: Docker Compose

---

## 🚀 Quick Start

### 1. Spin up Infrastructure Containers
```bash
docker compose up -d
```
*Starts PostgreSQL (port 5455), Redis (port 6398), and Qdrant (port 6333).*

### 2. Install Dependencies & Migrate Database
```bash
npm install
npm run db:migrate
npm run db:seed
```

### 3. Run Automated Tests
- **Concurrency Test (100 concurrent requests racing for 1 room)**:
  ```bash
  npm run test:concurrency
  ```
- **Semantic Vector Cache Test (Qdrant)**:
  ```bash
  npx tsx test/semantic-cache-test.ts
  ```
- **Full End-to-End System Test**:
  ```bash
  npx tsx test/e2e-api-test.ts
  ```

### 4. Start the Production Server
```bash
# Development with hot-reload
npm run dev

# Or build & start production
npm run build
npm start
```

---

## 📡 API Endpoints

### 1. Server-Sent Events (SSE) AI Search Stream
```http
GET /api/v1/search/stream?q=Goa mein 3 raat, 2 log, ₹8,000 budget, beach ke paas
```
Streams events:
- `event: status` (query received)
- `event: cache_hit` / `cache_miss` (Qdrant vector similarity)
- `event: llm_extracted` (structured filters)
- `event: room_found` (individual room candidates)
- `event: completed` (search summary)

### 2. Acquire Atomic Hold
```http
POST /api/v1/holds/acquire
Content-Type: application/json

{
  "userId": "user_123",
  "hotelId": "ac3cd876-bc76-48a3-aa6a-eb3cfe2d3cd1",
  "roomTypeId": "b281d696-81b1-469a-a4bb-8d72de17c31b",
  "checkIn": "2026-12-10",
  "checkOut": "2026-12-13",
  "roomsCount": 1,
  "ttlSeconds": 900
}
```
**Response (201 Created)**:
```json
{
  "success": true,
  "message": "Atomic 15-minute room hold successfully acquired!",
  "holdId": "296dbecf-54ae-4c09-a55e-d9e9a971818d",
  "expiresAt": "2026-12-10T12:15:00.000Z",
  "ttlSeconds": 900
}
```

### 3. Get Hold Status & Remaining TTL
```http
GET /api/v1/holds/:id
```

### 4. Confirm Hold (Payment Gateway Webhook)
```http
POST /api/v1/holds/:id/confirm
Content-Type: application/json

{
  "bookingId": "BK_20261120_987",
  "totalAmountInr": 7800,
  "paymentRef": "pay_rzp_live_12345"
}
```

### 5. Release Hold (Explicit Cancel)
```http
POST /api/v1/holds/:id/release
Content-Type: application/json

{
  "reason": "CANCELLED"
}
```

---

## 🔄 Switching LLM Provider

In `.env`, simply configure:
```env
# Choose: "mock", "gemini", or "openai"
LLM_PROVIDER=gemini

# For Google Gemini
GEMINI_API_KEY=your_gemini_api_key_here

# For OpenAI
OPENAI_API_KEY=your_openai_api_key_here
```
