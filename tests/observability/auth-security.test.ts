import assert from "node:assert/strict";
import test from "node:test";
import {
  isAppCheckExempt,
  requiresLimitedUseAppCheck,
} from "../../lib/api-security-policy";
import { hashAuthCode } from "../../lib/auth-tokens";
import {
  identityMatchesProfile,
  isRecentAuthentication,
} from "../../lib/auth-policy";

test("App Check exemptions are narrow and include both cron routes", () => {
  assert.equal(isAppCheckExempt("POST", "/api/cron"), true);
  assert.equal(isAppCheckExempt("GET", "/api/cron/incidents"), true);
  assert.equal(isAppCheckExempt("GET", "/api/legal/privacy"), true);
  assert.equal(isAppCheckExempt("POST", "/api/profile"), false);
  assert.equal(isAppCheckExempt("GET", "/api/profile"), false);
  assert.equal(isAppCheckExempt("POST", "/api/auth/mobile/google/session"), false);
});

test("sensitive endpoints require limited-use App Check tokens", () => {
  assert.equal(requiresLimitedUseAppCheck("POST", "/api/auth/change-password"), true);
  assert.equal(requiresLimitedUseAppCheck("POST", "/api/auth/reset-password"), true);
  assert.equal(requiresLimitedUseAppCheck("POST", "/api/boost/purchase"), true);
  assert.equal(requiresLimitedUseAppCheck("GET", "/api/profile"), false);
});

test("recent authentication rejects stale and future auth times", () => {
  assert.equal(isRecentAuthentication(9_800, 10_000, 300), true);
  assert.equal(isRecentAuthentication(9_699, 10_000, 300), false);
  assert.equal(isRecentAuthentication(10_001, 10_000, 300), false);
});

test("Firebase authorization requires a verified exact-UID profile mapping", () => {
  const identity = {
    uid: "firebase-uid",
    email: "person@example.com",
    emailVerified: true,
  };
  assert.equal(identityMatchesProfile(identity, null), false);
  assert.equal(identityMatchesProfile(
    { ...identity, emailVerified: false },
    { id: "firebase-uid", email: "person@example.com" },
  ), false);
  assert.equal(identityMatchesProfile(
    identity,
    { id: "different-uid", email: "person@example.com" },
  ), false);
  assert.equal(identityMatchesProfile(
    identity,
    { id: "firebase-uid", email: "other@example.com" },
  ), false);
  assert.equal(identityMatchesProfile(
    identity,
    { id: "firebase-uid", email: "PERSON@example.com " },
  ), true);
});

test("auth code hashes are purpose and account bound", () => {
  const previousSecret = process.env.AUTH_CODE_SECRET;
  process.env.AUTH_CODE_SECRET = "test-only-auth-code-secret-at-least-32-characters";
  try {
    const reset = hashAuthCode("reset", "person@example.com", "123456");
    assert.notEqual(reset, hashAuthCode("verify", "person@example.com", "123456"));
    assert.notEqual(reset, hashAuthCode("reset", "other@example.com", "123456"));
    assert.equal(reset, hashAuthCode("reset", "PERSON@example.com ", "123456"));
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_CODE_SECRET;
    else process.env.AUTH_CODE_SECRET = previousSecret;
  }
});
