# Courier partnership checklist (the make-or-break for ReRoute)

ReRoute only works if the courier lets you change the consignee of an NDR parcel within the same
delivery zone. Technically this is an "address update on NDR" — commercially you need it enabled.

## What to ask your aggregator / courier account manager
1. **Consignee change on NDR**: can we update name, phone and address (same city / same hub) via API?
   Which endpoint and fields? (Our Shiprocket adapter uses the NDR action API — verify fields with them.)
2. **Hold at hub**: can we place an NDR parcel on hold for 4–6 hours while offers are live,
   instead of an immediate re-attempt or RTO?
3. **Re-attempt SLA** after consignee change: next-day delivery?
4. **Charges**: is an address change charged as a fresh forward shipment, a re-attempt, or free?
5. **Webhook**: status webhook with AWB, our channel order id, NDR reason, timestamp, and a secret token.

## Pitch to the courier
RTO costs couriers too: reverse linehaul, hub handling, and lower partner satisfaction. Every rescued
parcel is a delivery they get paid for instead of a return trip. Offer them co-branded reporting
("parcels rescued in your network").

## Adding a new courier
Implement `CourierAdapter` in `src/integrations/courier/<name>.ts` (verifyWebhook, parseWebhook,
updateConsignee) and register it in `registry.ts`. Nothing else changes.
