import Redis from "ioredis";

const globalForRedis = global as unknown as {
  redis: Redis | undefined;
};

/** Strip redis-cli flags and ensure Upstash hosts use TLS (rediss://). */
function normalizeRedisUrl(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/rediss?:\/\/[^\s'"]+/i);
  const candidate = match ? match[0] : trimmed;

  if (!/^rediss?:\/\//i.test(candidate)) {
    throw new Error(
      "REDIS_URL must be a redis:// or rediss:// URL. Upstash: copy only the URL, not redis-cli flags like --tls or -u."
    );
  }

  try {
    const parsed = new URL(candidate);
    if (
      parsed.hostname.endsWith(".upstash.io") &&
      parsed.protocol === "redis:"
    ) {
      parsed.protocol = "rediss:";
      return parsed.toString();
    }
    return candidate;
  } catch {
    return candidate;
  }
}

function resolveRedisUrl(): string {
  const raw = process.env.REDIS_URL?.trim();
  if (raw) return normalizeRedisUrl(raw);

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "REDIS_URL is not set. Configure a hosted Redis URL (e.g. Upstash) for production."
    );
  }

  return "redis://127.0.0.1:6379";
}

function createRedisClient(): Redis {
  const client = new Redis(resolveRedisUrl(), {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  let lastErrorLogAt = 0;
  client.on("error", (err: Error) => {
    const now = Date.now();
    if (now - lastErrorLogAt < 10_000) return;
    lastErrorLogAt = now;
    console.error("[redis] connection error:", err.message);
  });

  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

export default redis;
