import { createHash, randomInt } from "crypto";
import { db } from "@/lib/db";

export type AuthTokenPurpose = "verify" | "reset" | "delete";

const TOKEN_TTL_MS = 1000 * 60 * 60;

export function hashAuthCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export async function issueAuthCode(purpose: AuthTokenPurpose, email: string) {
  const identifier = `${purpose}:${email}`;
  const code = randomInt(100000, 1000000).toString();

  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: {
      identifier,
      token: hashAuthCode(code),
      expires: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  return code;
}

export async function consumeAuthCode(
  purpose: AuthTokenPurpose,
  email: string,
  code: string,
) {
  const identifier = `${purpose}:${email}`;
  const token = hashAuthCode(code);
  const record = await db.verificationToken.findUnique({
    where: { identifier_token: { identifier, token } },
  });

  if (!record) return false;

  const now = new Date();
  if (record.expires <= now) {
    await db.verificationToken.deleteMany({ where: { id: record.id } });
    return false;
  }

  // deleteMany makes consumption atomic: two concurrent submissions cannot
  // both validate the same code.
  const consumed = await db.verificationToken.deleteMany({
    where: { id: record.id, identifier, token, expires: { gt: now } },
  });
  return consumed.count === 1;
}
