import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { consumeAuthCode } from "@/lib/auth-tokens";
import { rateLimit } from "@/lib/rate-limit";

async function POSTHandler(req: NextRequest) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown_ip";
  if (!rateLimit(`verify_email_${ip}`, 10, 15 * 60 * 1000).success) {
    return NextResponse.json({ error: "Too many verification attempts. Please try again later." }, { status: 429 });
  }
  const { email, code } = await req.json();
  const normalized = typeof email === "string" ? email.toLowerCase().trim() : "";
  const validCode = typeof code === "string" && /^\d{6}$/.test(code);
  const codeIsValid = normalized && validCode
    ? await consumeAuthCode("verify", normalized, code)
    : false;
  if (!codeIsValid) return NextResponse.json({ error: "This verification code is invalid or expired." }, { status: 400 });
  await db.user.updateMany({ where: { email: normalized, emailVerified: null }, data: { emailVerified: new Date() } });
  return NextResponse.json({ success: true });
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
