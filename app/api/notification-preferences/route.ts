import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { getAuthSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

const preferenceSelect = {
  notifyTurns: true,
  notifyReminders: true,
  notifyPosts: true,
  notifyInteractions: true,
  notifySocial: true,
  notifyRecaps: true,
  locale: true,
} as const;

async function GETHandler() {
  const session = await getAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const preferences = await db.user.findUnique({ where: { id: session.user.id }, select: preferenceSelect });
  if (!preferences) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ success: true, preferences });
}

async function POSTHandler(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`notification_preferences_${session.user.id}`, 30, 60_000);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, boolean | string> = {};
  for (const key of ["notifyTurns", "notifyReminders", "notifyPosts", "notifyInteractions", "notifySocial", "notifyRecaps"] as const) {
    if (typeof body[key] === "boolean") data[key] = body[key];
  }
  if (body.locale === "en" || body.locale === "tr") data.locale = body.locale;

  const preferences = await db.user.update({
    where: { id: session.user.id },
    data,
    select: preferenceSelect,
  });
  return NextResponse.json({ success: true, preferences });
}

export const GET = withApiHandler(GETHandler);

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
