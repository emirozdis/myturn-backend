import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { getAuthSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getFirebaseAuth } from "@/lib/firebase-admin";

async function POSTHandler(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = rateLimit(`change_password_${session.user.id}`, 5, 15 * 60 * 1000);
  if (!limit.success) {
    return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const { newPassword } = body;
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "INVALID_PASSWORD" }, { status: 400 });
  }

  try {
    const auth = getFirebaseAuth();
    await auth.updateUser(session.user.id, {
      password: newPassword,
    });
  } catch (fbError: any) {
    return NextResponse.json({ error: fbError.message || "Failed to update password in Firebase" }, { status: 400 });
  }

  await db.$transaction([
    db.user.update({
      where: { id: session.user.id },
      data: { sessionVersion: { increment: 1 } },
    }),
    db.pushSubscription.deleteMany({ where: { userId: session.user.id } }),
  ]);

  return NextResponse.json({ success: true, requiresReauthentication: true });
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
