import type { Instrumentation } from "next";

const processState = globalThis as typeof globalThis & {
  __myturnProcessErrorLoggingInitialized?: boolean;
};

function scrubEdgeErrorText(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/([?&](?:token|key|secret|signature|password)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
}

export async function register() {
  // Only boot the cron jobs on the Node.js server environment (ignores Edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logInfo, reportError } = await import("@/lib/observability/logger");
    if (!processState.__myturnProcessErrorLoggingInitialized) {
      processState.__myturnProcessErrorLoggingInitialized = true;
      process.on("uncaughtExceptionMonitor", (error, origin) => {
        reportError("process.uncaught_exception", error, { origin });
      });
      process.on("unhandledRejection", (reason) => {
        reportError("process.unhandled_rejection", reason);
        setImmediate(() => process.exit(1));
      });
    }

    logInfo("service.initialized", {}, "MyTurn backend instrumentation initialized");
    const { startCronJobs } = await import("./lib/cron");
    startCronJobs();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const fields = {
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    renderSource: context.renderSource,
  };

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportError } = await import("@/lib/observability/logger");
    reportError("next.request_error", error, fields, "Next.js reported an unhandled request error");
    return;
  }

  const edgeError = error instanceof Error
    ? {
        type: error.name,
        message: scrubEdgeErrorText(error.message).slice(0, 2_000),
        stack: error.stack ? scrubEdgeErrorText(error.stack).slice(0, 8_000) : undefined,
      }
    : { type: typeof error };
  // Edge instrumentation cannot load the Node-only Pino/Prisma stack. Vercel
  // captures this structured stderr line as the durable fallback.
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({
    level: "error",
    event: "next.edge_request_error",
    logId: globalThis.crypto.randomUUID(),
    ...fields,
    error: edgeError,
  }));
};
