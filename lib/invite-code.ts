import { randomInt } from "node:crypto";

// Crockford-style alphabet avoids characters that are easy to confuse when a
// code is read aloud or typed manually. Twelve symbols provide 60 bits of
// entropy while keeping the code reasonably short for a beta invite flow.
const INVITE_ALPHABET = "023456789ABCDEFGHJKMNPQRSTUVWXYZ";
const INVITE_CODE_SYMBOLS = 12;

export function createInviteCodeCandidate(): string {
  let value = "";
  for (let index = 0; index < INVITE_CODE_SYMBOLS; index += 1) {
    value += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return `${value.slice(0, 6)}-${value.slice(6)}`;
}
