import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabasePool } from "./index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const pool = getDatabasePool();
  const migrationFile = path.join(__dirname, "migrations", "001_initial.sql");
  const sql = await fs.readFile(migrationFile, "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Database migration complete.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

run();
