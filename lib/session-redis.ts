import redis from "@/lib/redis";

const KEY_PREFIX = "sess:";
const TTL_SEC = 60 * 60 * 24 * 7;

/** Optional server-side marker when Redis is configured (JWT cookie remains authoritative). */
export async function persistSessionEmail(email: string): Promise<void> {
  const key = `${KEY_PREFIX}${email.trim().toLowerCase()}`;
  try {
    await redis.set(key, "1", "EX", TTL_SEC);
  } catch {
    /* ignore */
  }
}

export async function clearPersistedSession(email: string): Promise<void> {
  try {
    await redis.del(`${KEY_PREFIX}${email.trim().toLowerCase()}`);
  } catch {
    /* ignore */
  }
}
