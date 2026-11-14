# Paid-order emails through Hostinger Email

New PayPal orders created by this version are marked for two notifications after verified completed payment: a buyer confirmation and a team alert. English / Traditional Chinese buyer copy follows checkout language; team alerts are in English. Both include quantity, discount, shipping, total and delivery details. Buyer messages are confirmations, not invoices or shipping confirmations. Reply-To is the sender mailbox. The team message links to the authenticated backoffice without a login token.

## Hostinger settings

Ensure `play@wanwanplay.com` is an active Hostinger Email mailbox and can send/receive through webmail. In hPanel → Emails → domain → email configuration, confirm the outgoing settings for that mailbox. For **Hostinger Email** the documented server is `smtp.hostinger.com`, SSL/TLS port **465**. Titan or another email product may have different settings: use the mailbox's actual provider settings.

In the **Node.js website's Environment Variables** (not the mailbox settings), add the following without replacing existing PayPal, admin, Google or DATA_DIR variables:

| Variable | Value |
| --- | --- |
| MAIL_ENABLED | true |
| SMTP_HOST | smtp.hostinger.com |
| SMTP_PORT | 465 |
| SMTP_USER | play@wanwanplay.com |
| SMTP_PASSWORD | The mailbox's password, entered privately in Hostinger |
| MAIL_FROM | play@wanwanplay.com |
| MAIL_TO | play@wanwanplay.com |
| MAIL_SANDBOX_ENABLED | false (or true for the isolated sandbox test below) |
| MAIL_SANDBOX_BUYER_ENABLED | false by default; true to test the buyer's actual email |

This is the mailbox password, not the hPanel account password. Never send it in chat, add it to Git or enable SMTP debug logs. SMTP uses TLS with certificate verification; port 587 is also supported with required STARTTLS. `BASE_URL` must be your HTTPS origin, normally `https://wanwanplay.com`. Deploy with `npm ci` for the new Nodemailer dependency and restart after settings changes. Changing MAIL_TO / MAIL_FROM later requires only environment-variable edits and a restart.

Check the email domain's SPF/DKIM status in Hostinger; do not overwrite existing DNS mail/verification records. An SMTP acceptance does not prove inbox delivery: check inbox/spam and the mailbox's bounce messages.

## Test before live sending

1. Keep PayPal in sandbox. Set MAIL_ENABLED=true and MAIL_SANDBOX_ENABLED=true with working SMTP settings.
2. Make a **new** sandbox order. By default both messages are labeled SANDBOX TEST and go **only to MAIL_TO**. The buyer version still uses the checkout language and order details. Expect two distinct messages at play@wanwanplay.com.
3. Within approximately 15 seconds (longer during SMTP trouble / backlog), open that paid order in the backoffice. Its **Order emails** section shows buyer/team states separately. Reopen the order to refresh.
4. Refresh the payment confirmation and redeliver the PayPal event: ordinary retries must not send another copy. Check both inbox and spam folders.
5. Set MAIL_SANDBOX_ENABLED=false after testing. Live PayPal orders send the buyer copy to the email returned by PayPal and the team copy to MAIL_TO. If PayPal returns no usable buyer email, buyer delivery is flagged and the team alert still goes out. Unknown order environments are not emailed.

To test a buyer confirmation in a separate real inbox, set **both** MAIL_SANDBOX_ENABLED=true and MAIL_SANDBOX_BUYER_ENABLED=true, then restart. Only the buyer copy goes to the customer email returned by PayPal and shown in the backoffice; the team alert still goes to MAIL_TO. There is no separate buyer email field on our website. The PayPal sandbox account/form must return a real inbox you control; an automatically generated sandbox/example address will not receive real email. A missing or invalid buyer email is flagged; the team alert can still send. Both messages retain the SANDBOX TEST label and state that no live purchase occurred.

Use a new sandbox order for this routing test. Changing routing settings does not resend an already accepted notification. An explicitly failed notification can be retried with the existing Retry failed emails button, using the current routing settings; uncertain notifications remain held. Set both sandbox flags back to false when testing is finished. Live buyer routing is unchanged.

## Reliability and operations

The worker polls every 15 seconds while the Node.js app is running. Payment confirmation does not wait for SMTP and cannot be reverted by an email failure. New eligible paid orders remain discoverable after restarts, even if the process stopped just after payment. The new-order marker prevents bulk emailing historical paid orders on rollout. No messages are scheduled for pending, failed or legacy orders.

Notification records are separate from payment and fulfillment data: `order-notifications.json` in the existing persistent DATA_DIR, or Redis keys `order-mail:<order-id>:buyer` / `:team`. Back these up with orders and promo counters. Do not delete notification records as a reset: doing so can resend emails. File storage requires one process; Redis uses atomic claims and ownership checks for multiple workers.

Each message has a stable Message-ID and an atomic claim. A successful SMTP acceptance is recorded as `sent`, labeled **Accepted by mail server** in the UI. Explicit SMTP rejection / safe connection failures retry after five minutes, up to five attempts. After fixing settings, **Retry failed emails** resets failed records only; sent/uncertain messages are untouched. Missing configuration leaves emails unsent until configured. Enabling credentials can send a backlog of new eligible paid orders.

SMTP cannot guarantee exactly-once inbox delivery. A dropped connection after DATA, or a crash between SMTP acceptance and saving its result, is ambiguous. Such messages are marked **uncertain** and not automatically retried. After a two-minute expired sending claim, another cycle marks it uncertain. Check the mailbox / provider before any separate manual follow-up. Retries of failed records do not force uncertain or sent records to resend. SMTP acceptance does not confirm inbox arrival or read status.

No real SMTP credentials or customer emails are used by automated tests. Real Hostinger authentication and inbox delivery require the sandbox test above after configuration.

References: [Hostinger Email configuration](https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/), [Nodemailer SMTP](https://nodemailer.com/smtp).
