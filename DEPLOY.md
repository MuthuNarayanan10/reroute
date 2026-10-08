# Deploy ReRoute and go live

Two stages:

- **Stage A (about 45 minutes):** the website and seller dashboard are live on the internet with HTTPS. No Shopify,
  Razorpay or WhatsApp keys are needed yet.
- **Stage B (1–3 days, mostly waiting on approvals):** connect Shopify, Razorpay, Shiprocket and WhatsApp so real
  orders flow and ReRoute rescues real parcels.

We use **Render** (render.com) because the included `render.yaml` sets everything up in one click: website + API,
background worker, PostgreSQL and Redis, all in the Singapore region (closest to India), with HTTPS and automatic
deploys on every `git push`. The app is a standard Docker image, so it also runs on AWS ECS, Railway or Fly.io
(see the end of this guide).

---

## Stage A — website and dashboard live

### 1. Accounts you need
- **GitHub** (free) — to hold the code.
- **Render** — sign up with GitHub and add a payment card. Use the paid plans in `render.yaml` for anything
  sellers will use; free plans sleep when idle and have limits. Check current prices at render.com/pricing.
- **A domain** (optional for day one), e.g. from GoDaddy, Namecheap or Hostinger.

### 2. Put the code on GitHub
Unzip `reroute-platform.zip`. In a terminal inside the `reroute-platform` folder:

```bash
# Create an EMPTY private repo on github.com first (no README), then:
git remote add origin https://github.com/<your-username>/reroute-platform.git
git branch -M main
git push -u origin main
```

The project already has its Git history, so you don't need `git init`.

### 3. Create everything on Render with the Blueprint
1. Render dashboard → **New** → **Blueprint**.
2. Connect GitHub and pick the `reroute-platform` repo.
3. Render reads `render.yaml` and shows 4 resources: `reroute-web`, `reroute-worker`, `reroute-db`,
   `reroute-redis`, plus the env group `reroute-secrets`. Click **Apply**.
4. Wait for the first build (5–10 minutes). Render builds the Docker image, runs the database migrations
   (`preDeployCommand`), then starts the web service and worker.

### 4. Check it's live
- Open `https://reroute-web.onrender.com` (Render shows your exact URL on the `reroute-web` page). You should see the website.
- `https://<your-url>/health` → `{"ok":true}`
- `https://<your-url>/ready` → `{"ok":true,"integrations":{...all false...}}`. Database and Redis are connected;
  integrations come in Stage B.
- Go to `/app/signup` and create your own account.

If the deploy fails, open the service → **Logs**. A missing setting prints `Invalid environment: <NAME>: ...`.

### 5. (Optional) Load demo data for sales demos
`reroute-web` → **Shell** tab:
```bash
node dist/cli/seed-demo.js --force --email you@yourbrand.in --password 'Choose-a-strong-one-1'
```
Then log in at `/app/login` with that email. Use this on a separate demo deployment, not the one real sellers use.

### 6. Your own domain (e.g. reroute.in)
1. `reroute-web` → **Settings** → **Custom Domains** → add `reroute.in` and `www.reroute.in`.
2. At your domain registrar, add the DNS records Render shows (usually a `CNAME` for `www` and an `A`/`ALIAS` for the root).
   Render issues the HTTPS certificate automatically, typically within minutes to an hour.
3. Point the app at the new address. In `render.yaml`, replace **both** `APP_URL` blocks (web and worker) with:
   ```yaml
      - key: APP_URL
        value: https://reroute.in
   ```
   Then `git commit -am "Use custom domain" && git push`. Render redeploys automatically.

**The website and dashboard are now live.** 🎉

---

## Stage B — connect the integrations

Add every key below in Render → **Environment Groups** → `reroute-secrets` → **Add Environment Variable**.
The group is shared, so the web service and worker both receive it. After saving, use **Manual Deploy** →
**Deploy latest commit** on both services. `/ready` shows each integration flip to `true`.

Use the **test/sandbox mode** of each provider first, then switch to live keys.

### 7. Shopify (orders, checkouts)
1. partners.shopify.com → **Apps** → **Create app** → create manually.
2. **App URL:** `https://reroute.in/app` · **Allowed redirection URL:** `https://reroute.in/auth/shopify/callback`
3. Copy **Client ID** → `SHOPIFY_API_KEY` and **Client secret** → `SHOPIFY_API_SECRET`.
4. **API access → Protected customer data:** request access to name, phone and address (Level 2). Shopify must
   approve this before ReRoute can read buyer details. Start early.
