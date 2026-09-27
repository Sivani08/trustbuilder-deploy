# Password reset email

Participants and facilitators can select **Forgot your password?** on their login view, or open `/reset-password.html` directly. The email links to that page with a one-use token in the URL fragment. The browser removes the fragment immediately and sends the token only in the password-change POST body.

For free Gmail delivery, create an Apps Script project using `integrations/google-mail-relay.gs`. Set the script property `MAIL_RELAY_SECRET` to a cryptographically random secret of at least 32 characters. Deploy a versioned web app executing as the owner with access set to Anyone. The public endpoint authenticates requests using HMAC-SHA256, a five-minute timestamp window, nonce deduplication, and restricted email subjects and reset links. The script needs only the send-email scope, not inbox access.

Configure on the existing Render service, then redeploy:

- `TRUSTBUILDER_MAIL_RELAY_URL`: the deployed Google Apps Script `/exec` URL.
- `TRUSTBUILDER_MAIL_RELAY_SECRET`: the same secret as the script property. Never commit it or expose it in frontend code.
- `TRUSTBUILDER_PUBLIC_ORIGIN`: the HTTPS app origin, if `RENDER_EXTERNAL_URL` is unavailable. Never use a request-supplied host for email links.

Google personal accounts permit 100 email recipients daily via Apps Script. Reset requests and successful-change notifications both consume this quota (approximately 50 complete resets/day). Other scripts using that account share the quota. Requests that exhaust the quota fail; the app does not queue or automatically retry mail.

When either relay setting is present, Google is used exclusively and incomplete configuration fails closed. Brevo is retained only as an alternative when neither relay setting is present:

- `BREVO_API_KEY`: a Brevo transactional email API key (not an SMTP key).
- `TRUSTBUILDER_MAIL_FROM`: an email address verified as a sender in that Brevo account.

No plaintext password or token is stored in PostgreSQL. Reset tokens are SHA-256 hashed, expire in 30 minutes, and are consumed atomically with the salted-scrypt password update and session revocation. A confirmation email is sent after a successful change. Accounts retain their existing roles. Administrator accounts are deliberately excluded from this participant/facilitator flow.

To limit email abuse, requests are limited in PostgreSQL to one per normalized email per 15 minutes and 100 per application per day. Unknown emails and inactive/administrator accounts get the same response and do not receive email. Email-provider failures are logged without addresses, tokens or provider response bodies. Missing email configuration returns a visible unavailable message, never a fake delivery claim.

Before enabling for users: verify the sender, set the secrets, request a reset for a controlled participant and facilitator Gmail inbox, confirm delivery, change the password, confirm old passwords and sessions fail, and confirm links cannot be reused. Domain authentication is recommended for reliable delivery.

UI reference: the existing TrustBuilder login page owns layout, typography, colors, button and field treatments. Refero's craft-details guide informs explicit labels, password-manager autocomplete, accessible status/errors and submission states. No new visual theme is introduced.
