# Correction release

The production correction is intentionally evidence-first. The server owns the canonical participant turn, acceptance decision, scoring, conversation state, and persistence. Text and voice normalize into the same response contract; audio is supplemental evidence and is uploaded asynchronously by session, participant, attempt, scenario, turn and timestamp.

The dashboard has three states: no evidence, provisional observed evidence, and approved evidence. A null score is never rendered as zero or as a neutral baseline. Rejected responses remain in the audit trail and do not advance accepted turns or profiles. Approval is rejected when there is no evidence, a score is outside 1–5, or an override has no reason.

The free voice fallback is the supported default. `voice.js` uses browser recognition, MediaRecorder, a 2.6 second pause grace period, duplicate final-event guards, barge-in cancellation, and a text fallback. It exposes `LISTENING`, `USER SPEAKING`, `PROCESSING`, `AI SPEAKING`, `INTERRUPTED`, `RECONNECTING`, and `TEXT FALLBACK` states in the live client panel. Provider-backed Realtime/WebRTC can be added behind `ENABLE_PAID_AI`; no browser bundle receives a provider key.

Render variables:

- `NODE_ENV=production`
- `TRUSTBUILDER_DATA_DIR=/var/data/.trustbuilder-data`
- `TRUSTBUILDER_PUBLIC_ORIGIN=https://<your-render-host>`
- `ENABLE_PAID_AI=false` for the free mode
- `OPENAI_API_KEY` only when explicitly enabling paid provider features; keep it server-side
