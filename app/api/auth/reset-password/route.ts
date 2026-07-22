import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { consumeAuthCode } from "@/lib/auth-tokens";
import { rateLimit } from "@/lib/rate-limit";
import { getFirebaseAuth } from "@/lib/firebase-admin";

async function POSTHandler(req: NextRequest) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown_ip";
  if (!rateLimit(`reset_password_code_${ip}`, 10, 15 * 60 * 1000).success) {
    return NextResponse.json({ error: "Too many reset attempts. Please try again later." }, { status: 429 });
  }
  const { email, code, password } = await req.json();
  const normalized = typeof email === "string" ? email.toLowerCase().trim() : "";
  if (!normalized || typeof code !== "string" || !/^\d{6}$/.test(code) || typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "A valid email, 6-digit code, and password of at least 8 characters are required." }, { status: 400 });
  }
  const codeIsValid = await consumeAuthCode("reset", normalized, code);
  if (!codeIsValid) return NextResponse.json({ error: "This reset code is invalid or expired." }, { status: 400 });
  
  const user = await db.user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "This reset code is invalid or expired." }, { status: 400 });

  try {
    const auth = getFirebaseAuth();
    await auth.updateUser(user.id, { password });
  } catch (err: any) {
    // Fallback: try finding user in Firebase by email if uid didn't match
    try {
      const auth = getFirebaseAuth();
      const fbUser = await auth.getUserByEmail(normalized);
      await auth.updateUser(fbUser.uid, { password });
    } catch {}
  }

  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { sessionVersion: { increment: 1 } },
    }),
    db.pushSubscription.deleteMany({ where: { userId: user.id } }),
  ]);
  return NextResponse.json({ success: true });
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
