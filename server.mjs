import http from "node:http";
import path from "node:path";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { JsonStore } from "./server/store.mjs";
import { createPasswordReset, createResetMailer } from "./server/password-reset.mjs";

const require = createRequire(import.meta.url);
const domain = require("./domain.js");
const ROOT = path.dirname(fileURLToPath(import.meta.url));
try {
  const file = await readFile(path.join(ROOT, ".env"), "utf8");
  file.split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) return;
    process.env[match[1]] = match[2].replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");
  });
} catch {}
const provider = await import("./server/openai-provider.mjs");
async function defaultDataDirectory() {
  const local = path.join(ROOT, ".trustbuilder-data");
  const legacySibling = path.resolve(ROOT, "..", ".trustbuilder-data");
  try {
    await stat(path.join(legacySibling, "trustbuilder.json"));
    return legacySibling;
  } catch {
    return local;
  }
}
const DATA_DIRECTORY = process.env.TRUSTBUILDER_DATA_DIR || await defaultDataDirectory();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_ORIGIN = String(process.env.TRUSTBUILDER_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const PRODUCTION = process.env.NODE_ENV === "production";
const sessionHash = token => createHash("sha256").update(token).digest("hex");
const MAX_JSON_BYTES = 1_000_000;
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_SIZE || 25_000_000);
const rateBuckets = new Map();
const idempotencyCache = new Map();
const sessionLocks = new Map();
const authSessions = new Map();
const scrypt = promisify(scryptCallback);
const PROJECT_CONTEXT = Object.freeze({ id: "project-trustbuilder-ai-sales-excellence", name: "TrustBuilder AI Sales Excellence", motto: "Practise the judgement behind trusted client relationships." });
const USE_CASE_MODULE_CONTEXT = Object.freeze({ id: "module-use-case-discovery", name: "Use-Case Discovery & Probing", motto: "Turn business intent into evidence-ready opportunities." });

const publicUser = user => { const { passwordHash, passwordSalt, ...safe } = user; return safe; };
function parseCookies(req) { return Object.fromEntries(String(req.headers.cookie || "").split(";").map(part => part.trim().split("=")).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)])); }
function authCookie(sessionId) { return `trustbuilder_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${process.env.NODE_ENV === "production" ? "; Secure" : ""}`; }
async function passwordRecord(password) { const salt = randomBytes(16).toString("hex"); const hash = (await scrypt(password, salt, 64)).toString("hex"); return { passwordHash: hash, passwordSalt: salt }; }
async function passwordMatches(password, user) { if (!user.passwordHash || !user.passwordSalt) return false; const actual = await scrypt(password, user.passwordSalt, 64); const expected = Buffer.from(user.passwordHash, "hex"); return expected.length === actual.length && timingSafeEqual(expected, actual); }

function seed() {
  const seededUseCase = domain.normalizeUseCase({
    id: "usecase-regulatory-document-analysis",
    name: "Regulatory Document Analysis",
    description: "Analyse regulatory documents so reviewers can identify requirements, evidence gaps, and items needing human judgement.",
    objective: "Help a regulatory reviewer prepare an evidence-based compliance decision.",
    businessProblem: "Manual review is slow and inconsistent across large document sets.",
    targetUsers: ["Regulatory reviewer"],
    stakeholders: ["Compliance lead", "Legal counsel"],
    trigger: "A document package is submitted for regulatory review.",
    currentProcess: "Reviewers manually inspect and cross-reference every document.",
    desiredOutcome: "Decide whether the document package meets the applicable requirements.",
    inputs: ["Regulatory documents", "Applicable requirements"],
    outputs: ["Evidence-linked review summary", "Flagged gaps"],
    dataSources: ["Controlled document repository"],
    systems: ["Document management system"],
    constraints: ["Human reviewer retains final decision authority"],
    risks: ["A missed requirement could create a compliance exposure"],
    successCriteria: ["Every finding links to source evidence"],
    kpis: ["Review cycle time", "Reviewer-confirmed finding precision"],
    aiRole: "Extract requirements, compare evidence, and flag gaps.",
    humanRole: "Validate findings and make the final compliance decision.",
    edgeCases: ["Conflicting requirements across jurisdictions"],
    confirmedFacts: ["This is an established TrustBuilder use case."],
    decisions: ["Keep final regulatory judgement with a human reviewer."],
    status: "published",
    version: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
  });
  return {
    users: [] /*
      { id: "usr-priya", name: "Priya Shah", email: "priya.shah@example.com", role: "facilitator", cohort: "Cohort 01", status: "active", passwordSalt: "c8c99e7f550308e19cc137fb3b5519ee", passwordHash: "eafc2b9406adc43ab59d2b3c8cb585d705dd58d0634c361c1d599c0ffa28a31f26f2ef3fa7a91a772ee8f4c9e82bbf352ca49032d280f3fac0b588ccf5453d08" },
      { id: "usr-jordan", name: "Jordan Lee", email: "jordan.lee@example.com", role: "administrator", cohort: "—", status: "active" }
    */, 
    templates: [domain.clone(domain.DEFAULT_TEMPLATE)],
    scenarios: [domain.clone(domain.DEFAULT_SCENARIO), domain.clone(domain.CLIENT_TRIGGERED_SCENARIO)],
    sessions: [], evaluations: [], assessmentResults: [], attempts: [], reviews: [], audit: [],
    useCases: [seededUseCase], useCaseConversations: [], useCaseAudit: []
  };
}

const store = process.env.DATABASE_URL
  ? await new (await import("./server/postgres-store.mjs")).PostgresStore({ connectionString: process.env.DATABASE_URL, seed }).initialize()
  : await new JsonStore({ directory: DATA_DIRECTORY, seed }).initialize();
if (PRODUCTION && !process.env.DATABASE_URL) throw new Error("Production requires DATABASE_URL for persistent storage.");
const passwordReset = createPasswordReset({ store, mailer: createResetMailer(), origin: PUBLIC_ORIGIN });
if (process.env.TRUSTBUILDER_INITIAL_ADMIN) {
  const initial = JSON.parse(Buffer.from(process.env.TRUSTBUILDER_INITIAL_ADMIN, "base64").toString("utf8"));
  if (!initial.email || !initial.passwordHash || !initial.passwordSalt) throw new Error("Invalid initial administrator configuration.");
  await store.transaction(current => {
    if (!current.users.some(user => user.role === "administrator" && user.passwordHash)) {
      current.users.push({ ...initial, id: domain.createId("usr"), role: "administrator", cohort: "—", status: "active", createdAt: domain.now() });
    }
    return { data: current };
  });
}
await store.transaction(current => {
  const defaults = seed();
  const userDefaults = Object.fromEntries(defaults.users.map(user => [user.id, user]));
  current.users = (current.users || []).map(user => ({ ...(userDefaults[user.id] || {}), ...user }));
  current.templates = (current.templates || []).map(template => {
    const minimumTurns = Math.max(1, Math.trunc(Number(template.conversationRules?.minimumTurns) || domain.DEFAULT_TEMPLATE.conversationRules.minimumTurns));
    const maximumCandidate = Math.trunc(Number(template.conversationRules?.maxTurns) || domain.DEFAULT_TEMPLATE.conversationRules.maxTurns);
    return { ...template, conversationRules: { ...domain.DEFAULT_TEMPLATE.conversationRules, ...(template.conversationRules || {}), minimumTurns, maxTurns: Math.max(2, minimumTurns, maximumCandidate) } };
  });
  current.scenarios = Array.isArray(current.scenarios) ? current.scenarios : [];
  [domain.DEFAULT_SCENARIO, domain.CLIENT_TRIGGERED_SCENARIO].forEach(canonical => {
    const index = current.scenarios.findIndex(item => item.id === canonical.id);
    if (index >= 0) current.scenarios[index] = { ...domain.clone(canonical), ...current.scenarios[index] };
    else current.scenarios.push(domain.clone(canonical));
  });
  current.sessions = Array.isArray(current.sessions) ? current.sessions : [];
  current.evaluations = Array.isArray(current.evaluations) ? current.evaluations : [];
  current.assessmentResults = Array.isArray(current.assessmentResults) ? current.assessmentResults : [];
  current.attempts = Array.isArray(current.attempts) ? current.attempts : [];
  current.reviews = Array.isArray(current.reviews) ? current.reviews : [];
  current.audit = Array.isArray(current.audit) ? current.audit : [];
  current.audioEvidence = Array.isArray(current.audioEvidence) ? current.audioEvidence : [];
  current.useCases = Array.isArray(current.useCases) ? current.useCases.map(item => domain.normalizeUseCase(item)) : [];
  if (!current.useCases.some(item => item.id === defaults.useCases[0].id)) current.useCases.push(defaults.useCases[0]);
  current.useCaseConversations = Array.isArray(current.useCaseConversations) ? current.useCaseConversations : [];
  current.useCaseAudit = Array.isArray(current.useCaseAudit) ? current.useCaseAudit : [];
  current.sessions.forEach(session => {
    session.profile = domain.assessEvidence(session.conversationHistory || [], { mode: session.mode });
  });
  current.assessmentResults.forEach(result => {
    if (result.frameworkVersion === domain.FRAMEWORK_VERSION) {
      if (result.scoringVersion === domain.SCORING_VERSION) return;
      const session = current.sessions.find(s => s.id === result.sessionId);
      if (!session) return;
      result.scoreHistory = [...(result.scoreHistory || []), { scoringVersion: result.scoringVersion || "conservative-rules-v1", capabilityScores: result.capabilityScores, impactScores: result.impactScores, generatedAt: result.generatedAt }];
      const priorStatus = result.status;
      Object.assign(result, domain.assessEvidence(session.conversationHistory || [], { mode: session.mode }));
      result.status = result.humanReview ? priorStatus : "AI_EVALUATION_PENDING_HUMAN_REVIEW";
      result.migrationStatus = "rubric_recomputed_from_saved_evidence";
      return;
    }
    result.legacyFramework = { capabilityScores: result.capabilityScores || null, impactScores: result.impactScores || null, humanReview: result.humanReview || null };
    const session = current.sessions.find(s => s.id === result.sessionId);
    const corrected = domain.assessEvidence(session?.conversationHistory || [], { mode: session?.mode });
    Object.assign(result, { ...corrected, status: "AI_EVALUATION_PENDING_HUMAN_REVIEW", humanReview: null, migrationStatus: session ? "recomputed_requires_review" : "legacy_unavailable" });
  });
  current.schemaVersion = Math.max(5, Number(current.schemaVersion || 0));
  return { data: current };
});

