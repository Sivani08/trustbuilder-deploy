# Relational data model

## Pilot persistence now implemented

`.trustbuilder-data/trustbuilder.json` stores schema version 4 collections for `users`, `templates`, `scenarios`, `sessions`, `evaluations`, `assessmentResults`, `attempts`, `reviews`, `audit`, `useCases`, `useCaseConversations`, and `useCaseAudit`. Writes use temporary-file replacement. Startup migration initializes missing collections, preserves custom scenarios and persisted canonical edits, and never overwrites existing use cases.

Sessions track both `submissionNumber` and accepted `turnNumber`; irrelevant submissions remain evidence but never advance accepted-turn completion. Assessment results retain AI provenance and an immutable AI score, while human review stores reviewer, final score, rationale, override reason, and timestamp separately.

A use case is sparse and versioned. It can hold identity and lifecycle fields; business problem, objective and desired outcome; users and stakeholders; trigger and current process; inputs, outputs, data sources and systems; dependencies, constraints, assumptions and risks; success criteria and KPIs; AI/human responsibility and edge cases; plus confirmed facts, open questions, decisions, conflicts, deferred items, answered fields, and relationship observations. Unknown values remain empty rather than being invented. A private conversation stores ordered facilitator/AI turns separately from public list summaries.

The JSON store is intentionally a pilot adapter. The relational target and constraints below remain the production migration design.

Core identity tables: `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `cohorts`, and `cohort_memberships`.

Capability content: `capabilities`, `rubric_versions`, `rubric_levels`, and `behaviour_indicators`. The six capabilities are seeded records, never one composite field.

Scenario content: `scenarios`, `scenario_versions`, `scenario_capabilities`, `scenario_twists`, and `scenario_assignments`. Participant-safe and facilitator-private fields are selected by separate server queries.

Discovery content: `projects`, `modules`, `use_cases`, `use_case_versions`, `use_case_conversations`, `use_case_turns`, `use_case_knowledge_items`, `use_case_relationships`, and `use_case_audit`. Scenario versions may join to one or more use-case versions without replacing the scenario aggregate.

Learning loop: `scenario_runs`, `run_state_events`, `attempts`, `response_assets`, `transcripts`, `analysis_jobs`, `observations`, `capability_assessments`, `critical_errors`, `feedback`, `feedback_approvals`, `retry_directives`, and `reflections`.

Longitudinal development: `language_patterns`, `language_observations`, `development_priorities`, `facilitator_comments`, `reports`, `feature_flags`, and `audit_logs`.

Important constraints:

- Unique active assignment per `(participant_id, scenario_version_id)` where duplication is not explicitly allowed.
- Unique attempt number per `(scenario_run_id, attempt_number)`.
- Assessments reference both scenario and rubric versions.
- Final scores require a facilitator identity and finalization timestamp.
- Judgement & Restraint cannot transition to published without a feedback approval row.
- State changes use an expected revision to reject stale updates.
- Response submission uses an idempotency key.
- Use-case probe submission uses an idempotency key and a per-record lock.
- Use-case updates derive the next version from the stored record and may require `expectedVersion`.
- Use-case lifecycle permits only `draft → published → archived`; AI output cannot publish.
- Every ownership lookup includes participant or cohort scope.
