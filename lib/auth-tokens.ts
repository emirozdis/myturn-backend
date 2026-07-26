import { createHmac, randomInt } from "crypto";
import { db } from "@/lib/db";

export type AuthTokenPurpose = "verify" | "reset" | "delete";

const TOKEN_TTL_MS = 1000 * 60 * 60;

function authCodeSecret() {
  const secret = process.env.AUTH_CODE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_CODE_SECRET must contain at least 32 characters.");
  }
  return secret;
}

export function hashAuthCode(purpose: AuthTokenPurpose, email: string, code: string) {
  return createHmac("sha256", authCodeSecret())
    .update(`${purpose}\0${email.toLowerCase().trim()}\0${code}`)
    .digest("hex");
}

export async function issueAuthCode(purpose: AuthTokenPurpose, email: string) {
  const identifier = `${purpose}:${email}`;
  const code = randomInt(100000, 1000000).toString();

  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: {
      identifier,
      token: hashAuthCode(purpose, email, code),
      expires: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  return code;
}

export async function validateAuthCode(
  purpose: AuthTokenPurpose,
  email: string,
  code: string,
) {
  const identifier = `${purpose}:${email}`;
  const token = hashAuthCode(purpose, email, code);
  const record = await db.verificationToken.findUnique({
    where: { identifier_token: { identifier, token } },
  });

  if (!record) return null;

  const now = new Date();
  if (record.expires <= now) {
    await db.verificationToken.deleteMany({ where: { id: record.id } });
    return null;
  }

  return { id: record.id, identifier, token };
}

export async function consumeValidatedAuthCode(record: {
  id: string;
  identifier: string;
  token: string;
}) {
  const consumed = await db.verificationToken.deleteMany({
    where: {
      id: record.id,
      identifier: record.identifier,
      token: record.token,
      expires: { gt: new Date() },
    },
  });
  return consumed.count === 1;
}

export async function consumeAuthCode(
  purpose: AuthTokenPurpose,
  email: string,
  code: string,
) {
  const record = await validateAuthCode(purpose, email, code);
  return record ? consumeValidatedAuthCode(record) : false;
}