function requestId(req) { return String(req.headers["x-request-id"] || domain.createId("request")).slice(0, 100); }
function legacyUserFromHeaders(req) {
  if (process.env.NODE_ENV !== "test" || process.env.TRUSTBUILDER_ALLOW_LEGACY_HEADERS !== "true") return null;
  const headers = req.headers || {};
  const role = String(headers["x-trustbuilder-role"] || headers["X-TrustBuilder-Role"] || "").trim().toLowerCase();
  const userId = String(headers["x-trustbuilder-user"] || headers["X-TrustBuilder-User"] || "").trim();
  if (!role || !userId) return null;
  if (!['participant', 'facilitator', 'administrator'].includes(role)) return null;
  return {
    id: userId,
    name: userId,
    email: `${userId}@example.com`,
    role,
    cohort: role === "administrator" ? "—" : "Cohort 01",
    status: "active"
  };
}
async function identity(req) {
  const token = parseCookies(req).trustbuilder_session;
  if (token && store.findSession) {
    const user = await store.findSession(sessionHash(token));
    if (user) return publicUser(user);
  }
  const session = authSessions.get(parseCookies(req).trustbuilder_session);
  if (session && session.expiresAt > Date.now()) return session.user;
  const legacyUser = process.env.NODE_ENV === "test" && process.env.TRUSTBUILDER_ALLOW_LEGACY_HEADERS === "true" ? legacyUserFromHeaders(req) : null;
  if (legacyUser) return legacyUser;
  return null;
}
function authorize(user, allowed) {
  if (!allowed.includes(user.role)) throw Object.assign(new Error("You are not authorized for this action."), { status: 403, code: "FORBIDDEN" });
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = new Set([PUBLIC_ORIGIN, `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`].filter(Boolean));
  if (!allowed.has(origin)) throw Object.assign(new Error("Request origin is not allowed."), { status: 403, code: "ORIGIN_REJECTED" });
}
function checkRateLimit(req) {
  const key = req.socket.remoteAddress || "local";
  const current = Date.now();
  const bucket = rateBuckets.get(key) || { start: current, count: 0 };
  if (current - bucket.start > 60_000) { bucket.start = current; bucket.count = 0; }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > 120) throw Object.assign(new Error("Too many requests. Please wait a moment."), { status: 429, code: "RATE_LIMITED" });
}
function safeLog(event, fields = {}) {
  console.log(JSON.stringify({ timestamp: domain.now(), event, ...Object.fromEntries(Object.entries(fields).filter(([key]) => !/response|transcript|content|message/i.test(key))) }));
}
function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  res.end(payload);
}
function sendError(res, error, id) {
  const status = Number(error.status || 500);
  const code = error.code || (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
  if (status >= 500) console.error(JSON.stringify({ timestamp: domain.now(), event: "request_failed", requestId: id, code, detail: error.message }));
  sendJson(res, status, { error: { code, message: status >= 500 && code === "INTERNAL_ERROR" ? "The request could not be completed." : error.message }, requestId: id });
}
async function jsonBody(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) throw Object.assign(new Error("Request body is too large."), { status: 413, code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400, code: "INVALID_JSON" }); }
}
function auditEntry({ actor, action, recordType, recordId, requestId: id, metadata = {} }) {
  return { id: domain.createId("audit"), timestamp: domain.now(), actorId: actor.id, actorRole: actor.role, action, recordType, recordId, requestId: id, metadata };
}
function assertSessionOwnership(session, user) {
  if (user.role === "participant" && session.participantId !== user.id) throw Object.assign(new Error("This assessment session belongs to another participant."), { status: 403, code: "SESSION_FORBIDDEN" });
}
function distinctAIMessage(message, history) {
  const normalized = domain.normalizeText(message);
  return !history.filter(turn => turn.role === "ai").some(turn => {
    const previous = domain.normalizeText(turn.text);
    if (previous === normalized) return true;
    const left = new Set(domain.tokenize(previous)), right = new Set(domain.tokenize(normalized));
    const overlap = [...left].filter(word => right.has(word)).length;
    return overlap / Math.max(1, new Set([...left, ...right]).size) >= .68;
  });
}
async function withSessionLock(sessionId, operation) {
  const previous = sessionLocks.get(sessionId) || Promise.resolve();
  const current = previous.then(operation, operation);
  let tracked;
  tracked = current.catch(() => undefined).finally(() => { if (sessionLocks.get(sessionId) === tracked) sessionLocks.delete(sessionId); });
  sessionLocks.set(sessionId, tracked);
  return current;
}
async function providerConversation(context, decision, history) {
  try {
    const generated = await provider.generateConversation(context, decision);
    const validated = domain.validateAIConversationOutput(generated);
    if (!validated.valid || !distinctAIMessage(validated.value.message, history)) throw Object.assign(new Error("AI returned a repeated or malformed message."), { code: "AI_SCHEMA_REJECTED" });
    return { ...validated.value, provider: generated.provider, model: generated.model, promptVersion: generated.promptVersion, tokenUsage: generated.tokenUsage };
  } catch (error) {
    safeLog("ai_fallback_used", { code: error.code || "AI_UNAVAILABLE" });
    const fallback = domain.fallbackAIMessage({ decision, scenario: context.scenario, evaluation: context.evaluation, history, mode: context.influenceMode?.name });
    return { ...fallback, phase: context.conversation?.turnNumber >= 2 ? 5 : 4, rationaleCode: fallback.decision };
  }
}
async function providerEvaluation(context) {
  try { return await provider.evaluateSemantics(context); }
  catch (error) { safeLog("evaluation_fallback_used", { code: error.code || "AI_UNAVAILABLE" }); return null; }
}
function buildAssessmentResult(session, template, scenario) {
  const evaluations = (session.evaluations || []).filter(e => e.accepted === true);
  const demonstrated = new Map();
  const violations = new Map();
  evaluations.forEach(evaluation => {
    evaluation.dos.forEach(item => { const existing = demonstrated.get(item.criterion); if (!existing || item.score > existing.score) demonstrated.set(item.criterion, item); });
    evaluation.donts.filter(item => item.violated).forEach(item => violations.set(item.criterion, item));
  });
  const strengths = [...demonstrated.values()].filter(item => item.status === "demonstrated").slice(0, 3).map(item => `${item.criterion}: ${item.evidence}`);
  const improvementAreas = [...demonstrated.values()].filter(item => item.status !== "demonstrated").slice(0, 3).map(item => `${item.criterion}: ${item.evidence}`);
  const weakTurns = evaluations.filter(item => item.finalScore < 65).slice(0, 3);
  return {
    ...domain.assessEvidence(session.conversationHistory, { mode: session.mode }),
    id: domain.createId("result"), sessionId: session.id, attemptNumber: session.attemptNumber, scenarioId: scenario.id, templateId: template.id,
    status: "AI_EVALUATION_PENDING_HUMAN_REVIEW", overallPerformance: session.runningScores.finalScore >= 80 ? "Strong" : session.runningScores.finalScore >= 65 ? "Functional" : "Developing",
    runningScores: session.runningScores, strengths, improvementAreas, dosPerformance: [...demonstrated.values()], dontViolations: [...violations.values()],
    communication: { grammar: session.runningScores.rawScores.grammar, vocabulary: session.runningScores.rawScores.vocabulary, repetition: session.runningScores.rawScores.repetition, relevance: session.runningScores.rawScores.relevance, clarity: session.runningScores.rawScores.clarity, professionalism: session.runningScores.rawScores.donts },
    evidence: evaluations.flatMap(item => [...item.dos.filter(observation => observation.status === "demonstrated").map(observation => ({ criterion: observation.criterion, evidence: observation.evidence, turnNumber: item.turnNumber })), ...item.donts.filter(observation => observation.violated).map(observation => ({ criterion: observation.criterion, evidence: observation.evidence, turnNumber: item.turnNumber }))]).slice(0, 12),
    betterResponseExamples: weakTurns.map(item => ({ turnNumber: item.turnNumber, original: domain.excerpt(item.originalResponse, 180), example: `Acknowledge the concern, answer directly using verified evidence, and name a precise next action for ${scenario.otherRole}.` })),
    aiProvenance: { provider: session.aiProvider, promptVersion: session.promptVersion, generatedAt: domain.now() }, humanReview: null, immutableAt: domain.now()
  };
}

function legacyFullEvaluation(payload = {}) {
  return domain.assessEvidence(payload.conversation || [], { mode: payload.mode });
}
function participantProfile(data, participantId) {
  const sessions = data.sessions.filter(s => s.participantId === participantId);
  const turns = sessions.flatMap(s => s.conversationHistory.filter(t => t.role === "participant"));
  const latest = sessions.filter(s => s.conversationHistory.some(t => t.role === "participant" && t.accepted)).at(-1);
  const approved = data.assessmentResults.filter(r => sessions.some(s => s.id === r.sessionId) && r.humanReview?.frameworkVersion === domain.FRAMEWORK_VERSION).at(-1);
  const metrics = approved?.humanReview || latest?.profile || domain.assessEvidence([]);
  const hasEvidence = [...metrics.capabilityScores, ...metrics.impactScores].some(x => x.score !== null);
  const assigned = data.scenarios.find(s => s.assignedParticipantIds?.includes(participantId));
  return { hasEvidence, profileStatus: approved ? "approved" : hasEvidence ? "provisional" : "none", responses: { total: turns.length, accepted: turns.filter(t => t.accepted).length, rejected: turns.filter(t => !t.accepted).length }, capabilities: metrics.capabilityScores, impactR: metrics.impactScores, recommendedFocus: assigned ? { scenarioId: assigned.id, title: assigned.title, objective: assigned.objective } : null, latestAttempt: latest ? { sessionId: latest.id, attemptNumber: latest.attemptNumber, scenarioId: latest.scenarioId } : null, latestApprovedAssessment: approved?.id || null, frameworkVersion: domain.FRAMEWORK_VERSION };
}

