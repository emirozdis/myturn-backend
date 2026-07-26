import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { issueAuthCode } from "@/lib/auth-tokens";
import { sendVerificationEmail } from "@/lib/email";
import { CURRENT_AGREEMENT_CONTENT, CURRENT_AGREEMENT } from "@/lib/legal-copy";
import { CURRENT_AGREEMENT_HASH } from "@/lib/legal-agreements";
import { getFirebaseAuth } from "@/lib/firebase-admin";

async function POSTHandler(req: NextRequest) {
  try {
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown_ip";

    // Rate Limit: Max 5 signups per hour per IP address
    const rl = await rateLimit(`signup_${ip}`, 5, 3600 * 1000);
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429 }
      );
    }

    // Prevent registration if system flag is disabled
    const allowRegistration = process.env.NEXT_PUBLIC_ALLOW_REGISTRATION !== "false";
    if (!allowRegistration) {
      return NextResponse.json(
        { error: "User registration is currently disabled by the system administrator." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { name, idToken, agreement } = body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 100 ||
      typeof idToken !== "string" ||
      !idToken.trim()
    ) {
      return NextResponse.json(
        { error: "Name and a Firebase registration identity are required." },
        { status: 400 }
      );
    }

    const hasAcceptedCurrentAgreement =
      agreement?.accepted === true &&
      agreement?.slug === CURRENT_AGREEMENT.slug &&
      agreement?.version === CURRENT_AGREEMENT.version &&
      agreement?.contentHash === CURRENT_AGREEMENT_HASH;

    if (!hasAcceptedCurrentAgreement) {
      return NextResponse.json(
        { error: "You must accept the current Terms of Service and Privacy Notice to register." },
        { status: 400 }
      );
    }

    let firebaseUser;
    try {
      const auth = getFirebaseAuth();
      const decoded = await auth.verifyIdToken(idToken.trim(), true);
      if (!decoded.uid || !decoded.email) {
        return NextResponse.json({ error: "Firebase identity has no email." }, { status: 400 });
      }
      firebaseUser = await auth.getUser(decoded.uid);
    } catch {
      return NextResponse.json({ error: "Invalid Firebase registration identity." }, { status: 401 });
    }

    const emailNormalized = firebaseUser.email?.toLowerCase().trim() || "";
    if (emailNormalized.length > 320 || !emailNormalized.includes("@")) {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    }
    const normalizedName = name.trim();

    const existingProfile = await db.profile.findFirst({
      where: { OR: [{ id: firebaseUser.uid }, { email: emailNormalized }] },
    });

    if (existingProfile && existingProfile.id !== firebaseUser.uid) {
      return NextResponse.json(
        { error: "This Firebase identity conflicts with an existing profile." },
        { status: 409 }
      );
    }

    try {
      await getFirebaseAuth().updateUser(firebaseUser.uid, { displayName: normalizedName });
      const profile = await db.$transaction(async (tx) => {
        const provisioned = await tx.profile.upsert({
          where: { id: firebaseUser.uid },
          create: {
            id: firebaseUser.uid,
            name: normalizedName,
            email: emailNormalized,
          },
          update: {},
        });
        await tx.agreementAcceptance.upsert({
          where: {
            userId_agreementSlug_agreementVersion: {
              userId: provisioned.id,
              agreementSlug: CURRENT_AGREEMENT.slug,
              agreementVersion: CURRENT_AGREEMENT.version,
            },
          },
          create: {
            userId: provisioned.id,
            agreementSlug: CURRENT_AGREEMENT.slug,
            agreementVersion: CURRENT_AGREEMENT.version,
            agreementEffectiveAt: new Date(CURRENT_AGREEMENT.effectiveAt),
            titleSnapshot: CURRENT_AGREEMENT.title,
            contentSnapshot: CURRENT_AGREEMENT_CONTENT,
            contentHash: CURRENT_AGREEMENT_HASH,
            ipAddress: ip.split(",")[0]?.trim().slice(0, 64),
            userAgent: req.headers.get("user-agent")?.slice(0, 1000),
          },
          update: {},
        });
        return provisioned;
      });
      const code = await issueAuthCode("verify", emailNormalized);
      await sendVerificationEmail(emailNormalized, profile.name, code);
      return NextResponse.json(
        { success: true, userId: profile.id, requiresEmailVerification: true },
        { status: 201 },
      );
    } catch (provisioningError) {
      await db.verificationToken.deleteMany({ where: { identifier: `verify:${emailNormalized}` } });
      if (!existingProfile) {
        await db.profile.deleteMany({ where: { id: firebaseUser.uid } });
        try {
          await getFirebaseAuth().deleteUser(firebaseUser.uid);
        } catch {}
      }
      throw provisioningError;
    }
  } catch (error: unknown) {
    throw error;
  }
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
