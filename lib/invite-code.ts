import { randomInt } from "node:crypto";

// Crockford-style alphabet avoids characters that are easy to confuse when a
// code is read aloud or typed manually. Six symbols keep invites quick to type
// while still providing almost one billion possible values; uniqueness is
// enforced by the database and callers retry the very unlikely collision.
const INVITE_ALPHABET = "023456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const INVITE_CODE_SYMBOLS = 6;

export function createInviteCodeCandidate(): string {
  let value = "";
  for (let index = 0; index < INVITE_CODE_SYMBOLS; index += 1) {
    value += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return value;
}
