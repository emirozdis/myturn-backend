import "server-only";

import { createHmac, pbkdf2 as pbkdf2Callback, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

const pbkdf2 = promisify(pbkdf2Callback);

export const ADMIN_COOKIE_NAME = "myturn_admin_session";
export const ADMIN_CHALLENGE_COOKIE_NAME = "myturn_admin_challenge";
const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const CHALLENGE_LIFETIME_SECONDS = 10 * 60;
const PASSWORD_ALGORITHM = "pbkdf2_sha512";

type AdminTokenPayload = {
  email: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

type AdminChallengePayload = {
  kind: "admin_login";
  email: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export type AdminSession = {
  email: string;
  expiresAt: Date;
};

export type AdminLoginChallenge = {
  email: string;
  expiresAt: Date;
  nonce: string;
};

function adminEmail() {
  return process.env.ADMIN_EMAIL?.trim().toLowerCase() || "";
}

function sessionSecret() {
  const value = process.env.ADMIN_SESSION_SECRET || "";
  return value.length >= 32 ? value : null;
}

function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function sign(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function parseAdminPasswordHash(encodedHash: string) {
  // Colon is the preferred separator because Next.js expands `$NAME` inside
  // local .env files. Keep accepting the legacy dollar format for values set
  // directly in a hosting provider, where dotenv expansion does not occur.
  const separator = encodedHash.includes(":") ? ":" : "$";
  const parts = encodedHash.split(separator);
  if (parts.length !== 4) return null;
  const [algorithm, iterationString, saltString, expectedString] = parts;
  const iterations = Number(iterationString);
  if (
    algorithm !== PASSWORD_ALGORITHM ||
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    !/^[A-Za-z0-9_-]+$/.test(saltString) ||
    !/^[A-Za-z0-9_-]+$/.test(expectedString)
  ) {
    return null;
  }

  const salt = Buffer.from(saltString, "base64url");
  const expected = Buffer.from(expectedString, "base64url");
  if (salt.length < 16 || expected.length < 32) return null;
  return { iterations, salt, expected };
}

export function isAdminAuthConfigured() {
  return Boolean(
    adminEmail() &&
    parseAdminPasswordHash(process.env.ADMIN_PASSWORD_HASH || "") &&
    sessionSecret() &&
    process.env.BREVO_API_KEY &&
    process.env.BREVO_SENDER_EMAIL,
  );
}

export async function verifyAdminCredentials(email: string, password: string) {
  const configuredEmail = adminEmail();
  const encodedHash = process.env.ADMIN_PASSWORD_HASH || "";

  if (!configuredEmail || !encodedHash || !sessionSecret()) return false;
  const emailMatches = safeEqual(
    Buffer.from(email.trim().toLowerCase()),
    Buffer.from(configuredEmail),
  );

  const parsedHash = parseAdminPasswordHash(encodedHash);
  if (!parsedHash) return false;

  const actual = await pbkdf2(
    password,
    parsedHash.salt,
    parsedHash.iterations,
    parsedHash.expected.length,
    "sha512",
  );
  return emailMatches && safeEqual(actual, parsedHash.expected);
}

export function createAdminSessionToken(email: string) {
  const secret = sessionSecret();
  if (!secret) throw new Error("ADMIN_SESSION_SECRET must contain at least 32 characters.");

  const now = Math.floor(Date.now() / 1_000);
  const payload: AdminTokenPayload = {
    email: email.trim().toLowerCase(),
    issuedAt: now,
    expiresAt: now + SESSION_LIFETIME_SECONDS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

function adminLoginIdentifierPrefix(email: string) {
  return `admin-login:${email.trim().toLowerCase()}:`;
}

function adminLoginIdentifier(email: string, nonce: string) {
  return `${adminLoginIdentifierPrefix(email)}${nonce}`;
}

function hashAdminLoginCode(email: string, nonce: string, code: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`admin-login\0${email.trim().toLowerCase()}\0${nonce}\0${code}`)
    .digest("hex");
}

export async function createAdminLoginChallenge(email: string) {
  const secret = sessionSecret();
  const normalizedEmail = email.trim().toLowerCase();
  if (!secret || normalizedEmail !== adminEmail()) {
    throw new Error("Admin two-factor authentication is not configured.");
  }

  const now = Math.floor(Date.now() / 1_000);
  const nonce = randomBytes(24).toString("base64url");
  const code = randomInt(100000, 1000000).toString();
  const payload: AdminChallengePayload = {
    kind: "admin_login",
    email: normalizedEmail,
    issuedAt: now,
    expiresAt: now + CHALLENGE_LIFETIME_SECONDS,
    nonce,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const challengeToken = `${encodedPayload}.${sign(encodedPayload, secret)}`;
  const identifier = adminLoginIdentifier(normalizedEmail, nonce);
  const token = hashAdminLoginCode(normalizedEmail, nonce, code, secret);

  await db.$transaction([
    db.verificationToken.deleteMany({
      where: { identifier: { startsWith: adminLoginIdentifierPrefix(normalizedEmail) } },
    }),
    db.verificationToken.create({
      data: { identifier, token, expires: new Date(payload.expiresAt * 1_000) },
    }),
  ]);

  return { code, challengeToken, expiresAt: new Date(payload.expiresAt * 1_000) };
}

export function verifyAdminLoginChallengeToken(token: string): AdminLoginChallenge | null {
  const secret = sessionSecret();
  if (!secret) return null;

  const [encodedPayload, providedSignature, extra] = token.split(".");
  if (!encodedPayload || !providedSignature || extra) return null;
  if (!safeEqual(Buffer.from(providedSignature), Buffer.from(sign(encodedPayload, secret)))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AdminChallengePayload;
    const now = Math.floor(Date.now() / 1_000);
    if (
      payload.kind !== "admin_login" ||
      payload.email !== adminEmail() ||
      !Number.isInteger(payload.issuedAt) ||
      !Number.isInteger(payload.expiresAt) ||
      payload.issuedAt > now + 60 ||
      payload.expiresAt <= now ||
      payload.expiresAt - payload.issuedAt !== CHALLENGE_LIFETIME_SECONDS ||
      typeof payload.nonce !== "string" ||
      payload.nonce.length < 20
    ) {
      return null;
    }
    return { email: payload.email, expiresAt: new Date(payload.expiresAt * 1_000), nonce: payload.nonce };
  } catch {
    return null;
  }
}

export async function getAdminLoginChallenge() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_CHALLENGE_COOKIE_NAME)?.value;
  const challenge = token ? verifyAdminLoginChallengeToken(token) : null;
  if (!challenge) return null;
  const pending = await db.verificationToken.findFirst({
    where: {
      identifier: adminLoginIdentifier(challenge.email, challenge.nonce),
      expires: { gt: new Date() },
    },
    select: { id: true },
  });
  return pending ? challenge : null;
}

export async function consumeAdminLoginChallenge(challengeToken: string, code: string) {
  const secret = sessionSecret();
  const challenge = verifyAdminLoginChallengeToken(challengeToken);
  if (!secret || !challenge || !/^\d{6}$/.test(code)) return null;

  const identifier = adminLoginIdentifier(challenge.email, challenge.nonce);
  const token = hashAdminLoginCode(challenge.email, challenge.nonce, code, secret);
  const consumed = await db.verificationToken.deleteMany({
    where: { identifier, token, expires: { gt: new Date() } },
  });
  return consumed.count === 1 ? challenge : null;
}

export async function invalidateAdminLoginChallenge(challengeToken: string | undefined) {
  if (!challengeToken) return;
  const challenge = verifyAdminLoginChallengeToken(challengeToken);
  if (!challenge) return;
  await db.verificationToken.deleteMany({
    where: { identifier: adminLoginIdentifier(challenge.email, challenge.nonce) },
  });
}

export function verifyAdminSessionToken(token: string): AdminSession | null {
  const secret = sessionSecret();
  if (!secret) return null;

  const [encodedPayload, providedSignature, extra] = token.split(".");
  if (!encodedPayload || !providedSignature || extra) return null;
  if (!safeEqual(Buffer.from(providedSignature), Buffer.from(sign(encodedPayload, secret)))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AdminTokenPayload;
    const now = Math.floor(Date.now() / 1_000);
    if (
      payload.email !== adminEmail() ||
      !Number.isInteger(payload.issuedAt) ||
      !Number.isInteger(payload.expiresAt) ||
      payload.issuedAt > now + 60 ||
      payload.expiresAt <= now ||
      payload.expiresAt - payload.issuedAt !== SESSION_LIFETIME_SECONDS ||
      typeof payload.nonce !== "string"
    ) {
      return null;
    }
    return { email: payload.email, expiresAt: new Date(payload.expiresAt * 1_000) };
  } catch {
    return null;
  }
}

export async function getAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  return token ? verifyAdminSessionToken(token) : null;
}

export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}

export const adminCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/admin",
  maxAge: SESSION_LIFETIME_SECONDS,
};

export const adminChallengeCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/admin",
  maxAge: CHALLENGE_LIFETIME_SECONDS,
};
