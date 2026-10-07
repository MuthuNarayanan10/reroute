# Roadmap

## Done in this codebase (MVP backend)
- Shopify OAuth install, encrypted tokens, webhook registration, GDPR webhooks
- Real-time order + abandoned-checkout sync (idempotent, out-of-order safe)
- Abandoned cart WhatsApp recovery (2 nudges max, consent-aware)
- Explainable COD risk scoring + COD-to-prepaid payment link offers
- Courier tracking ingestion (Shiprocket adapter) with learning loop
- **ReRoute engine**: NDR → nearby buyer match → prepaid offers → first-payer-wins → consignee change → new order
- Admin API with store-scoped stats; Prometheus metrics; Docker; CI

## Known limitations (fix before scaling)
- **Admin auth** is a shared API key. Add seller login (Shopify session tokens for the embedded app, or email OTP) before onboarding sellers.
- **Shopify Protected Customer Data**: reading names, phones and addresses needs Shopify's approval (Level 2) — apply in the Partner dashboard early.
- **App config**: add `shopify.app.toml` (via Shopify CLI) with the mandatory compliance webhooks pointing at `/webhooks/shopify`.
- **COD-to-prepaid discount**: the order is marked paid and tagged with the discount; apply the discount on the Shopify order via the order-editing API for clean accounting.
- **Hold at hub** while ReRoute offers are live is not automated yet (needs courier support — see COURIER_PARTNERSHIP.md).
- **WhatsApp STOP replies** need an inbound webhook to withdraw consent.

## Next modules (in order)
1. Seller dashboard UI (embedded Shopify app, Polaris) on top of the admin API
2. WooCommerce + custom-site connectors (same `NormalizedOrder` shape)
3. Second courier adapter (Delhivery) + courier selection by pincode performance
4. Amazon SP-API + Flipkart listing/inventory/order sync
5. Grow engine: auto-SEO pages, ad creatives, profit-aware Meta/Google spend (feeds delivered/RTO signals back)
6. Manufacturer portal + demand-to-factory loop
7. Global hub: test-sell abroad, overseas warehouse inventory, Global ReRoute
