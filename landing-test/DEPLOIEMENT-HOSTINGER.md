# Hostinger deployment — checkout disabled

Existing application: https://wanwanplay.com. Repository: wtccjc13-eng/wanwanplay. Branch: feature/airwallex-checkout (historical name retained). Do not merge into main.

## Redeploy

1. Back up existing data. Keep the same persistent DATA_DIR outside the deployed site and the same Redis configuration if used. Do not delete orders or promo counters.
2. Redeploy the latest branch in the existing hPanel Node.js application. Keep Node.js 22, Express, root landing-test, entry server.js, npm installation and no build step.
3. Keep BASE_URL=https://wanwanplay.com, NODE_ENV=production and existing product/pricing settings.
4. Check Chinese and English pages, images, quantities and promo previews. The banner and disabled button must show that checkout is unavailable.
5. Check /api/config: provider none, checkoutReady false, simulation false. POST /api/checkout must return 503 PAYMENT_UNAVAILABLE. Former callbacks and simulation endpoints must return 404.

This version has no payment provider. PayPal is a separate upcoming integration. Do not advertise cards or mobile wallets before validating that integration.

## Retire Airwallex

The code no longer reads any AIRWALLEX_* variables. Credentials left in hPanel cannot activate payments. Remove those variables individually in hPanel, preserving all other variables and secrets. Do not replace the complete environment-variable set.

The /airwallex/webhook endpoint is removed and returns 404 after deployment. Reconcile outstanding transactions against retained orders before disabling the webhook in the merchant account. Late transactions require manual reconciliation. Once reconciled, disable the webhook and revoke API credentials. Keep access to transaction history for refunds and disputes.

The Apple merchant verification file supplied for the former provider is removed. A future wallet integration may require its own file.

## Local verification

Run npm ci and npm test in landing-test. Tests cover blocked checkout and former endpoints, pricing and promotions, unchanged existing data after restart, and read-only Redis promo access. No merchant credentials or real payments are used.
