(async function () {
  const sim = window.TrustBuilderSimulation;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };

  assert(!sim.validateAnswer("", "What evidence do you need?").relevant, "Empty response must be rejected");
  assert(!sim.validateAnswer("I guarantee 100% recovery today.", "What can you commit to?").relevant, "Unsupported guarantee must be rejected");
  assert(!sim.validateAnswer("My favourite holiday is in the mountains and I enjoy painting there.", "What evidence do you need?").relevant, "Off-topic response must be rejected");

  const good = "I cannot guarantee recovery until the downstream reconciliation test is validated, and I will update the client by 2:30pm.";
  assert(sim.validateAnswer(good, "What evidence do you need?").relevant, "Relevant evidence-bound response must be accepted");

  const first = await sim.nextQuestion({ mode: "HUNT", conversation: [], initialEvaluation: {} });
  assert(first.phase === 4 && !first.complete && first.question.length > 20, "Phase 4 must begin with one question");
  assert((first.question.match(/\?/g) || []).length === 1, "AI voice output must contain exactly one question");
  assert(!/^(exactly|great|good|perfect|correct)/i.test(first.question), "AI voice output must not begin with repetitive praise");
  assert(sim.oneVoiceQuestion("Great! What evidence is verified? What else do you know?") === "What evidence is verified?", "Voice output must remove praise and extra questions");

  const context = sim.getAssistantContext({ mode: "HUNT", scenario: { title: "Pressure for an immediate answer", context: "Recovery evidence is incomplete." }, conversation: [] });
  assert(context.project === "TrustBuilder AI Sales Excellence", "Project context must remain explicit");
  assert(context.module === "Adaptive AI Client Conversation", "Module context must remain explicit");
  assert(context.currentTask === "Pressure for an immediate answer", "Current task must come from the active scenario");

  const focusedConversation = [];
  const richAnswers = [
    "I cannot guarantee recovery until validation is complete; the business risk affects operations, and I will provide a confirmed update by 2:30pm.",
    "I will base the recommendation on the reconciliation test, keep the client informed, and change the recovery decision if peak-volume evidence fails.",
    "The recovery lead owns validation, operations confirms the outcome, and I remain accountable for the client update at 2:30pm.",
    "If recovery is not confirmed by 4pm, I will prioritise safe reconciliation, explain the customer impact, and offer a validated phased commitment."
  ];
  let focusedNext = await sim.nextQuestion({ mode: "HUNT", scenario: { title: "Pressure for an immediate answer" }, conversation: focusedConversation, initialEvaluation: {} });
  const focusedQuestions = [];
  for (const answer of richAnswers) {
    assert(!focusedQuestions.some(question => sim.isRepeatedQuestion(focusedNext.question, [{ role: "ai", text: question }])), "Each AI question must be materially new");
    focusedQuestions.push(focusedNext.question);
    focusedConversation.push({ role: "ai", text: focusedNext.question, rationaleCode: focusedNext.rationaleCode });
    focusedConversation.push({ role: "participant", text: answer, accepted: true });
    focusedNext = await sim.nextQuestion({ mode: "HUNT", scenario: { title: "Pressure for an immediate answer" }, conversation: focusedConversation, initialEvaluation: {} });
  }
  assert(new Set(focusedQuestions.map(question => question.toLowerCase())).size === focusedQuestions.length, "AI questions must not repeat");
  assert(focusedNext.complete, "The focused conversation must complete after four accepted answers");

  const originalFetch = globalThis.fetch;
  globalThis.TRUSTBUILDER_CONVERSATION_ENDPOINT = "/mock-conversation";
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ phase: 4, question: first.question, complete: false }) });
  const providerFallback = await sim.nextQuestion({ mode: "HUNT", scenario: { title: "Pressure for an immediate answer" }, conversation: [{ role: "ai", text: first.question, rationaleCode: first.rationaleCode }, { role: "participant", text: good, accepted: true }], initialEvaluation: {} });
  assert(providerFallback.fallback && providerFallback.question !== first.question, "A repeated provider question must be replaced with a focused local question");
  globalThis.TRUSTBUILDER_CONVERSATION_ENDPOINT = "";
  globalThis.fetch = originalFetch;

  const conversation = [
    { role: "ai", text: first.question },
    { role: "participant", text: good, accepted: true },
    { role: "ai", text: "What is the business impact?" },
    { role: "participant", text: "The business impact is delayed customer order reconciliation, so operations needs a confirmed risk update by 2:30pm.", accepted: true },
    { role: "ai", text: "What will change?" },
    { role: "participant", text: "Based on the new evidence, I will revise the recovery recommendation and confirm the peak-volume test before committing.", accepted: true },
    { role: "ai", text: "Why should I trust you?" },
    { role: "participant", text: "I will be transparent about the remaining risk, own the decision, and return with a validated outcome by 2:30pm.", accepted: true }
  ];
  const result = sim.evaluateFullInteraction({ initialResponse: good, conversation, mode: "HUNT" });
  assert(result.capabilityScores.length === 6, "Final evaluation must preserve six capabilities");
  assert(result.impactScores.length === 7, "Final evaluation must include IMPACT+R");
  assert(result.status === "DRAFT_REQUIRES_FACILITATOR_APPROVAL", "Evaluation must remain a draft");
  assert(result.capabilityScores.every(item => item.score === null || (item.score >= 1 && item.score <= 5)), "Scores must remain on the existing five-level scale");
  console.log("simulation tests passed");
})();
