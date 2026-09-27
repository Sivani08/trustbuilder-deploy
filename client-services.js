(function () {
  "use strict";
  const runtime = { health: null, healthCheckedAt: 0, activeRequests: new Map() };
  const endpoints = {
    authSession: "/api/auth/session", authRegister: "/api/auth/register", authLogin: "/api/auth/login", authLogout: "/api/auth/logout",
    health: "/api/health", users: "/api/users", templates: "/api/templates", scenarios: "/api/scenarios", generateScenario: "/api/scenarios/generate",
    useCases: "/api/use-cases", detectUseCase: "/api/use-cases/detect", discoverUseCases: "/api/use-cases/discover", useCaseRelationships: "/api/use-cases/relationships",
    start: "/api/conversation/start", respond: "/api/conversation/respond", complete: "/api/conversation/complete", retries: "/api/retries"
  };

  function identityHeaders() {
    const authenticatedUser = window.TRUSTBUILDER_AUTH_USER;
    const role = typeof authenticatedUser?.role === "string" ? authenticatedUser.role : "";
    const userId = typeof authenticatedUser?.id === "string" ? authenticatedUser.id : "";
    return role && userId ? { "X-TrustBuilder-Role": role, "X-TrustBuilder-User": userId } : {};
  }
  function id(prefix = "request") { return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`; }
  async function request(url, { method = "GET", body, idempotencyKey, signal } = {}) {
    const requestId = id("web");
    const headers = { ...identityHeaders(), "X-Request-Id": requestId };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await fetch(url, { method, credentials: "same-origin", headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `Request failed (${response.status}).`);
      error.code = payload?.error?.code || "REQUEST_FAILED";
      error.status = response.status;
      error.requestId = payload?.requestId || requestId;
      throw error;
    }
    return payload;
  }
  function once(key, operation) {
    if (runtime.activeRequests.has(key)) return runtime.activeRequests.get(key);
    const promise = Promise.resolve().then(operation).finally(() => runtime.activeRequests.delete(key));
    runtime.activeRequests.set(key, promise);
    return promise;
  }
  async function health(force = false) {
    if (!force && runtime.health && Date.now() - runtime.healthCheckedAt < 30_000) return runtime.health;
    try { runtime.health = await request(endpoints.health); }
    catch { runtime.health = { ok: false, aiConfigured: false, offline: true }; }
    runtime.healthCheckedAt = Date.now();
    return runtime.health;
  }
  async function authSession() { return request(endpoints.authSession); }
  async function registerAccount(account) { return request(endpoints.authRegister, { method: "POST", body: account, idempotencyKey: id("register") }); }
  async function loginAccount(credentials) { return request(endpoints.authLogin, { method: "POST", body: credentials, idempotencyKey: id("login") }); }
  async function logoutAccount() { return request(endpoints.authLogout, { method: "POST", body: {}, idempotencyKey: id("logout") }); }
  async function startConversation(input) {
    return once("conversation-start", () => request(endpoints.start, { method: "POST", body: input, idempotencyKey: id("start") }));
  }
  async function respond(input) {
    const key = input.idempotencyKey || id("response");
    return once(`conversation-response:${input.sessionId}`, () => request(endpoints.respond, { method: "POST", body: { ...input, idempotencyKey: key }, idempotencyKey: key }));
  }
  async function complete(sessionId) { return once(`conversation-complete:${sessionId}`, () => request(endpoints.complete, { method: "POST", body: { sessionId }, idempotencyKey: id("complete") })); }
  async function listUsers() { return request(endpoints.users); }
  async function createUser(user) { return request(endpoints.users, { method: "POST", body: user, idempotencyKey: id("user") }); }
  async function listTemplates() { return request(endpoints.templates); }
  async function saveTemplate(template) { return request(endpoints.templates, { method: "POST", body: template, idempotencyKey: id("template") }); }
  async function listScenarios() { return request(endpoints.scenarios); }
  async function saveScenario(scenario) { return request(endpoints.scenarios, { method: "POST", body: scenario, idempotencyKey: id("scenario") }); }
  async function generateScenario(input) { return once("scenario-generate", () => request(endpoints.generateScenario, { method: "POST", body: input, idempotencyKey: id("scenario-generate") })); }
  async function listUseCases() { return request(endpoints.useCases); }
  async function discoverUseCases() { return request(endpoints.discoverUseCases, { method: "POST", body: {}, idempotencyKey: id("usecase-discover") }); }
  async function getUseCase(useCaseId) { return request(endpoints.useCases + "/" + encodeURIComponent(useCaseId)); }
  async function createUseCase(useCase) { return request(endpoints.useCases, { method: "POST", body: useCase, idempotencyKey: id("usecase-create") }); }
  async function updateUseCase(useCaseId, patch) { return request(endpoints.useCases + "/" + encodeURIComponent(useCaseId), { method: "PATCH", body: patch, idempotencyKey: id("usecase-update") }); }
  async function detectUseCase(text) { return once("usecase-detect", () => request(endpoints.detectUseCase, { method: "POST", body: { text }, idempotencyKey: id("usecase-detect") })); }
  async function analyzeUseCaseRelationships(input) { return request(endpoints.useCaseRelationships, { method: "POST", body: input, idempotencyKey: id("usecase-relationships") }); }
  async function probeUseCase(useCaseId, answer = "") {
    const key = id("usecase-probe");
    return once("usecase-probe:" + useCaseId, () => request(endpoints.useCases + "/" + encodeURIComponent(useCaseId) + "/probe", { method: "POST", body: { useCaseId, facilitatorMessage: answer, idempotencyKey: key }, idempotencyKey: key }));
  }
  async function retry(previousSessionId) { return once(`retry:${previousSessionId}`, () => request(endpoints.retries, { method: "POST", body: { previousSessionId }, idempotencyKey: id("retry") })); }
  async function approve(resultId, review) { return request(`/api/reviews/${encodeURIComponent(resultId)}/approve`, { method: "POST", body: review, idempotencyKey: id("review") }); }

  window.TrustBuilderServices = { runtime, endpoints, id, request, once, health, authSession, registerAccount, loginAccount, logoutAccount, startConversation, respond, complete, listUsers, createUser, listTemplates, saveTemplate, listScenarios, saveScenario, generateScenario, listUseCases, discoverUseCases, getUseCase, createUseCase, updateUseCase, detectUseCase, analyzeUseCaseRelationships, probeUseCase, retry, approve };
})();
