import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { consumeValidatedAuthCode, validateAuthCode } from "@/lib/auth-tokens";
import { rateLimit } from "@/lib/rate-limit";
import { getFirebaseAuth } from "@/lib/firebase-admin";

async function POSTHandler(req: NextRequest) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown_ip";
  if (!(await rateLimit(`verify_email_${ip}`, 10, 15 * 60 * 1000)).success) {
    return NextResponse.json({ error: "Too many verification attempts. Please try again later." }, { status: 429 });
  }
  const { email, code } = await req.json();
  const normalized = typeof email === "string" ? email.toLowerCase().trim() : "";
  const validCode = typeof code === "string" && /^\d{6}$/.test(code);
  const codeRecord = normalized && validCode
    ? await validateAuthCode("verify", normalized, code)
    : null;
  if (!codeRecord) {
    return NextResponse.json({ error: "This verification code is invalid or expired." }, { status: 400 });
  }

  const profile = await db.profile.findUnique({
    where: { email: normalized },
    select: { id: true, firebaseUid: true },
  });
  if (!profile) {
    return NextResponse.json({ error: "This verification code is invalid or expired." }, { status: 400 });
  }

  const auth = getFirebaseAuth();
  await auth.updateUser(profile.firebaseUid, { emailVerified: true });
  const consumed = await consumeValidatedAuthCode(codeRecord);
  if (!consumed) {
    return NextResponse.json({ error: "This verification code is invalid or expired." }, { status: 400 });
  }
  await db.profile.update({
    where: { id: profile.id },
    data: { emailVerified: new Date() },
  });
  await auth.revokeRefreshTokens(profile.firebaseUid);
  return NextResponse.json({ success: true });
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
