import pg from "pg";
const { Pool } = pg;

let poolInstance = null;

export function getDatabasePool() {
  if (!poolInstance) {
    const url = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/trustbuilder";
    poolInstance = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
  }
  return poolInstance;
}

export async function dbQuery(text, params = []) {
  const pool = getDatabasePool();
  return pool.query(text, params);
}

export async function withTransaction(operation) {
  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function pingDatabase() {
  try {
    const { rows } = await dbQuery("SELECT 1 AS ok");
    return rows[0]?.ok === 1 ? { ok: true } : { ok: false, reason: "unexpected result" };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}
