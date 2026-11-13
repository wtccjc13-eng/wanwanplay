# WanWan Play — PayPal checkout

Bilingual Traditional Chinese / English product site with PayPal Standard Checkout, server-side EUR pricing and promo codes. Airwallex and simulated payments remain removed.

## Local development

Run npm ci, copy .env.example to an untracked .env if needed, then npm start (http://localhost:3000). Run npm test for the automated suite. No new npm dependency is required: server requests use Node.js fetch.

Checkout stays closed with HTTP 503 PAYMENT_UNAVAILABLE until PAYPAL_ENV is sandbox or live and PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID and PAYPAL_MERCHANT_ID are all present. The client ID is public and used by the PayPal JavaScript SDK; the secret never leaves the server. Matching credentials do not prove account eligibility or successful payment; test the real account before launch.

## Payment flow

1. The browser validates the shipping form, then requests POST /api/checkout. The server validates fields, calculates quantity/price/discount and persists a pending order before creating the PayPal order.
2. The browser receives the PayPal order ID and an opaque per-order token. The token is stored in sessionStorage; only its hash is stored with the order. Browser storage is required for status access. No token is placed in URLs.
3. The PayPal SDK displays eligible methods. Its onApprove callback calls POST /api/orders/:id/capture with the per-order bearer token. The server retrieves the order from PayPal, validates merchant, reference, currency and total, captures with a stable PayPal-Request-Id and retrieves it again.
4. A completed capture with the exact EUR amount marks the order paid and increments its promo counter once. A pending or denied capture cannot be shown as paid. The status page reads GET /api/orders/:id; its retry button safely retries the same order after a timeout.
5. POST /paypal/webhook verifies signatures through PayPal's verification API, retrieves authoritative order details and reconciles payment. CHECKOUT.ORDER.APPROVED also triggers capture if the browser closed after approval. Invalid signatures return 401; processing/storage errors return 500 so PayPal can retry.

A success-page URL alone is never payment confirmation. Status endpoints return only the order reference, status and amount, and require the per-order token. Existing legacy orders and payment references remain untouched. No email sending or automatic fulfillment is implemented. Refunds and disputes are handled in the merchant dashboard; this version does not synchronize refund/dispute states.

## Product and promotions

PRICE_EUR defaults to 19.90 and SHIPPING_EUR to 0. Prices must be valid non-negative EUR amounts (product at least EUR 1). PRODUCT_NAME controls the product label. POST /api/quote previews prices without creating orders or consuming promotions.

promo-codes.json supports percent, amount_eur, maxUses and expires. Promo usage increments once on confirmed payment. maxUses is checked when creating an order, without reserving capacity for pending payments; simultaneous pending checkouts can exceed that limit. It is not a hard stock/quota mechanism.

## Storage

Keep DATA_DIR outside the deployment directory and preserve orders.json and promo-uses.json. Empty defaults to landing-test/data; relative paths start at server.js. The server refuses an unusable directory. File storage supports one Node.js process only. Writes use temporary files and rename; payment-journal.json recovers an interrupted paid-order/promo update at startup or the next access. Preserve all three files together when backing up or migrating. Invalid JSON raises an error instead of overwriting historical data.

Optional Redis takes precedence via UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL / KV_REST_API_TOKEN. It uses the existing order: and promo: keys. A Lua operation updates paid status and promo usage together. Use Redis for multiple processes/instances. There is no automatic migration.

## Verification

npm test uses fake PayPal and Redis servers and a simulated SDK/DOM callback flow. It checks server totals, access tokens, mismatch rejection, pending/denied captures, approval webhooks, duplicate events, lost capture responses, transient Redis errors, persistence, journal recovery and closed checkout with missing settings. It does not prove live PayPal eligibility, real webhook delivery or browser/device compatibility.

See DEPLOIEMENT-HOSTINGER.md for credentials, webhook setup and the real-account test checklist.

Official references:
- https://developer.paypal.com/studio/checkout/standard/integrate
- https://developer.paypal.com/api/orders/v2
- https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post
