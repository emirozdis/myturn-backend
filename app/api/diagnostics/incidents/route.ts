import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { withApiHandler } from "@/lib/observability/api-handler";
import { scrubLogText } from "@/lib/observability/logger";

const MAX_BODY_BYTES = 160_000;
const MAX_BREADCRUMBS = 120;
const SENSITIVE_KEY = /authorization|cookie|password|passwd|secret|token|signature|api[-_]?key|base64|body|payload|content|email|message|text/i;

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? scrubLogText(value.trim()).slice(0, max)
    : undefined;
}

function integer(value: unknown, min: number, max: number): number | undefined {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : undefined;
}

function date(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return scrubLogText(value).slice(0, 1_000);
  if (!value || typeof value !== "object" || depth >= 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 30).map((entry) => sanitize(entry, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, 50)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const sanitized = sanitize(nested, depth + 1);
    if (sanitized !== undefined) result[key.slice(0, 100)] = sanitized;
  }
  return result;
}

function json(value: unknown): Prisma.InputJsonValue | undefined {
  const sanitized = sanitize(value);
  return sanitized && typeof sanitized === "object"
    ? JSON.parse(JSON.stringify(sanitized)) as Prisma.InputJsonValue
    : undefined;
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";
}

function installationHash(value: string | undefined): string | undefined {
  return value ? createHash("sha256").update(value).digest("hex") : undefined;
}

async function POSTHandler(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Diagnostic payload is too large." }, { status: 413 });
  }

  const installationId = text(req.headers.get("x-client-installation-id"), 200);
  const limiter = await rateLimit(
    `diagnostics:${installationHash(installationId) || clientIp(req)}`,
    120,
    60 * 60_000,
  );
  if (!limiter.success) {
    return NextResponse.json(
      { error: "Too many diagnostic reports." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfter) } },
    );
  }

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Diagnostic payload is too large." }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid diagnostic payload." }, { status: 400 });
  }

  const clientIncidentId = text(body.clientIncidentId, 200);
  const status = integer(body.status, 0, 599);
  const route = text(body.route, 500);
  if (!clientIncidentId || status === undefined || !route) {
    return NextResponse.json({ error: "Missing required diagnostic fields." }, { status: 400 });
  }

  const session = await getAuthSession();
  const breadcrumbs = Array.isArray(body.breadcrumbs)
    ? body.breadcrumbs.slice(0, MAX_BREADCRUMBS)
    : [];
  const occurredAt = date(body.occurredAt) || new Date();
  const code = text(body.code, 100);
  const fingerprint = createHash("sha256")
    .update(`${text(body.method, 20) || "UNKNOWN"}|${route}|${status}|${code || ""}`)
    .digest("hex");
  const expiresAt = new Date(Date.now() + (status >= 500 ? 90 : 30) * 24 * 60 * 60_000);

  try {
    const incident = await db.backendIncident.create({
      data: {
        id: randomUUID(),
        source: "client",
        clientIncidentId,
        clientRequestId: text(body.clientRequestId, 200),
        operationId: text(body.operationId, 200),
        installationIdHash: installationHash(installationId || text(body.installationId, 200)),
        appSessionId: text(body.appSessionId, 200),
        authState: text(body.authState, 100) || (session ? "valid" : "anonymous"),
        reportedUserId: text(body.reportedUserId, 100),
        fingerprint,
        occurredAt,
        durationMs: integer(body.durationMs, 0, 86_400_000),
        retryNumber: integer(body.retryNumber, 0, 100),
        recovered: typeof body.recovered === "boolean" ? body.recovered : false,
        finalizedAt: date(body.finalizedAt) || new Date(),
        level: status >= 500 ? "error" : "warn",
        event: "client.http_non_2xx",
        code,
        route,
        method: text(body.method, 20),
        status,
        userId: session?.user.id,
        errorType: text(body.errorType, 200),
        errorMessage: text(body.errorMessage, 2_000),
        context: json(body.context),
        deviceContext: json(body.deviceContext),
        networkContext: json(body.networkContext),
        appContext: json(body.appContext),
        environment: text(body.environment, 100) || process.env.NODE_ENV || "unknown",
        release: text(body.release, 200) || "unknown",
        expiresAt,
        breadcrumbs: {
          create: breadcrumbs.flatMap((entry, index) => {
            if (!entry || typeof entry !== "object") return [];
            const item = entry as Record<string, unknown>;
            const name = text(item.name, 200);
            const category = text(item.category, 100);
            const breadcrumbTime = date(item.occurredAt);
            if (!name || !category || !breadcrumbTime) return [];
            return [{
              sequence: integer(item.sequence, 0, 1_000_000) ?? index,
              phase: text(item.phase, 20) || "before",
              occurredAt: breadcrumbTime,
              category,
              name,
              outcome: text(item.outcome, 30),
              durationMs: integer(item.durationMs, 0, 86_400_000),
              status: integer(item.status, 100, 599),
              code: text(item.code, 100),
              context: json(item.context),
            }];
          }),
        },
      },
      select: { id: true },
    });
    return NextResponse.json({ success: true, incidentId: incident.id }, { status: 202 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ success: true, duplicate: true }, { status: 202 });
    }
    throw error;
  }
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
