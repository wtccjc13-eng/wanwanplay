# WanWanPlay

The production Node.js site is in landing-test/. Hostinger deploys feature/airwallex-checkout (historical branch name), Express on Node.js 22, root landing-test, entry server.js.

**PayPal checkout is implemented and stays closed until all required PayPal settings are configured.** The former payment integration and simulated payment routes remain removed. Product pages, language selection, price previews and promo validation are preserved.

Keep the existing persistent DATA_DIR or optional Redis configuration. Preserve existing orders and promo counters. See landing-test/README.md and landing-test/DEPLOIEMENT-HOSTINGER.md for setup, verification and retiring the former payment account.

For local preview run npm ci, npm start and npm test inside landing-test/.

An order backoffice is available at `/backoffice/` after configuring `ADMIN_PASSWORD` (a unique random password of at least 16 characters) in Hostinger. It provides protected recipient details, filters, fulfillment notes/tracking, archiving and CSV export. Existing orders are read automatically; payment records remain separate from management edits. See the deployment guide before enabling it.

The previous static website remains in dist/. Do not merge this deployment branch into main as part of the removal. Static-only hosting does not provide the pricing and promo APIs.
