import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { consumeValidatedAuthCode, validateAuthCode } from "@/lib/auth-tokens";
import { rateLimit } from "@/lib/rate-limit";
import { getFirebaseAuth } from "@/lib/firebase-admin";

async function POSTHandler(req: NextRequest) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown_ip";
  if (!(await rateLimit(`reset_password_code_${ip}`, 10, 15 * 60 * 1000)).success) {
    return NextResponse.json({ error: "Too many reset attempts. Please try again later." }, { status: 429 });
  }
  const { email, code, password } = await req.json();
  const normalized = typeof email === "string" ? email.toLowerCase().trim() : "";
  if (!normalized || typeof code !== "string" || !/^\d{6}$/.test(code) || typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "A valid email, 6-digit code, and password of at least 8 characters are required." }, { status: 400 });
  }
  const codeRecord = await validateAuthCode("reset", normalized, code);
  if (!codeRecord) {
    return NextResponse.json({ error: "This reset code is invalid or expired." }, { status: 400 });
  }
  
  const profile = await db.profile.findUnique({ where: { email: normalized }, select: { id: true } });
  if (!profile) {
    return NextResponse.json({ error: "This reset code is invalid or expired." }, { status: 400 });
  }

  try {
    const auth = getFirebaseAuth();
    const firebaseUser = await auth.getUser(profile.id);
    const hasPasswordProvider = firebaseUser.providerData.some(
      (provider) => provider.providerId === "password",
    );
    if (
      !hasPasswordProvider ||
      firebaseUser.email?.toLowerCase().trim() !== normalized
    ) {
      return NextResponse.json({ error: "This reset code is invalid or expired." }, { status: 400 });
    }

    await auth.updateUser(profile.id, { password });
    const consumed = await consumeValidatedAuthCode(codeRecord);
    if (!consumed) {
      return NextResponse.json({ error: "This reset code is invalid or expired." }, { status: 400 });
    }
    await auth.revokeRefreshTokens(profile.id);
  } catch {
    return NextResponse.json(
      { error: "Password reset is temporarily unavailable. Your code remains valid." },
      { status: 503 },
    );
  }

  await db.pushSubscription.deleteMany({ where: { userId: profile.id } });
  return NextResponse.json({ success: true });
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
