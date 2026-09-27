# AI services

## Implemented adapter

`server/openai-provider.mjs` uses the OpenAI Responses API with strict JSON Schema structured outputs for semantic response evaluation, adaptive stakeholder turns, scenario drafts, use-case intent detection, and use-case probing. It also provides transcription and speech adapters. The API key, base URL, model names, and voice are read only on the server from environment variables or `.env`.

The primary synchronous pilot pipeline is:

`response received → deterministic evaluation → optional semantic observations → merged evidence → deterministic weighted score → conversation decision → one structured AI message`.

The facilitator discovery pipeline is:

`active use case → deterministic knowledge state and relationships → ranked candidate gaps → one structured provider probe → schema/question-memory validation → deterministic fallback → grounded update`.

The provider receives bounded project, module, active-use-case, related-use-case, knowledge, prior-turn, latest-answer, and candidate-gap context. It may select only an eligible gap and may not publish, merge records, invent confirmed facts, or expose internal rationale in participant messages. `trustbuilder-use-case-v1` records prompt provenance independently from the existing conversation prompt.

Malformed, repeated, timed-out, or unavailable provider output is rejected and replaced by a non-repeating deterministic stakeholder message. Text is always available; TTS falls back to browser speech with a bounded completion timeout.

Each AI capability sits behind a small provider-neutral contract. Adapters receive stable domain inputs and return typed, provenance-rich suggestions. A `MockAIAdapter` and manual workflow are always available, so unavailable AI never blocks scoring or feedback.

The use-case contract follows the same provider-neutral boundary, allowing a future Gemini-compatible adapter or mock implementation to return the validated shape without changing domain, API, or UI code.

Processing is asynchronous: upload → queued job → transcription → language/speech/structure analysis → draft observations → draft assessment → facilitator review. Each step records `QUEUED`, `PROCESSING`, `COMPLETED`, `PARTIAL`, or `FAILED` independently and uses bounded retries. Original recordings and participant responses are immutable.

AI output is never silently final. The database retains suggestion, provider metadata, human review state, final judgement, and override reason. Judgement & Restraint always requires facilitator approval; business-judgement hypothesis assessments require sign-off as well.