async function startConversation(payload, user, id) {
  authorize(user, ["participant", "facilitator", "administrator"]);
  const data = await store.read();
  const scenario = data.scenarios.find(item => item.id === payload.scenarioId) || payload.scenario || data.scenarios[0];
  const template = data.templates.find(item => item.id === (payload.templateId || scenario.templateId)) || data.templates[0];
  const session = domain.createSession({ scenario, template, participantId: payload.participantId || user.id, attemptNumber: payload.attemptNumber || 1, aiProvider: provider.isConfigured() ? "openai" : "safe-fallback" });
  session.mode = ["HUNT", "FARM", "MINE"].includes(payload.mode) ? payload.mode : "HUNT";
  session.sessionId = session.id;
  session.status = "ai_turn";
  const context = domain.buildConversationContext({ template, scenario, history: [], runningScores: session.runningScores, turnNumber: 0, mode: session.mode });
  let opening;
  try { opening = await provider.generateConversation(context, "FOLLOW_UP"); }
  catch { opening = { message: scenario.openingSituation, decision: "FOLLOW_UP", conversationGoal: scenario.objective, shouldContinue: true, phase: 4, rationaleCode: "OPENING_SITUATION", provider: "safe-fallback", model: "scenario-opening", promptVersion: domain.PROMPT_VERSION, tokenUsage: { input: 0, output: 0, total: 0 } }; }
  const checked = domain.validateAIConversationOutput(opening);
  const ai = checked.valid ? { ...checked.value, provider: opening.provider, model: opening.model, promptVersion: opening.promptVersion, tokenUsage: opening.tokenUsage } : { message: scenario.openingSituation, decision: "FOLLOW_UP", conversationGoal: scenario.objective, shouldContinue: true, phase: 4, rationaleCode: "OPENING_SITUATION", provider: "safe-fallback", model: "scenario-opening", promptVersion: domain.PROMPT_VERSION, tokenUsage: { input: 0, output: 0, total: 0 } };
  session.conversationHistory.push({ id: domain.createId("turn"), role: "ai", text: ai.message, decision: ai.decision, conversationGoal: ai.conversationGoal, phase: ai.phase, provider: ai.provider, model: ai.model, promptVersion: ai.promptVersion, timestamp: domain.now() });
  session.status = "waiting_for_user";
  session.updatedAt = domain.now(); session.revision += 1;
  session.tokenUsage = ai.tokenUsage || session.tokenUsage;
  data.sessions.push(session);
  data.attempts.push({ id: domain.createId("attempt"), sessionId: session.id, participantId: session.participantId, scenarioId: session.scenarioId, attemptNumber: session.attemptNumber, createdAt: session.startedAt, status: "in_progress" });
  data.audit.push(auditEntry({ actor: user, action: "conversation_started", recordType: "ConversationSession", recordId: session.id, requestId: id, metadata: { scenarioId: scenario.id, templateId: template.id } }));
  await store.transaction(current => {
    current.sessions.push(session);
    current.attempts.push(data.attempts.at(-1));
    current.audit.push(data.audit.at(-1));
    return { data: current };
  });
  safeLog("conversation_started", { requestId: id, sessionId: session.id, scenarioId: scenario.id });
  return { session, aiMessage: ai, requestId: id };
}

async function respondToConversation(payload, user, id) {
  authorize(user, ["participant", "facilitator", "administrator"]);
  if (!payload.sessionId) throw Object.assign(new Error("sessionId is required."), { status: 400, code: "SESSION_REQUIRED" });
  const idempotencyKey = String(payload.idempotencyKey || "");
  if (!idempotencyKey) throw Object.assign(new Error("idempotencyKey is required."), { status: 400, code: "IDEMPOTENCY_REQUIRED" });
  const cacheKey = `${user.id}:${payload.sessionId}:${idempotencyKey}`;
  if (idempotencyCache.has(cacheKey)) return idempotencyCache.get(cacheKey);
  return withSessionLock(payload.sessionId, async () => {
    if (idempotencyCache.has(cacheKey)) return idempotencyCache.get(cacheKey);
    const data = await store.read();
    const session = data.sessions.find(item => item.id === payload.sessionId);
    if (!session) throw Object.assign(new Error("Conversation session was not found."), { status: 404, code: "SESSION_NOT_FOUND" });
    assertSessionOwnership(session, user);
    const persisted = session.processedRequests?.[idempotencyKey];
    if (persisted) return { ...persisted, session };
    if (session.status === "completed") throw Object.assign(new Error("This assessment is already complete."), { status: 409, code: "SESSION_COMPLETED" });
    if (session.status !== "waiting_for_user") throw Object.assign(new Error("The conversation is not ready for a participant response."), { status: 409, code: "INVALID_SESSION_STATE" });
    const scenario = data.scenarios.find(item => item.id === session.scenarioId) || data.scenarios[0];
    const template = data.templates.find(item => item.id === session.templateId) || data.templates[0];
    const originalResponse = String(payload.originalResponse || "");
    const transcription = payload.transcription ? String(payload.transcription) : null;
    const audioReference = payload.audioReference ? { localId: String(payload.audioReference.localId || ""), mimeType: String(payload.audioReference.mimeType || ""), sizeBytes: Number(payload.audioReference.sizeBytes || 0), durationMs: Number(payload.audioReference.durationMs || 0), localOnly: true } : null;
    if (!(transcription || originalResponse).trim()) throw Object.assign(new Error("A response is required."), { status: 400, code: "EMPTY_RESPONSE" });
    const currentQuestion = [...session.conversationHistory].reverse().find(turn => turn.role === "ai")?.text || scenario.openingSituation;
    session.status = "evaluating"; session.submissionNumber = Number(session.submissionNumber ?? session.conversationHistory.filter(turn => turn.role === "participant").length) + 1; session.latestUserResponse = originalResponse; session.updatedAt = domain.now(); session.revision += 1;
    const semanticContext = domain.buildConversationContext({ template, scenario, history: session.conversationHistory, runningScores: session.runningScores, currentResponse: transcription || originalResponse, turnNumber: session.turnNumber, mode: session.mode });
    semanticContext.currentQuestion = currentQuestion;
    semanticContext.evaluationCriteria = { dos: scenario.dos, donts: scenario.donts };
    const semantic = await providerEvaluation(semanticContext);
    const evaluation = domain.evaluateTurn({ originalResponse, transcription, question: currentQuestion, history: session.conversationHistory, template, scenario, semanticObservations: semantic, inputType: payload.inputType || (transcription ? "voice" : "text"), turnNumber: session.submissionNumber });
    const accepted = domain.acceptEvaluation(evaluation);
    evaluation.accepted = accepted;
    if (accepted) session.turnNumber += 1;
    const participantTurn = { id: domain.createId("turn"), role: "participant", text: transcription || originalResponse, originalResponse, transcription, audioReference, inputType: evaluation.inputType, turnNumber: session.submissionNumber, acceptedTurnNumber: accepted ? session.turnNumber : null, accepted, evaluationId: evaluation.id, timestamp: domain.now() };
    Object.assign(participantTurn, { sessionId: session.id, turnId: participantTurn.id, source: evaluation.inputType === "voice" ? "voice" : "text", transcript: transcription || originalResponse, scenarioId: session.scenarioId, attemptNumber: session.attemptNumber });
    session.conversationHistory.push(participantTurn);
    session.evaluations.push(evaluation);
    session.profile = domain.assessEvidence(session.conversationHistory, { mode: session.mode });
    if (accepted) session.detectedDos = [...new Set([...session.detectedDos, ...evaluation.dos.filter(item => item.status === "demonstrated").map(item => item.criterion)])];
    session.detectedDonts = [...new Set([...session.detectedDonts, ...evaluation.donts.filter(item => item.violated).map(item => item.criterion)])];
    if (accepted) session.completedObjectives = [...new Set([...session.completedObjectives, ...evaluation.dos.filter(item => item.status === "demonstrated").map(item => item.criterion)])];
    session.runningScores = domain.aggregateRunningScores(session.evaluations.filter(e => e.accepted === true), template);
    data.evaluations.push({ ...evaluation, sessionId: session.id, turnId: participantTurn.id });
    const decision = accepted ? domain.decideConversation({ session, evaluation, template }) : { decision: "CLARIFY", shouldContinue: true, reason: "response_requires_repair" };
    let aiMessage = null;
    let result = null;
    if (!decision.shouldContinue) {
      session.status = "completed"; session.completedAt = domain.now(); session.updatedAt = session.completedAt; session.revision += 1;
      result = buildAssessmentResult(session, template, scenario);
      data.assessmentResults.push(result);
      const attempt = data.attempts.find(item => item.sessionId === session.id); if (attempt) { attempt.status = "completed"; attempt.completedAt = session.completedAt; attempt.finalScore = session.runningScores.finalScore; }
      data.audit.push(auditEntry({ actor: user, action: "conversation_completed", recordType: "ConversationSession", recordId: session.id, requestId: id, metadata: { turns: session.turnNumber } }));
      data.audit.push(auditEntry({ actor: user, action: "assessment_generated", recordType: "AssessmentResult", recordId: result.id, requestId: id, metadata: { status: result.status } }));
      safeLog("conversation_completed", { requestId: id, sessionId: session.id, turns: session.turnNumber });
    } else {
      session.status = "ai_turn";
      const nextContext = { ...semanticContext, evaluation: { relevance: evaluation.relevance, dos: evaluation.dos, donts: evaluation.donts, runningScores: session.runningScores }, conversation: { ...semanticContext.conversation, turnNumber: session.turnNumber } };
      aiMessage = await providerConversation(nextContext, decision.decision, session.conversationHistory);
      session.conversationHistory.push({ id: domain.createId("turn"), role: "ai", text: aiMessage.message, decision: aiMessage.decision, conversationGoal: aiMessage.conversationGoal, phase: aiMessage.phase, provider: aiMessage.provider, model: aiMessage.model, promptVersion: aiMessage.promptVersion, timestamp: domain.now() });
      session.status = "waiting_for_user"; session.currentObjective = aiMessage.conversationGoal; session.updatedAt = domain.now(); session.revision += 1;
      if (aiMessage.tokenUsage) session.tokenUsage = { input: session.tokenUsage.input + aiMessage.tokenUsage.input, output: session.tokenUsage.output + aiMessage.tokenUsage.output, total: session.tokenUsage.total + aiMessage.tokenUsage.total };
      data.audit.push(auditEntry({ actor: user, action: "ai_followup_generated", recordType: "ConversationTurn", recordId: session.conversationHistory.at(-1).id, requestId: id, metadata: { decision: aiMessage.decision, provider: aiMessage.provider } }));
    }
    data.audit.push(auditEntry({ actor: user, action: "user_response_received", recordType: "ConversationTurn", recordId: participantTurn.id, requestId: id, metadata: { inputType: participantTurn.inputType, submissionNumber: session.submissionNumber, acceptedTurnNumber: participantTurn.acceptedTurnNumber } }));
    data.audit.push(auditEntry({ actor: user, action: "response_evaluated", recordType: "ResponseEvaluation", recordId: evaluation.id, requestId: id, metadata: { provider: evaluation.provider, promptVersion: evaluation.promptVersion } }));
    const savedResponse = { evaluation, decision, aiMessage, assessmentResult: result, requestId: id };
    session.processedRequests = { ...session.processedRequests, [idempotencyKey]: savedResponse };
    await store.transaction(current => {
      const recording = current.audioEvidence.find(a => a.sessionId === session.id && a.localId === participantTurn.audioReference?.localId);
      if (recording) { recording.turnId = participantTurn.id; participantTurn.audioReference = recording; }
      const at = current.sessions.findIndex(s => s.id === session.id); current.sessions[at] = session;
      current.evaluations.push({ ...evaluation, sessionId: session.id, turnId: participantTurn.id });
      if (result) current.assessmentResults.push(result);
      const attempt = current.attempts.find(a => a.sessionId === session.id);
      if (attempt && result) Object.assign(attempt, { status: "completed", completedAt: session.completedAt, finalScore: session.runningScores.finalScore });
      current.audit.push(...data.audit.filter(a => !current.audit.some(existing => existing.id === a.id)));
      return { data: current };
    });
    const response = { session, ...savedResponse };
    idempotencyCache.set(cacheKey, response);
    setTimeout(() => idempotencyCache.delete(cacheKey), 10 * 60_000).unref?.();
    safeLog("response_evaluated", { requestId: id, sessionId: session.id, turnNumber: session.turnNumber, decision: decision.decision });
    return response;
  });
}

