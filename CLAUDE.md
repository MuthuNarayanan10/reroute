# CLAUDE.md — ReRoute platform

## What this is
Multi-tenant AI commerce backend for Indian D2C sellers. Live modules: Shopify order + checkout sync,
abandoned-cart WhatsApp recovery, COD risk scoring + COD-to-prepaid, courier tracking, and the
**ReRoute engine** (failed-delivery parcel → nearby buyer). Read `docs/ARCHITECTURE.md` before big changes.

## Stack
TypeScript (strict, ESM, NodeNext) · Fastify 5 · PostgreSQL via Drizzle ORM · Redis + BullMQ · zod ·
pino · prom-client · vitest. Node 22. Frontend: Vite + React 18 + react-router (no UI library; brand CSS tokens in `web/src/tokens.css`).

## Layout
- `src/api` HTTP only (validate → enqueue/query). `src/workers` maps queues → module functions.
- `src/modules/<name>` business logic; pure logic in its own file (e.g. `risk.ts`, `matcher.ts`, `eligibility.ts`).
- `src/integrations/<provider>` the only code that calls external APIs (always via `lib/http.ts` `fetchJson`).
- `src/db/schema.ts` single source of truth; generate migrations with `npm run db:generate -- --name <change>`.
- `web/` marketing pages are static HTML (`web/*.html` + `web/src/site`); the dashboard is `web/src/app` (React).
- Seller routes live under `/app-api` (session); internal ops under `/api` (API key). Both reuse `routes/store-api.ts`.

## Rules
- Webhooks: verify signature on the raw body → enqueue with a dedupe `jobId` → return 200. Never do work in the request.
- Every handler is idempotent (unique keys / status checks). Assume every webhook arrives twice and out of order.
- Every query on tenant data filters by `storeId`.
- Money = integer paise (`lib/money.ts`). Phones = E.164 (`lib/phone.ts`). Never log raw PII (`lib/mask.ts`).
- Secrets only from `env()` (`src/config/env.ts`); add new vars to the zod schema AND `.env.example`.
- New courier = new `CourierAdapter`; new store platform = new mapper into `NormalizedOrder`.
- Marketing WhatsApp messages only with `whatsappConsent = true`.
- Seller-facing endpoints: authorize via store membership; non-members get 404, never 403 (don't leak store existence).
- UI copy: plain seller language, numbers first (₹ rescued), brand colours only (lime = good outcome, coral = failure).

## Commands
- `npm run dev:api` / `npm run dev:worker` / `npm run dev:web` (site + dashboard on :5173)
- `npm run seed:demo` (demo login demo@reroute.example / Reroute-demo-2026)
- `npm test` (unit) · `npm run test:integration` (needs Postgres) · `npm run typecheck`
- `docker compose up -d` · `npm run db:migrate`

## Definition of done
Typecheck clean, unit tests for new pure logic, integration test updated if a flow changed,
docs/ARCHITECTURE.md updated if a queue/table/flow changed.

## How to work with me (Claude)
- For multi-file changes, show a short plan first and wait for approval.
- One module per session; don't touch unrelated modules.
- Finish with: what changed, how to test it, any follow-ups.
