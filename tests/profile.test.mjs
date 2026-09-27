import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let child,base,dir;
async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'test',TRUSTBUILDER_ALLOW_LEGACY_HEADERS:'true',HOST:'127.0.0.1',PORT:'0',TRUSTBUILDER_DATA_DIR:dir,OPENAI_API_KEY:'',ENABLE_PAID_AI:'false'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(match[0]);}});child.once('error',reject);});}
async function stop(){if(child&&!child.killed){child.kill();await new Promise(resolve=>child.once('exit',resolve));}}
const headers=(user='new-user',role='participant')=>({'Content-Type':'application/json','X-TrustBuilder-User':user,'X-TrustBuilder-Role':role});
async function api(route,body,user='new-user',role='participant'){const r=await fetch(base+route,{method:body?'POST':'GET',headers:headers(user,role),body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
const answer='I understand the adoption concern for operations. I recommend we validate adoption data because the evidence is incomplete. I cannot confirm the business impact until we verify the adoption constraint. I will review the evidence and update you by Friday.';
test.before(async()=>{dir=await mkdtemp(path.join(tmpdir(),'trustbuilder-profile-test-'));await start();});
test.after(async()=>{await stop();const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('trustbuilder-profile-test-'));await rm(resolved,{recursive:true,force:true});});
test('new user → rejected → provisional → approved, ownership, durable idempotency and legacy migration',async()=>{
  const empty=(await api('/api/participants/me/profile')).body;
  assert.equal(empty.profileStatus,'none');assert.equal(empty.hasEvidence,false);assert.deepEqual(empty.responses,{total:0,accepted:0,rejected:0});assert.equal(empty.recommendedFocus,null);assert.ok(empty.capabilities.every(m=>m.score===null));
  const session=(await api('/api/conversation/start',{scenarioId:'insufficient-evidence',mode:'MINE'})).body.session;
  let response=await api('/api/conversation/respond',{sessionId:session.id,idempotencyKey:'rejected',originalResponse:'I like pizza.'});
  assert.equal(response.body.session.turnNumber,0);assert.equal(response.body.evaluation.accepted,false);
  assert.equal((await api('/api/participants/me/profile')).body.profileStatus,'none');
  const body={sessionId:session.id,idempotencyKey:'accepted',originalResponse:answer};
  response=await api('/api/conversation/respond',body);assert.equal(response.body.evaluation.accepted,true);
  const profile=(await api('/api/participants/me/profile')).body;
  assert.equal(profile.profileStatus,'provisional');assert.equal(profile.responses.accepted,1);assert.ok(profile.capabilities.some(m=>m.score!==null));assert.equal(profile.capabilities[4].deliveryScore,null);assert.equal(profile.capabilities[4].scope,'communication-content-only');
  assert.equal((await api('/api/participants/me/profile',null,'other-user')).body.hasEvidence,false);
  assert.equal((await api('/api/conversation/respond',body,'other-user')).status,403);
  assert.equal((await api('/api/conversation/session/'+session.id,null,'other-user')).status,403);
  const id=response.body.evaluation.id;
  await stop();await start();
  response=await api('/api/conversation/respond',body);assert.equal(response.body.evaluation.id,id);assert.equal(response.body.session.turnNumber,1);
  const complete=(await api('/api/conversation/complete',{sessionId:session.id})).body.assessmentResult;
  assert.equal(complete.capabilityScores.length,6);assert.equal(complete.impactScores.length,7);
  assert.equal((await api('/api/reviews/'+complete.id+'/approve',{},'new-user')).status,403);
  assert.equal((await api('/api/reviews/'+complete.id+'/approve',{finalScore:100},'reviewer','facilitator')).status,400);
  const approved=await api('/api/reviews/'+complete.id+'/approve',{comments:'Evidence verified.'},'reviewer','facilitator');assert.equal(approved.status,200);
  assert.deepEqual(approved.body.assessmentResult.capabilityScores,complete.capabilityScores);
  assert.equal((await api('/api/participants/me/profile')).body.profileStatus,'approved');
  // A historical result is retained separately; it is never silently relabelled.
  await stop();const file=path.join(dir,'trustbuilder.json'),data=JSON.parse(await readFile(file,'utf8'));
  data.assessmentResults.push({id:'legacy',sessionId:'missing',impactScores:[{code:'I',name:'Insight',score:5}],humanReview:{status:'approved'}});
  const savedApproved=data.assessmentResults.find(r=>r.id===complete.id);
  savedApproved.scoringVersion='conservative-rules-v1';
  const previousReview=structuredClone(savedApproved.humanReview);
  await writeFile(file,JSON.stringify(data));await start();
  const migrated=JSON.parse(await readFile(file,'utf8')).assessmentResults.find(r=>r.id==='legacy');
  assert.equal(migrated.migrationStatus,'legacy_unavailable');assert.equal(migrated.legacyFramework.impactScores[0].name,'Insight');assert.ok(migrated.impactScores.every(m=>m.score===null));assert.equal(migrated.humanReview,null);
  const recomputed=JSON.parse(await readFile(file,'utf8')).assessmentResults.find(r=>r.id===complete.id);
  assert.deepEqual(recomputed.humanReview,previousReview);assert.equal(recomputed.status,'HUMAN_REVIEWED_FINAL');
  assert.equal(recomputed.scoreHistory.length,1);assert.notEqual(recomputed.scoringVersion,'conservative-rules-v1');
  await stop();await start();
  assert.equal(JSON.parse(await readFile(file,'utf8')).assessmentResults.find(r=>r.id===complete.id).scoreHistory.length,1,'migration is idempotent');
});
test('audio evidence is privately persisted and the free configuration exposes no key',async()=>{
  const session=(await api('/api/conversation/start',{scenarioId:'insufficient-evidence'})).body.session;
  const form=new FormData();form.append('audio',new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3,0,1,2,3])],{type:'audio/webm'}),'evidence.webm');form.append('sessionId',session.id);form.append('localId','audio-test-reference');
  const h=headers();delete h['Content-Type'];const uploaded=await fetch(base+'/api/evidence/audio',{method:'POST',headers:h,body:form});assert.equal(uploaded.status,201);
  const evidence=(await uploaded.json()).evidence;
  assert.equal((await fetch(base+evidence.url,{headers:headers('other-user')})).status,403);
  assert.equal((await fetch(base+evidence.url,{headers:headers()})).status,200);
  const responded=await api('/api/conversation/respond',{sessionId:session.id,idempotencyKey:'audio-turn',originalResponse:answer,inputType:'voice',audioReference:{localId:'audio-test-reference'}});
  const turn=responded.body.session.conversationHistory.find(t=>t.role==='participant');assert.equal(turn.audioReference.localOnly,false);assert.equal(turn.audioReference.turnId,turn.id);
  const config=(await api('/api/voice/config')).body;assert.equal(config.freeMode,true);assert.doesNotMatch(JSON.stringify(config),/sk-|api.key/i);
});
