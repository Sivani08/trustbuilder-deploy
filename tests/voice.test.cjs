const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(supported=true){
  const timers=new Map(),listeners={},states=[],turns=[],instances=[];let next=0,cancels=0,stops=0;
  class Recognition{constructor(){instances.push(this);}start(){}abort(){this.aborted=true;}}
  const track={enabled:true,stop(){stops++;}};
  const window={SpeechRecognition:supported?Recognition:null,speechSynthesis:{cancel(){cancels++;},speak(u){u.onend();}},addEventListener:(name,fn)=>listeners[name]=fn};
  const context={window,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]})}},document:{hidden:false,addEventListener:(name,fn)=>listeners[name]=fn,querySelector:()=>null},setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id),crypto:{randomUUID:()=>String(++next)},SpeechSynthesisUtterance:class{constructor(t){this.text=t;}},speechSynthesis:window.speechSynthesis};
  vm.runInNewContext(fs.readFileSync(require.resolve('../voice.js'),'utf8'),context);
  return {voice:window.TrustBuilderVoice,instances,timers,listeners,states,turns,context,get cancels(){return cancels;},get stops(){return stops;},options:{sessionId:'saved-session',onState:s=>states.push(s),onTurn:async t=>turns.push(t),currentQuestion:''}};
}
test('free voice connects, protects short pauses, ignores duplicate final events, releases microphone',async()=>{
  const s=setup();await s.voice.start(s.options);assert.equal(s.voice.active,true);
  const result=[{transcript:'I will validate the adoption evidence by Friday.'}];result.isFinal=true;
  const event={resultIndex:0,results:[result]};s.instances[0].onresult(event);s.instances[0].onresult(event);
  assert.equal(s.turns.length,0);const grace=[...s.timers.values()].find(t=>t.ms===2600);assert.ok(grace);await grace.fn();
  assert.deepEqual(s.turns,['I will validate the adoption evidence by Friday.']);s.voice.stop();assert.equal(s.voice.active,false);assert.ok(s.stops>0);assert.ok(s.instances[0].aborted);
});
test('speech start cancels stakeholder playback and backgrounding ends capture',async()=>{
  const s=setup();await s.voice.start(s.options);
  s.context.speechSynthesis.speak=()=>{};
  void s.voice.speak('What business impact should I expect?');const before=s.cancels;s.instances[0].onspeechstart();assert.ok(s.cancels>before);assert.ok(s.states.includes('INTERRUPTED'));
  s.context.document.hidden=true;s.listeners.visibilitychange();assert.equal(s.voice.active,false);
});
test('unsupported recognition and permission denial leave text available',async()=>{
  const s=setup(false);await s.voice.start(s.options);assert.equal(s.voice.active,false);assert.match(s.states.at(-1),/TEXT FALLBACK/);
  const denied=setup();denied.context.navigator.mediaDevices.getUserMedia=async()=>{throw Object.assign(Error(),{name:'NotAllowedError'});};await denied.voice.start(denied.options);assert.equal(denied.voice.active,false);assert.match(denied.states.at(-1),/permission denied/);
});
