import Redis from "ioredis";

const client = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3, enableOfflineQueue: false }) : null;

export async function withRedis(operation, fallbackValue = null) {
  if (!client) return fallbackValue;
  try {
    await client.connect();
    return await operation(client);
  } catch {
    return fallbackValue;
  } finally {
    if (client.status === "connect") {
      await client.quit().catch(() => {});
    }
  }
}

export async function pingRedis() {
  if (!client) return { ok: false, reason: "not-configured" };
  try {
    await client.connect();
    await client.ping();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  } finally {
    if (client.status === "connect") {
      await client.quit().catch(() => {});
    }
  }
}

export function getRedisClient() {
  return client;
}

export const redisConfig = { url: process.env.REDIS_URL || "redis://127.0.0.1:6379" };
