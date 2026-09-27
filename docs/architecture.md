# Architecture

## Implemented pilot architecture

The browser remains a dependency-free SPA, but persistence, authorization checks, AI-provider calls, conversation state, idempotency, and final approval now run through `server.mjs`. `domain.js` is shared by browser and server so template validation and deterministic scoring have one implementation. `client-services.js` is the same-origin transport boundary. `server/openai-provider.mjs` is the only module allowed to read provider credentials.

The service writes an atomic schema-versioned JSON document through `server/store.mjs`. Per-session and per-use-case locks serialize state changes, idempotency keys deduplicate retries, and expected versions reject stale use-case edits. Rejected operations are absorbed by the lock chain so one conflict cannot terminate the server. This is durable pilot storage, not the production relational target below.

Request flow:

`Template → Scenario → ConversationSession → ConversationTurn → ResponseEvaluation → deterministic aggregate → AssessmentResult → HumanReview`.

Use-case discovery is a separate facilitator aggregate:

`Project → Module → UseCase → KnowledgeState → ProbeTurn → RelationshipObservation → explicit Publish`.

A scenario may reference `useCaseIds[]`; the scenario still owns assessment execution and scoring. `buildConversationContext()` emits discovery fields only for the facilitator audience, so assumptions, relationships, private notes, and gap analysis never enter participant prompts.

Provider failures return structured safe fallbacks; they do not bypass validation or facilitator approval.

## Product boundary

The application is organized around one learning aggregate: `ScenarioRun`. A run owns an ordered set of attempts and progresses through a guarded state machine. Scenario content and rubric wording are versioned separately so historical assessments remain stable.

## Production target

- Web: strict TypeScript React application with server-rendered protected routes.
- Domain: scenario, assessment, retry, reflection, reporting, and authorization services that do not import UI code.
- Data: PostgreSQL with transactional writes and optimistic concurrency; Prisma for migrations and access.
- Storage: private S3-compatible object storage behind a `StorageService` interface.
- Jobs: durable asynchronous processing with isolated transcription, language, speech, structure, and assessment steps. Partial failure never removes the response asset.
- AI: provider-neutral interfaces with mock/manual fallbacks. AI outputs are suggestions and carry provenance and review state.
- Security: server-side RBAC/ABAC, opaque asset identifiers, signed download URLs, audit logs, validation, MIME/size enforcement, and no facilitator-only scenario fields in participant payloads.

## Modules

`auth`, `users`, `cohorts`, `capabilities`, `rubrics`, `use-cases`, `scenarios`, `assignments`, `runs`, `responses`, `analysis`, `assessments`, `feedback`, `retries`, `reflections`, `language-profile`, `reports`, `audit`, and `feature-flags`.

## AI interfaces

`TranscriptionService`, `LanguageAnalysisService`, `SpeechAnalysisService`, `ResponseStructureService`, `FeedbackDraftingService`, `AssessmentSuggestionService`, `ScenarioGenerationService`, `UseCaseDetectionService`, and `UseCaseProbeService`. Each returns typed results with provider, model/version, confidence, timestamp, and failure status.
