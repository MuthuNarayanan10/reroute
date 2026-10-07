# ReRoute Platform

AI commerce backend for Indian D2C sellers. It syncs Shopify orders, converts risky COD orders to prepaid,
recovers abandoned carts on WhatsApp — and **rescues failed deliveries** by selling the parcel to a nearby
shopper who wanted the same product, instead of sending it back to the warehouse.

**Tests:** 56 unit + 12 end-to-end steps against real Postgres. **Stack:** TypeScript, Fastify, PostgreSQL
(Drizzle), Redis + BullMQ, Docker.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it fits together.

## Quick start (local)

Prerequisites: Node.js 22, Docker Desktop, a Shopify Partner account with a development store.

```bash
npm install
cp .env.example .env          # fill in values (see "Accounts you need" below)
docker compose up -d          # Postgres + Redis
npm run db:migrate            # create tables
npm run db:seed-pincodes -- data/pincodes.csv   # India Post pincode lat/long CSV (data.gov.in)

npm run dev:api               # terminal 1 — http://localhost:3000
npm run dev:worker            # terminal 2 — background jobs
```

Expose your local API with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`), put the
URL in `APP_URL`, and set the same URL as the app URL + redirect URL
(`<APP_URL>/auth/shopify/callback`) in the Shopify Partner dashboard.

Install on your dev store: open `<APP_URL>/auth/shopify?shop=your-store.myshopify.com`.

## Tests

```bash
npm test                      # unit tests (no DB needed); integration test auto-skips
npm run test:integration      # end-to-end against Postgres (uses INTEGRATION_DATABASE_URL or localhost default)
npm run typecheck
```

## Accounts you need

| Service | Used for | Env vars |
|---|---|---|
| Shopify Partners | App install, orders, checkouts | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` |
| Razorpay | Payment links (prepaid conversion + ReRoute offers) | `RAZORPAY_*` |
| Meta WhatsApp Cloud API | Offers + cart reminders | `WHATSAPP_*` (templates: `docs/WHATSAPP_TEMPLATES.md`) |
| Shiprocket | Tracking webhooks + NDR consignee update | `SHIPROCKET_*`, `COURIER_WEBHOOK_SECRET` |

## Webhook URLs to configure

| Provider | URL |
|---|---|
| Shopify | registered automatically on install: `<APP_URL>/webhooks/shopify` |
| Razorpay | `<APP_URL>/webhooks/razorpay` — events: `payment_link.paid`, `payment_link.expired`, `payment_link.cancelled` |
| Shiprocket | `<APP_URL>/webhooks/courier/shiprocket` — token = `COURIER_WEBHOOK_SECRET` |

## Admin API (for the dashboard)

All routes need `x-api-key: <one of ADMIN_API_KEYS>` and are scoped to one store.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/stores/:storeId` | Store info + settings |
| PATCH | `/api/stores/:storeId/settings` | Tune thresholds, discounts, excluded SKUs |
| GET | `/api/stores/:storeId/orders` | Latest orders with risk score + reasons |
| POST | `/api/stores/:storeId/shipments` | Register an AWB `{orderExternalId, courier, awb}` |
| GET | `/api/stores/:storeId/reroute/cases` | ReRoute cases |
| GET | `/api/stores/:storeId/stats` | Prepaid conversion rate, parcels rescued, ₹ recovered |

Ops endpoints: `GET /health`, `GET /ready`, `GET /metrics` (Prometheus).

## Deploying
Build one image, run it twice: `node dist/api/index.js` (API) and `node dist/workers/index.js` (workers).
Run `node dist/db/migrate.js` once per release before rolling out. Use managed Postgres + Redis (AWS RDS +
ElastiCache, or equivalents). `docker compose --profile full up` runs the whole stack locally.

## Read next
- `docs/COURIER_PARTNERSHIP.md` — what to agree with your courier (ReRoute depends on it)
- `docs/ROADMAP.md` — known limitations and the next modules
- `CLAUDE.md` — conventions for building the next modules with Claude Code
