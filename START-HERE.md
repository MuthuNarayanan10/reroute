# Start here — where everything is

ReRoute is **one project** that contains both the backend and the frontend.
They are built and deployed together as a single app (one Docker image).

```
reroute-platform/
│
├── src/                      ← BACKEND (Node.js + TypeScript)
│   ├── api/                  HTTP server: website serving, login, dashboard API, webhooks
│   │   ├── server.ts         ← the server starts here
│   │   └── routes/           every URL the server answers
│   ├── workers/              background jobs (runs as a 2nd process)
│   ├── modules/              business logic: order sync, COD risk, ReRoute engine, accounts...
│   ├── integrations/         Shopify, Razorpay, WhatsApp, Shiprocket clients
│   ├── db/                   database tables (schema.ts) + migrations
│   ├── cli/                  one-off commands: demo data, pincode loader
│   └── config/env.ts         every setting the app reads
│
├── web/                      ← FRONTEND
│   ├── index.html            marketing website (home page)
│   ├── privacy.html, terms.html, 404.html
│   ├── app.html              entry for the seller dashboard
│   └── src/
│       ├── site/             website styles + script
│       └── app/              seller dashboard (React): pages/, components/
│
├── tests/                    89 automated tests
├── render.yaml               one-click hosting setup (Render)
├── Dockerfile                builds backend + frontend into one image
├── docker-compose.yml        local Postgres + Redis
├── .env.example              list of settings (copy to .env)
├── DEPLOY.md                 ← how to go live, step by step
├── README.md                 developer reference
└── docs/                     architecture, courier partnership, WhatsApp templates, roadmap
```

## Run it on your laptop (10 minutes)

You need Node.js 22 and Docker Desktop.

```bash
npm install
docker compose up -d                 # starts Postgres + Redis
cp .env.example .env                 # then fill the 4 core values (see comments in the file)
npm run db:migrate                   # creates the tables
npm run seed:demo                    # demo store + login

npm run dev:api                      # terminal 1 — backend on :3000
npm run dev:worker                   # terminal 2 — background jobs
npm run dev:web                      # terminal 3 — frontend with hot reload on :5173
```

Open **http://localhost:5173** (website) and **http://localhost:5173/app** (dashboard).
Demo login: `demo@reroute.example` / `Reroute-demo-2026`.

To try the production version locally: `npm run build && npm run start:api` → http://localhost:3000.

## Go live
Follow **[DEPLOY.md](DEPLOY.md)**.
