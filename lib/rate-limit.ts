import { createHash, randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type RateLimitRow = {
  count: number;
  resetAt: Date;
};

function bucketKey(identifier: string) {
  return createHash("sha256").update(identifier).digest("hex");
}

/**
 * A database-backed fixed-window limiter. The upsert is one atomic PostgreSQL
 * statement, so limits are shared across serverless instances and cold starts.
 */
export async function rateLimit(identifier: string, limit: number, windowMs: number) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const key = bucketKey(identifier);

  const rows = await db.$queryRaw<RateLimitRow[]>(Prisma.sql`
    INSERT INTO "rate_limit_buckets" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${resetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limit_buckets"."resetAt" <= ${now} THEN 1
        ELSE "rate_limit_buckets"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "rate_limit_buckets"."resetAt" <= ${now} THEN ${resetAt}
        ELSE "rate_limit_buckets"."resetAt"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "resetAt"
  `);

  const row = rows[0];
  if (!row) throw new Error("Rate limit state was not persisted.");

  // Amortized cleanup keeps one-off IP/action buckets bounded without adding a
  // cleanup query to every request.
  if (randomInt(100) === 0) {
    await db.rateLimitBucket.deleteMany({
      where: { resetAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    });
  }

  return {
    success: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    retryAfter: Math.max(1, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000)),
  };
}
