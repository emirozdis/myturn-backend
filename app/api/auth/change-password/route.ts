import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { compare, hash } from "bcryptjs";
import { getAuthSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

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
  const { currentPassword, newPassword } = body;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "INVALID_PASSWORD" }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "PASSWORD_UNCHANGED" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.password) {
    return NextResponse.json({ error: "PASSWORD_LOGIN_UNAVAILABLE" }, { status: 400 });
  }

  const currentPasswordMatches = await compare(currentPassword, user.password);
  if (!currentPasswordMatches) {
    return NextResponse.json({ error: "CURRENT_PASSWORD_INCORRECT" }, { status: 400 });
  }

  const password = await hash(newPassword, 12);
  await db.$transaction([
    db.user.update({
      where: { id: session.user.id },
      data: { password, sessionVersion: { increment: 1 } },
    }),
    db.pushSubscription.deleteMany({ where: { userId: session.user.id } }),
  ]);

  return NextResponse.json({ success: true, requiresReauthentication: true });
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
