# WanWanPlay

The production Node.js site is in landing-test/. Hostinger deploys feature/airwallex-checkout (historical branch name), Express on Node.js 22, root landing-test, entry server.js.

**Online checkout is temporarily unavailable.** The former payment integration and simulated payment routes have been removed. PayPal is planned separately. Product pages, language selection, price previews and promo validation remain available.

Keep the existing persistent DATA_DIR or optional Redis configuration. Preserve existing orders and promo counters. See landing-test/README.md and landing-test/DEPLOIEMENT-HOSTINGER.md for setup, verification and retiring the former payment account.

For local preview run npm ci, npm start and npm test inside landing-test/.

The previous static website remains in dist/. Do not merge this deployment branch into main as part of the removal. Static-only hosting does not provide the pricing and promo APIs.
