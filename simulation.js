(function () {
  const capabilityNames = window.TrustBuilderDomain.CAPABILITIES;
  const commercialNames = window.TrustBuilderDomain.IMPACT_R.map(d => [d.code, d.name]);
  const scenarioVocabulary = [
    "client", "sponsor", "stakeholder", "recovery", "service", "validation", "evidence",
    "risk", "impact", "reconciliation", "operations", "commitment", "update", "team",
    "test", "decision", "time", "4pm", "business", "customer", "confirm", "outcome"
  ];
  const projectContext = Object.freeze({
    project: "TrustBuilder AI Sales Excellence",
    projectMotto: "Practise the judgement behind trusted client relationships.",
    module: "Adaptive AI Client Conversation",
    moduleMotto: "One relevant, evidence-supported response at a time.",
    responseStyle: "Direct, concise, contextual, voice-friendly, and non-repetitive."
  });
  const topicQuestions = {
    EVIDENCE: { phase: 4, question: "Which evidence must be verified before you commit, and who owns that validation?" },
    IMPACT: { phase: 4, question: "What business impact does this create for operations, customers, or revenue?" },
    CHECKPOINT: { phase: 5, question: "What precise update will you give me, and at what time?" },
    ADAPTATION: { phase: 5, question: "If peak-volume testing fails, how will your recommendation change?" },
    ACCOUNTABILITY: { phase: 5, question: "Who owns the next decision, and what outcome will confirm recovery?" },
    TRADEOFF: { phase: 5, question: "What trade-off will you make if full recovery cannot be confirmed by 4pm?" }
  };

  function tokenize(text) {
    return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(word => word.length > 2);
  }
  function normalizedText(text) {
    return tokenize(text).join(" ");
  }
  function oneVoiceQuestion(text) {
    let cleaned = String(text || "").replace(/\s+/g, " ").trim();
    cleaned = cleaned.replace(/^(?:(?:exactly|great|good|perfect|correct|thanks|thank you|that'?s right)[!,.\s:-]*)+/i, "");
    const questionMatch = cleaned.match(/[^?]{1,320}\?/);
    if (questionMatch) {
      const sentences = questionMatch[0].trim().split(/(?<=[.!])\s+/);
      cleaned = sentences[sentences.length - 1];
    }
    const words = cleaned.replace(/[?.!]+$/, "").split(/\s+/).filter(Boolean).slice(0, 32);
    return words.length ? `${words.join(" ")}?` : "What evidence supports your next decision?";
  }
  function questionSimilarity(left, right) {
    const a = new Set(tokenize(left)), b = new Set(tokenize(right));
    if (!a.size || !b.size) return 0;
    const intersection = [...a].filter(word => b.has(word)).length;
    return intersection / new Set([...a, ...b]).size;
  }
  function isRepeatedQuestion(question, conversation = []) {
    const previous = conversation.filter(turn => turn.role === "ai").map(turn => turn.text);
    return previous.some(text => normalizedText(text) === normalizedText(question) || questionSimilarity(text, question) >= .68);
  }
  function inferQuestionTopic(turn) {
    if (turn.rationaleCode) return turn.rationaleCode;
    const text = String(turn.text || "").toLowerCase();
    if (/worked together|existing relationship|broader client need|responsibly commit/.test(text)) return "MODE_OPENING";
    if (/which evidence|specific evidence|who.*provid|validation/.test(text)) return "EVIDENCE";
    if (/business impact|business consequence|operations, customers|revenue/.test(text)) return "IMPACT";
    if (/what precise update|by when|at what time|decision point/.test(text)) return "CHECKPOINT";
    if (/testing fails|recommendation change|what will you change/.test(text)) return "ADAPTATION";
    if (/why should i trust|relationship again|sales pitch/.test(text)) return "MODE_CHALLENGE";
    if (/who owns the next decision|outcome will confirm/.test(text)) return "ACCOUNTABILITY";
    if (/what trade-off|cannot be confirmed by 4pm/.test(text)) return "TRADEOFF";
    return "OTHER";
  }
  function getAssistantContext(payload = {}) {
    const lastParticipant = [...(payload.conversation || [])].reverse().find(turn => turn.role === "participant");
    return {
      ...projectContext,
      currentTask: payload.scenario?.title || "Current TrustBuilder scenario",
      scenarioBoundary: payload.scenario?.context || "Use only the active scenario and its evidence.",
      commercialMode: payload.mode || "HUNT",
      previousStep: lastParticipant?.text?.slice(0, 240) || "Start the current module.",
      rules: [
        "Return exactly one short client question.",
        "Use only the current project, module, scenario, mode, and conversation evidence.",
        "Do not repeat or paraphrase an earlier question.",
        "Do not add praise, summaries, tutorials, or unrelated explanations.",
        "Ask only for the next missing evidence, decision, impact, adaptation, or commitment."
      ]
    };
  }
  function quoteFor(text, pattern) {
    const sentence = text.split(/(?<=[.!?])\s+/).find(item => pattern.test(item));
    return sentence ? `“${sentence.slice(0, 150)}${sentence.length > 150 ? "…" : ""}”` : "No direct evidence found.";
  }
  function clamp(score) { return Math.max(1, Math.min(5, Math.round(score))); }

  function validateAnswer(answer, question, context = {}) {
    const text = answer.trim(), words = tokenize(text), lower = text.toLowerCase();
    const questionTerms = tokenize(question).filter(word => word.length > 4);
    const scenarioTerms = tokenize(`${context.scenario?.title || ""} ${context.scenario?.context || ""}`)
      .filter(word => word.length > 4 && !["while","before","after","their","there","which","about"].includes(word));
    const scopedVocabulary = [...new Set([...scenarioVocabulary, ...scenarioTerms])];
    const contextHits = scopedVocabulary.filter(term => lower.includes(term)).length;
    const questionHits = questionTerms.filter(term => lower.includes(term)).length;
    const empty = !text;
    const tooShort = words.length < 8;
    const generic = /^(?:i don'?t know|not sure|okay|yes|no|maybe|it depends|whatever|next question)[.!]?$/i.test(text);
    const unsupported = /\b(?:guarantee|definitely|certainly|100%|without doubt|will absolutely)\b/i.test(text)
      && !/\b(?:cannot|can't|can not|evidence|validated|confirmed|subject to|assuming|if)\b/i.test(text);
    const offTopic = contextHits === 0 && questionHits === 0;
    const flags = [];
    if (empty) flags.push("empty");
    if (tooShort && !empty) flags.push("insufficient-detail");
    if (generic) flags.push("generic");
    if (unsupported) flags.push("unsupported-claim");
    if (offTopic && !empty) flags.push("off-topic");
    const relevant = flags.length === 0;
    let message = "Relevant response accepted.";
    if (empty) message = "Please answer the client’s question before we continue.";
    else if (generic || tooShort) message = "Give a specific client-facing answer with your reasoning, evidence, or next action.";
    else if (unsupported) message = "That answer makes an unsupported commitment. Bound what is known, name the evidence still required, and try again.";
    else if (offTopic) message = "Connect your answer to the client’s concern, recovery evidence, business impact, or next decision.";
    return { relevant, flags, message, wordCount: words.length, relevanceSignals: contextHits + questionHits };
  }

  async function validateAnswerWithProvider(payload) {
    const scopedPayload = { ...payload, assistantContext: getAssistantContext({ ...payload.context, conversation: payload.context?.previousAnswers || [] }) };
    const hardGate = validateAnswer(payload.answer, payload.question, payload.context);
    if (!hardGate.relevant || !window.TRUSTBUILDER_VALIDATION_ENDPOINT) return hardGate;
    try {
      const response = await fetch(window.TRUSTBUILDER_VALIDATION_ENDPOINT, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scopedPayload)
      });
      if (!response.ok) throw new Error(`Validation service returned ${response.status}`);
      const semantic = await response.json();
      if (typeof semantic.relevant !== "boolean" || typeof semantic.supported !== "boolean") throw new Error("Validation service returned an invalid decision");
      const relevant = hardGate.relevant && semantic.relevant && semantic.supported;
      const flags = [...new Set([...hardGate.flags, ...(semantic.flags || []), ...(!semantic.supported ? ["unsupported-claim"] : [])])];
      return { ...hardGate, ...semantic, relevant, flags, message: relevant ? "Relevant response accepted." : semantic.retryInstruction || semantic.message || "Connect the answer directly to the client’s question and support it with evidence." };
    } catch (error) {
      return { ...hardGate, providerFallback: true, providerError: error.message };
    }
  }

  function localQuestion({ mode, conversation, initialEvaluation }) {
    const accepted = conversation.filter(turn => turn.role === "participant" && turn.accepted);
    const turn = accepted.length;
    const modeOpening = {
      HUNT: "What can you responsibly commit to now while recovery evidence is still incomplete?",
      FARM: "What will you say now to protect our existing trust without overpromising recovery?",
      MINE: "How will you address today’s recovery risk while checking whether the issue is systemic?"
    };
    if (turn === 0) return { phase: 4, question: modeOpening[mode] || modeOpening.HUNT, complete: false, rationaleCode: "MODE_OPENING" };
    if (turn >= 4) return { phase: 5, question: "Conversation complete.", complete: true, rationaleCode: "COMPLETE" };
    const transcript = accepted.map(item => item.text).join(" ").toLowerCase();
    const askedTopics = new Set(conversation.filter(turn=>turn.role==="ai").map(inferQuestionTopic));
    const modeChallenge = mode === "FARM"
      ? "What will you change after recovery so this does not weaken our relationship again?"
      : mode === "MINE"
        ? "How will you test the wider need without turning this incident into a sales pitch?"
        : "Why should I trust this recommendation before we have a track record together?";
    const candidates = [
      { code: "EVIDENCE", needed: !/evidence|validat|confirm|test|unknown|cannot guarantee|can't guarantee/.test(transcript), ...topicQuestions.EVIDENCE },
      { code: "IMPACT", needed: !/impact|operation|order|customer|business|cost|revenue|risk/.test(transcript), ...topicQuestions.IMPACT },
      { code: "CHECKPOINT", needed: !/\b(?:by|at)\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|end of day|tomorrow)|update|checkpoint/.test(transcript), ...topicQuestions.CHECKPOINT },
      { code: "ADAPTATION", needed: !/change|revise|adjust|if.*then|based on|fails?/.test(transcript), ...topicQuestions.ADAPTATION },
      { code: "MODE_CHALLENGE", needed: true, phase: 5, question: modeChallenge },
      { code: "ACCOUNTABILITY", needed: true, ...topicQuestions.ACCOUNTABILITY },
      { code: "TRADEOFF", needed: true, ...topicQuestions.TRADEOFF }
    ];
    const candidate = candidates.find(item=>item.needed&&!askedTopics.has(item.code))
      || candidates.find(item=>!askedTopics.has(item.code))
      || topicQuestions.ACCOUNTABILITY;
    return { phase: candidate.phase, question: oneVoiceQuestion(candidate.question), complete: false, rationaleCode: candidate.code || "ACCOUNTABILITY" };
  }

  async function nextQuestion(payload) {
    const scopedPayload = { ...payload, assistantContext: getAssistantContext(payload) };
    if (window.TRUSTBUILDER_CONVERSATION_ENDPOINT) {
      try {
        const response = await fetch(window.TRUSTBUILDER_CONVERSATION_ENDPOINT, {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scopedPayload)
        });
        if (!response.ok) throw new Error(`Conversation service returned ${response.status}`);
        const result = await response.json();
        if (!result.question || ![4,5].includes(result.phase)) throw new Error("Conversation service returned an invalid question");
        const question = oneVoiceQuestion(result.question);
        if (isRepeatedQuestion(question, payload.conversation)) throw new Error("Conversation service repeated an earlier question");
        return { ...result, question };
      } catch (error) {
        return { ...localQuestion(scopedPayload), fallback: true, providerError: error.message };
      }
    }
    return localQuestion(scopedPayload);
  }

  async function speak(text, onStatus = () => {}) {
    onStatus("speaking");
    const waitForVoice = (register, timeoutMs = 8000) => new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      register(finish);
    });
    if (window.TRUSTBUILDER_TTS_ENDPOINT) {
      try {
        const response = await fetch(window.TRUSTBUILDER_TTS_ENDPOINT, {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, purpose: "adaptive_client_simulation" })
        });
        if (!response.ok) throw new Error(`Voice service returned ${response.status}`);
        const audio = new Audio(URL.createObjectURL(await response.blob()));
        await audio.play();
        await waitForVoice(resolve => { audio.onended = resolve; audio.onerror = resolve; });
        onStatus("idle");
        return "provider";
      } catch (error) {
        console.warn("Provider voice unavailable; using browser fallback.", error);
      }
    }
    if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.96; utterance.pitch = 0.96;
      const voices = speechSynthesis.getVoices();
      utterance.voice = voices.find(voice => /en-(GB|IN|US)/.test(voice.lang) && /natural|neural|premium/i.test(voice.name))
        || voices.find(voice => /^en/i.test(voice.lang)) || null;
      await waitForVoice(resolve => { utterance.onend = resolve; utterance.onerror = resolve; speechSynthesis.speak(utterance); });
      onStatus("idle");
      return "browser-fallback";
    }
    onStatus("text-only");
    return "text-only";
  }

  function evaluateFullInteraction({ conversation = [], mode }) {
    return window.TrustBuilderDomain.assessEvidence(conversation, { mode });
  }

  async function finalEvaluation(payload) {
    if (window.TRUSTBUILDER_EVALUATION_ENDPOINT) {
      try {
        const response = await fetch(window.TRUSTBUILDER_EVALUATION_ENDPOINT, {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`Evaluation service returned ${response.status}`);
        const result = await response.json();
        if (!Array.isArray(result.capabilityScores) || result.capabilityScores.length !== 6 || !Array.isArray(result.impactScores) || result.impactScores.length !== 7)
          throw new Error("Evaluation service returned an invalid scoring shape");
        return { ...result, status: "DRAFT_REQUIRES_FACILITATOR_APPROVAL" };
      } catch (error) {
        return { ...evaluateFullInteraction(payload), providerFallback: true, providerError: error.message };
      }
    }
    return evaluateFullInteraction(payload);
  }

  window.TrustBuilderSimulation = { validateAnswer, validateAnswerWithProvider, nextQuestion, speak, evaluateFullInteraction, finalEvaluation, getAssistantContext, isRepeatedQuestion, oneVoiceQuestion, projectContext, capabilityNames, commercialNames };
})();
