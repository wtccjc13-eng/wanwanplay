# Hostinger — PayPal setup

Existing app: https://wanwanplay.com. Repository wtccjc13-eng/wanwanplay, branch feature/airwallex-checkout (historical name retained). Keep main unchanged. Use Node.js 22, Express, root landing-test, entry server.js, npm installation and no build step.

## 1. PayPal Business app

Sign into https://developer.paypal.com/dashboard/ with the Taiwanese company Business account. In Apps & Credentials, select Sandbox and create a merchant app called WanWan Play linked to the sandbox Business seller. Keep the sandbox personal buyer separate from the seller.

Obtain the app Client ID and Secret. Find the seller Merchant ID in Account Settings > Business information on sandbox.paypal.com. For production use the actual company's Business account on paypal.com and a Live app; do not mix sandbox and live values.

Official Merchant ID instructions: https://www.paypal.com/us/cshelp/article/how-do-i-find-my-secure-merchant-id-on-my-paypal-account-help538

## 2. Register the webhook

Inside the matching Sandbox app's webhook settings, add:

https://wanwanplay.com/paypal/webhook

Subscribe to these four events:
- CHECKOUT.ORDER.APPROVED
- PAYMENT.CAPTURE.COMPLETED
- PAYMENT.CAPTURE.PENDING
- PAYMENT.CAPTURE.DENIED

Copy the generated Webhook ID. This is the ID of the registration, not an invented signing secret. Our server asks PayPal to verify each event against this ID. The endpoint may return 503 until all settings are entered and the app is redeployed.

## 3. Hostinger variables

Open the existing wanwanplay.com Node.js application in hPanel, then Environment Variables. Add these individually; preserve all unrelated variables and secrets:

| Variable | Sandbox value | Production value |
| --- | --- | --- |
| PAYPAL_ENV | sandbox | live |
| PAYPAL_CLIENT_ID | Sandbox app Client ID | Live app Client ID |
| PAYPAL_CLIENT_SECRET | Sandbox app Secret | Live app Secret |
| PAYPAL_WEBHOOK_ID | Sandbox registration ID | Live registration ID |
| PAYPAL_MERCHANT_ID | Sandbox Business seller Merchant ID | Taiwanese company Merchant ID |

Keep BASE_URL=https://wanwanplay.com, NODE_ENV=production and existing price/product settings. Keep DATA_DIR and existing Redis settings unchanged. DATA_DIR must stay persistent and outside the deployed site. Never paste secrets into GitHub, commits, chat or logs. Do not configure PAYPAL_TEST_API_BASE on Hostinger; it is accepted only by local tests in NODE_ENV=test.

The extra Merchant ID check ensures the payment recipient matches the intended company. All five PayPal settings are required. Redeploy or restart after variable changes. No credentials are supplied by this repository.

## 4. Deploy and test sandbox

1. Back up existing data (including payment-journal.json if present); keep the same storage location. File storage requires one Node.js process. Use Redis for multiple instances.
2. Redeploy the latest feature branch in the existing app. Auto-deploy may already have started on push.
3. Check /api/config for provider paypal, checkoutReady true and paypalEnv sandbox. No secret should appear. The site must show a sandbox banner and PayPal buttons. With any required setting missing, checkout must remain closed.
4. In a real browser, try Chinese and English, mobile and desktop, valid/invalid shipping details, quantity changes, TEST10 and cancellation before approval. Use a sandbox buyer, never a real card in sandbox.
5. Complete a sandbox purchase. Check PayPal transaction details and the saved order's paid status, exact amount, Merchant ID and paypalCaptureId. Confirm the promo counter increased once, including after webhook redelivery and page refresh. Verify actual webhook delivery in PayPal's event dashboard. A simulator event is not a real purchase.
6. Test a pending/failed payment where supported and retry after an interrupted browser connection. The status page must not claim paid until the server confirms capture. Preserve the same order when retrying.
7. Confirm persisted orders and promo counters survive a redeploy. Check eligible guest-card checkout using your actual merchant account; do not promise cards, Apple Pay or Google Pay that PayPal does not display.

Automated tests use local fake services. Real sandbox SDK, account eligibility and real delivery still need the checks above.

## 5. Switch live

After sandbox validation, create/select the company's Live app, register the same webhook URL in Live with the same four events, and replace ALL five variables with matching Live values (PAYPAL_ENV=live). Redeploy, make an agreed real purchase, check actual capture/webhook/order status and refund it through PayPal. Never mark an order paid from a browser return alone. Refund/dispute synchronization, confirmation emails and fulfillment automation are not part of this integration.

## Retired provider

AIRWALLEX_* settings are unused and may be removed individually. The old webhook and simulated payments remain 404. Reconcile any old outstanding transactions before disabling the former webhook and revoking credentials. Preserve historical payment references for refunds/disputes. The old Apple merchant association file remains removed; any future wallet integration may require its own verification.

## Enable the order backoffice

1. In the existing application's Environment Variables, add `ADMIN_PASSWORD`. Generate a unique random password using a password manager, with at least 16 characters (24 or more recommended). Do not paste it into chat or GitHub. Keep all PayPal/storage variables unchanged.
2. Redeploy the latest feature branch or restart after changing variables. Production must use HTTPS; the cookie is intentionally not sent over plain HTTP.
3. Open https://wanwanplay.com/backoffice/ and sign in with that password. You should see paid active orders first. Select All payments or Pending to inspect incomplete attempts.
4. Open an order to see the recipient, address, contact information, amount and payment references. Set fulfillment, carrier, tracking, internal notes or archive state and save. These actions do not change payment status or send customer emails.
5. Mark sandbox attempts as Test orders after checking them. Existing records may show Environment unknown; the integration did not store the environment on older orders. New orders record it automatically. A sandbox paid order is not a real sale.
6. Refresh the page to confirm the saved changes remain. Use Export CSV to download all matching orders, including customer shipping details. Keep downloads private.

The backoffice reads existing orders automatically; there is no JSON upload/import or manual file editing. Its private fulfillment/notes file is `order-management.json` inside DATA_DIR. For Redis, separate keys store management and shared sessions. Do not copy any of these files into the public website folder. See README.md for session expiry, login limits, backup and concurrency details.
