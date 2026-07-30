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

function codeForResponse(status: number, message?: string): string {
  const normalizedMessage = message?.toLowerCase() ?? "";

  if (normalizedMessage.includes("app check") || normalizedMessage.includes("appcheck")) {
    return normalizedMessage.includes("required") || normalizedMessage.includes("missing")
      ? "NO_APPCHECK_TOKEN"
      : "INVALID_APPCHECK_TOKEN";
  }
  if (status === 401) {
    return "INVALID_SESSION";
  }
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 410) return "GONE";
  if (status === 413) return "PAYLOAD_TOO_LARGE";
  if (status === 415) return "UNSUPPORTED_MEDIA_TYPE";
  if (status === 422) return "UNPROCESSABLE_REQUEST";
  if (status === 429) return "RATE_LIMITED";
  if (status === 207) return "PARTIAL_FAILURE";
  if (status >= 500) return "INTERNAL_ERROR";
  return "INVALID_REQUEST";
}

async function normalizeResponse(response: Response): Promise<Response> {
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    // A few legacy handlers still return plain-text 4xx responses. Bring those
    // into the same machine-readable contract without touching binary media or
    // OAuth redirects.
    if (response.status < 400 || response.status >= 600) return response;
    const error = (await response.clone().text()).trim();
    if (!error) return response;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify({
      success: false,
      code: codeForResponse(response.status, error),
      error,
      ...(response.status === 400 ? { message: error } : {}),
    }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) return response;

  const current = body as Record<string, unknown>;
  const successful = response.ok && current.success !== false;
  const responseError = typeof current.error === "string"
    ? current.error
    : typeof current.message === "string"
      ? current.message
      : response.status === 400
        ? "The request is invalid. Check the required fields and values."
        : undefined;
  const normalized = successful
    ? { ...current, success: true, code: "SUCCESS" }
    : {
        ...current,
        success: false,
        code: typeof current.code === "string"
          ? current.code
          : codeForResponse(response.status, typeof current.error === "string" ? current.error : undefined),
        ...(responseError ? { error: responseError } : {}),
        ...(response.status === 400 && responseError ? { message: responseError } : {}),
      };

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(normalized), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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
    const headerValue = (name: string, maxLength = 200) => request.headers.get(name)?.slice(0, maxLength) || undefined;

    return runWithRequestContext(
      {
        requestId,
        method: request.method,
        route,
        clientRequestId: headerValue("x-client-request-id"),
        operationId: headerValue("x-client-operation-id"),
        appSessionId: headerValue("x-client-app-session-id"),
      },
      async () => {
        let response: Response;
        let incidentPersisted = false;

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
              incidentPersisted = true;
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
              incidentPersisted = true;
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

        response = await normalizeResponse(response);

        if (!response.ok && !incidentPersisted) {
          const logId = idFactory();
          const status = response.status;
          let responseBody: Record<string, unknown> | undefined;
          try {
            const parsed = await response.clone().json();
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              responseBody = parsed as Record<string, unknown>;
            }
          } catch {
            // The status and route still provide a useful incident for non-JSON responses.
          }
          const responseError = typeof responseBody?.error === "string"
            ? responseBody.error
            : typeof responseBody?.message === "string"
              ? responseBody.message
              : undefined;
          const code = typeof responseBody?.code === "string"
            ? responseBody.code.slice(0, 100)
            : codeForResponse(status, responseError);
          requestLogger.warn(
            {
              event: "api.non_2xx_response",
              logId,
              status,
              code,
            },
            "API request completed with a non-2xx response",
          );
          try {
            await incidentWriter({
              id: logId,
              level: status >= 500 ? "error" : "warn",
              event: "api.non_2xx_response",
              code,
              status,
              error: responseError ? new Error(responseError) : undefined,
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
