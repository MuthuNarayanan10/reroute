# WhatsApp templates

Templates must be created and approved in Meta Business Manager before use. Names must match `.env`.

## `cod_to_prepaid_offer` (category: UTILITY)
Sent to the buyer about **their own order**, so it is a utility message.
```
Hi {{1}}, your order {{2}} is confirmed and will ship soon.
Pay online now and save {{3}}, plus get priority dispatch: {{4}}
Prefer cash? No action needed — we'll deliver as COD.
```

## `nearby_parcel_offer` (category: MARKETING — needs opt-in)
Only sent to shoppers who opted in to marketing messages (`whatsapp_consent = true`).
```
Good news! {{1}} (MRP {{2}}) is available near you right now.
Get it for {{3}} with fast local delivery. Prepaid only, limited stock: {{4}}
Reply STOP to opt out.
```

## `abandoned_cart_reminder` (category: MARKETING — needs opt-in)
Has one URL button with a dynamic suffix (the recovery path).
```
Hi {{1}}, you left {{2}} in your cart ({{3}}). Complete your order in one tap.
[Button: Complete order -> https://yourstore.com/{{1}}]
```

## Rules to stay compliant
- Never message without consent for marketing templates (India DPDP Act + Meta policy).
- Honour STOP: set `whatsapp_consent = false` (add an inbound webhook for replies as a next step).
- Keep volume low per user (cart nudges are capped at 2) to protect your number's quality rating.
