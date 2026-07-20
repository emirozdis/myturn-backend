// ./proxy.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAppCheckToken } from "@/lib/app-check";
import { rateLimit } from "@/lib/rate-limit";

const APP_CHECK_HEADER = "x-firebase-appcheck";
const API_RATE_LIMIT = 120;
const API_RATE_LIMIT_WINDOW_MS = 60_000;

function getClientIp(req: NextRequest) {
  return (
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function protectUserApi(req: NextRequest) {
  const result = rateLimit(
    `api:${getClientIp(req)}`,
    API_RATE_LIMIT,
    API_RATE_LIMIT_WINDOW_MS,
  );

  if (!result.success) {
    return NextResponse.json(
      { error: "Too many requests." },
      {
        status: 429,
        headers: { "Retry-After": String(result.retryAfter) },
      },
    );
  }

  const appCheckToken = req.headers.get(APP_CHECK_HEADER);
  if (!appCheckToken) {
    return NextResponse.json(
      { error: "A Firebase App Check token is required." },
      { status: 401 },
    );
  }

  try {
    await verifyAppCheckToken(appCheckToken);
    return NextResponse.next();
  } catch {
    return NextResponse.json(
      { error: "Invalid Firebase App Check token." },
      { status: 401 },
    );
  }
}

export async function proxy(req: NextRequest) {
  // The current privacy notice must remain readable before sign-in and when a
  // user cannot obtain an App Check token. It contains no user-specific data.
  if (req.nextUrl.pathname === "/api/legal/privacy") {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname === "/api/account-deletion/request" ||
      (req.nextUrl.pathname === "/api/profile" && req.method === "DELETE")) {
    return NextResponse.next();
  }

  // These two endpoints run in the system browser and receive Google's OAuth
  // redirect, so they cannot carry the native app's App Check header. The
  // session exchange remains App Check protected and is bound to the app with
  // a one-time PKCE challenge.
  if (
    req.nextUrl.pathname === "/api/auth/mobile/google/start" ||
    req.nextUrl.pathname === "/api/auth/mobile/google/callback"
  ) {
    return NextResponse.next();
  }

  return protectUserApi(req);
}

export const config = {
  matcher: [
    "/api/((?!webhooks(?:/|$)).*)",
  ],
};
