# Correction audit — 27 September 2026

Source: the updated application supplied in Downloads, preserved separately from the earlier uncommitted redesign.

- Login uses server cookies, but browser state is loaded from a shared localStorage key before authentication. Logout clears only the role, leaving prior evidence in memory.
- The participant home/profile/language/progress/reflection views contain invented participant scores, history and feedback. Staff views also include unlabelled demo records.
- The stateful response route evaluates and persists turns, but accepts partially relevant responses and unsupported guarantees. Rejected evaluations enter running averages. Opening responses bypass persistence.
- Final evaluation is a separate legacy heuristic in server.mjs and simulation.js. Both use the wrong IMPACT+R constructs and manufacture neutral scores. The actual assessment result lacks the six/seven metric contracts.
- Approval preserves an overall suggestion but lacks dimension-level review, score validation and mandatory override rationale. No participant profile API exists.
- Idempotency is an in-memory cache checked before ownership; it expires and does not survive restart. Store writes from concurrent sessions can overwrite each other.
- Audio blobs remain in browser memory; persisted references explicitly say localOnly. Browser reload loses the recording.
- Voice is record/stop/transcribe/submit/TTS. There is no Realtime exchange, automatic live-turn loop or comprehensive interruption lifecycle.
- Active server imports JsonStore and openai-provider.mjs. server/ai, server/db and server/auth modules are not wired into the active HTTP server; SQL import imports only users/templates/scenarios. Do not claim SQL durability for assessments.
- README overstates seeded account availability and durable audio. Tests rely on a local header-auth compatibility path.

Reference lock: retain the supplied screenshots' light panels, teal sidebar, existing typography and six-phase journey. Add a compact stakeholder panel using the same tokens, explicit connection state, transcript, mute/end/text controls. Deck slides 3–5 establish the canonical six capabilities, IMPACT+R and HUNT/FARM/MINE; slides 7–12 distinguish actual speech evidence from transcript evidence.

Cost constraint: free browser speech and deterministic server assessment are the default. No paid provider calls are authorized. Optional provider features require explicit server configuration. Browser recognition is not semantic VAD and deterministic scoring is conservative, not equivalent to a calibrated semantic evaluator.
