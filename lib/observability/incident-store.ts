import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getRequestContext } from "./request-context";
import { scrubLogText, serializeUnknownError } from "./logger";

export type IncidentLevel = "warn" | "error" | "fatal";

export type IncidentInput = {
  id: string;
  level: IncidentLevel;
  event: string;
  code?: string;
  status?: number;
  error?: unknown;
  context?: Record<string, unknown>;
};

const SENSITIVE_KEY = /authorization|cookie|password|passwd|secret|token|signature|api[-_]?key|base64|body|payload|content/i;
const REDACTED = "[REDACTED]";

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function sanitizeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return scrubLogText(value).slice(0, 2_000);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return String(value).slice(0, 2_000);
  if (depth >= 4) return "[MAX_DEPTH]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value).slice(0, 50)) {
    sanitized[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(nestedValue, depth + 1, seen);
  }
  return sanitized;
}

function sanitizedJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  return JSON.parse(JSON.stringify(sanitizeValue(value))) as Prisma.InputJsonValue;
}

function retentionDays(level: IncidentLevel): number {
  if (level === "warn") {
    return boundedInteger(process.env.INCIDENT_WARNING_RETENTION_DAYS, 30, 1, 365);
  }
  return boundedInteger(process.env.INCIDENT_ERROR_RETENTION_DAYS, 90, 1, 365);
}

function persistenceTimeoutMs(): number {
  return boundedInteger(process.env.INCIDENT_PERSIST_TIMEOUT_MS, 750, 100, 5_000);
}

export async function persistIncident(input: IncidentInput): Promise<void> {
  if (process.env.INCIDENT_PERSISTENCE_ENABLED === "false") return;

  const request = getRequestContext();
  const serializedError = input.error === undefined
    ? undefined
    : input.error instanceof Error
      ? serializeUnknownError(input.error)
      : sanitizeValue(input.error) as Record<string, unknown>;
  const expiresAt = new Date(Date.now() + retentionDays(input.level) * 24 * 60 * 60 * 1_000);
  const context = sanitizedJson({
    ...input.context,
    errorCode: serializedError?.code,
    errorStatus: serializedError?.status,
    cause: serializedError?.cause,
  });
  const contextUserId = typeof input.context?.userId === "string" ? input.context.userId : undefined;
  const contextGroupId = typeof input.context?.groupId === "string" ? input.context.groupId : undefined;
  const contextClipId = typeof input.context?.clipId === "string" ? input.context.clipId : undefined;

  await db.backendIncident.create({
    data: {
      id: input.id,
      requestId: request?.requestId,
      jobRunId: request?.jobRunId,
      level: input.level,
      event: input.event.slice(0, 200),
      code: input.code?.slice(0, 100),
      route: request?.route.slice(0, 500),
      method: request?.method.slice(0, 20),
      status: input.status,
      userId: (request?.userId || contextUserId)?.slice(0, 100),
      groupId: (request?.groupId || contextGroupId)?.slice(0, 100),
      clipId: (request?.clipId || contextClipId)?.slice(0, 100),
      errorType: typeof serializedError?.type === "string" ? serializedError.type.slice(0, 200) : undefined,
      errorMessage: typeof serializedError?.message === "string"
        ? serializedError.message.slice(0, 8_000)
        : typeof serializedError?.value === "string"
          ? serializedError.value.slice(0, 8_000)
          : undefined,
      stack: typeof serializedError?.stack === "string" ? serializedError.stack.slice(0, 32_000) : undefined,
      context,
      environment: (process.env.LOG_ENVIRONMENT || process.env.NODE_ENV || "development").slice(0, 100),
      release: (process.env.LOG_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || "unknown").slice(0, 200),
      expiresAt,
    },
  });
}

export async function persistIncidentWithTimeout(input: IncidentInput): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      persistIncident(input),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Incident persistence timed out")), persistenceTimeoutMs());
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function cleanupExpiredIncidents(): Promise<number> {
  const result = await db.backendIncident.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}
