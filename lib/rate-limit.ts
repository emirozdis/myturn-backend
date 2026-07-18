// ./lib/rate-limit.ts

const globalForRateLimit = globalThis as unknown as {
  rateLimitCache: Map<string, { count: number; resetAt: number }>;
  rateLimitInterval: NodeJS.Timeout;
};

const cache = globalForRateLimit.rateLimitCache || new Map<string, { count: number; resetAt: number }>();

if (process.env.NODE_ENV !== "production") {
  globalForRateLimit.rateLimitCache = cache;
}

// Garbage collection to prevent memory leaks over time
if (!globalForRateLimit.rateLimitInterval) {
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
      if (now > value.resetAt) {
        cache.delete(key);
      }
    }
  }, 60000); // Run cleanup every 60s
  
  // Unref to prevent the interval from keeping the Node.js event loop alive unnecessarily
  interval.unref();
  globalForRateLimit.rateLimitInterval = interval;
}

/**
 * Validates if the action for the given identifier is within rate limits.
 * @param identifier The unique key (e.g. IP address or User ID).
 * @param limit Maximum allowed requests within the time window.
 * @param windowMs The rolling time window in milliseconds.
 */
export function rateLimit(identifier: string, limit: number, windowMs: number) {
  const now = Date.now();
  const record = cache.get(identifier);

  if (!record || now > record.resetAt) {
    cache.set(identifier, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1 };
  }

  if (record.count >= limit) {
    return { 
      success: false, 
      retryAfter: Math.ceil((record.resetAt - now) / 1000) 
    };
  }

  record.count += 1;
  return { success: true, remaining: limit - record.count };
}