5. **Compliance webhooks** (required for the App Store): set customer data request, customer redact and shop redact
   all to `https://reroute.in/webhooks/shopify`.
6. Test: create a development store → in your dashboard go to **Connections** → enter the store → approve.
   Place a test COD order and it appears under **Orders** within seconds.

### 8. Razorpay (prepaid links, ReRoute payments, refunds)
1. dashboard.razorpay.com → **Settings → API Keys** → generate → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
2. **Settings → Webhooks → Add:** URL `https://reroute.in/webhooks/razorpay`, choose a secret → `RAZORPAY_WEBHOOK_SECRET`.
   Events: `payment_link.paid`, `payment_link.expired`, `payment_link.cancelled`.
3. Payment Links must be enabled on your account (live mode needs KYC).

### 9. Shiprocket (tracking + failed-delivery redirect)
1. Shiprocket → **Settings → API → Create an API user** (a separate email from your login) → `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`.
2. **Settings → Webhooks:** URL `https://reroute.in/webhooks/courier/shiprocket`. Token = the `COURIER_WEBHOOK_SECRET`
   value Render generated (copy it from the env group).
3. **Ask your Shiprocket account manager** to enable consignee/address change on NDR shipments. ReRoute's parcel redirect
   depends on it. Use the checklist in `docs/COURIER_PARTNERSHIP.md`.

### 10. WhatsApp (offers, cart reminders)
1. developers.facebook.com → create a **Business** app → add **WhatsApp** → add and verify your business phone number.
2. Copy the **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
3. Create a **System User** in Business Manager with a permanent token (`whatsapp_business_messaging`) → `WHATSAPP_TOKEN`.
4. Create and get approved the 3 templates in `docs/WHATSAPP_TEMPLATES.md` (names must match exactly).

### 11. Pincode map data (needed for "buyers nearby")
1. Download the India Post *All India Pincode Directory with latitude/longitude* CSV from data.gov.in.
2. Render → `reroute-db` → **Networking** → add your current IP to the allow list → copy the **External Database URL**.
3. On your laptop, in the project folder:
   ```bash
   DATABASE_URL='<external database url>' npm run db:seed-pincodes -- path/to/pincodes.csv
   ```
4. Remove your IP from the allow list again.

### 12. Final checks
- `/ready` shows all four integrations `true`.
- Place a COD test order on the dev store → it appears in **Orders** with a risk score.
- Track a test AWB in **Connections** → mark it undelivered in the Shiprocket sandbox → a case appears under **ReRoute**.

---

## Go-live checklist (before real sellers)

- [ ] Fill the bracketed company details in `web/privacy.html` and `web/terms.html`, and have a lawyer review them.
- [ ] Switch Razorpay and Shiprocket from test to **live** keys.
- [ ] Shopify Protected Customer Data approved; app listing submitted if you want App Store installs.
- [ ] WhatsApp templates approved; business verification done.
- [ ] Confirm pricing on the website (`web/index.html`, pricing section).
- [ ] Render Postgres: confirm backups are enabled on your plan.
- [ ] Set up an uptime alert on `https://reroute.in/health` (e.g. Better Stack, UptimeRobot).
- [ ] Trademark search for "ReRoute" (classes 9, 39, 42).
- [ ] **Never change `ENCRYPTION_KEY`** after stores connect, or saved Shopify tokens become unreadable.

## Everyday operations
- **Deploy a change:** `git push` to `main`. Render rebuilds, runs migrations, then switches over with no downtime.
- **Logs:** Render → service → Logs. **Metrics:** Render charts, plus Prometheus at `/metrics`.
- **Roll back:** Render → service → Events → pick a previous deploy → Rollback.
- **Database changes:** edit `src/db/schema.ts` → `npm run db:generate -- --name what_changed` → commit → push.

## Not using Render?
The same Docker image runs anywhere:
```bash
docker build -t reroute .
docker run --env-file .env -p 3000:3000 reroute                              # web + API
docker run --env-file .env reroute node dist/workers/index.js                 # worker
docker run --env-file .env reroute node dist/db/migrate.js                    # once per release
```
On AWS: ECS Fargate (2 services from one image) + RDS PostgreSQL + ElastiCache Redis (`maxmemory-policy noeviction`)
+ an Application Load Balancer with an ACM certificate. Health check path: `/health`.
