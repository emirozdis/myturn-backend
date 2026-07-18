import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NextRequest, NextResponse } from "next/server";
import type { Logger } from "pino";
import { AppError, isAppError } from "./errors";
import { logger, serializeUnknownError } from "./logger";
import { runWithRequestContext } from "./request-context";
import { persistIncidentWithTimeout, type IncidentInput } from "./incident-store";

type RouteHandler<Context = unknown> = (
  request: NextRequest,
  context: Context,
) => Response | Promise<Response>;

type ApiHandlerOptions = {
  logger?: Pick<Logger, "info" | "warn" | "error">;
  idFactory?: () => string;
  incidentWriter?: (incident: IncidentInput) => Promise<void>;
};

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

function normalizedRoute(pathname: string): string {
  if (pathname.startsWith("/api/media/")) return "/api/media/[...path]";

  return pathname
    .split("/")
    .map((segment) => {
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
      if (/^\d+$/.test(segment)) return ":id";
      return segment;
    })
    .join("/");
}

function safeServerErrorResponse(status: number, logId: string): NextResponse {
  return NextResponse.json(
    {
      error: GENERIC_ERROR_MESSAGE,
      code: "INTERNAL_ERROR",
      logId,
    },
    {
      status: status >= 500 && status <= 599 ? status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function safeAppErrorResponse(error: AppError): NextResponse {
  return NextResponse.json(
    { error: error.safeMessage, code: error.code },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}

function attachRequestId(response: Response, requestId: string): Response {
  // NextResponse is a web Response subclass whose body is backed by private
  // runtime state. Re-wrapping that body during static generation can detach it
  // from the original instance and crash `next build`. Route-created response
  // headers are mutable, so preserve the original response and annotate it.
  response.headers.set("X-Request-ID", requestId);
  if (response.status >= 500) response.headers.set("Cache-Control", "no-store");
  return response;
}

export function withApiHandler<Context = unknown>(
  handler: RouteHandler<Context>,
  options: ApiHandlerOptions = {},
): RouteHandler<Context> {
  return async (request, context) => {
    const requestLogger = options.logger ?? logger;
    const idFactory = options.idFactory ?? randomUUID;
    const incidentWriter = options.incidentWriter ?? persistIncidentWithTimeout;
    const requestId = idFactory();
    const route = normalizedRoute(request.nextUrl.pathname);
    const startedAt = performance.now();

    return runWithRequestContext(
      { requestId, method: request.method, route },
      async () => {
        let response: Response;

        try {
          response = await handler(request, context);

          if (response.status >= 500) {
            const logId = idFactory();
            const incident: IncidentInput = {
              id: logId,
              level: "error",
              event: "api.returned_server_error",
              code: "INTERNAL_ERROR",
              status: response.status,
            };
            requestLogger.error(
              {
                event: "api.returned_server_error",
                logId,
                status: response.status,
              },
              "API handler returned a server error response",
            );
            try {
              await incidentWriter(incident);
            } catch (persistenceError: unknown) {
              requestLogger.error(
                {
                  event: "incident.persistence_failed",
                  logId,
                  err: serializeUnknownError(persistenceError),
                },
                "Incident persistence failed; stdout remains the fallback",
              );
            }
            response = safeServerErrorResponse(response.status, logId);
          }
        } catch (error: unknown) {
          if (isAppError(error) && error.expose && error.status < 500) {
            requestLogger[error.level](
              {
                event: "api.expected_error",
                status: error.status,
                code: error.code,
                details: error.details,
              },
              error.safeMessage,
            );
            response = safeAppErrorResponse(error);
          } else {
            const logId = idFactory();
            const status = isAppError(error) ? error.status : 500;
            const code = isAppError(error) ? error.code : "INTERNAL_ERROR";
            const details = isAppError(error) ? error.details : undefined;
            requestLogger.error(
              {
                event: "api.request_failed",
                logId,
                status,
                code,
                err: serializeUnknownError(error),
                details,
              },
              "API request failed",
            );
            try {
              await incidentWriter({
                id: logId,
                level: "error",
                event: "api.request_failed",
                code,
                status,
                error,
                context: details,
              });
            } catch (persistenceError: unknown) {
              requestLogger.error(
                {
                  event: "incident.persistence_failed",
                  logId,
                  err: serializeUnknownError(persistenceError),
                },
                "Incident persistence failed; stdout remains the fallback",
              );
            }
            response = safeServerErrorResponse(status, logId);
          }
        }

        const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
        requestLogger.info(
          {
            event: "api.request_completed",
            status: response.status,
            durationMs,
          },
          "API request completed",
        );

        return attachRequestId(response, requestId);
      },
    );
  };
}
