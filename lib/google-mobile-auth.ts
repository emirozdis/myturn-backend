import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const HANDOFF_PREFIX = "mobile-google";

type GoogleOAuthState = {
  challenge: string;
  exp: number;
  nonce: string;
};

function authSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for Google sign-in.");
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isValidGoogleCodeChallenge(value: string | null): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/.test(value));
}

export function createGoogleOAuthState(challenge: string) {
  const payload: GoogleOAuthState = {
    challenge,
    exp: Date.now() + OAUTH_STATE_TTL_MS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyGoogleOAuthState(value: string): GoogleOAuthState | null {
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GoogleOAuthState;
    if (
      !isValidGoogleCodeChallenge(payload.challenge) ||
      typeof payload.exp !== "number" ||
      payload.exp <= Date.now() ||
      typeof payload.nonce !== "string"
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function hashHandoffCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export async function issueGoogleMobileHandoff(
  userId: string,
  challenge: string,
  isNewUser: boolean,
) {
  const code = randomBytes(32).toString("base64url");
  const identifier = `${HANDOFF_PREFIX}:${isNewUser ? "1" : "0"}:${userId}:${challenge}`;

  await db.verificationToken.create({
    data: {
      identifier,
      token: hashHandoffCode(code),
      expires: new Date(Date.now() + HANDOFF_TTL_MS),
    },
  });

  return code;
}

export async function consumeGoogleMobileHandoff(code: string, verifier: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || verifier.length < 32 || verifier.length > 256) {
    return null;
  }

  const token = hashHandoffCode(code);
  const record = await db.verificationToken.findUnique({ where: { token } });
  if (!record || record.expires <= new Date()) return null;

  const parts = record.identifier.split(":");
  if (parts.length !== 4 || parts[0] !== HANDOFF_PREFIX || !["0", "1"].includes(parts[1])) {
    return null;
  }

  const expectedChallenge = createHash("sha256").update(verifier).digest("hex");
  if (!safeEqual(parts[3], expectedChallenge)) return null;

  const consumed = await db.verificationToken.deleteMany({
    where: { id: record.id, token, expires: { gt: new Date() } },
  });
  if (consumed.count !== 1) return null;

  return { userId: parts[2], isNewUser: parts[1] === "1" };
}

export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  const baseUrl = process.env.NEXTAUTH_URL?.trim() || "http://localhost:3000";

  return {
    clientId,
    clientSecret,
    redirectUri: new URL("/api/auth/mobile/google/callback", baseUrl).toString(),
  };
}

export function googleLoginEnabled() {
  return (
    process.env.NEXT_PUBLIC_ALLOW_SOCIAL_LOGIN !== "false" &&
    process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN !== "false"
  );
}

export function googleAppRedirect(params: Record<string, string>) {
  const redirect = new URL("myturn://auth/google");
  for (const [key, value] of Object.entries(params)) redirect.searchParams.set(key, value);
  return redirect;
}
