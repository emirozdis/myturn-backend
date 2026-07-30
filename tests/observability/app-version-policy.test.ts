import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedUpdateUrl,
  isValidAppVersion,
  requiresAppUpdate,
} from "../../lib/app-version-policy";

test("version wall checks both semantic version and native build", () => {
  const requirement = {
    minimumVersion: "1.2.0",
    minimumBuildNumber: 25,
  };

  assert.equal(requiresAppUpdate(
    { appVersion: "1.1.9", buildNumber: 30 },
    requirement,
  ), true);
  assert.equal(requiresAppUpdate(
    { appVersion: "1.2.0", buildNumber: 24 },
    requirement,
  ), true);
  assert.equal(requiresAppUpdate(
    { appVersion: "1.2.0", buildNumber: 25 },
    requirement,
  ), false);
  assert.equal(requiresAppUpdate(
    { appVersion: "1.3.0", buildNumber: 25 },
    requirement,
  ), false);
});

test("version wall rejects malformed client versions", () => {
  assert.equal(isValidAppVersion("1.0.0"), true);
  assert.equal(isValidAppVersion("v2.4.1-beta.2"), true);
  assert.equal(isValidAppVersion("latest"), false);
  assert.equal(isValidAppVersion("1..2"), false);
});

test("version wall accepts database-owned HTTPS update URLs", () => {
  assert.equal(isAllowedUpdateUrl(
    "https://apps.apple.com/app/id6792202991",
  ), true);
  assert.equal(isAllowedUpdateUrl(
    "https://play.google.com/store/apps/details?id=com.emirozdis.myturn",
  ), true);
  assert.equal(isAllowedUpdateUrl("https://updates.myturn.example/ios"), true);
  assert.equal(isAllowedUpdateUrl("http://updates.myturn.example/ios"), false);
  assert.equal(isAllowedUpdateUrl("market://details?id=myturn"), false);
  assert.equal(isAllowedUpdateUrl("https://user:password@example.com/update"), false);
});
