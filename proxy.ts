// ./proxy.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAppCheckToken } from "@/lib/app-check";
import { rateLimit } from "@/lib/rate-limit";
import {
  isAppCheckExempt,
  requiresLimitedUseAppCheck,
} from "@/lib/api-security-policy";

const APP_CHECK_HEADER = "x-firebase-appcheck";
const API_RATE_LIMIT = 120;
const API_RATE_LIMIT_WINDOW_MS = 60_000;

function proxyResponse(status: number, code: string, error: string, headers?: HeadersInit) {
  console.warn(JSON.stringify({
    event: "api.proxy_rejected",
    code,
    status,
    error,
  }));

  return NextResponse.json(
    { success: false, code, error },
    { status, headers },
  );
}

function getClientIp(req: NextRequest) {
  return (
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function protectUserApi(req: NextRequest) {
  const result = await rateLimit(
    `api:${getClientIp(req)}`,
    API_RATE_LIMIT,
    API_RATE_LIMIT_WINDOW_MS,
  );

  if (!result.success) {
    return proxyResponse(429, "RATE_LIMITED", "Too many requests.", {
      "Retry-After": String(result.retryAfter),
    });
  }

  const appCheckToken = req.headers.get(APP_CHECK_HEADER);
  if (!appCheckToken) {
    return proxyResponse(401, "NO_APPCHECK_TOKEN", "A Firebase App Check token is required.");
  }

  try {
    await verifyAppCheckToken(
      appCheckToken,
      requiresLimitedUseAppCheck(req.method, req.nextUrl.pathname),
    );
    return NextResponse.next();
  } catch {
    console.warn(JSON.stringify({
      event: "api.proxy_appcheck_verification_failed",
      code: "INVALID_APPCHECK_TOKEN",
    }));
    return proxyResponse(401, "INVALID_APPCHECK_TOKEN", "Invalid Firebase App Check token.");
  }
}

export async function proxy(req: NextRequest) {
  // Machine routes authenticate independently, public legal/deletion routes
  // must work outside the app, and browser OAuth cannot carry a native token.
  if (isAppCheckExempt(req.method, req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  return protectUserApi(req);
}

export const config = {
  matcher: [
    "/api/((?!webhooks(?:/|$)).*)",
  ],
};
