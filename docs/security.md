# Security and privacy

- Enforce permissions on the server for every page, API, action, and asset request.
- Never serialize hidden concern, strong-response guidance, rubric answer keys, or facilitator notes to participant clients.
- Store recordings privately; validate size, MIME type, extension, and content signature; provide short-lived signed access.
- Scope participant reads to their own records. Scope facilitator reads to assigned cohorts. Reserve configuration and audit access for administrators.
- Protect writes with validation, CSRF defenses, secure sessions, idempotency keys, transactions, and optimistic concurrency.
- Log access and assessment changes without logging private response content.
- Require facilitator or administrator authorization for every use-case list, detail, create, update, detect, relationship, and probe operation. A visual role switch does not grant API authority.
- Keep use-case gap analysis, assumptions, relationships, question reasons, private notes, and raw facilitator probing turns out of participant context. Audit only bounded action metadata, never the raw facilitator answer.
- Require explicit draft-to-published action, derive versions from persisted state, reject stale `expectedVersion` values, and never let provider output publish or merge a use case.
- Support configurable retention, subject access, and deletion policies before enterprise rollout.
