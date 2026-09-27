import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHmac } from 'node:crypto';
import { createResetMailer } from '../server/password-reset.mjs';

const secret = 'test-only-secret-with-at-least-32-characters';
const url = 'https://script.google.com/macros/s/test-deployment/exec';
const source = readFileSync(new URL('../integrations/google-mail-relay.gs', import.meta.url), 'utf8');
function harness() {
  const sent = [], cache = new Map(); let quota = 100;
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => secret }) },
    Utilities: { Charset: { UTF_8: 'utf8' }, computeHmacSha256Signature: (data,key) => [...createHmac('sha256',key).update(data).digest()] },
    LockService: { getScriptLock: () => ({tryLock: () => true, hasLock: () => true, releaseLock() {}}) },
    CacheService: { getScriptCache: () => ({get: key => cache.get(key), put: (key,value) => cache.set(key,value)}) },
    MailApp: {getRemainingDailyQuota: () => quota, sendEmail: message => {sent.push(message); quota--;}},
    ContentService: {MimeType: {JSON:'json'}, createTextOutput: text => ({setMimeType: () => JSON.parse(text)})}
  });
  vm.runInContext(source,context);
  const call = envelope => context.doPost({postData:{contents:JSON.stringify(envelope)}});
  return {sent,call,setQuota: value => {quota=value;}};
}
const envelope = message => {const payload=JSON.stringify(message); return {payload,signature:createHmac('sha256',secret).update(payload).digest('hex')};};
const message = () => ({to:'recipient@example.com',subject:'Reset your TrustBuilder password',textContent:'https://trustbuilder-zip-sep22.onrender.com/reset-password.html#token='+'a'.repeat(64),timestamp:Date.now(),nonce:'b'.repeat(32)});

test('Render adapter and Google relay interoperate; retries do not duplicate mail',async () => {
  const h=harness(); let body;
  const mailer=createResetMailer({relayUrl:url,relaySecret:secret,fetcher:async(target,options)=>{
    assert.equal(target,url); assert(!options.body.includes(secret)); body=JSON.parse(options.body);
    return {ok:true,json:async()=>h.call(body)};
  }});
  assert.equal(mailer.configured,true);
  await mailer.send(message().to,message().subject,message().textContent);
  assert.equal(h.sent.length,1);
  assert.equal(h.call(body).ok,true); assert.equal(h.sent.length,1);
  const tampered=JSON.parse(body.payload); tampered.to='attacker@example.com';
  assert.equal(h.call({...body,payload:JSON.stringify(tampered)}).ok,false);
});
test('relay rejects expired, arbitrary, multi-recipient and exhausted requests',()=>{
  for(const change of [{timestamp:Date.now()-600001},{to:'a@example.com,b@example.com'},{subject:'Arbitrary spam'},{textContent:'https://evil.example/reset'},{nonce:'bad'}]) {
    const h=harness(); assert.equal(h.call(envelope({...message(),...change})).ok,false); assert.equal(h.sent.length,0);
  }
  const h=harness(); h.setQuota(0); assert.equal(h.call(envelope(message())).ok,false); assert.equal(h.sent.length,0);
});
test('relay failure and incomplete settings fail closed',async()=>{
  assert.equal(createResetMailer({relayUrl:url,relaySecret:''}).configured,false);
  assert.equal(createResetMailer({relayUrl:'https://evil.example',relaySecret:secret}).configured,false);
  const mailer=createResetMailer({relayUrl:url,relaySecret:secret,fetcher:async()=>({ok:true,json:async()=>({ok:false})})});
  await assert.rejects(mailer.send('x@example.com','Reset','Link'),/Email delivery failed/);
});
