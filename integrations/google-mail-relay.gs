// Deploy as a web app executing as the owner, accessible to Anyone.
// Set MAIL_RELAY_SECRET (32+ random characters) in Script Properties.
// The matching secret stays only in Render's environment variables.
function doPost(e) {
  var lock;
  try {
    if (!e || !e.postData || e.postData.contents.length > 12000) throw Error('Invalid request');
    var envelope = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('MAIL_RELAY_SECRET');
    if (!secret || secret.length < 32 || typeof envelope.payload !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.signature || '')) throw Error('Unauthorized');
    var expected = Utilities.computeHmacSha256Signature(envelope.payload, secret, Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    var mismatch = 0;
    for (var i = 0; i < 64; i++) mismatch |= expected.charCodeAt(i) ^ envelope.signature.charCodeAt(i);
    if (mismatch) throw Error('Unauthorized');
    var message = JSON.parse(envelope.payload);
    if (!Number.isSafeInteger(message.timestamp) || Math.abs(Date.now() - message.timestamp) > 300000 || !/^[a-f0-9]{32}$/.test(message.nonce || '')) throw Error('Expired');
    if (typeof message.to !== 'string' || message.to.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(message.to)) throw Error('Invalid recipient');
    if (['Reset your TrustBuilder password', 'Your TrustBuilder password was changed'].indexOf(message.subject) < 0 || typeof message.textContent !== 'string' || message.textContent.length > 4000) throw Error('Invalid message');
    // Only permit links to this deployment, including the single-use reset token.
    var links = message.textContent.match(/https?:\/\/\S+/g) || [];
    if (links.some(function(url) { return !/^https:\/\/trustbuilder-zip-sep22\.onrender\.com\/reset-password\.html#token=[a-f0-9]{64}$/.test(url); })) throw Error('Invalid link');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) throw Error('Busy');
    var cache = CacheService.getScriptCache();
    var key = 'sent:' + message.nonce;
    if (cache.get(key)) return relayResult(true);
    if (MailApp.getRemainingDailyQuota() < 1) throw Error('Quota exhausted');
    MailApp.sendEmail({ to: message.to, subject: message.subject, body: message.textContent, name: 'TrustBuilder' });
    cache.put(key, '1', 600);
    return relayResult(true);
  } catch (_) {
    // Never log email addresses, reset tokens, payloads, or secrets.
    return relayResult(false);
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function relayResult(ok) {
  return ContentService.createTextOutput(JSON.stringify({ ok: ok })).setMimeType(ContentService.MimeType.JSON);
}
