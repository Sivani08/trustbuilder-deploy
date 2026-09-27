import { createHash, createHmac, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
export const RESET_MESSAGE = 'If an eligible account exists, a reset link will be emailed to you. Check your inbox and spam folder.';
const invalid = () => Object.assign(new Error('This reset link is invalid or has expired. Request a new link.'), { status: 400, code: 'INVALID_RESET_LINK' });

export function createResetMailer({ apiKey = process.env.BREVO_API_KEY, sender = process.env.TRUSTBUILDER_MAIL_FROM, relayUrl = process.env.TRUSTBUILDER_MAIL_RELAY_URL, relaySecret = process.env.TRUSTBUILDER_MAIL_RELAY_SECRET, fetcher = fetch } = {}) {
  if (relayUrl || relaySecret) return {
    configured: Boolean(/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(relayUrl || '') && relaySecret?.length >= 32),
    async send(to, subject, textContent) {
      const payload = JSON.stringify({ to, subject, textContent, timestamp: Date.now(), nonce: randomBytes(16).toString('hex') });
      const signature = createHmac('sha256', relaySecret).update(payload).digest('hex');
      const response = await fetcher(relayUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, signature }), signal: AbortSignal.timeout(25000)
      });
      if (!response.ok || (await response.json()).ok !== true) throw new Error('Email delivery failed');
    }
  };
  return {
    configured: Boolean(apiKey && sender),
    async send(to, subject, textContent) {
      const response = await fetcher('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { name: 'TrustBuilder', email: sender }, to: [{ email: to }], subject, textContent }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('Email delivery failed');
    }
  };
}

export function createPasswordReset({ store, mailer, origin, now = Date.now }) {
  return {
    async request(email) {
      email = String(email || '').trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
      if (!mailer.configured || !origin) throw Object.assign(new Error('Password-reset email is not available yet. Please contact your administrator.'), { status: 503, code: 'RESET_EMAIL_UNAVAILABLE' });
      const token = randomBytes(32).toString('hex');
      const account = await store.issuePasswordReset(email, hash(email), hash(token), now());
      if (account) {
        try {
          await mailer.send(account.email, 'Reset your TrustBuilder password', `A password reset was requested for your TrustBuilder account.\n\nChoose a new password using this link:\n${origin}/reset-password.html#token=${token}\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, ignore this email. Your password has not changed.`);
        } catch {
          await store.removePasswordReset(hash(token));
          // Do not reveal account existence or provider responses to the requester.
          console.error(JSON.stringify({ event: 'password_reset_email_failed' }));
        }
      }
      return { message: RESET_MESSAGE };
    },
    async complete(token, password) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalid();
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw Object.assign(new Error('Use a password with 8 to 128 characters.'), { status: 400, code: 'INVALID_PASSWORD' });
      const passwordSalt = randomBytes(16).toString('hex');
      const passwordHash = (await derive(password, passwordSalt, 64)).toString('hex');
      const account = await store.consumePasswordReset(hash(token), { passwordSalt, passwordHash }, now());
      if (!account) throw invalid();
      try { await mailer.send(account.email, 'Your TrustBuilder password was changed', 'Your TrustBuilder password was successfully changed. Existing login sessions have been signed out. If you did not make this change, contact your administrator immediately.'); }
      catch { console.error(JSON.stringify({ event: 'password_change_notification_failed' })); }
      return { message: 'Password changed. You can now sign in with your new password.' };
    }
  };
}
