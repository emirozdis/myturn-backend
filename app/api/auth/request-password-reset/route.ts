import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { issueAuthCode } from "@/lib/auth-tokens";
import { sendPasswordResetEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { getFirebaseAuth } from "@/lib/firebase-admin";

async function POSTHandler(req: NextRequest) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown_ip";
  if (!(await rateLimit(`password_reset_${ip}`, 5, 60 * 60 * 1000)).success) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }
  const { email } = await req.json();
  const normalized = typeof email === "string" ? email.toLowerCase().trim() : "";
  const profile = normalized ? await db.profile.findUnique({ where: { email: normalized } }) : null;
  if (profile) {
    try {
      const firebaseUser = await getFirebaseAuth().getUser(profile.id);
      const hasPasswordProvider = firebaseUser.providerData.some(
        (provider) => provider.providerId === "password",
      );
      if (hasPasswordProvider && firebaseUser.email?.toLowerCase().trim() === normalized) {
        const code = await issueAuthCode("reset", normalized);
        await sendPasswordResetEmail(normalized, profile.name, code);
      }
    } catch {
      // Keep the public response identical for absent, provider-only, disabled,
      // and temporarily unavailable identities.
    }
  }
  return NextResponse.json({ success: true });
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