function addUseCaseAudit(data, { actor, action, recordId, requestId: id, metadata = {} }) {
  const entry = auditEntry({ actor, action, recordType: "UseCase", recordId, requestId: id, metadata });
  data.useCaseAudit = Array.isArray(data.useCaseAudit) ? data.useCaseAudit : [];
  data.audit = Array.isArray(data.audit) ? data.audit : [];
  data.useCaseAudit.push(entry);
  data.audit.push(entry);
  return entry;
}

function mergeRelationshipObservations(existing = [], incoming = []) {
  const result = [...(existing || [])];
  (incoming || []).forEach(observation => {
    const duplicate = result.some(item => item.type === observation.type && item.relatedUseCaseId === observation.relatedUseCaseId && item.direction === observation.direction);
    if (!duplicate) result.push(observation);
  });
  return result;
}

function useCasePayload(data, record) {
  const relationships = domain.detectUseCaseRelationships(record, data.useCases || []);
  return {
    useCase: record,
    knowledgeState: domain.deriveUseCaseKnowledgeState(record),
    relationships: mergeRelationshipObservations(record.relationshipObservations, relationships),
    conversation: (data.useCaseConversations || []).find(item => item.useCaseId === record.id) || null,
    project: PROJECT_CONTEXT,
    module: USE_CASE_MODULE_CONTEXT
  };
}

function requireUseCase(data, useCaseId) {
  const record = (data.useCases || []).find(item => item.id === useCaseId);
  if (!record) throw Object.assign(new Error("Use case was not found."), { status: 404, code: "USE_CASE_NOT_FOUND" });
  return record;
}

function assertUseCaseTransition(previous, next) {
  if (previous === next) return;
  const allowed = previous === "draft" && next === "published"
    || previous === "published" && next === "archived";
  if (!allowed) throw Object.assign(new Error("Unsupported use-case status transition from " + previous + " to " + next + "."), { status: 409, code: "INVALID_USE_CASE_TRANSITION" });
}

function useCasePatch(record, payload, user) {
  const allowedFields = [...domain.USE_CASE_SCALAR_FIELDS, ...domain.USE_CASE_LIST_FIELDS, "status"];
  const input = { ...record };
  allowedFields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) input[field] = payload[field];
  });
  const requestedStatus = String(input.status || record.status).toLowerCase();
  assertUseCaseTransition(record.status, requestedStatus);
  input.id = record.id;
  input.createdAt = record.createdAt;
  input.createdBy = record.createdBy;
  input.updatedAt = domain.now();
  input.updatedBy = user.id;
  input.version = Number(record.version || 0) + 1;
  const validated = domain.validateUseCase(input);
  if (!validated.valid) throw Object.assign(new Error(validated.errors.join(" ")), { status: 400, code: "INVALID_USE_CASE" });
  return validated.value;
}

function useCaseConversation(data, useCaseId, actor) {
  data.useCaseConversations = Array.isArray(data.useCaseConversations) ? data.useCaseConversations : [];
  let conversation = data.useCaseConversations.find(item => item.useCaseId === useCaseId);
  if (!conversation) {
    conversation = { id: domain.createId("usecase-conversation"), useCaseId, status: "active", turns: [], createdBy: actor.id, createdAt: domain.now(), updatedAt: domain.now() };
    data.useCaseConversations.push(conversation);
  }
  conversation.turns = Array.isArray(conversation.turns) ? conversation.turns : [];
  return conversation;
}

function conflictProbe(mergeResult) {
  const conflict = mergeResult.conflicts[0];
  const message = "The current record says \"" + domain.excerpt(conflict.existingValue, 90) + "\", while the new answer says \"" + domain.excerpt(conflict.proposedValue, 90) + "\". Which value should be treated as current?";
  return {
    message,
    question: message,
    decision: "CLARIFY",
    targetField: "conflictResolution",
    questionReason: "Conflicting facilitator evidence must be resolved without overwriting the confirmed value.",
    complete: false,
    rationaleCode: "CONTRADICTION_REQUIRES_DECISION",
    useCaseUpdate: {},
    relationshipObservations: mergeResult.relationshipObservations,
    provider: "safe-fallback",
    model: "trustbuilder-use-case-rules-v1",
    promptVersion: domain.USE_CASE_PROMPT_VERSION
  };
}

function scopeExpansionProbe(record, answer) {
  if (!/\b(?:also|in addition|expand|broaden)\b[\s\S]{0,120}\b(?:use case|workflow|department|enterprise|all teams)\b/i.test(answer)) return null;
  const observation = {
    id: domain.createId("relationship"),
    type: "SCOPE_EXPANSION",
    useCaseId: record.id,
    relatedUseCaseId: record.id,
    explanation: "The latest answer introduces capability beyond the active use-case boundary.",
    confidence: .86,
    direction: null,
    status: "suggested",
    requiresFacilitatorDecision: true
  };
  const message = "That adds scope beyond " + record.name + ". Should it extend this use case or be captured as a separate use case?";
  return {
    observation,
    probe: {
      message,
      question: message,
      decision: "RELATIONSHIP_DECISION",
      targetField: "scopeDecision",
      questionReason: "The facilitator must decide whether the new scope belongs here.",
      complete: false,
      rationaleCode: "SCOPE_EXPANSION_REQUIRES_DECISION",
      useCaseUpdate: {},
      relationshipObservations: [observation],
      provider: "safe-fallback",
      model: "trustbuilder-use-case-rules-v1",
      promptVersion: domain.USE_CASE_PROMPT_VERSION
    }
  };
}

async function generateUseCaseProbe({ record, data, conversation, latestAnswer = "", mergeResult = null }) {
  if (mergeResult?.conflicts?.length) return conflictProbe(mergeResult);
  if (mergeResult?.ambiguities?.length) {
    const ambiguity = mergeResult.ambiguities[0];
    return {
      message: ambiguity.question,
      question: ambiguity.question,
      decision: "CLARIFY",
      targetField: ambiguity.field,
      questionReason: ambiguity.reason,
      complete: false,
      rationaleCode: "AMBIGUITY_REQUIRES_THRESHOLD",
      useCaseUpdate: {},
      relationshipObservations: [],
      provider: "safe-fallback",
      model: "trustbuilder-use-case-rules-v1",
      promptVersion: domain.USE_CASE_PROMPT_VERSION
    };
  }
  const scopeExpansion = latestAnswer ? scopeExpansionProbe(record, latestAnswer) : null;
  if (scopeExpansion) return scopeExpansion.probe;
  const relationships = domain.detectUseCaseRelationships(record, data.useCases || []);
  const knowledgeState = domain.deriveUseCaseKnowledgeState(record);
  const candidates = domain.generateUseCaseProbeCandidates(record, { knowledgeState, relationships, existingUseCases: data.useCases || [] });
  const fallback = domain.fallbackUseCaseProbe(record, { history: conversation.turns, knowledgeState, relationships, existingUseCases: data.useCases || [] });
  if (!provider.isConfigured()) return fallback;
  const context = {
    promptVersion: domain.USE_CASE_PROMPT_VERSION,
    project: PROJECT_CONTEXT,
    module: USE_CASE_MODULE_CONTEXT,
    activeUseCase: domain.useCaseSummary(record),
    knowledgeState,
    relationshipObservations: relationships,
    relatedUseCases: (data.useCases || []).filter(item => item.id !== record.id).slice(0, 20).map(domain.useCaseSummary),
    previousConversation: conversation.turns.slice(-20).map(turn => ({ role: turn.role, text: domain.excerpt(turn.text, 500), targetField: turn.targetField || null, decision: turn.decision || null })),
    latestFacilitatorAnswer: { content: domain.excerpt(latestAnswer, 2000), trustBoundary: "UNTRUSTED_FACILITATOR_CONTENT" },
    rankedCandidateGaps: candidates.slice(0, 8)
  };
  try {
    const generated = await provider.probeUseCase(context);
    const checked = domain.validateUseCaseProbeOutput(generated, conversation.turns);
    const allowedTargets = new Set(candidates.map(item => item.targetField));
    if (!checked.valid || (!checked.value.complete && !allowedTargets.has(checked.value.targetField))) throw Object.assign(new Error("AI returned an unsafe or out-of-scope use-case probe."), { code: "AI_SCHEMA_REJECTED" });
    return { ...checked.value, provider: generated.provider, model: generated.model, promptVersion: generated.promptVersion, tokenUsage: generated.tokenUsage };
  } catch (error) {
    safeLog("use_case_ai_fallback_used", { code: error.code || "AI_UNAVAILABLE", useCaseId: record.id });
    return { ...fallback, providerError: error.code || "AI_UNAVAILABLE" };
  }
}

