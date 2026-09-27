# Dynamic use-case discovery

## Product boundary

Use-case discovery helps a facilitator turn business intent into an evidence-ready requirement. It extends TrustBuilder without replacing scenarios, HUNT/FARM/MINE modes, the six-phase assessment, deterministic scoring, transcription, retries, dashboards, or human approval.

The central loop is:

`context → knowledge state → relationship and gap detection → candidate ranking → one natural probe → grounded update`

The engine asks the minimum high-value questions needed for clarity. It is not a fixed questionnaire. Every probe uses the current project, module, active use case, existing use cases, prior turns, confirmed answers, assumptions, open questions, decisions, dependencies, risks, and relationship suggestions.

## Use-case and knowledge state

Use cases are sparse, versioned records. All requested business, workflow, data, responsibility, success, risk, lifecycle, and provenance fields are available, but only `name` is required for a draft. Unknown values remain empty.

`deriveUseCaseKnowledgeState()` produces six explicit buckets:

- `confirmed`: populated record fields and facilitator-grounded facts
- `assumed`: claims that still require validation
- `unknown`: open questions plus missing core fields
- `conflicting`: contradictory values or relationship observations
- `decided`: explicit facilitator decisions
- `deferred`: deliberately postponed points

Completeness is a navigation aid, not a score and not permission to publish.

## Dynamic probe selection

`generateUseCaseProbeCandidates()` derives candidates only for unresolved knowledge. Candidates cover the decision, business problem, user, trigger, evidence, source authority, AI boundary, human accountability, output, success, KPI, constraints, risks, edge cases, and unresolved relationships. Their priority changes with context: for example, once a decision is known, the evidence question incorporates that decision directly.

`validateUseCaseProbeOutput()` checks the typed decision, allowed target field, completion consistency, length, one-question rule, and question memory. Provider output can select only from the deterministic candidate-gap set. If output is missing, malformed, repeated, timed out, or unavailable, the same domain state feeds `fallbackUseCaseProbe()`.

Question memory combines normalized text, concept-token similarity, and the target knowledge facet. “Who will use it?” and “Who are the target users?” are treated as equivalent even though the wording differs.

## Grounded updates and exceptions

A facilitator answer updates only the field targeted by the pending question and records the facilitator source. Unsupported provider additions never become confirmed facts.

- Empty, trivial, and off-topic input is rejected without advancing to a new gap.
- Qualitative terms such as “fast”, “accurate”, and “scalable” produce a measurable clarification question.
- A new scalar that conflicts with an existing confirmed value is preserved as a conflict until explicitly resolved.
- Materially broader capability produces a `SCOPE_EXPANSION` observation and an extension-versus-separate decision.
- Completion is a suggestion after sufficient core clarity; it does not publish the record.

## Relationship observations

Every active record is compared with existing use cases. Deterministic analysis can suggest `DUPLICATE`, `OVERLAP`, `DEPENDENCY`, `SHARED_DATA`, `SHARED_STAKEHOLDER`, `SHARED_WORKFLOW`, `SHARED_AI_CAPABILITY`, `CONFLICT`, and `SCOPE_EXPANSION`. Each observation retains confidence, explanation, a related ID, direction when relevant, and whether facilitator action is required. Nothing merges automatically.

## API contracts

- `GET /api/use-cases` lists records with compact completeness and relationship counts.
- `POST /api/use-cases` creates a draft regardless of client-supplied status.
- `GET /api/use-cases/:id` returns the record, knowledge state, private conversation, relationships, project, and module.
- `PATCH /api/use-cases/:id` applies allowed fields, optional `expectedVersion`, and explicit status transitions.
- `POST /api/use-cases/:id/probe` accepts `useCaseId`, `facilitatorMessage`, and `idempotencyKey`, persists a grounded update, and returns one probe or a completion suggestion.
- `POST /api/use-cases/detect` extracts natural new-use-case intent but never persists until the facilitator confirms creation.
- `POST /api/use-cases/relationships` re-runs comparison and records new observations for a saved record.

All endpoints require facilitator or administrator authorization. Allowed transitions are `draft → published → archived`; reverting to draft and automatic publication are rejected.

## Persistence and audit

Schema v4 adds `useCases[]`, `useCaseConversations[]`, and `useCaseAudit[]`. Startup migration initializes missing arrays, preserves existing/custom scenarios, and seeds the example `Regulatory Document Analysis` record only when absent.

Use-case audit records include actor, role, timestamp, use-case ID, request ID, and bounded metadata for creation, material updates, probe start/completion, relationship detection, and publication. Raw facilitator answers remain in the private conversation record and are not copied into audit metadata.
