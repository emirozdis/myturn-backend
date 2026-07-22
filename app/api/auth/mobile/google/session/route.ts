import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { consumeGoogleMobileHandoff, googleLoginEnabled } from "@/lib/google-mobile-auth";
import { withApiHandler } from "@/lib/observability/api-handler";
import { getFirebaseAuth } from "@/lib/firebase-admin";

async function POSTHandler(req: NextRequest) {
  if (!googleLoginEnabled()) {
    return NextResponse.json({ error: "Google sign-in is disabled." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const idToken = typeof body?.idToken === "string" ? body.idToken.trim() : "";
  const code = typeof body?.code === "string" ? body.code : "";
  const verifier = typeof body?.verifier === "string" ? body.verifier : "";

  let user = null;
  let isNewUser = false;

  if (idToken) {
    try {
      const decodedToken = await getFirebaseAuth().verifyIdToken(idToken);
      const uid = decodedToken.uid;
      const email = decodedToken.email ? decodedToken.email.toLowerCase().trim() : null;

      user = await db.user.findFirst({
        where: {
          OR: [
            { id: uid },
            ...(email ? [{ email }] : []),
          ],
        },
        select: { id: true, email: true, name: true, image: true },
      });

      if (!user && email) {
        isNewUser = true;
        user = await db.user.create({
          data: {
            id: uid,
            email,
            name: decodedToken.name || email.split("@")[0],
            image: decodedToken.picture || null,
            emailVerified: decodedToken.email_verified ? new Date() : null,
          },
          select: { id: true, email: true, name: true, image: true },
        });
      }
    } catch {
      return NextResponse.json({ error: "Invalid Firebase Google token." }, { status: 401 });
    }
  } else if (code && verifier) {
    const handoff = await consumeGoogleMobileHandoff(code, verifier);
    if (!handoff) {
      return NextResponse.json({ error: "The Google sign-in session is invalid or expired." }, { status: 400 });
    }
    isNewUser = handoff.isNewUser;
    user = await db.user.findUnique({
      where: { id: handoff.userId },
      select: { id: true, email: true, name: true, image: true },
    });
  }

  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const response = NextResponse.json({
    success: true,
    isNewUser,
    sessionToken: idToken || "",
    user: { id: user.id, email: user.email, name: user.name, image: user.image },
  });

  if (idToken) {
    response.cookies.set("firebase_session", idToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NEXTAUTH_URL?.startsWith("https://") === true,
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
  }

  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
