# Scenario engine

State progression:

`ASSIGNED → BRIEFING → READY → STIMULUS → RESPONSE → SUBMITTED → PROCESSING → FACILITATOR_REVIEW → FEEDBACK_READY → FEEDBACK_VIEWED → RETRY_READY → RETRY_SUBMITTED → RETRY_REVIEW → REFLECTION → COMPLETED`

Only a transition service may change state. It validates actor role, current state, assignment ownership, required artifacts, and expected revision inside one transaction. Every transition writes a `run_state_event` audit row.

A scenario version stores the participant briefing separately from hidden concern, scoring guidance, expected behaviour, and facilitator notes. Twists are ordered first-class records with triggers, evidence changes, emotional changes, and scoring implications. A `ScenarioRun` supports Attempt 1 through Attempt N; no fixed retry columns are used.

A scenario may optionally store `useCaseIds[]` to reference the discovery records that informed it. The relationship is additive: use cases define business intent and requirements, while scenarios continue to own participant briefing, simulation, evidence capture, six-phase execution, scoring, retries, and review. Participant scenario payloads never inherit facilitator-private use-case knowledge automatically.
