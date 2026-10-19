# WanWanPlay

One-page static website. The page, scripts, styles, images, and original Chinese rules are in `dist/`.

## Hostinger Git deployment

Deploy the `main` branch into the website's document root (normally `public_html/`). Include the tracked `.htaccess` file at that root.

The root `.htaccess` internally serves `/` from `dist/index.html` and resolves existing build assets from `dist/`. Visitors keep the normal homepage URL. Missing files are not rewritten repeatedly. Direct `/dist/` URLs continue to work.

After redeploying, check the homepage, an animal filter, a random card draw, and the original rules PDF. If Hostinger still displays a cached 403, clear the website's Hostinger cache and reload.

## Other static hosts

Set the publish directory to `dist`. No build command or package installation is required. `.openai/hosting.json` retains the existing Sites configuration.

## Local preview

Serve `dist/` using any static HTTP server. A plain static development server does not process the Apache/LiteSpeed `.htaccess` rules used by Hostinger.
