import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { consumeGoogleMobileHandoff, googleLoginEnabled } from "@/lib/google-mobile-auth";
import { withApiHandler } from "@/lib/observability/api-handler";
import { getFirebaseAuth } from "@/lib/firebase-admin";

async function ensureFirebaseIdentity(profile: {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
}) {
  if (!profile.email) throw new Error("Google profile has no email.");
  const auth = getFirebaseAuth();

  try {
    await auth.updateUser(profile.id, {
      email: profile.email,
      emailVerified: true,
      displayName: profile.name || undefined,
      photoURL: profile.image || undefined,
      disabled: false,
    });
  } catch (error: unknown) {
    const code = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
    if (code !== "auth/user-not-found") throw error;

    try {
      const emailIdentity = await auth.getUserByEmail(profile.email);
      if (emailIdentity.uid !== profile.id) {
        throw new Error("Firebase email is linked to a different profile.");
      }
    } catch (emailError: unknown) {
      const emailCode = typeof emailError === "object" && emailError && "code" in emailError
        ? String(emailError.code)
        : "";
      if (emailCode !== "auth/user-not-found") throw emailError;
      await auth.createUser({
        uid: profile.id,
        email: profile.email,
        emailVerified: true,
        displayName: profile.name || undefined,
        photoURL: profile.image || undefined,
      });
    }
  }

  return auth.createCustomToken(profile.id, { myturnProfile: true });
}

async function POSTHandler(req: NextRequest) {
  if (!googleLoginEnabled()) {
    return NextResponse.json({ error: "Google sign-in is disabled." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";
  const verifier = typeof body?.verifier === "string" ? body.verifier : "";
  if (!code || !verifier) {
    return NextResponse.json({ error: "A Google handoff and verifier are required." }, { status: 400 });
  }

  const handoff = await consumeGoogleMobileHandoff(code, verifier);
  if (!handoff) {
    return NextResponse.json(
      { error: "The Google sign-in session is invalid or expired." },
      { status: 400 },
    );
  }

  const profile = await db.profile.findUnique({
    where: { id: handoff.userId },
    select: { id: true, email: true, name: true, image: true },
  });
  if (!profile) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  try {
    const customToken = await ensureFirebaseIdentity(profile);
    return NextResponse.json(
      {
        success: true,
        isNewUser: handoff.isNewUser,
        customToken,
        user: {
          id: profile.id,
          email: profile.email,
          name: profile.name,
          image: profile.image,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Google identity could not be linked safely." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
