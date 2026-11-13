# WanWan Play

Bilingual Traditional Chinese / English product page. **Online checkout is temporarily unavailable**, pending a separate PayPal integration. No orders are created and no simulated payments are available.

## Local development

Run npm ci, then npm start in this directory (http://localhost:3000). Optionally copy .env.example to .env. Never commit secrets. Run npm test for verification.

## Retained functionality

- Product images, language selection (public/i18n.js), mobile layout and navigation.
- Euro prices: PRODUCT_NAME, PRICE_EUR, SHIPPING_EUR.
- POST /api/quote calculates prices and promotions without consuming a promo code.
- promo-codes.json supports percent, amount_eur, maxUses and expires.
- GET /api/config returns provider: none, checkoutReady: false, simulation: false.
- POST /api/checkout always returns HTTP 503 PAYMENT_UNAVAILABLE without storing customer details.

The former payment SDK, API calls, callbacks, simulation routes and Apple merchant verification file have been removed. Return pages do not confirm payment. PayPal is not integrated yet.

## Existing data

Keep DATA_DIR, orders.json, promo-uses.json and any Redis configuration unchanged. This version reads promo counters only and does not modify existing orders, payment references or counters.

Use a persistent DATA_DIR outside the deployed site. Empty defaults to landing-test/data; relative paths start at server.js. Startup fails if the directory is unusable.

Redis remains optional and takes precedence via UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL / KV_REST_API_TOKEN. No automatic data migration occurs. Do not change storage during this removal.

See DEPLOIEMENT-HOSTINGER.md for redeployment and retiring the former provider.
