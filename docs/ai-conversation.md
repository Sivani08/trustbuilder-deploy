# Adaptive AI conversation extension

## Preserved product boundaries

The extension does not replace the scenario engine, HUNT/FARM/MINE context, five-level scoring methodology, six capability records, facilitator review, approval gate, retry, reflection, or participant dashboards. It adds new evidence to the same scenario run and attempt.

The facilitator use-case probe is a separate discovery context that reuses the same `state → context → provider → validation → fallback → persistence → audit` pattern. It never enters the participant simulation or changes the assessment weights.

Phases 1–3 retain the existing audio and transcription path. Phase 4 starts adaptive client discovery. Phase 5 increases commercial challenge. Phase 6 evaluates the opening response and every accepted or rejected AI interaction together, then routes the draft to facilitator review.

## Conversation endpoint

The primary stateful contracts are now:

- `POST /api/conversation/start`
- `POST /api/conversation/respond`
- `POST /api/conversation/complete`
- `POST /api/retries`

`/api/ai/conversation/next` remains as a compatibility adapter for the original client contract. The stateful response endpoint performs evaluation, scoring, decisioning, persistence, and next-message generation as one per-session serialized operation.

`POST /api/ai/conversation/next`

Input contains the participant-safe scenario context, commercial mode, opening assessment, previous AI questions, accepted participant answers, rejected-answer flags, and a persistent `assistantContext` with the TrustBuilder project, adaptive-conversation module, active scenario task, project/module mottos, and response rules. The server must return exactly one short question:

```json
{
  "phase": 4,
  "question": "What evidence do you still need before committing?",
  "complete": false,
  "rationaleCode": "MISSING_EVIDENCE_BOUNDARY"
}
```

The server uses structured output validation. It must never return facilitator-only scenario fields. The client will not advance on an invalid or missing question and has a bounded local fallback.

The client normalizes provider output for voice: it removes praise/filler, keeps the first question only, and limits it to 32 words. Exact or materially similar questions are rejected. When a provider repeats a prior question, the local topic-memory fallback selects the next unasked evidence, impact, checkpoint, adaptation, trust, accountability, or trade-off prompt.

## Answer validation

Every submitted answer is stored with `accepted`, `flags`, relevance signals, and timestamp. Progression is blocked when an answer is empty, too short to contain evidence, generic, off-topic, or contains unsupported certainty. Rejected answers stay in the audit trail and the AI asks the participant to correct the same response rather than moving forward.

The session has separate submission and accepted-turn counters. Empty responses are rejected before persistence; irrelevant responses are evaluated and retained with `accepted=false`, but do not increment the accepted turn, satisfy a minimum-turn rule, or trigger completion.

`POST /api/ai/conversation/validate` receives the current question, proposed answer, participant-safe scenario context, mode, and prior answers. It returns `relevant`, `supported`, `scenarioConnection`, `evidenceUsed`, `flags[]`, and `retryInstruction`. Deterministic hard gates run first and cannot be overridden by the model.

Production validation should combine deterministic gates with a structured semantic relevance decision. Semantic validation returns `relevant`, `supported`, `scenarioConnection`, `evidenceUsed`, `flags[]`, and `retryInstruction`. Do not use only lexical overlap, and do not allow the question-generating model to silently override hard safety or completeness gates.

## Voice endpoint

`POST /api/ai/speech` accepts the exact AI text already shown on screen and returns audio. Text always renders before playback. If provider speech fails, the browser voice fallback is attempted; if that also fails, the text remains fully usable. Provider credentials stay server-side.

## Phase 6 evaluation endpoint

`POST /api/ai/evaluate` receives the immutable opening response reference, verified transcripts, AI questions, accepted and rejected participant answers, HUNT/FARM/MINE mode, scenario/rubric version IDs, and existing methodology identifier.

The validated result contains exactly six capability records and seven IMPACT+R records. Every score must include direct transcript evidence or explicitly say that evidence is absent. It also returns strengths, development needs, recommendations, targeted practice, provider/model/prompt versions, and `DRAFT_REQUIRES_FACILITATOR_APPROVAL` status.

The server rejects scores outside 1–5, unknown metric names, missing evidence, and any attempt to mark AI output as final. Facilitator approval stores the final score, rationale, and override reason separately from the AI suggestion.

## Reliability tests

Test the same scenario with strong answers, relevant but unsupported guarantees, empty audio, irrelevant answers, repeated generic answers, noisy speech, transcript corrections, code-switching, provider timeouts, voice autoplay denial, stale conversation turns, and evaluation schema violations. Assert that no invalid answer advances a turn and no phase 6 score publishes without review.

Use-case probing additionally tests natural intent extraction, sparse drafts, answer-driven follow-ups, semantic/facet repetition, overlap, duplicates, dependencies, conflicts, scope expansion, vague thresholds, malformed structured output, idempotency, version conflicts, access control, explicit publication, schema migration, and audit privacy. See `use-case-discovery.md` for the full loop.
