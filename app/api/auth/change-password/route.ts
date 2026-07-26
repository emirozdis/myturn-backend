import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { getAuthSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { isRecentAuthentication } from "@/lib/auth-policy";

async function POSTHandler(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(`change_password_${session.user.id}`, 5, 15 * 60 * 1000);
  if (!limit.success) {
    return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const { newPassword } = body;
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json(
      { error: "A new password of at least 8 characters is required.", code: "INVALID_PASSWORD" },
      { status: 400 },
    );
  }

  if (
    session.firebase.signInProvider !== "password" ||
    !isRecentAuthentication(session.firebase.authTime)
  ) {
    return NextResponse.json(
      { error: "Recent password authentication is required.", code: "CURRENT_PASSWORD_REAUTH_REQUIRED" },
      { status: 403 },
    );
  }

  try {
    const auth = getFirebaseAuth();
    await auth.updateUser(session.user.id, {
      password: newPassword,
    });
    await auth.revokeRefreshTokens(session.user.id);
  } catch {
    return NextResponse.json(
      { error: "Password update is temporarily unavailable.", code: "PASSWORD_UPDATE_FAILED" },
      { status: 503 },
    );
  }

  await db.pushSubscription.deleteMany({ where: { userId: session.user.id } });

  return NextResponse.json({ success: true, requiresReauthentication: true });
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
