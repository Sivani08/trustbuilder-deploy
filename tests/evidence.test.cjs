const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const d = require('../domain.js');
const accepted = text => ({ id: 'turn-1', role: 'participant', accepted: true, text });
test('canonical framework has exact six and seven names', () => {
  assert.deepEqual(d.IMPACT_R.map(x=>x.name), ['Interpret the Context','Make Outcomes Visible','Position Your POV','Adapt Communication','Commit with Ownership','Trust through Consistency','Restraint']);
  assert.deepEqual(d.CAPABILITIES, ['Active Listening','Adaptive Thinking','Judgement & Restraint','Constructive Hypothesis Building','Professional Speech Excellence','Language Accuracy']);
});
test('empty and rejected evidence never creates neutral scores',()=>{
  for(const turns of [[], [{...accepted('I understand the adoption concern for operations.'),accepted:false}]]) {
    const r=d.assessEvidence(turns);assert.equal(r.capabilityScores.length,6);assert.equal(r.impactScores.length,7);
    assert.ok([...r.capabilityScores,...r.impactScores].every(m=>m.score===null && m.evidenceStatus==='not_observed'));
  }
});
test('combined observable behaviours have attributable quotes; isolated keywords do not',()=>{
  const r=d.assessEvidence([accepted('I understand the adoption concern for operations. I will validate the evidence and update you by Friday.')]);
  assert.equal(r.capabilityScores[0].score,3);assert.equal(r.capabilityScores[0].evidenceTurnId,'turn-1');
  assert.equal(r.capabilityScores[1].score,null);assert.equal(r.capabilityScores[4].scope,'communication-content-only');assert.equal(r.impactScores[4].score,4);
  assert.ok(d.assessEvidence([accepted('evidence impact recommendation ownership')]).impactScores.every(m=>m.score===null));
});
test('voice and text share scoring, and transcript does not invent delivery measures',()=>{
  const t=accepted('I recommend validation because adoption evidence is incomplete.');
  const a=d.assessEvidence([{...t,source:'voice',audioReference:{id:'clip'}}]), b=d.assessEvidence([{...t,source:'text'}]);
  assert.deepEqual(a.capabilityScores,b.capabilityScores);assert.deepEqual(a.impactScores,b.impactScores);assert.equal(a.capabilityScores[4].deliveryScore,null);
  assert.ok(a.capabilityScores[4].score > 0);assert.match(a.capabilityScores[4].rationale,/Content-only/);
});

test('the screenshot responses yield justified restraint, outcome, trust and language ratings',()=>{
  const r=d.assessEvidence([
    {...accepted('Before committing, I can verify user adoption data, workflow fit, data quality, system usability, and feedback from operations teams.'),id:'verify'},
    {...accepted('I communicated the risk early, explained how it could affect adoption and the client outcome, and aligned the team on the next steps.'),id:'risk'}
  ]);
  for(const index of [2,4,5]) assert.ok(r.capabilityScores[index].score>=1);
  for(const index of [1,5,6]) assert.ok(r.impactScores[index].score>=1);
  assert.equal(r.capabilityScores[4].deliveryScore,null);
  assert.equal(r.capabilityScores[0].score,null,'absence of listening evidence is not a low numeric rating');
});

test('full conversation can score all thirteen dimensions with attributable criteria',()=>{
  const texts=[
    'I understand your concern about low adoption in operations. What outcome would make the workflow useful for your team?',
    'My hypothesis is that the workflow may be too complex for users. I would test whether usability is the cause by comparing feedback with adoption data.',
    'I recommend a small pilot because the adoption data is incomplete. We should compare the current approach with a simpler alternative plan.',
    'Given that new evidence, I would adjust the plan and explain the business impact to your operations team. Does that explanation address your concern and make the next step clear?',
    'I cannot confirm the benefit until we verify the evidence. I will review the adoption report and update you by Friday. This will reduce operational risk and improve the client outcome.',
    'I communicated the risk early and aligned the team on the next steps. We will measure the baseline adoption to confirm the business outcome. If the test data disproves our assumption, I would revise the plan instead.'
  ];
  const r=d.assessEvidence(texts.map((text,i)=>({...accepted(text),id:'turn-'+i})));
  for(const m of [...r.capabilityScores,...r.impactScores]){
    assert.ok(m.score>=1&&m.score<=5,m.name);assert.ok(m.evidenceItems.length,m.name);
    assert.ok(m.criteria.some(c=>c.demonstrated),m.name);
    for(const evidence of m.evidenceItems) assert.ok(texts[Number(evidence.turnId.split('-')[1])].includes(evidence.text));
  }
  assert.ok(new Set([...r.capabilityScores,...r.impactScores].map(m=>m.score)).size>1,'ratings are not uniform defaults');
});

test('weak, functional, strong and counter-evidence produce different ratings',()=>{
  const listen=text=>d.assessEvidence([accepted(text)]).capabilityScores[0].score;
  assert.equal(listen('I understand you are asking me for a clear response.'),2);
  assert.equal(listen('I understand your concern about low adoption in operations.'),3);
  assert.equal(listen('I understand your concern about low adoption in operations. What would make the workflow easier for your team?'),4);
  assert.equal(listen('I do not care about your request because it is not my problem.'),1);
  const clean=d.assessEvidence([accepted('I will review the adoption report and share the confirmed findings with your team.')]);
  const flawed=d.assessEvidence([accepted('We was planning to discuss about adoption with your team before we make a decision.')]);
  assert.ok(clean.capabilityScores[5].score>flawed.capabilityScores[5].score);
});

test('negated commitments and repeated copies do not earn ownership or consistency credit',()=>{
  const refusal=d.assessEvidence([accepted('I will not review the report or update the client by Friday.')]);
  assert.equal(refusal.impactScores[4].score,null);
  const text='I understand your concern about low adoption in operations. What would make the workflow easier for your team? Does that explanation address your concern clearly?';
  const duplicate=d.assessEvidence([{...accepted(text),id:'one'},{...accepted(text),id:'two'}]);
  assert.equal(duplicate.capabilityScores[0].score,4);
  const distinct=d.assessEvidence([{...accepted(text),id:'one'},{...accepted('You mentioned the business risk from low adoption. Can you confirm which outcome would meet your priority?'),id:'two'}]);
  assert.equal(distinct.capabilityScores[0].score,5);
});
test('mode changes hidden context and stakeholder fallback; no coaching is spoken',()=>{
  const messages=[];
  for(const mode of ['HUNT','FARM','MINE']){
    const context=d.buildConversationContext({template:d.DEFAULT_TEMPLATE,scenario:d.DEFAULT_SCENARIO,mode});
    assert.equal(context.influenceMode.name,mode);
    const output=d.fallbackAIMessage({decision:'FOLLOW_UP',mode});messages.push(output.message);
    assert.doesNotMatch(output.message,/your score|great answer|well done|rubric/i);
  }
  assert.equal(new Set(messages).size,3);
});
test('active scoring files contain no incorrect IMPACT labels',()=>{
  for(const file of ['../domain.js','../server.mjs','../simulation.js','../app.js']){
    const text=fs.readFileSync(require.resolve(file),'utf8');
    assert.doesNotMatch(text,/\["[IMPACT R]", "(?:Insight|Message|Presence|Adaptability|Commerciality|Trust|Relationship\s*\/\s*Result)"\]/);
  }
});
