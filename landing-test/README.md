# WanWan Play — PayPal checkout

Bilingual Traditional Chinese / English product site with PayPal Standard Checkout, server-side EUR pricing and promo codes. Airwallex and simulated payments remain removed.

## Local development

Run npm ci, copy .env.example to an untracked .env if needed, then npm start (http://localhost:3000). Run npm test for the automated suite. No new npm dependency is required: server requests use Node.js fetch.

Checkout stays closed with HTTP 503 PAYMENT_UNAVAILABLE until PAYPAL_ENV is sandbox or live and PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID and PAYPAL_MERCHANT_ID are all present. The client ID is public and used by the PayPal JavaScript SDK; the secret never leaves the server. Matching credentials do not prove account eligibility or successful payment; test the real account before launch.

## Payment flow

1. The single checkout form contains quantity, promo code and a required **Delivery contact phone** above the PayPal buttons, with explicit delivery-only purpose text in English and Traditional Chinese. The browser validates the international phone and applies the entered promo before opening PayPal. POST /api/checkout accepts quantity, promo, language and deliveryPhone; the server independently validates and normalizes the phone, recalculates totals, and persists it before PayPal order creation. Name, address and email still come from PayPal.
2. The browser receives the PayPal order ID and an opaque per-order token. The token is stored in sessionStorage; only its hash is stored with the order. Browser storage is required for status access. No token is placed in URLs.
3. The PayPal SDK displays eligible methods. Its onApprove callback calls POST /api/orders/:id/capture with the per-order bearer token. The server retrieves the order from PayPal, validates merchant, reference, currency and total, then requires a complete recipient name and supported European shipping address before capture. It saves those confirmed delivery details, captures with a stable PayPal-Request-Id and retrieves the order again.
4. A completed capture with the exact EUR amount marks the order paid and increments its promo counter once. A pending or denied capture cannot be shown as paid. Missing delivery details or an unsupported country return a localized 422 error before capture. The buyer can restart checkout and select a valid address in PayPal. The status page reads GET /api/orders/:id; its retry button safely retries the same order after a timeout.
5. POST /paypal/webhook verifies signatures through PayPal's verification API, retrieves authoritative order details and reconciles payment. CHECKOUT.ORDER.APPROVED also triggers capture if the browser closed after approval. Invalid signatures return 401; processing/storage errors return 500 so PayPal can retry.

A success-page URL alone is never payment confirmation. Status endpoints return only the order reference, status and amount, and require the per-order token. Existing legacy orders and payment references remain untouched. No email sending or automatic fulfillment is implemented. Refunds and disputes are handled in the merchant dashboard; this version does not synchronize refund/dispute states.

## Product and promotions

PRICE_EUR defaults to 19.90. SINGLE_DECK_SHIPPING_EUR defaults to 3.90; shipping is free for two or more decks in the same order. The old flat SHIPPING_EUR setting is no longer used, so a legacy SHIPPING_EUR=0 cannot silently override the new quantity-based policy. Prices must be valid non-negative EUR amounts (product at least EUR 1). PRODUCT_NAME controls the product label. POST /api/quote previews prices without creating orders or consuming promotions.

The backoffice **Promo codes** section imports from a private Google Sheet: save the connection, **Update from Google Sheets**, review, then **Apply changes to checkout**. Changes apply immediately without redeployment. Invalid/unavailable sheets leave the active list unchanged. Missing codes are disabled and paid-use counts preserved. See [GOOGLE-SHEETS-PROMOS.md](GOOGLE-SHEETS-PROMOS.md) for the template, service-account setup, backups and recovery.

Before the first applied import, promo-codes.json supplies the seed list; thereafter persistent storage takes precedence. Expiry dates end at 23:59:59.999 UTC. Promo usage increments once on confirmed payment. maxUses is checked when creating an order, without reserving capacity for pending payments; simultaneous pending checkouts can exceed that limit. It is not a hard stock/quota mechanism.

## Storage

Keep DATA_DIR outside the deployment directory and preserve orders.json and promo-uses.json. Empty defaults to landing-test/data; relative paths start at server.js. The server refuses an unusable directory. File storage supports one Node.js process only. Writes use temporary files and rename; payment-journal.json recovers an interrupted paid-order/promo update at startup or the next access. Preserve all three files together when backing up or migrating. Invalid JSON raises an error instead of overwriting historical data.

Optional Redis takes precedence via UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL / KV_REST_API_TOKEN. It uses the existing order: and promo: keys. A Lua operation updates paid status and promo usage together. Use Redis for multiple processes/instances. There is no automatic migration.

## Verification

npm test uses fake PayPal and Redis servers and a simulated SDK/DOM callback flow. It checks server totals, access tokens, mismatch rejection, pending/denied captures, approval webhooks, duplicate events, lost capture responses, transient Redis errors, persistence, journal recovery and closed checkout with missing settings. It does not prove live PayPal eligibility, real webhook delivery or browser/device compatibility.

See DEPLOIEMENT-HOSTINGER.md for credentials, webhook setup and the real-account test checklist.

## Order backoffice

Open `/backoffice/`. Set `ADMIN_PASSWORD` to a unique random password (minimum 16 characters) in Hostinger environment variables, then restart/redeploy. Do not put the password in this repository or chat. Without this setting the admin API is closed. Production requires HTTPS; the session cookie is Secure, HttpOnly and SameSite=Strict.

The backoffice supports search, payment/fulfillment/type/archive filters, recipient details, tracking, internal notes, archive/unarchive and CSV export of all matching orders. It initially shows paid active orders. Counts and totals follow the filters and include test orders unless filtered out. Pending attempts remain visible under All payments or Pending. Payment status cannot be edited, deleted or refunded from this page, and only paid orders can be packed or shipped.

Existing orders do not identify their sandbox/live environment reliably. New PayPal orders store `paypalEnv`. Use the separate Test / Real / Unclassified order type to organize older records after checking PayPal. This label never changes or confirms payment. No shipment booking or customer notification is performed.

Management data is kept separately in `<DATA_DIR>/order-management.json`, without rewriting original orders. Sessions are stored in `admin-sessions.json` using hashed session identifiers; sessions expire after eight hours. Logout revokes the session, and changing ADMIN_PASSWORD invalidates existing sessions. After 10 failed logins from the same server-observed IP, login is blocked for 15 minutes; counters are local to each Node.js process and reset on restart.

Redis uses `order-admin:<id>` and `admin-session:<hash>` keys; it lists historical `order:*` records via SCAN/MGET. The backoffice currently supports up to 10,000 Redis order records; larger datasets need indexed storage before using this backoffice. File storage still requires exactly one Node.js process. Concurrent metadata edits use a version check: reopen an order after a conflict, rather than overwriting somebody else's work.

Back up management data along with orders, promo counters and any recovery journal while the application is stopped. Sessions need not be preserved when restoring a backup. Keep all these files outside `public/` and `public_html`. There is no public orders JSON download. Only authenticated admins can export customer details as CSV; exports omit checkout token hashes and escape spreadsheet formulas.

Automated tests include admin authentication, CSRF protection, login limits, session expiration/revocation, metadata persistence and edit conflicts, CSV safety, legacy and Redis records, and a simulated browser login/edit flow. The layout and save flow were also checked in a local browser with invented orders.

Official references:
- https://developer.paypal.com/studio/checkout/standard/integrate
- https://developer.paypal.com/api/orders/v2
- https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post

## PayPal-first recipient collection

The old left-hand personal-details form is removed. PayPal is configured with GET_FROM_FILE so it collects/confirms the delivery address. The site explains that the parcel will go to that address. We do not treat a card billing address as the delivery address unless PayPal returns it as the confirmed shipping address.

Only whitelisted fields from the authenticated PayPal order response are saved: recipient name, street/address lines, postcode, city, state/region, country, and available email. Card details and complete raw PayPal responses are not stored. A customer object supplied by the browser is ignored. The dedicated deliveryPhone field is the exception: new orders require an international number starting with +, 8–15 digits total with a nonzero first digit; spaces, parentheses, dots and hyphens are removed before storage. This is format validation, not proof the number exists or belongs to the buyer. It is used only for contacting the buyer about order delivery. The stored checkout deliveryPhone always takes precedence over optional PayPal phone data on browser captures, webhooks and retries, and appears in the backoffice and order emails. Historical orders without that field retain PayPal phone fallback and remain readable/capturable. Email still prefers shipping contacts, then PayPal payer/account contacts, and can be absent. PayPal's Contact Module is documented as US-only, so the Taiwanese merchant integration does not depend on UPDATE_CONTACT_INFO.

Complete name, street, city, postcode and a supported European country are mandatory before our capture call. These checks also apply to CHECKOUT.ORDER.APPROVED webhooks. Existing orders remain readable. New pending orders show Awaiting PayPal details until the buyer supplies them. Delivery updates patch the existing order atomically in Redis (or synchronously with file storage), preserving concurrent paid status and separate backoffice metadata.

If PayPal has already completed a capture externally, the server records the financial truth even when delivery details are missing, flags deliveryStatus=needs_attention and blocks packing/shipping until reviewed. It does not hide a real charge or ask the buyer to pay again. The confirmation page reports that delivery needs review. A recipient verified immediately before our capture can be retained if the subsequent PayPal response omits shipping.

After deploying, test BOTH a sandbox PayPal-account buyer and a guest card buyer on the actual Taiwanese merchant app. Confirm the exact returned name/address and available contacts in the backoffice, quantity/discount/total, cancellation, country rejection and webhook redelivery. Local fake API/SDK tests cannot establish which fields a real PayPal guest flow will return.

Contact-module availability reference: https://developer.paypal.com/platforms/checkout/standard/customize/contact-module/

## Legal page and footer

The footer links to /legal.html under Legal & Terms (法律與條款 in Chinese). The source legal content was supplied in English in Legal Notes (website).docx. Company ID/address/contact are taken from that document. The owner confirmed 36 cards, EUR 3.90 shipping for one deck, free shipping for two or more, and Apple Pay/Google Pay availability within PayPal where offered. The legal page retains the supplied unused/fully-packaged return condition and 14-day damaged-item reporting clauses at the owner's explicit request for separate legal review; this work is not legal validation of those clauses.

Internal draft instructions and unsupported claims about automatic confirmation/tracking emails were omitted. Email notifications are explicitly deferred to the next task; no email-sending code is added. The legal page uses current server pricing when available and falls back to the supplied EUR 19.90 / EUR 3.90 defaults on static hosting. Contact links use play@wanwanplay.com.

## Paid-order email notifications

New paid orders send a buyer confirmation (checkout language: English / Traditional Chinese) and a team alert via Hostinger SMTP once configured. Default sender and team recipient: play@wanwanplay.com. Messages include quantity, promo, prices and delivery address. SMTP delivery runs independently of payment and is tracked in the order details backoffice, with safe failed-send retries. Historical orders are not emailed automatically. Sandbox sending is off by default; when enabled, both test emails go to the team mailbox by default. MAIL_SANDBOX_BUYER_ENABLED=true additionally opts in to sending the sandbox buyer copy to the customer email returned by PayPal. See [ORDER-EMAILS.md](ORDER-EMAILS.md) for environment variables, testing, persistent notification backups and the limits of SMTP duplicate protection.
