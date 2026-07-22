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
    const rl = rateLimit(`signup_${ip}`, 5, 3600 * 1000);
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
    const { name, email, password, agreement } = body;

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required." },
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

    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters long." }, { status: 400 });
    }

    const emailNormalized = email.toLowerCase().trim();

    const existingUser = await db.user.findUnique({
      where: { email: emailNormalized },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "A user with this email already exists." },
        { status: 400 }
      );
    }

    // Create User in Firebase Authentication
    let firebaseUser;
    try {
      const auth = getFirebaseAuth();
      firebaseUser = await auth.createUser({
        email: emailNormalized,
        password: password,
        displayName: name,
      });
    } catch (fbError: any) {
      if (fbError.code === "auth/email-already-in-use") {
        return NextResponse.json(
          { error: "A user with this email already exists in Firebase Auth." },
          { status: 400 }
        );
      }
      throw fbError;
    }

    // Create User in Prisma database mapping to Firebase UID
    const user = await db.user.create({
      data: {
        id: firebaseUser.uid,
        name,
        email: emailNormalized,
        agreementAcceptances: {
          create: {
            agreementSlug: CURRENT_AGREEMENT.slug,
            agreementVersion: CURRENT_AGREEMENT.version,
            agreementEffectiveAt: new Date(CURRENT_AGREEMENT.effectiveAt),
            titleSnapshot: CURRENT_AGREEMENT.title,
            contentSnapshot: CURRENT_AGREEMENT_CONTENT,
            contentHash: CURRENT_AGREEMENT_HASH,
            ipAddress: ip.split(",")[0]?.trim().slice(0, 64),
            userAgent: req.headers.get("user-agent")?.slice(0, 1000),
          },
        },
      },
    });

    try {
      const code = await issueAuthCode("verify", emailNormalized);
      await sendVerificationEmail(emailNormalized, user.name, code);
    } catch (emailError) {
      await db.verificationToken.deleteMany({ where: { identifier: `verify:${emailNormalized}` } });
      await db.user.delete({ where: { id: user.id } });
      try {
        await getFirebaseAuth().deleteUser(firebaseUser.uid);
      } catch {}
      throw emailError;
    }

    return NextResponse.json({ success: true, userId: user.id, requiresEmailVerification: true }, { status: 201 });
  } catch (error: unknown) {
    throw error;
  }
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
