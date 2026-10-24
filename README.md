# WanWanPlay

The current homepage is the bilingual landing page in `landing-test/public/`. The previous static website and its assets remain in `dist/`.

## Hostinger Git deployment

Deploy the `main` branch into the website's document root (normally `public_html/`). Include the tracked `.htaccess` file at that root.

The root `.htaccess` internally serves `/` from `landing-test/public/index.html` and resolves its scripts and images from `landing-test/public/`. Visitors keep the normal homepage URL. Existing build assets and direct `/dist/` URLs continue to work.

After redeploying, check the new homepage, product images, and language selector. Clear the website's Hostinger cache if the old homepage is still displayed.

This Git deployment serves the landing page as static files. Its pricing, promo, and checkout APIs require the Node.js app in `landing-test/server.js`; Apache rewrite rules do not run that server. Configure Node.js hosting before using the order flow. See `landing-test/README.md` for backend setup.

## Other static hosts

Set the publish directory to `landing-test/public`. No build command or package installation is required to display the page. `.openai/hosting.json` uses this directory as well. Checkout requires the backend described above.

## Local preview

Run `npm install` and `npm start` inside `landing-test/` to preview the full app in payment simulation mode when no payment credentials are configured. A plain static development server does not process the Apache/LiteSpeed `.htaccess` rules used by Hostinger.
