# Reliable transcription and evaluation

## Implemented pilot behavior

The browser captures an immutable-quality audio blob using the best supported codec, with echo cancellation, noise suppression, automatic gain control, one-second data chunks, and explicit failure recovery. Where the browser supports speech recognition, it creates an immediate draft transcript. The draft remains editable and is labelled “Review required.” The participant can continue manually when recognition or a provider is unavailable.

The audio and transcript are separate evidence objects. A facilitator must verify the transcript before approving a Judgement & Restraint assessment. Editing the transcript recalculates the evidence suggestions.

Evaluation is deterministic and evidence-based in reduced mode. It checks stakeholder acknowledgement, evidence boundaries, time-bound follow-through, clarification behavior, unsupported certainty, filler count, and response length. Each observation records what was or was not observed and a suggested rubric level. It never publishes a final score.

## Production provider endpoint

Set `window.TRUSTBUILDER_TRANSCRIPTION_ENDPOINT` to a same-origin server endpoint. The browser sends multipart form data containing `audio` and JSON `context`. The server should:

1. Authenticate the participant and validate assignment ownership.
2. Validate file size, MIME type, and content signature.
3. Store the original audio privately before processing.
4. Call a high-accuracy transcription provider from the server; never send provider credentials to the browser.
5. Supply scenario vocabulary as keyword hints and appropriate language hints.
6. Return `{ text, confidence, language, segments, provider, model, requestId }`.
7. Record `QUEUED`, `PROCESSING`, `COMPLETED`, `PARTIAL`, or `FAILED` status independently from assessment processing.

## Structured evaluation contract

Production AI evaluation should return a validated schema containing `capability`, `suggestedScore`, `behaviouralEvidence[]`, `communicationEvidence[]`, `criticalErrors[]`, `strengths[]`, `developmentObservations[]`, `rationale`, `model`, `promptVersion`, and `generatedAt`. Reject outputs that do not match the schema. Store the suggestion separately from facilitator final score and approval status.

Reliability checks should include a small scenario-specific evaluation set with clean audio, noise, varied accents, technical vocabulary, code-switching, numbers/times, unsupported guarantees, appropriate pauses, and correct deferral. Track transcription word-error rate on labelled samples and agreement with calibrated facilitator scores; never optimize only for model-to-model agreement.

Use-case discovery remains text-first facilitator configuration and does not alter the immutable participant audio/transcript path. If voice capture is added to the facilitator workspace later, its transcript must be treated as an editable draft and must pass the same grounded-answer validation before updating confirmed use-case knowledge.
