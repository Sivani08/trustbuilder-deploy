// Production deployments set these to authenticated, same-origin server routes.
// Provider API keys must remain on the server and must never be added here.
window.TRUSTBUILDER_TRANSCRIPTION_ENDPOINT = window.TRUSTBUILDER_TRANSCRIPTION_ENDPOINT || "/api/ai/transcribe";
window.TRUSTBUILDER_CONVERSATION_ENDPOINT = window.TRUSTBUILDER_CONVERSATION_ENDPOINT || "/api/ai/conversation/next";
window.TRUSTBUILDER_VALIDATION_ENDPOINT = window.TRUSTBUILDER_VALIDATION_ENDPOINT || "/api/ai/conversation/validate";
window.TRUSTBUILDER_TTS_ENDPOINT = window.TRUSTBUILDER_TTS_ENDPOINT || "/api/ai/speech";
window.TRUSTBUILDER_EVALUATION_ENDPOINT = window.TRUSTBUILDER_EVALUATION_ENDPOINT || "/api/ai/evaluate";
// Password recovery uses the same account database as sign-in.
window.TRUSTBUILDER_PASSWORD_RESET_URL = window.TRUSTBUILDER_PASSWORD_RESET_URL || "/reset-password.html";
