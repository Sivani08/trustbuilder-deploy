# TrustBuilder

TrustBuilder is a scenario-driven behavioural simulation and coaching application for high-stakes client engagement. This build preserves the existing UI, HUNT/FARM/MINE modes, six-phase journey, five-level capability methodology, IMPACT+R metrics, retry flow, and facilitator approval gate while adding a real server-backed conversational assessment engine.

## What works

- Administrator template authoring with versioned Do’s, Don’ts, deterministic weights, conversation limits, and validation.
- Manual scenario authoring plus AI-assisted editable drafts. AI output never publishes automatically.
- Persistent scenarios inheriting their template rules and supporting scenario-specific extensions.
- Phases 1–3 retain audio capture, editable transcription, evidence extraction, and human verification.
- Phases 4–5 run a stateful, one-question-at-a-time client simulation scoped to the active project, module, and scenario.
- Every response is evaluated for grammar, vocabulary, conversation-wide repetition, relevance, Do’s, Don’ts, clarity, and evidence.
- Empty and irrelevant submissions are recorded and redirected but do not advance accepted-turn or completion counters.
- AI questions use structured outputs, prompt boundaries, duplicate detection, a bounded retry path, and a safe non-repeating fallback.
- AI voice uses server-side TTS when configured, browser speech as fallback, and always keeps text visible.
- Phase 6 combines the opening evidence and full adaptive conversation into six capability metrics, IMPACT+R, strengths, development needs, recommendations, targeted practice, and a deterministic 0–100 score.
- Retry attempts are preserved and compared by criterion and Don’t violation.
- AI evaluation and human-reviewed final results are stored separately. No score is released without facilitator approval.
- Participant, facilitator, and administrator views remain available, including new-user creation and the live dashboard updated after every response.
- Facilitators now have a private **Use Cases** workspace for manual or natural-language draft creation, adaptive one-question probing, structured editing, knowledge-state review, relationship analysis, and explicit publishing.
- Use-case probing follows `context → knowledge state → gap detection → one natural question → grounded update`. It safely redirects empty, off-topic, vague, repeated, malformed, contradictory, and scope-expanding input.

## Run locally

Requirements: Node.js 20 or newer. No package installation is required.

```powershell
cd C:\path\to\trustbuilder
Copy-Item .env.example .env
npm start
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/).

Do not open `index.html` directly from the ZIP. The browser UI requires the Node server for authentication and API requests. On another developer's machine, extract the project, run `npm install`, run `npm start`, and open `http://127.0.0.1:4173/` from that same machine. To share one running server over a local network, open `http://<host-machine-ip>:4173/` instead of `localhost`.

The included facilitator demo is `priya.shah@example.com` / `TrustBuilder!2026`. Use it to open **Use Cases**. New participant accounts can also be created from the login screen; administrators can add users from the existing user workspace.

The app loads `.env` from the project directory. Leave `OPENAI_API_KEY` blank to exercise the safe deterministic fallback. Add a server-side key to enable OpenAI conversation generation, semantic evaluation, transcription, and speech. Provider credentials are never sent to the browser.

## Test

```powershell
npm test
```

The suite covers the original assessment path plus use-case detection, adaptive probes, knowledge updates, ambiguity, contradictions, scope expansion, relationships, access control, version conflicts, publishing, audit events, and schema-v4 persistence.

## Runtime architecture

```text
Browser SPA
  ├─ existing six-phase UI, audio capture, text fallback
  ├─ facilitator-only use-case discovery workspace
  ├─ same-origin API client with idempotency keys
  └─ shared deterministic domain/scoring module
           │
Node HTTP service
  ├─ authorization, origin checks, size/rate limits
  ├─ per-session and per-use-case serialization and audit events
  ├─ durable atomic JSON persistence
  ├─ OpenAI adapter (server only)
  └─ safe deterministic fallback
```

Primary endpoints:

- `GET|POST /api/users`
- `GET|POST /api/templates`
- `GET|POST /api/scenarios`
- `POST /api/scenarios/generate`
- `GET|POST /api/use-cases`
- `GET|PATCH /api/use-cases/:id`
- `POST /api/use-cases/:id/probe`
- `POST /api/use-cases/detect`
- `POST /api/use-cases/relationships`
- `POST /api/conversation/start`
- `POST /api/conversation/respond`
- `POST /api/conversation/complete`
- `POST /api/retries`
- `POST /api/reviews/:resultId/approve`
- `POST /api/ai/transcribe`
- `POST /api/ai/speech`
- `POST /api/ai/evaluate`

## Persistence and security boundary

The pilot writes atomic schema-v4 JSON records under `.trustbuilder-data/`; this directory and `.env` are excluded from static serving and ZIP source control. Startup migration preserves existing scenarios and safely adds missing use-case collections. Conversation and probe responses require idempotency keys and are serialized per record. Audit logs omit raw response, transcript, and facilitator-answer content.

The included header-based identity is deliberately a local-pilot boundary, not production authentication. A production deployment should replace it with SSO/session authentication, row-level authorization, a transactional database, encrypted object storage for audio, retention controls, and centralized audit/observability.

## Demo roles

Use an account whose authenticated role permits the action. The top-bar selector changes the demo view but does not grant server permissions:

- Participant: run the six phases, retry, and view feedback.
- Facilitator: verify transcripts, inspect full evidence, override with rationale, and approve.
- Administrator: manage users, templates, scenarios, feature flags, and system configuration.

See `docs/use-case-discovery.md`, `docs/architecture.md`, `docs/data-model.md`, `docs/ai-services.md`, `docs/ai-conversation.md`, and `docs/transcription-evaluation.md` for detailed contracts.
