# ReRoute Platform

The complete ReRoute product: **marketing website + seller dashboard + backend**, deployed as one app.

> **New here?** Read [START-HERE.md](START-HERE.md) (where everything is) and [DEPLOY.md](DEPLOY.md) (go live step by step).
> Backend = `src/` · Frontend = `web/`
AI commerce platform for Indian D2C sellers. It syncs Shopify orders, converts risky COD orders to prepaid,
recovers abandoned carts on WhatsApp — and **rescues failed deliveries** by selling the parcel to a nearby
shopper who wanted the same product, instead of sending it back to the warehouse.

**Tests:** 82 (unit + integration against real Postgres: order→ReRoute flow, accounts, tenant isolation, roles, CSRF).
**Stack:** TypeScript · Fastify · PostgreSQL (Drizzle) · Redis + BullMQ · React + Vite · Docker.

| URL | What |
|---|---|
| `/` | Marketing site (static HTML, SEO-friendly): hero, how it works, features, pricing, FAQ, early-access form |
| `/privacy`, `/terms` | Legal pages (**drafts — have a lawyer review and fill in company details**) |
| `/app/login`, `/app/signup` | Seller accounts (email + password, server-side sessions) |
| `/app` | Dashboard: ₹ rescued, COD→prepaid, RTO rate, daily chart, failed deliveries, risky COD |
| `/app/orders` | Orders with risk score + reasons, filters, search, paging |
| `/app/reroute` | Every ReRoute case and its outcome |
| `/app/settings` | Thresholds, discounts, excluded SKUs (owners/admins; viewers read-only) |
| `/app/connect` | Connect Shopify, webhook URLs to paste, manual AWB tracking |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it fits together.

## Quick start (local)

Prerequisites: Node.js 22, Docker Desktop, a Shopify Partner account with a development store.

```bash
npm install
cp .env.example .env          # fill in values (see "Accounts you need" below)
docker compose up -d          # Postgres + Redis
npm run db:migrate            # create tables
npm run db:seed-pincodes -- data/pincodes.csv   # India Post pincode lat/long CSV (data.gov.in)

npm run seed:demo             # optional: demo store + login (demo@reroute.example / Reroute-demo-2026)

npm run dev:api               # terminal 1 — API on http://localhost:3000
npm run dev:worker            # terminal 2 — background jobs
npm run dev:web               # terminal 3 — website + dashboard with hot reload on http://localhost:5173
```

Open http://localhost:5173 (site) and http://localhost:5173/app (dashboard). In production the API serves the
built site itself (`npm run build` → one container), so there is no separate frontend host.

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

## Seller API (used by the dashboard)

Cookie session (`rr_session`, HttpOnly, Secure in production, SameSite=Lax) + same-origin check on every write.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup`, `/auth/login`, `/auth/logout` | Accounts (rate-limited 10/min) |
| GET | `/app-api/me` | Current user + stores they belong to |
| POST | `/app-api/shopify/connect` | Start Shopify OAuth bound to this user |
| POST | `/app-api/stores/claim` | Link a store installed from the Shopify App Store |
| GET | `/app-api/stores/:id/overview` | KPIs, 30-day series, needs-action lists |
| GET/PATCH | `/app-api/stores/:id`, `/settings` | Store info and settings |
| GET | `/app-api/stores/:id/orders?view=&q=&limit=&offset=` | Orders |
| GET | `/app-api/stores/:id/reroute/cases?status=` | ReRoute cases |
| POST | `/app-api/stores/:id/shipments` | Track an AWB `{orderNumber, courier, awb}` |
| POST | `/public/leads` | Early-access form (rate-limited, honeypot) |

A store you are not a member of always returns **404** (its existence is never revealed). Viewers get 403 on writes.

## Internal admin API (ops only)

Same store routes under `/api/...` with `x-api-key: <one of ADMIN_API_KEYS>`; full access to every store.

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
Build one image (`docker build .` — it builds API, workers **and** the website), run it twice:
`node dist/api/index.js` (API + website) and `node dist/workers/index.js` (workers).
Run `node dist/db/migrate.js` once per release before rolling out. Use managed Postgres + Redis (AWS RDS +
ElastiCache, or equivalents). `docker compose --profile full up` runs the whole stack locally.

## Read next
- `docs/COURIER_PARTNERSHIP.md` — what to agree with your courier (ReRoute depends on it)
- `docs/ROADMAP.md` — known limitations and the next modules
- `CLAUDE.md` — conventions for building the next modules with Claude Code
