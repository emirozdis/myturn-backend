import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { OAuth2Client } from "google-auth-library";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { CURRENT_AGREEMENT, CURRENT_AGREEMENT_CONTENT } from "@/lib/legal-copy";
import { CURRENT_AGREEMENT_HASH } from "@/lib/legal-agreements";
import {
  getGoogleOAuthConfig,
  googleAppRedirect,
  googleLoginEnabled,
  issueGoogleMobileHandoff,
  verifyGoogleOAuthState,
} from "@/lib/google-mobile-auth";

function redirectError(error: string) {
  return NextResponse.redirect(googleAppRedirect({ error }));
}

function clientIp(req: NextRequest) {
  return (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown")
    .split(",")[0]
    .trim()
    .slice(0, 64);
}

async function GETHandler(req: NextRequest) {
  if (!googleLoginEnabled()) return redirectError("google_disabled");
  if (req.nextUrl.searchParams.get("error")) return redirectError("google_cancelled");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const verifiedState = state ? verifyGoogleOAuthState(state) : null;
  if (!code || !verifiedState) return redirectError("invalid_state");

  try {
    const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
    const oauthClient = new OAuth2Client(clientId, clientSecret, redirectUri);
    const { tokens } = await oauthClient.getToken({ code, redirect_uri: redirectUri });
    if (!tokens.id_token) return redirectError("missing_identity_token");

    const ticket = await oauthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: clientId,
    });
    const profile = ticket.getPayload();
    const email = profile?.email?.toLowerCase().trim();
    if (!profile?.sub || !email || profile.email_verified !== true) {
      return redirectError("unverified_email");
    }

    const existingAccount = await db.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: profile.sub,
        },
      },
      select: { userId: true },
    });
    const existingUser = existingAccount
      ? await db.profile.findUnique({ where: { id: existingAccount.userId }, select: { id: true } })
      : await db.profile.findUnique({ where: { email }, select: { id: true } });
    const isNewUser = !existingUser;

    if (isNewUser && process.env.NEXT_PUBLIC_ALLOW_REGISTRATION === "false") {
      return redirectError("registration_disabled");
    }

    const newProfileId = randomUUID();
    const user = await db.$transaction(async (tx) => {
      const resolvedUser = existingUser
        ? await tx.profile.update({
            where: { id: existingUser.id },
            // Do not overwrite profile edits with Google values on later logins.
            data: { emailVerified: new Date() },
          })
        : await tx.profile.create({
            data: {
              id: newProfileId,
              firebaseUid: newProfileId,
              email,
              emailVerified: new Date(),
              name: profile.name || email.split("@")[0],
              image: profile.picture,
            },
          });

      await tx.account.upsert({
        where: {
          provider_providerAccountId: {
            provider: "google",
            providerAccountId: profile.sub,
          },
        },
        create: {
          userId: resolvedUser.id,
          type: "oauth",
          provider: "google",
          providerAccountId: profile.sub,
        },
        update: {},
      });

      await tx.agreementAcceptance.upsert({
        where: {
          userId_agreementSlug_agreementVersion: {
            userId: resolvedUser.id,
            agreementSlug: CURRENT_AGREEMENT.slug,
            agreementVersion: CURRENT_AGREEMENT.version,
          },
        },
        create: {
          userId: resolvedUser.id,
          agreementSlug: CURRENT_AGREEMENT.slug,
          agreementVersion: CURRENT_AGREEMENT.version,
          agreementEffectiveAt: new Date(CURRENT_AGREEMENT.effectiveAt),
          titleSnapshot: CURRENT_AGREEMENT.title,
          contentSnapshot: CURRENT_AGREEMENT_CONTENT,
          contentHash: CURRENT_AGREEMENT_HASH,
          ipAddress: clientIp(req),
          userAgent: req.headers.get("user-agent")?.slice(0, 1000),
        },
        update: {},
      });

      return resolvedUser;
    });

    const handoffCode = await issueGoogleMobileHandoff(
      user.id,
      verifiedState.challenge,
      isNewUser,
    );
    if (tokens.access_token) {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.access_token }),
        signal: AbortSignal.timeout(8_000),
      }).catch(() => {});
    }
    return NextResponse.redirect(googleAppRedirect({ code: handoffCode }));
  } catch {
    return redirectError("google_auth_failed");
  }
}

export const GET = withApiHandler(GETHandler);

export const dynamic = "force-dynamic";
