const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const helpers = source.slice(source.indexOf('function responseSaveError('), source.indexOf('async function completeLegacyEvaluation('));
function setup(session = null) {
  const messages = [], sends = [], starts = [];
  const button = {disabled:false, textContent:'Submit response'};
  const state = {decision:'Validate before responding', response:'The main barriers may be poor workflow integration and low trust in analytics.', mode:'HUNT', stage:'response', conversationSession:session, openingAudioRef:{localId:'recorded-audio',localOnly:true}};
  let n=0;
  const context = {TypeError,state,conversationRequestInFlight:false,pendingTurnKey:null,document:{querySelector:()=>button},capture(){},save(){},render(){},toast:message=>messages.push(message),scenarioRecord:()=>({id:'current'}),activeScenarioModel:()=>null,analysis:{evaluateResponse:()=>({evidence:[]})},syncConversationSession:s=>{state.conversationSession=s;},refreshProfile:async()=>{},services:{id:()=>`key-${++n}`,startConversation:async input=>{starts.push(input);return {session:{id:'new',scenarioId:'current',status:'waiting_for_user'}};},respond:async input=>{sends.push(input);return {session:{id:input.sessionId,scenarioId:'current',status:'waiting_for_user'},evaluation:{accepted:true}};}}};
  vm.runInNewContext(helpers,context);
  return {context,state,messages,sends,starts,button,submit:()=>context.submitOpeningResponse()};
}
test('opening response starts a fresh session after completion or scenario change',async()=>{
  for(const session of [{id:'old',scenarioId:'current',status:'completed'},{id:'old',scenarioId:'other',status:'waiting_for_user'},null]) {
    const s=setup(session);await s.submit();assert.equal(s.starts.length,1);assert.equal(s.sends[0].sessionId,'new');assert.equal(s.state.stage,'evidence');assert.equal(s.sends[0].audioReference.localId,'recorded-audio');
  }
});
test('server-side stale session recovers once without losing the answer',async()=>{
  for(const code of ['SESSION_COMPLETED','SESSION_NOT_FOUND']) {
    const s=setup({id:'old',scenarioId:'current',status:'waiting_for_user'}),send=s.context.services.respond;
    s.context.services.respond=async input=>{if(input.sessionId==='old')throw Object.assign(new Error('Stale session'),{code});return send(input);};
    await s.submit();assert.equal(s.starts.length,1);assert.equal(s.state.stage,'evidence');assert.equal(s.sends[0].originalResponse,s.state.response);
  }
});
test('successful response is retained when profile refresh fails',async()=>{
  const s=setup();s.context.refreshProfile=async()=>{throw new Error('Profile unavailable');};await s.submit();
  assert.equal(s.state.stage,'evidence');assert.equal(s.sends.length,1);assert.match(s.messages.at(-1),/Response saved/);assert.equal(s.button.disabled,false);
});
test('network retry reuses request key and preserves text and audio',async()=>{
  const s=setup(),send=s.context.services.respond,keys=[];
  s.context.services.respond=async input=>{keys.push(input.idempotencyKey);if(keys.length===1)throw new TypeError('Failed to fetch');return send(input);};
  await s.submit();assert.equal(s.state.stage,'response');assert.match(s.messages.at(-1),/Connection interrupted/);assert.equal(s.state.openingAudioRef.localId,'recorded-audio');
  await s.submit();assert.equal(keys[0],keys[1]);assert.equal(s.state.stage,'evidence');assert.equal(s.starts.length,1);
});
test('authorization error is actionable and never creates another session',async()=>{
  const s=setup({id:'existing',scenarioId:'current',status:'waiting_for_user'});
  s.context.services.respond=async()=>{throw Object.assign(new Error('Unauthorized'),{status:401});};await s.submit();
  assert.match(s.messages.at(-1),/sign-in expired/);assert.equal(s.starts.length,0);assert.equal(s.state.stage,'response');assert.equal(s.button.disabled,false);
});
test('double click only submits once and releases the button',async()=>{
  const s=setup(),send=s.context.services.respond;let release;
  s.context.services.respond=async input=>{await new Promise(resolve=>release=resolve);return send(input);};
  const first=s.submit();await new Promise(resolve=>setImmediate(resolve));await s.submit();release();await first;
  assert.equal(s.starts.length,1);assert.equal(s.sends.length,1);assert.equal(s.button.disabled,false);
});
