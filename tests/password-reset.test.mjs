import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createHash, scryptSync } from 'node:crypto';
import { PostgresStore } from '../server/postgres-store.mjs';
import { createPasswordReset, createResetMailer, RESET_MESSAGE } from '../server/password-reset.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
let db, store, flow, messages, clock;
test.beforeEach(async () => {
  db = new PGlite();
  store = new PostgresStore({ connectionString: '', seed: () => ({ users: ['participant','facilitator','administrator'].map(role => ({ id: role, email: `${role}@example.com`, role, status: 'active', passwordSalt: 'old-salt', passwordHash: scryptSync('old-password','old-salt',64).toString('hex') })) }) });
  store.pool = { query: (...args) => db.query(...args), connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
  await store.initialize();
  clock = Date.now(); messages = [];
  flow = createPasswordReset({ store, origin: 'https://trustbuilder.example', now: () => clock, mailer: { configured: true, send: async (...message) => messages.push(message) } });
});
test.afterEach(async () => db.close());
const lastToken = () => messages.at(-1)[2].match(/#token=([a-f0-9]{64})/)[1];

for (const role of ['participant','facilitator']) test(`${role}: emailed token changes only this account and revokes sessions`, async () => {
  const before = await store.read();
  await store.saveSession(hash('session'), role, clock + 3600000, before.users.find(u => u.id === role).passwordHash);
  assert.equal((await flow.request(` ${role.toUpperCase()}@EXAMPLE.COM `)).message, RESET_MESSAGE);
  const token = lastToken();
  const saved = await db.query('SELECT * FROM trustbuilder_password_resets');
  assert.equal(saved.rows[0].token_hash, hash(token));
  assert(!JSON.stringify(saved.rows).includes(token));
  await flow.complete(token, 'replacement-password');
  const after = await store.read(); const user = after.users.find(u => u.id === role);
  assert.equal(user.passwordHash, scryptSync('replacement-password',user.passwordSalt,64).toString('hex'));
  assert.notEqual(user.passwordHash, scryptSync('old-password',user.passwordSalt,64).toString('hex'));
  assert.equal(user.role, role);
  assert.equal(await store.findSession(hash('session')), null);
  assert.deepEqual(after.users.filter(u => u.id !== role), before.users.filter(u => u.id !== role));
  assert.equal(messages.at(-1)[1], 'Your TrustBuilder password was changed');
  await assert.rejects(flow.complete(token, 'another-password'), { code: 'INVALID_RESET_LINK' });
  await store.write(before);
  assert.equal((await store.read()).users.find(u => u.id === role).passwordHash, user.passwordHash, 'stale assessment writes cannot revert a password');
  await assert.rejects(store.saveSession(hash('racing-session'), role, clock + 3600000, before.users.find(u => u.id === role).passwordHash), { code: 'INVALID_CREDENTIALS' });
});
test('unknown, inactive and administrator accounts do not leak eligibility', async () => {
  await store.transaction(data => { data.users.find(u => u.id === 'facilitator').status = 'inactive'; });
  for (const email of ['unknown@example.com','administrator@example.com','facilitator@example.com']) assert.deepEqual(await flow.request(email), { message: RESET_MESSAGE });
  assert.equal(messages.length, 0);
});
test('expiry, replacement, rate limits and invalid passwords', async () => {
  await flow.request('participant@example.com'); const original = lastToken();
  await flow.request('participant@example.com'); assert.equal(messages.length, 1);
  await assert.rejects(flow.complete(original, 'short'), { code: 'INVALID_PASSWORD' });
  clock += 900001;
  await flow.request('participant@example.com'); const replacement = lastToken();
  await assert.rejects(flow.complete(original, 'long-enough-password'), { code: 'INVALID_RESET_LINK' });
  clock += 1800001;
  await assert.rejects(flow.complete(replacement, 'long-enough-password'), { code: 'INVALID_RESET_LINK' });
  await assert.rejects(flow.complete('invalid', 'long-enough-password'), { code: 'INVALID_RESET_LINK' });
});
test('email failures invalidate unsent tokens and missing configuration is explicit', async () => {
  const unavailable = createPasswordReset({ store, origin:'https://example.com', mailer: { configured:false } });
  await assert.rejects(unavailable.request('participant@example.com'), { code:'RESET_EMAIL_UNAVAILABLE' });
  const failing = createPasswordReset({ store, origin:'https://example.com', mailer: { configured:true, send:async () => { throw Error('failure'); } } });
  assert.deepEqual(await failing.request('participant@example.com'), { message: RESET_MESSAGE });
  assert.equal((await db.query('SELECT * FROM trustbuilder_password_resets')).rows.length,0);
});
test('mailer sends through HTTPS with credentials outside the message body', async () => {
  const mailer = createResetMailer({ apiKey:'test-secret', sender:'sender@example.com', fetcher:async (url,opts) => {
    assert.equal(url,'https://api.brevo.com/v3/smtp/email');
    assert.equal(opts.headers['api-key'],'test-secret');
    assert(!opts.body.includes('test-secret'));
    assert.deepEqual(JSON.parse(opts.body).to,[{email:'participant@example.com'}]);
    return {ok:true};
  } });
  await mailer.send('participant@example.com','Reset','Link');
});
