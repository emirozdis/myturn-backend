// ./app/api/push/route.ts
import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

function readToken(body: Record<string, unknown>): string | null {
  const subscription = body.subscription;
  const candidate = body.token ||
    (subscription && typeof subscription === "object" && "token" in subscription
      ? (subscription as { token?: unknown }).token
      : subscription);
  if (typeof candidate !== "string" || candidate.length < 16 || candidate.length > 4096 || /\s/.test(candidate)) {
    return null;
  }
  return candidate;
}

async function POSTHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    
    // Parse the body safely to allow both registrations and unregistrations to process under POST
    const body = await req.json().catch(() => ({}));
    const action = body.action || "register";

    // --- Action: UNREGISTER ---
    if (action === "unregister") {
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized. Please log in first." }, { status: 401 });
      }

      const token = readToken(body);

      if (!token) {
        return NextResponse.json({ error: "Invalid token parameter." }, { status: 400 });
      }

      await db.pushSubscription.deleteMany({
        where: { token, userId: session.user.id }
      });

      return NextResponse.json({ success: true });
    }

    // --- Action: REGISTER ---
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized. Please log in first." }, { status: 401 });
    }

    const rl = await rateLimit(`save_sub_${session.user.id}`, 15, 60000);
    if (!rl.success) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rl.retryAfter}s.` },
        { status: 429 }
      );
    }

    const token = readToken(body);

    if (!token) {
      return NextResponse.json({ error: "Invalid FCM token details." }, { status: 400 });
    }

    const userId = session.user.id;

    if (body.locale === "en" || body.locale === "tr") {
      await db.profile.update({ where: { id: userId }, data: { locale: body.locale } });
    }

    // Associate the new unique Firebase Cloud Messaging token with the user
    await db.pushSubscription.upsert({
      where: { token },
      update: {
        userId,
      },
      create: {
        userId,
        token,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    throw error;
  }
}

// Keep the DELETE method as a backward compatible fallback, but route query tokens properly
async function DELETEHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized. Please log in first." }, { status: 401 });
    }
    const rl = await rateLimit(`del_sub_${session.user.id}`, 20, 60000);
    if (!rl.success) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rl.retryAfter}s.` },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token || token.length < 16 || token.length > 4096 || /\s/.test(token)) {
      return NextResponse.json({ error: "Invalid token parameter." }, { status: 400 });
    }

    await db.pushSubscription.deleteMany({
      where: { token, userId: session.user.id }
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    throw error;
  }
}

export const POST = withApiHandler(POSTHandler);

export const DELETE = withApiHandler(DELETEHandler);

export const dynamic = "force-dynamic";
