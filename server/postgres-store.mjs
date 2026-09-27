import pg from "pg";

// Keep the existing application document contract while moving durable state
// off Render's ephemeral filesystem. Only one application instance is deployed.
export class PostgresStore {
  constructor({ connectionString, seed }) {
    this.pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 15000, idleTimeoutMillis: 10000 });
    this.seed = seed;
    this.queue = Promise.resolve();
  }
  async initialize() {
    await this.pool.query("CREATE TABLE IF NOT EXISTS trustbuilder_state (id integer PRIMARY KEY CHECK (id = 1), document jsonb NOT NULL)");
    await this.pool.query("INSERT INTO trustbuilder_state(id, document) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING", [JSON.stringify(this.seed())]);
    await this.pool.query("CREATE TABLE IF NOT EXISTS trustbuilder_auth_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL, expires_at bigint NOT NULL)");
    await this.pool.query("CREATE TABLE IF NOT EXISTS trustbuilder_password_resets (token_hash text PRIMARY KEY, user_id text NOT NULL, expires_at bigint NOT NULL)");
    await this.pool.query("CREATE TABLE IF NOT EXISTS trustbuilder_reset_requests (email_hash text NOT NULL, requested_at bigint NOT NULL)");
    return this;
  }
  async read() {
    const { rows } = await this.pool.query("SELECT document FROM trustbuilder_state WHERE id = 1");
    return structuredClone(rows[0].document);
  }
  async write(data) {
    data = structuredClone(data);
    return this.transaction(current => {
      // A long-running assessment must not restore credentials read before a reset.
      for (const user of data.users) {
        const existing = current.users.find(item => item.id === user.id);
        if (existing) for (const field of ['passwordHash', 'passwordSalt']) user[field] = existing[field];
      }
      return { data, result: structuredClone(data) };
    });
  }
  async issuePasswordReset(email, emailHash, tokenHash, now) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM trustbuilder_state WHERE id = 1 FOR UPDATE');
      await client.query('DELETE FROM trustbuilder_reset_requests WHERE requested_at < $1', [now - 86400000]);
      await client.query('DELETE FROM trustbuilder_password_resets WHERE expires_at <= $1', [now]);
      const { rows } = await client.query('SELECT count(*)::int AS total, count(*) FILTER (WHERE email_hash = $1 AND requested_at > $2)::int AS recent FROM trustbuilder_reset_requests', [emailHash, now - 900000]);
      if (rows[0].total >= 100 || rows[0].recent >= 1) { await client.query('COMMIT'); return null; }
      await client.query('INSERT INTO trustbuilder_reset_requests VALUES ($1, $2)', [emailHash, now]);
      const state = await client.query('SELECT document FROM trustbuilder_state WHERE id = 1');
      const user = state.rows[0].document.users.find(item => item.email?.toLowerCase() === email && item.status === 'active' && ['participant', 'facilitator'].includes(item.role));
      if (user) {
        await client.query('DELETE FROM trustbuilder_password_resets WHERE user_id = $1', [user.id]);
        await client.query('INSERT INTO trustbuilder_password_resets VALUES ($1, $2, $3)', [tokenHash, user.id, now + 1800000]);
      }
      await client.query('COMMIT');
      return user ? { email: user.email } : null;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async removePasswordReset(tokenHash) {
    await this.pool.query('DELETE FROM trustbuilder_password_resets WHERE token_hash = $1', [tokenHash]);
  }
  async consumePasswordReset(tokenHash, credentials, now) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const state = await client.query('SELECT document FROM trustbuilder_state WHERE id = 1 FOR UPDATE');
      const { rows } = await client.query('DELETE FROM trustbuilder_password_resets WHERE token_hash = $1 AND expires_at > $2 RETURNING user_id', [tokenHash, now]);
      const data = state.rows[0].document;
      const user = data.users.find(item => item.id === rows[0]?.user_id && item.status === 'active' && ['participant', 'facilitator'].includes(item.role));
      if (!user) { await client.query('COMMIT'); return null; }
      Object.assign(user, credentials);
      await client.query('UPDATE trustbuilder_state SET document = $1::jsonb WHERE id = 1', [JSON.stringify(data)]);
      await client.query('DELETE FROM trustbuilder_auth_sessions WHERE user_id = $1', [user.id]);
      await client.query('DELETE FROM trustbuilder_password_resets WHERE user_id = $1', [user.id]);
      await client.query('COMMIT');
      return { email: user.email };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async transaction(mutator) {
    const operation = async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query("SELECT document FROM trustbuilder_state WHERE id = 1 FOR UPDATE");
        const current = rows[0].document;
        const result = await mutator(current);
        await client.query("UPDATE trustbuilder_state SET document = $1::jsonb WHERE id = 1", [JSON.stringify(result?.data || current)]);
        await client.query("COMMIT");
        return result?.result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    };
    this.queue = this.queue.then(operation, operation);
    return this.queue;
  }
  async saveSession(hash, userId, expiresAt, expectedPasswordHash) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT document FROM trustbuilder_state WHERE id = 1 FOR SHARE');
      const user = rows[0].document.users.find(item => item.id === userId && item.status === 'active');
      if (!user || user.passwordHash !== expectedPasswordHash) throw Object.assign(new Error('Your password changed. Please sign in again.'), { status: 401, code: 'INVALID_CREDENTIALS' });
      await client.query("DELETE FROM trustbuilder_auth_sessions WHERE expires_at <= $1", [Date.now()]);
      await client.query("INSERT INTO trustbuilder_auth_sessions(token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [hash, userId, expiresAt]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async findSession(hash) {
    const { rows } = await this.pool.query("SELECT user_id FROM trustbuilder_auth_sessions WHERE token_hash = $1 AND expires_at > $2", [hash, Date.now()]);
    if (!rows.length) return null;
    const data = await this.read();
    return data.users.find(user => user.id === rows[0].user_id && user.status === "active") || null;
  }
  async deleteSession(hash) {
    await this.pool.query("DELETE FROM trustbuilder_auth_sessions WHERE token_hash = $1", [hash]);
  }
}
