import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { issueAuthCode } from "@/lib/auth-tokens";
import { sendAccountDeletionEmail } from "@/lib/email";
import { reportError } from "@/lib/observability/logger";
import { withApiHandler } from "@/lib/observability/api-handler";
import { rateLimit } from "@/lib/rate-limit";

async function POSTHandler(req: NextRequest) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown_ip";
  if (!(await rateLimit(`delete_request_ip_${ip}`, 5, 60 * 60 * 1000)).success) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : "";
  if (!email || email.length > 320 || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!(await rateLimit(`delete_request_email_${email}`, 3, 60 * 60 * 1000)).success) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const user = await db.profile.findUnique({
    where: { email },
    select: { name: true },
  });

  if (user) {
    try {
      const code = await issueAuthCode("delete", email);
      await sendAccountDeletionEmail(email, user.name, code);
    } catch (error) {
      reportError("account_deletion.verification_email_failed", error);
    }
  }

  // Keep the response identical whether or not an account exists.
  return NextResponse.json({ success: true });
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
