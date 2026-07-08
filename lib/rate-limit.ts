import redis from "@/lib/redis";

/**
 * Current counter for a rate-limit key (no increment).
 */
export async function getRateLimitCount(key: string): Promise<number> {
  const raw = await redis.get(key);
  return raw ? Number.parseInt(raw, 10) || 0 : 0;
}

/**
 * Increments the counter and ensures a sliding window TTL.
 * Returns the new count after increment.
 */
export async function incrementRateLimitWithWindow(
  key: string,
  windowSeconds: number
): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count;
}

export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  const ttl = await redis.ttl(key);
  const resetIn = ttl > 0 ? ttl : windowSeconds;
  const allowed = !(count > maxAttempts);
  const remaining = Math.max(0, maxAttempts - count);
  return { allowed, remaining, resetIn };
}

export async function resetRateLimit(key: string): Promise<void> {
  await redis.del(key);
}