async function probeUseCase(useCaseId, payload, user, id) {
  authorize(user, ["facilitator", "administrator"]);
  if (payload.useCaseId && String(payload.useCaseId) !== useCaseId) throw Object.assign(new Error("The use-case ID does not match the route."), { status: 400, code: "USE_CASE_ID_MISMATCH" });
  const idempotencyKey = String(payload.idempotencyKey || "");
  if (!idempotencyKey) throw Object.assign(new Error("idempotencyKey is required."), { status: 400, code: "IDEMPOTENCY_REQUIRED" });
  const cacheKey = "usecase:" + useCaseId + ":" + idempotencyKey;
  if (idempotencyCache.has(cacheKey)) return idempotencyCache.get(cacheKey);
  return withSessionLock("usecase:" + useCaseId, async () => {
    if (idempotencyCache.has(cacheKey)) return idempotencyCache.get(cacheKey);
    const data = await store.read();
    let record = requireUseCase(data, useCaseId);
    const originalVersion = record.version;
    const conversation = useCaseConversation(data, useCaseId, user);
    const answer = String(payload.facilitatorMessage ?? payload.answer ?? "").replace(/\s+/g, " ").trim();
    const lastTurn = conversation.turns.at(-1);
    if (!answer && lastTurn?.role === "ai" && lastTurn.decision !== "COMPLETE") {
      const detail = useCasePayload(data, record);
      const response = { ...detail, probe: lastTurn, message: lastTurn.text, useCaseUpdate: {}, relationships: detail.relationships, nextQuestionReason: lastTurn.questionReason, complete: false, accepted: null, requestId: id };
      idempotencyCache.set(cacheKey, response);
      return response;
    }
    addUseCaseAudit(data, { actor: user, action: "use_case_probe_started", recordId: record.id, requestId: id, metadata: { hasAnswer: Boolean(answer) } });

    let mergeResult = null;
    if (answer) {
      const pendingQuestion = [...conversation.turns].reverse().find(turn => turn.role === "ai" && turn.decision !== "COMPLETE");
      if (!pendingQuestion) throw Object.assign(new Error("Start probing before submitting an answer."), { status: 409, code: "NO_PENDING_PROBE" });
      mergeResult = domain.mergeUseCaseAnswer(record, answer, pendingQuestion);
      conversation.turns.push({ id: domain.createId("usecase-turn"), role: "facilitator", text: answer, accepted: mergeResult.accepted, targetField: pendingQuestion.targetField, createdAt: domain.now(), createdBy: user.id });
      addUseCaseAudit(data, { actor: user, action: "facilitator_answer_recorded", recordId: record.id, requestId: id, metadata: { accepted: mergeResult.accepted, targetField: pendingQuestion.targetField } });
      record = mergeResult.useCase;
      record.relationshipObservations = mergeRelationshipObservations(record.relationshipObservations, mergeResult.relationshipObservations);
      if (mergeResult.updatedFields.length) {
        record.version = Number(originalVersion || 0) + 1;
        record.updatedAt = domain.now();
        record.updatedBy = user.id;
        addUseCaseAudit(data, { actor: user, action: "use_case_updated", recordId: record.id, requestId: id, metadata: { fields: [...new Set(mergeResult.updatedFields)] } });
      }
      const recordIndex = data.useCases.findIndex(item => item.id === record.id);
      data.useCases[recordIndex] = record;
      if (!mergeResult.accepted && !mergeResult.ambiguities?.length) {
        conversation.updatedAt = domain.now();
        addUseCaseAudit(data, { actor: user, action: "use_case_probe_completed", recordId: record.id, requestId: id, metadata: { accepted: false, targetField: pendingQuestion.targetField } });
        await store.write(data);
        const detail = useCasePayload(data, record);
        const response = { ...detail, probe: pendingQuestion, message: pendingQuestion.text, useCaseUpdate: {}, relationships: detail.relationships, nextQuestionReason: pendingQuestion.questionReason, complete: false, accepted: false, validationMessage: mergeResult.message, requestId: id };
        idempotencyCache.set(cacheKey, response);
        return response;
      }
    }

    const relationships = domain.detectUseCaseRelationships(record, data.useCases || []);
    const previousRelationshipKeys = new Set((record.relationshipObservations || []).map(item => item.type + ":" + item.relatedUseCaseId + ":" + (item.direction || "")));
    const newRelationships = relationships.filter(item => !previousRelationshipKeys.has(item.type + ":" + item.relatedUseCaseId + ":" + (item.direction || "")));
    record.relationshipObservations = mergeRelationshipObservations(record.relationshipObservations, relationships);
    newRelationships.forEach(observation => addUseCaseAudit(data, { actor: user, action: "use_case_relationship_detected", recordId: record.id, requestId: id, metadata: { type: observation.type, relatedUseCaseId: observation.relatedUseCaseId } }));

    const probe = await generateUseCaseProbe({ record, data, conversation, latestAnswer: answer, mergeResult });
    const probeRelationships = Array.isArray(probe.relationshipObservations) ? probe.relationshipObservations : [];
    record.relationshipObservations = mergeRelationshipObservations(record.relationshipObservations, probeRelationships);
    probeRelationships.forEach(observation => {
      const key = observation.type + ":" + observation.relatedUseCaseId + ":" + (observation.direction || "");
      if (!previousRelationshipKeys.has(key)) addUseCaseAudit(data, { actor: user, action: "use_case_relationship_detected", recordId: record.id, requestId: id, metadata: { type: observation.type, relatedUseCaseId: observation.relatedUseCaseId } });
    });
    data.useCases[data.useCases.findIndex(item => item.id === record.id)] = record;
    conversation.turns.push({ id: domain.createId("usecase-turn"), role: "ai", text: probe.message, decision: probe.decision, targetField: probe.targetField, questionReason: probe.questionReason, rationaleCode: probe.rationaleCode, complete: probe.complete, provider: probe.provider, model: probe.model, promptVersion: probe.promptVersion, createdAt: domain.now() });
    conversation.status = probe.complete ? "ready_for_review" : "waiting_for_facilitator";
    conversation.updatedAt = domain.now();
    addUseCaseAudit(data, { actor: user, action: probe.complete ? "knowledge_gap_review_completed" : "knowledge_gap_detected", recordId: record.id, requestId: id, metadata: { targetField: probe.targetField, rationaleCode: probe.rationaleCode } });
    addUseCaseAudit(data, { actor: user, action: "probing_question_asked", recordId: record.id, requestId: id, metadata: { targetField: probe.targetField, provider: probe.provider } });
    addUseCaseAudit(data, { actor: user, action: "use_case_probe_completed", recordId: record.id, requestId: id, metadata: { accepted: mergeResult ? mergeResult.accepted : null, complete: probe.complete, targetField: probe.targetField } });
    const currentIndex = data.useCases.findIndex(item => item.id === record.id);
    if (data.useCases[currentIndex].version !== originalVersion && !answer) throw Object.assign(new Error("Use case changed while probing. Reload and try again."), { status: 409, code: "USE_CASE_VERSION_CONFLICT" });
    data.useCases[currentIndex] = record;
    await store.write(data);
    const detail = useCasePayload(data, record);
    const response = {
      ...detail,
      probe,
      message: probe.message,
      useCaseUpdate: mergeResult ? { updatedFields: [...new Set(mergeResult.updatedFields)], confirmedFacts: record.confirmedFacts, assumptions: record.assumptions, openQuestions: record.openQuestions, decisions: record.decisions, dependencies: record.dependencies, risks: record.risks } : {},
      relationships: detail.relationships,
      nextQuestionReason: probe.questionReason,
      complete: probe.complete,
      accepted: mergeResult ? mergeResult.accepted : null,
      validationMessage: mergeResult && !mergeResult.accepted ? mergeResult.message : null,
      requestId: id
    };
    idempotencyCache.set(cacheKey, response);
    setTimeout(() => idempotencyCache.delete(cacheKey), 10 * 60_000).unref?.();
    return response;
  });
}

