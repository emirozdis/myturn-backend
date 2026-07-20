import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { consumeGoogleMobileHandoff, googleLoginEnabled } from "@/lib/google-mobile-auth";
import { withApiHandler } from "@/lib/observability/api-handler";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

async function POSTHandler(req: NextRequest) {
  if (!googleLoginEnabled()) {
    return NextResponse.json({ error: "Google sign-in is disabled." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";
  const verifier = typeof body?.verifier === "string" ? body.verifier : "";
  const handoff = await consumeGoogleMobileHandoff(code, verifier);
  if (!handoff) {
    return NextResponse.json({ error: "The Google sign-in session is invalid or expired." }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: handoff.userId },
    select: { id: true, email: true, name: true, image: true, sessionVersion: true },
  });
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required.");

  const sessionToken = await encode({
    secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: {
      id: user.id,
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.image,
      sessionVersion: user.sessionVersion,
    },
  });

  const secure = process.env.NEXTAUTH_URL?.startsWith("https://") === true;
  const cookieName = secure ? "__Secure-next-auth.session-token" : "next-auth.session-token";
  const response = NextResponse.json({
    success: true,
    isNewUser: handoff.isNewUser,
    user: { id: user.id, email: user.email, name: user.name, image: user.image },
  });
  response.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
