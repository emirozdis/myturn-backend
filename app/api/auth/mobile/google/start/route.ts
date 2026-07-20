import { NextRequest, NextResponse } from "next/server";
import { getCurrentAgreement } from "@/lib/legal-agreements";
import { rateLimit } from "@/lib/rate-limit";
import {
  createGoogleOAuthState,
  getGoogleOAuthConfig,
  googleAppRedirect,
  googleLoginEnabled,
  isValidGoogleCodeChallenge,
} from "@/lib/google-mobile-auth";

function clientIp(req: NextRequest) {
  return (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown")
    .split(",")[0]
    .trim();
}

export async function GET(req: NextRequest) {
  if (!googleLoginEnabled()) {
    return NextResponse.redirect(googleAppRedirect({ error: "google_disabled" }));
  }

  const limited = rateLimit(`google_oauth_start_${clientIp(req)}`, 20, 10 * 60 * 1000);
  if (!limited.success) {
    return NextResponse.redirect(googleAppRedirect({ error: "too_many_attempts" }));
  }

  const challenge = req.nextUrl.searchParams.get("code_challenge");
  const accepted = req.nextUrl.searchParams.get("agreement_accepted") === "true";
  const agreement = getCurrentAgreement();
  const agreementMatches =
    req.nextUrl.searchParams.get("agreement_slug") === agreement.slug &&
    req.nextUrl.searchParams.get("agreement_version") === agreement.version &&
    req.nextUrl.searchParams.get("agreement_hash") === agreement.contentHash;

  if (!isValidGoogleCodeChallenge(challenge) || !accepted || !agreementMatches) {
    return NextResponse.redirect(googleAppRedirect({ error: "invalid_request" }));
  }

  const { clientId, redirectUri } = getGoogleOAuthConfig();
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: createGoogleOAuthState(challenge),
    prompt: "select_account",
  }).toString();

  return NextResponse.redirect(authorizationUrl);
}

export const dynamic = "force-dynamic";