async function routeApi(req, res, url, id) {
  checkRateLimit(req);
  if (req.method !== "GET") checkOrigin(req);
  if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true, aiConfigured: provider.isConfigured(), storage: process.env.DATABASE_URL ? "postgres" : "durable-json", promptVersion: domain.PROMPT_VERSION, requestId: id });

  if (url.pathname === "/api/auth/session" && req.method === "GET") {
    const user = await identity(req);
    return sendJson(res, 200, { authenticated: Boolean(user), user, requestId: id });
  }
  if (url.pathname === '/api/auth/forgot-password' && req.method === 'POST') {
    const payload = await jsonBody(req);
    if (!store.issuePasswordReset) throw Object.assign(new Error('Password reset requires the connected database.'), { status: 503, code: 'RESET_EMAIL_UNAVAILABLE' });
    return sendJson(res, 200, await passwordReset.request(payload.email));
  }
  if (url.pathname === '/api/auth/reset-password' && req.method === 'POST') {
    const payload = await jsonBody(req);
    if (!store.consumePasswordReset) throw Object.assign(new Error('Password reset requires the connected database.'), { status: 503, code: 'RESET_EMAIL_UNAVAILABLE' });
    return sendJson(res, 200, await passwordReset.complete(payload.token, payload.password));
  }
  if (url.pathname === "/api/auth/register" && req.method === "POST") {
    const payload = await jsonBody(req); const name = String(payload.name || "").trim(); const email = String(payload.email || "").trim().toLowerCase(); const password = String(payload.password || ""); const role = String(payload.role || "").trim().toLowerCase();
    if (name.length < 2) throw Object.assign(new Error("Full name is required."), { status: 400, code: "INVALID_NAME" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400, code: "INVALID_EMAIL" });
    if (password.length < 8) throw Object.assign(new Error("Password must be at least 8 characters."), { status: 400, code: "PASSWORD_TOO_SHORT" });
    if (!["participant", "facilitator", "administrator"].includes(role)) throw Object.assign(new Error("Choose a valid account type."), { status: 400, code: "INVALID_ACCOUNT_ROLE" });
    if (role !== "participant" && process.env.NODE_ENV !== "test") throw Object.assign(new Error("Staff accounts must be provisioned by an administrator."), { status: 403, code: "STAFF_REGISTRATION_DISABLED" });
    const credentials = await passwordRecord(password);
    const created = await store.transaction(current => {
      if (current.users.some(item => String(item.email || "").toLowerCase() === email)) throw Object.assign(new Error("An account with this email already exists."), { status: 409, code: "USER_EMAIL_EXISTS" });
      const record = { id: domain.createId("usr"), name, email, role, cohort: role === "administrator" ? "—" : "Cohort 01", status: "active", createdAt: domain.now(), ...credentials };
      current.users.push(record); current.audit.push(auditEntry({ actor: { id: record.id, role }, action: "account_registered", recordType: "User", recordId: record.id, requestId: id })); return { data: current, result: publicUser(record) };
    });
    return sendJson(res, 201, { user: created, message: "Account created. Please log in.", requestId: id });
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const payload = await jsonBody(req); const email = String(payload.email || "").trim().toLowerCase(); const password = String(payload.password || ""); const data = await store.read(); const account = data.users.find(item => String(item.email || "").toLowerCase() === email);
    if (!account || account.status !== "active" || !(await passwordMatches(password, account))) throw Object.assign(new Error("Invalid email or password."), { status: 401, code: "INVALID_CREDENTIALS" });
    const sessionId = randomBytes(32).toString("hex"); const user = publicUser(account);
    if (store.saveSession) await store.saveSession(sessionHash(sessionId), user.id, Date.now() + 86_400_000, account.passwordHash);
    else authSessions.set(sessionId, { user, expiresAt: Date.now() + 86_400_000 });
    return sendJson(res, 200, { user, requestId: id }, { "Set-Cookie": authCookie(sessionId) });
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const cookies = parseCookies(req); if (cookies.trustbuilder_session) authSessions.delete(cookies.trustbuilder_session);
    if (cookies.trustbuilder_session && store.deleteSession) await store.deleteSession(sessionHash(cookies.trustbuilder_session));
    return sendJson(res, 200, { authenticated: false, requestId: id }, { "Set-Cookie": "trustbuilder_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
  }

  const user = await identity(req);
  if (!user) throw Object.assign(new Error("Authentication is required."), { status: 401, code: "AUTHENTICATION_REQUIRED" });

  if (url.pathname === "/api/use-cases/detect" && req.method === "POST") {
    authorize(user, ["facilitator", "administrator"]);
    const payload = await jsonBody(req);
    const text = String(payload.text || "").trim();
    if (!text) throw Object.assign(new Error("Facilitator text is required."), { status: 400, code: "USE_CASE_TEXT_REQUIRED" });
    let detection = domain.detectNewUseCaseIntent(text);
    if ((!detection.detected || !detection.candidate) && provider.isConfigured()) {
      try {
        const generated = await provider.detectUseCase({ text });
        if (generated.detected && generated.name?.trim()) {
          detection = {
            detected: true,
            confidence: Number(generated.confidence || .7),
            sourceText: text,
            needsName: false,
            candidate: domain.normalizeUseCase({ name: generated.name, description: generated.description || text, status: "draft" }, { actorId: user.id })
          };
        }
      } catch (error) {
        safeLog("use_case_detection_fallback_used", { code: error.code || "AI_UNAVAILABLE" });
      }
    }
    const data = await store.read();
    const relationships = detection.candidate ? domain.detectUseCaseRelationships(detection.candidate, data.useCases || []) : [];
    return sendJson(res, 200, { ...detection, relationships, requiresConfirmation: Boolean(detection.candidate), project: PROJECT_CONTEXT, module: USE_CASE_MODULE_CONTEXT, requestId: id });
  }

  if (url.pathname === "/api/use-cases/relationships" && req.method === "POST") {
    authorize(user, ["facilitator", "administrator"]);
    const payload = await jsonBody(req);
    const data = await store.read();
    const candidate = payload.useCaseId ? requireUseCase(data, String(payload.useCaseId)) : domain.normalizeUseCase(payload.candidate || {});
    if (!candidate.name || candidate.name === "Untitled use case") throw Object.assign(new Error("A saved use-case ID or candidate name is required."), { status: 400, code: "USE_CASE_REQUIRED" });
    const relationships = domain.detectUseCaseRelationships(candidate, data.useCases || []);
    if (payload.useCaseId) {
      await store.transaction(current => {
        const record = requireUseCase(current, candidate.id);
        const previous = new Set((record.relationshipObservations || []).map(item => item.type + ":" + item.relatedUseCaseId + ":" + (item.direction || "")));
        record.relationshipObservations = mergeRelationshipObservations(record.relationshipObservations, relationships);
        relationships.filter(item => !previous.has(item.type + ":" + item.relatedUseCaseId + ":" + (item.direction || ""))).forEach(observation => {
          addUseCaseAudit(current, { actor: user, action: "use_case_relationship_detected", recordId: record.id, requestId: id, metadata: { type: observation.type, relatedUseCaseId: observation.relatedUseCaseId } });
        });
        return { data: current };
      });
    }
    return sendJson(res, 200, { relationships, candidate: domain.useCaseSummary(candidate), requestId: id });
  }

  if (url.pathname === "/api/use-cases/discover" && (req.method === "GET" || req.method === "POST")) {
    authorize(user, ["facilitator", "administrator"]);
    const data = await store.read();
    const proposals = domain.discoverUseCases(data.useCases || []);
    return sendJson(res, 200, { proposals, project: PROJECT_CONTEXT, module: USE_CASE_MODULE_CONTEXT, requestId: id });
  }

  if (url.pathname === "/api/use-cases") {
    authorize(user, ["facilitator", "administrator"]);
    if (req.method === "GET") {
      const data = await store.read();
      const useCases = (data.useCases || []).map(record => {
        const knowledge = domain.deriveUseCaseKnowledgeState(record);
        const relationships = domain.detectUseCaseRelationships(record, data.useCases || []);
        return { ...record, knowledgeSummary: { completeness: knowledge.completeness, openCount: knowledge.open.length, confirmedCount: knowledge.confirmed.length }, relationshipCount: mergeRelationshipObservations(record.relationshipObservations, relationships).length };
      });
      const proposals = domain.discoverUseCases(data.useCases || []);
      return sendJson(res, 200, { useCases, proposals, project: PROJECT_CONTEXT, module: USE_CASE_MODULE_CONTEXT, requestId: id });
    }
    if (req.method !== "POST") throw Object.assign(new Error("Method not allowed."), { status: 405, code: "METHOD_NOT_ALLOWED" });
    const payload = await jsonBody(req);
    const created = await store.transaction(current => {
      const candidate = domain.normalizeUseCase({ ...payload, id: domain.createId("usecase"), status: "draft", version: 1 }, { actorId: user.id });
      candidate.createdBy = user.id;
      candidate.updatedBy = user.id;
      candidate.createdAt = domain.now();
      candidate.updatedAt = candidate.createdAt;
      const validation = domain.validateUseCase(candidate);
      if (!validation.valid) throw Object.assign(new Error(validation.errors.join(" ")), { status: 400, code: "INVALID_USE_CASE" });
      const relationships = domain.detectUseCaseRelationships(validation.value, current.useCases || []);
      validation.value.relationshipObservations = relationships;
      current.useCases.push(validation.value);
      addUseCaseAudit(current, { actor: user, action: "use_case_created", recordId: validation.value.id, requestId: id, metadata: { status: "draft" } });
      relationships.forEach(observation => addUseCaseAudit(current, { actor: user, action: "use_case_relationship_detected", recordId: validation.value.id, requestId: id, metadata: { type: observation.type, relatedUseCaseId: observation.relatedUseCaseId } }));
      return { data: current, result: useCasePayload(current, validation.value) };
    });
    return sendJson(res, 201, { ...created, requestId: id });
  }

  const useCaseProbeMatch = url.pathname.match(/^\/api\/use-cases\/([^/]+)\/probe$/);
  if (useCaseProbeMatch && req.method === "POST") {
    const payload = await jsonBody(req);
    payload.idempotencyKey = payload.idempotencyKey || req.headers["idempotency-key"];
    return sendJson(res, 200, await probeUseCase(decodeURIComponent(useCaseProbeMatch[1]), payload, user, id));
  }

  const useCaseMatch = url.pathname.match(/^\/api\/use-cases\/([^/]+)$/);
  if (useCaseMatch) {
    authorize(user, ["facilitator", "administrator"]);
    const useCaseId = decodeURIComponent(useCaseMatch[1]);
    if (req.method === "GET") {
      const data = await store.read();
      return sendJson(res, 200, { ...useCasePayload(data, requireUseCase(data, useCaseId)), requestId: id });
    }
    if (req.method !== "PATCH") throw Object.assign(new Error("Method not allowed."), { status: 405, code: "METHOD_NOT_ALLOWED" });
    const payload = await jsonBody(req);
    const updated = await withSessionLock("usecase:" + useCaseId, () => store.transaction(current => {
      const existing = requireUseCase(current, useCaseId);
      if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(existing.version)) throw Object.assign(new Error("Use case changed since it was loaded. Reload and try again."), { status: 409, code: "USE_CASE_VERSION_CONFLICT" });
      const record = useCasePatch(existing, payload, user);
      const relationships = domain.detectUseCaseRelationships(record, current.useCases || []);
      record.relationshipObservations = mergeRelationshipObservations(existing.relationshipObservations, relationships);
      current.useCases[current.useCases.findIndex(item => item.id === record.id)] = record;
      const action = existing.status !== "published" && record.status === "published" ? "use_case_published" : "use_case_updated";
      addUseCaseAudit(current, { actor: user, action, recordId: record.id, requestId: id, metadata: { fromStatus: existing.status, toStatus: record.status, version: record.version } });
      relationships.forEach(observation => addUseCaseAudit(current, { actor: user, action: "use_case_relationship_detected", recordId: record.id, requestId: id, metadata: { type: observation.type, relatedUseCaseId: observation.relatedUseCaseId } }));
      return { data: current, result: useCasePayload(current, record) };
    }));
    return sendJson(res, 200, { ...updated, requestId: id });
  }

  if (url.pathname === "/api/users") {
    authorize(user, ["administrator"]);
    if (req.method === "GET") { const data = await store.read(); return sendJson(res, 200, { users: data.users.map(publicUser), requestId: id }); }
    const payload = await jsonBody(req); const name = String(payload.name || "").trim(); const email = String(payload.email || "").trim().toLowerCase(); const role = String(payload.role || "participant").toLowerCase();
    if (name.length < 2) throw Object.assign(new Error("A full name is required."), { status: 400, code: "INVALID_USER_NAME" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("A valid email address is required."), { status: 400, code: "INVALID_USER_EMAIL" });
    if (!["participant", "facilitator", "administrator"].includes(role)) throw Object.assign(new Error("The selected role is invalid."), { status: 400, code: "INVALID_USER_ROLE" });
    const temporaryPassword = randomBytes(18).toString("base64url");
    const userCredentials = await passwordRecord(temporaryPassword);
    const created = await store.transaction(current => {
      if (current.users.some(item => String(item.email || "").toLowerCase() === email)) throw Object.assign(new Error("A user with this email already exists."), { status: 409, code: "USER_EMAIL_EXISTS" });
      const record = { id: domain.createId("usr"), name, email, role, cohort: role === "administrator" ? "—" : String(payload.cohort || "Cohort 01"), status: "active", createdAt: domain.now(), ...userCredentials };
      current.users.push(record); current.audit.push(auditEntry({ actor: user, action: "user_created", recordType: "User", recordId: record.id, requestId: id, metadata: { role } })); return { data: current, result: record };
    });
    return sendJson(res, 201, { user: publicUser(created), temporaryPassword, requestId: id });
  }

  if (url.pathname === "/api/templates") {
    if (req.method === "GET") { authorize(user, ["facilitator", "administrator"]); const data = await store.read(); return sendJson(res, 200, { templates: data.templates, requestId: id }); }
    const payload = await jsonBody(req); authorize(user, ["administrator"]);
    const validation = domain.validateTemplate(payload);
    if (!validation.valid) throw Object.assign(new Error(validation.errors.join(" ")), { status: 400, code: "INVALID_TEMPLATE" });
    const template = { ...validation.value, id: payload.id || domain.createId("template"), version: Number(payload.version || 0) + 1, updatedAt: domain.now(), updatedBy: user.id };
    await store.transaction(data => { const index = data.templates.findIndex(item => item.id === template.id); if (index >= 0) data.templates[index] = template; else data.templates.push(template); data.audit.push(auditEntry({ actor: user, action: index >= 0 ? "template_updated" : "template_created", recordType: "Template", recordId: template.id, requestId: id })); return { data, result: template }; });
    return sendJson(res, payload.id ? 200 : 201, { template, requestId: id });
  }

  if (url.pathname === "/api/scenarios/generate" && req.method === "POST") {
    authorize(user, ["facilitator", "administrator"]); const payload = await jsonBody(req); const data = await store.read(); const template = data.templates.find(item => item.id === payload.templateId) || data.templates[0];
    let draft;
    try { draft = await provider.generateScenario({ ...payload, template }); }
    catch { draft = { title: payload.topic || "New client conversation", context: `${payload.industry || "Client"} scenario for ${payload.participantRole || "participant"}.`, participantRole: payload.participantRole || "Engagement lead", otherRole: payload.otherRole || "Client sponsor", objective: payload.objective || template.objective, openingSituation: `I'd like to discuss ${String(payload.topic || "the current concern").toLowerCase()}. What happened from your perspective?`, dos: template.dos.slice(0, 4), donts: template.donts.slice(0, 4), expectedBehaviors: template.dos.slice(0, 4), evaluationCriteria: template.evaluationCriteria, possibleConversationDirections: ["clarify context", "assess impact", "agree next action"], provider: "safe-fallback" }; }
    const scenario = { ...draft, id: domain.createId("scenario-draft"), templateId: template.id, difficulty: payload.difficulty || template.difficulty, status: "draft", active: false, generatedAt: domain.now(), generatedBy: user.id };
    return sendJson(res, 200, { scenario, editable: true, published: false, requestId: id });
  }

  if (url.pathname === "/api/scenarios") {
    if (req.method === "GET") { const data = await store.read(); const visible = user.role === "participant" ? data.scenarios.filter(item => [domain.DEFAULT_SCENARIO.id, domain.CLIENT_TRIGGERED_SCENARIO.id].includes(item.id) && item.status === "published" && item.active !== false) : data.scenarios; return sendJson(res, 200, { scenarios: visible, requestId: id }); }
    authorize(user, ["facilitator", "administrator"]); const payload = await jsonBody(req); const data = await store.read(); const template = data.templates.find(item => item.id === payload.templateId) || data.templates[0]; const resolved = domain.resolveScenario(payload, template).scenario;
    if (!resolved.title?.trim() || !resolved.objective?.trim() || !resolved.openingSituation?.trim()) throw Object.assign(new Error("Scenario title, objective, and opening situation are required."), { status: 400, code: "INVALID_SCENARIO" });
    const scenario = { ...resolved, id: payload.id || domain.createId("scenario"), status: payload.status === "published" ? "published" : "draft", active: payload.status === "published", version: Number(payload.version || 0) + 1, updatedAt: domain.now(), updatedBy: user.id };
    await store.transaction(current => { const index = current.scenarios.findIndex(item => item.id === scenario.id); if (index >= 0) current.scenarios[index] = scenario; else current.scenarios.push(scenario); current.audit.push(auditEntry({ actor: user, action: scenario.status === "published" ? "scenario_published" : "scenario_saved", recordType: "Scenario", recordId: scenario.id, requestId: id })); return { data: current, result: scenario }; });
    return sendJson(res, payload.id ? 200 : 201, { scenario, requestId: id });
  }

  if (url.pathname === "/api/participants/me/profile" && req.method === "GET") {
    return sendJson(res, 200, participantProfile(await store.read(), user.id));
  }
  if (url.pathname === "/api/evidence/audio" && req.method === "POST") {
    const pieces = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES + 16384) throw Object.assign(new Error("Recording exceeds the upload limit."), { status: 413 });
      pieces.push(chunk);
    }
    const form = await new Request("http://localhost/evidence", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body: Buffer.concat(pieces) }).formData();
    const sessionId = String(form.get("sessionId") || ""), localId = String(form.get("localId") || "");
    const data = await store.read(); const session = data.sessions.find(s => s.id === sessionId);
    if (!session) throw Object.assign(new Error("Session not found."), { status: 404 });
    assertSessionOwnership(session, user);
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(localId)) throw Object.assign(new Error("Invalid evidence reference."), { status: 400 });
    const existing = data.audioEvidence.find(a => a.sessionId === sessionId && a.localId === localId);
    if (existing) return sendJson(res, 200, { evidence: existing });
    const blob = form.get("audio");
    if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_UPLOAD_BYTES || !/^audio\/(webm|ogg|mp4|wav)/.test(blob.type)) throw Object.assign(new Error("Unsupported or empty recording."), { status: 400 });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const valid = bytes.subarray(0,4).toString("hex") === "1a45dfa3" || bytes.subarray(0,4).toString() === "OggS" || bytes.subarray(0,4).toString() === "RIFF" || bytes.subarray(4,8).toString() === "ftyp";
    if (!valid) throw Object.assign(new Error("Invalid audio container."), { status: 400 });
    const evidenceId = domain.createId("audio");
    await mkdir(path.join(DATA_DIRECTORY, "audio"), { recursive: true });
    await writeFile(path.join(DATA_DIRECTORY, "audio", evidenceId), bytes, { mode: 0o600, flag: "wx" });
    const evidence = { id: evidenceId, localId, sessionId, participantId: session.participantId, attemptNumber: session.attemptNumber, scenarioId: session.scenarioId, timestamp: domain.now(), mimeType: blob.type, sizeBytes: blob.size, localOnly: false, url: `/api/evidence/audio/${evidenceId}` };
    await store.transaction(current => {
      const saved = current.sessions.find(s => s.id === sessionId);
      const turn = saved.conversationHistory.find(t => t.audioReference?.localId === localId);
      if (turn) { evidence.turnId = turn.id; turn.audioReference = evidence; }
      current.audioEvidence.push(evidence); return { data: current };
    });
    return sendJson(res, 201, { evidence });
  }
  if (url.pathname.startsWith("/api/evidence/audio/") && req.method === "GET") {
    const data = await store.read(); const evidence = data.audioEvidence.find(a => a.id === url.pathname.split("/").at(-1));
    if (!evidence) throw Object.assign(new Error("Evidence not found."), { status: 404 });
    assertSessionOwnership({ participantId: evidence.participantId }, user);
    const bytes = await readFile(path.join(DATA_DIRECTORY, "audio", evidence.id));
    res.writeHead(200, { "Content-Type": evidence.mimeType, "Content-Length": bytes.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); return res.end(bytes);
  }
  if (url.pathname === "/api/reviews" && req.method === "GET") {
    authorize(user, ["facilitator", "administrator"]);
    const data = await store.read();
    return sendJson(res, 200, { results: data.assessmentResults.map(result => ({ ...result, participant: publicUser(data.users.find(u => u.id === data.sessions.find(s => s.id === result.sessionId)?.participantId) || {}), session: data.sessions.find(s => s.id === result.sessionId) })) });
  }
  if (url.pathname.startsWith("/api/conversation/session/") && req.method === "GET") {
    const data = await store.read(); const session = data.sessions.find(s => s.id === url.pathname.split("/").at(-1));
    if (!session) throw Object.assign(new Error("Session not found."), { status: 404 });
    assertSessionOwnership(session, user); return sendJson(res, 200, { session });
  }
  if (url.pathname === "/api/voice/config" && req.method === "GET") return sendJson(res, 200, { realtime: false, freeMode: true, speech: "browser", recognition: "browser" });
  if (url.pathname === "/api/conversation/start" && req.method === "POST") return sendJson(res, 201, await startConversation(await jsonBody(req), user, id));
  if (url.pathname === "/api/conversation/respond" && req.method === "POST") return sendJson(res, 200, await respondToConversation(await jsonBody(req), user, id));
  if (url.pathname === "/api/conversation/complete" && req.method === "POST") {
    const payload = await jsonBody(req); authorize(user, ["participant", "facilitator", "administrator"]); const data = await store.read(); const session = data.sessions.find(item => item.id === payload.sessionId); if (!session) throw Object.assign(new Error("Conversation session was not found."), { status: 404, code: "SESSION_NOT_FOUND" }); assertSessionOwnership(session, user);
    const template = data.templates.find(item => item.id === session.templateId) || data.templates[0]; const scenario = data.scenarios.find(item => item.id === session.scenarioId) || data.scenarios[0]; session.status = "completed"; session.completedAt = domain.now(); session.updatedAt = session.completedAt; const result = buildAssessmentResult(session, template, scenario); data.assessmentResults.push(result); data.audit.push(auditEntry({ actor: user, action: "conversation_completed", recordType: "ConversationSession", recordId: session.id, requestId: id, metadata: { endedBy: user.role } })); await store.write(data); return sendJson(res, 200, { session, assessmentResult: result, requestId: id });
  }
  if (url.pathname === "/api/retries" && req.method === "POST") {
    const payload = await jsonBody(req); authorize(user, ["participant", "facilitator", "administrator"]); const data = await store.read(); const previous = data.sessions.find(item => item.id === payload.previousSessionId); if (!previous) throw Object.assign(new Error("Previous attempt was not found."), { status: 404, code: "ATTEMPT_NOT_FOUND" }); assertSessionOwnership(previous, user); const started = await startConversation({ scenarioId: previous.scenarioId, templateId: previous.templateId, participantId: previous.participantId, attemptNumber: previous.attemptNumber + 1 }, user, id); started.comparisonBaseline = { previousSessionId: previous.id, previousScore: previous.runningScores.finalScore }; safeLog("retry_started", { requestId: id, previousSessionId: previous.id, sessionId: started.session.id }); return sendJson(res, 201, started);
  }
  if (url.pathname.startsWith("/api/reviews/") && url.pathname.endsWith("/approve") && req.method === "POST") {
    authorize(user, ["facilitator", "administrator"]);
    const resultId = url.pathname.split("/")[3]; const payload = await jsonBody(req);
    const approved = await store.transaction(data => {
      const result = data.assessmentResults.find(r => r.id === resultId);
      if (!result) throw Object.assign(new Error("Assessment not found."), { status: 404 });
      if (result.humanReview) throw Object.assign(new Error("This assessment has already been reviewed."), { status: 409 });
      if (!result.capabilityScores.some(d => d.score !== null) && !result.impactScores.some(d => d.score !== null)) throw Object.assign(new Error("No scored evidence to approve."), { status: 400 });
      const finalScore = payload.finalScore ?? result.runningScores.finalScore;
      if (!Number.isFinite(finalScore) || finalScore < 0 || finalScore > 100) throw Object.assign(new Error("Invalid overall score."), { status: 400 });
      const validate = (original, supplied) => original.map(metric => {
        const value = supplied?.find(m => m.name === metric.name);
        if (!value) return domain.clone(metric);
        if (value.score !== null && (!Number.isFinite(value.score) || value.score < 1 || value.score > 5)) throw Object.assign(new Error("Metric scores must be null or between 1 and 5."), { status: 400 });
        if (value.score !== null && !String(value.evidence || metric.evidence).trim()) throw Object.assign(new Error("A score requires evidence."), { status: 400 });
        return { ...metric, score: value.score, evidence: String(value.evidence || metric.evidence), evidenceStatus: value.score === null ? "not_observed" : "observed" };
      });
      const capabilityScores = validate(result.capabilityScores, payload.capabilityScores);
      const impactScores = validate(result.impactScores, payload.impactScores);
      const changed = finalScore !== result.runningScores.finalScore || JSON.stringify(capabilityScores) !== JSON.stringify(result.capabilityScores) || JSON.stringify(impactScores) !== JSON.stringify(result.impactScores);
      if (changed && !String(payload.overrideReason || "").trim()) throw Object.assign(new Error("Explain the score override."), { status: 400 });
      result.humanReview = { reviewerId: user.id, status: "approved", finalScore, capabilityScores, impactScores, frameworkVersion: domain.FRAMEWORK_VERSION, comments: String(payload.comments || ""), overrideReason: String(payload.overrideReason || ""), reviewedAt: domain.now() };
      result.status = "HUMAN_REVIEWED_FINAL";
      data.reviews.push({ id: domain.createId("review"), resultId, ...result.humanReview });
      data.audit.push(auditEntry({ actor: user, action: "human_reviewed", recordType: "AssessmentResult", recordId: resultId, requestId: id, metadata: { overridden: changed } }));
      return { data, result };
    });
    return sendJson(res, 200, { assessmentResult: approved, requestId: id });
  }

  // Backward-compatible AI contracts used by the existing six-phase client.
  if (url.pathname === "/api/ai/conversation/next" && req.method === "POST") {
    const payload = await jsonBody(req); const context = payload.assistantContext || domain.buildConversationContext({ template: domain.DEFAULT_TEMPLATE, scenario: payload.scenario || domain.DEFAULT_SCENARIO, history: payload.conversation || [], runningScores: {}, turnNumber: (payload.conversation || []).filter(turn => turn.role === "participant" && turn.accepted).length }); const generated = await providerConversation(context, null, payload.conversation || []); return sendJson(res, 200, { question: generated.message, phase: generated.phase, complete: !generated.shouldContinue, rationaleCode: generated.rationaleCode, provider: generated.provider, model: generated.model, promptVersion: generated.promptVersion });
  }
  if (url.pathname === "/api/ai/conversation/validate" && req.method === "POST") {
    const payload = await jsonBody(req); const context = { ...(payload.assistantContext || {}), currentQuestion: payload.question, participantResponse: { content: payload.answer, trustBoundary: "UNTRUSTED_PARTICIPANT_CONTENT" }, evaluationCriteria: { dos: domain.DEFAULT_TEMPLATE.dos, donts: domain.DEFAULT_TEMPLATE.donts } }; const semantic = await providerEvaluation(context); const relevance = semantic?.relevance || domain.evaluateRelevance(payload.answer, payload.question, payload.context?.scenario || domain.DEFAULT_SCENARIO); const relevant = ["highly_relevant", "relevant"].includes(relevance.classification); return sendJson(res, 200, { relevant, supported: !/\b(?:guarantee|100%)\b/i.test(payload.answer) || /cannot|can't|subject to|until/i.test(payload.answer), scenarioConnection: relevance.classification, evidenceUsed: relevance.evidence, flags: relevant ? [] : [relevance.classification === "irrelevant" ? "off-topic" : "insufficient-detail"], retryInstruction: relevance.missingInformation?.[0] || "Answer the stakeholder's current question directly." });
  }
  if (url.pathname === "/api/ai/evaluate" && req.method === "POST") {
    const payload = await jsonBody(req);
    if (payload.sessionId) {
      const session = (await store.read()).sessions.find(s => s.id === payload.sessionId);
      if (!session) throw Object.assign(new Error("Session not found."), { status: 404 });
      assertSessionOwnership(session, user);
      return sendJson(res, 200, domain.assessEvidence(session.conversationHistory, { mode: session.mode }));
    }
    return sendJson(res, 200, { ...legacyFullEvaluation(payload), unpersisted: true });
  }
  if (url.pathname === "/api/ai/speech" && req.method === "POST") {
    const payload = await jsonBody(req); if (!payload.text?.trim()) throw Object.assign(new Error("Speech text is required."), { status: 400, code: "TEXT_REQUIRED" }); const speech = await provider.synthesizeSpeech(String(payload.text).slice(0, 2000)); res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }); Readable.fromWeb(speech.body).pipe(res); return;
  }
  if (url.pathname === "/api/ai/transcribe" && req.method === "POST") {
    const webRequest = new Request(`http://${HOST}:${PORT}${url.pathname}`, { method: "POST", headers: req.headers, body: Readable.toWeb(req), duplex: "half" }); const form = await webRequest.formData(); const audio = form.get("audio"); if (!(audio instanceof Blob)) throw Object.assign(new Error("Audio file is required."), { status: 400, code: "AUDIO_REQUIRED" }); if (!audio.size) throw Object.assign(new Error("Audio file is empty."), { status: 400, code: "AUDIO_EMPTY" }); if (audio.size > MAX_UPLOAD_BYTES) throw Object.assign(new Error(`Audio file exceeds ${Math.floor(MAX_UPLOAD_BYTES / 1_000_000)} MB.`), { status: 413, code: "AUDIO_TOO_LARGE" }); const context = JSON.parse(String(form.get("context") || "{}")); const result = await provider.transcribe(audio, { prompt: (context.keywordHints || []).join(", ") }); return sendJson(res, 200, { ...result, requestId: id });
  }

  throw Object.assign(new Error("API route not found."), { status: 404, code: "NOT_FOUND" });
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8" };
async function serveStatic(req, res, url) {
  const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  if (/^\/(?:server(?:\/|\.mjs)|tests\/|\.trustbuilder-data\/|\.env|\.git)/i.test(relative)) throw Object.assign(new Error("File not found."), { status: 404, code: "NOT_FOUND" });
  const candidate = path.resolve(ROOT, `.${relative}`);
  if (!candidate.startsWith(ROOT + path.sep)) throw Object.assign(new Error("Invalid path."), { status: 400, code: "INVALID_PATH" });
  let info;
  try { info = await stat(candidate); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw Object.assign(new Error("File not found."), { status: 404, code: "NOT_FOUND" });
    throw error;
  }
  if (!info.isFile()) throw Object.assign(new Error("File not found."), { status: 404, code: "NOT_FOUND" });
  let content = await readFile(candidate);
  if (relative === "/runtime-config.js") {
    const resetUrl = JSON.stringify(process.env.TRUSTBUILDER_PASSWORD_RESET_URL || "/reset-password.html");
    content = Buffer.concat([content, Buffer.from(`\nwindow.TRUSTBUILDER_PASSWORD_RESET_URL = ${resetUrl};\n`)]);
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(candidate)] || "application/octet-stream", "Content-Length": content.length, "Cache-Control": [".html", ".js", ".mjs"].includes(path.extname(candidate)) ? "no-store" : "public, max-age=60", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'" });
  if (req.method === "HEAD") return res.end();
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  const id = requestId(req);
  res.setHeader("X-Request-Id", id);
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith("/api/")) return await (req.method === "GET" ? routeApi(req, res, url, id) : withSessionLock("store-mutations", () => routeApi(req, res, url, id)));
    if (!["GET", "HEAD"].includes(req.method)) throw Object.assign(new Error("Method not allowed."), { status: 405, code: "METHOD_NOT_ALLOWED" });
    return await serveStatic(req, res, url);
  } catch (error) { return sendError(res, error, id); }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  console.log(`TrustBuilder server running at http://${HOST}:${address.port}/`);
  console.log(`AI provider: ${provider.isConfigured() ? "configured" : "not configured; safe fallback active"}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));

export { server, store };
