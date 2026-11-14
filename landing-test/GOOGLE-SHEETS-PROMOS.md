# Private Google Sheets promo codes

## Create your sheet

Create **WanWan Play Promo Codes** in Google Drive. Name the worksheet tab **Promos**. Paste the following into cell A1 (tab-separated), or use the backoffice template download:

```tsv
code	type	value	max_uses	expires	active	partner
WANWAN10	percent	10	100	2027-12-31	TRUE	WanWan
CREATOR5	amount_eur	5	50	2027-12-31	FALSE	Creator name
```

- `code`: unique, case-insensitive, 2–40 letters/digits/hyphens/underscores. Stored uppercase. Keep the same code to preserve lifetime usage; renaming creates a new code/counter.
- `type`: `percent` or `amount_eur`.
- `value`: number, no currency/percent symbols, up to two decimals. Percent: greater than 0, at most 100. Fixed amount: greater than 0, at most EUR 10,000. Discounts affect games, not shipping; the existing EUR 1 product minimum remains.
- `max_uses`: positive whole number, or blank for unlimited. Checked at order creation, not a reservation: simultaneous pending payments can exceed the limit.
- `expires`: set the column to **Plain text**, enter `YYYY-MM-DD`, or leave blank. Codes expire at the end of that date in UTC. Avoid locale-dependent date formats.
- `active`: `TRUE` or `FALSE`; Google Sheets checkboxes also work.
- `partner`: optional internal partner/creator label, up to 100 characters. No customer data.

Keep these exact seven headers in row 1. Maximum 1,000 data rows, no extra data columns. Include every code you want enabled. Missing codes are retained as disabled. To disable all codes, retain rows and set active to FALSE; empty sheets are rejected. Usage counts are never imported. A limit below the existing paid-use count makes a code exhausted immediately.

## Connect the private sheet

A link shared in chat identifies the sheet but does not grant the server access. Do **not** publish the sheet or enable Anyone with the link.

1. In your Google Cloud project, enable **Google Sheets API**.
2. Create a service account; no project IAM role or domain-wide delegation is needed for this feature.
3. Create a JSON key for it. Keep it private and outside the repository.
4. In Hostinger's Node.js application Environment Variables, enter `client_email` as `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key` as `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`. Real newlines or literal `\n` sequences are accepted. Never paste the private key into chat, GitHub, logs or the backoffice. Restart/redeploy after environment-variable changes.
5. In Google Sheets → Share, add that service account email as **Viewer**. The app uses only `spreadsheets.readonly`, never writes to Google Sheets and sends no order/customer data to Google.
6. In `/backoffice/` → **Promo codes**, paste the sheet link, keep tab name **Promos**, and **Save connection**. This saves settings only; it does not test Google access or change active codes.

## Import when ready

1. Edit the sheet, then click **Update from Google Sheets** in the backoffice.
2. Review added, updated, enabled, disabled and unchanged codes, including before/after values and paid-use counts. Invalid rows or access failures leave active codes unchanged.
3. Click **Apply changes to checkout**. New quotes/orders use the list immediately, without redeployment. Existing checkout attempts retain their quoted amounts.

Previews expire after 15 minutes and belong to the signed-in session. Apply uses the fetched snapshot, not later sheet edits; fetch again after editing. Another window's saved connection/catalog changes invalidate old previews. There is no scheduled sync. Payments arriving between preview and apply retain their updated usage counts. The readiness indicator checks configuration presence; fetching tests actual access.

## Storage, backup and recovery

Before the first applied import, `promo-codes.json` supplies the seed list. Thereafter persistent storage takes precedence, including after redeployment. Back up `promo-state.json` and `promo-config.json` with existing orders, usage counts, management data and recovery journal in **DATA_DIR**, outside the deployed/public folder. Stop the single-process file-backed app while backing up/restoring. `promo-previews.json` and admin sessions are short-lived and need not be restored.

To undo an unintended valid import, fix the sheet and import again or restore a known-good catalog backup. Do not routinely delete the catalog: that would re-enable the seed definitions.

Redis stores catalog/config at `wanwan:promos:state` / `wanwan:promos:config`; previews use `wanwan:promo-preview:<hash>` with 15-minute TTL. Atomic revision checks prevent stale overwrites. Existing `promo:<code>` counters stay unchanged. No automatic file/Redis migration. File storage still requires one Node.js process; use Redis for multiple processes.

Deploy with `npm ci`. Tests use fake sources; real Google access must be tested once the private sheet and Hostinger credentials are configured.
