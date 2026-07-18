import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { issueAuthCode } from "@/lib/auth-tokens";
import { sendVerificationEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

async function POSTHandler(req: NextRequest) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown_ip";
  if (!rateLimit(`resend_verification_${ip}`, 5, 60 * 60 * 1000).success) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }
  const { email } = await req.json();
  const normalized = typeof email === "string" ? email.toLowerCase().trim() : "";
  const user = normalized ? await db.user.findUnique({ where: { email: normalized } }) : null;
  if (user && !user.emailVerified) {
    const code = await issueAuthCode("verify", normalized);
    await sendVerificationEmail(normalized, user.name, code);
  }
  return NextResponse.json({ success: true });
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
