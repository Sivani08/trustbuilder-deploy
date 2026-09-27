import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabasePool } from "./index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function readJsonData() {
  const legacyPath = path.resolve(__dirname, "..", "..", ".trustbuilder-data", "trustbuilder.json");
  try {
    const raw = await fs.readFile(legacyPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { users: [], templates: [], scenarios: [], sessions: [], attempts: [], evaluations: [], assessmentResults: [], reviews: [], audit: [], useCases: [], useCaseConversations: [], useCaseAudit: [] };
  }
}

async function importJson() {
  const pool = getDatabasePool();
  const data = await readJsonData();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const user of data.users || []) {
      await client.query(
        `INSERT INTO users (id, name, email, password_hash, password_salt, status, role, created_at, updated_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [user.id, user.name, user.email, user.passwordHash || null, user.passwordSalt || null, user.status || "active", user.role || "participant"]
      );
    }
    for (const template of data.templates || []) {
      await client.query(
        `INSERT INTO templates (id, name, description, objective, dos, donts, evaluation_criteria, scoring_weights, difficulty, conversation_rules, active, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [template.id, template.name, template.description, template.objective, JSON.stringify(template.dos || []), JSON.stringify(template.donts || []), JSON.stringify(template.evaluationCriteria || []), JSON.stringify(template.scoringWeights || {}), template.difficulty || "Developing", JSON.stringify(template.conversationRules || {}), !!template.active, Number(template.version || 1)]
      );
    }
    for (const scenario of data.scenarios || []) {
      await client.query(
        `INSERT INTO scenarios (id, template_id, title, type, domain, context, participant_role, other_role, objective, opening_situation, dos, donts, expected_behaviors, evaluation_criteria, impact_emphasis, possible_conversation_directions, difficulty, status, active, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [scenario.id, scenario.templateId || null, scenario.title, scenario.type || null, scenario.domain || null, scenario.context || null, scenario.participantRole || null, scenario.otherRole || null, scenario.objective || null, scenario.openingSituation || null, JSON.stringify(scenario.dos || []), JSON.stringify(scenario.donts || []), JSON.stringify(scenario.expectedBehaviors || []), JSON.stringify(scenario.evaluationCriteria || []), JSON.stringify(scenario.impactEmphasis || []), JSON.stringify(scenario.possibleConversationDirections || []), scenario.difficulty || null, scenario.status || "draft", !!scenario.active, Number(scenario.version || 1)]
      );
    }
    await client.query("COMMIT");
    console.log(`Imported ${data.users?.length || 0} users, ${data.templates?.length || 0} templates, ${data.scenarios?.length || 0} scenarios.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("JSON import failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

importJson();
