import pino, { type Logger, type LoggerOptions } from "pino";
import { randomUUID } from "node:crypto";
import { getRequestContext } from "./request-context";

const REDACTED = "[REDACTED]";

const REDACT_PATHS = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "secret",
  "base64Data",
  "headers.authorization",
  "headers.cookie",
  "headers.set-cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "body.password",
  "body.token",
  "body.base64Data",
  "credentials.password",
  "credentials.secret",
  "error.config.headers.Authorization",
] as const;

export const loggerOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: {
    service: process.env.LOG_SERVICE || "myturn-api",
    environment: process.env.LOG_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.LOG_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  mixin() {
    return getRequestContext() ?? {};
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  redact: {
    paths: [...REDACT_PATHS],
    censor: REDACTED,
  },
};

export function createLogger(destination?: pino.DestinationStream): Logger {
  return destination ? pino(loggerOptions, destination) : pino(loggerOptions);
}

export const logger = createLogger();

export function scrubLogText(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, `$1${REDACTED}@`)
    .replace(/([?&](?:token|key|secret|signature|password)=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/((?:password|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
}

export function serializeUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown; status?: unknown };
    return {
      type: error.name,
      message: scrubLogText(error.message),
      stack: error.stack ? scrubLogText(error.stack) : undefined,
      code: errorWithCode.code,
      status: errorWithCode.status,
      cause: error.cause instanceof Error
        ? {
            type: error.cause.name,
            message: scrubLogText(error.cause.message),
            stack: error.cause.stack ? scrubLogText(error.cause.stack) : undefined,
          }
        : error.cause,
    };
  }

  return { type: typeof error, value: scrubLogText(String(error)) };
}

export function logInfo(event: string, context: Record<string, unknown> = {}, message = event): void {
  logger.info({ ...context, event }, message);
}

function scheduleIncidentPersistence(input: {
  id: string;
  level: "warn" | "error" | "fatal";
  event: string;
  error?: unknown;
  context?: Record<string, unknown>;
}): void {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.INCIDENT_PERSISTENCE_ENABLED === "false"
  ) return;

  void import("./incident-store")
    .then(({ persistIncidentWithTimeout }) => persistIncidentWithTimeout(input))
    .catch((persistenceError: unknown) => {
      logger.error(
        {
          event: "incident.persistence_failed",
          logId: input.id,
          incidentEvent: input.event,
          err: serializeUnknownError(persistenceError),
        },
        "Incident persistence failed; stdout remains the fallback",
      );
    });
}

export function reportWarning(
  event: string,
  error?: unknown,
  context: Record<string, unknown> = {},
  message = event,
): string {
  const logId = randomUUID();
  logger.warn(
    {
      ...context,
      event,
      logId,
      err: error === undefined ? undefined : serializeUnknownError(error),
    },
    message,
  );
  scheduleIncidentPersistence({ id: logId, level: "warn", event, error, context });
  return logId;
}

export function reportError(
  event: string,
  error: unknown,
  context: Record<string, unknown> = {},
  message = event,
): string {
  const logId = randomUUID();
  logger.error({ ...context, event, logId, err: serializeUnknownError(error) }, message);
  scheduleIncidentPersistence({ id: logId, level: "error", event, error, context });
  return logId;
}
