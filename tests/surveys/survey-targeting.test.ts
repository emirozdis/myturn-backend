import assert from "node:assert/strict";
import test from "node:test";
import {
  compareAppVersions,
  localizedSurveyText,
  matchesSurveyAudience,
  matchesTechnicalTarget,
  normalizedSurveyOptions,
} from "../../lib/survey-targeting";

const technicalSurvey = {
  platforms: ["ios"],
  releaseChannels: ["production"],
  appVersions: [],
  minAppVersion: "1.9.0",
  maxAppVersion: "2.0.0",
  buildNumbers: [],
  minBuildNumber: 10,
  maxBuildNumber: 30,
};

test("compares dotted app versions numerically", () => {
  assert.equal(compareAppVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareAppVersions("v2.0", "2.0.0"), 0);
  assert.equal(compareAppVersions("2.0.0-beta", "2.0.0"), -1);
});

test("matches all configured technical constraints", () => {
  assert.equal(matchesTechnicalTarget(technicalSurvey, {
    platform: "ios",
    releaseChannel: "production",
    appVersion: "1.10.0",
    buildNumber: 19,
  }), true);
  assert.equal(matchesTechnicalTarget(technicalSurvey, {
    platform: "android",
    releaseChannel: "production",
    appVersion: "1.10.0",
    buildNumber: 19,
  }), false);
  assert.equal(matchesTechnicalTarget(technicalSurvey, {
    platform: "ios",
    releaseChannel: "production",
    appVersion: "1.10.0",
    buildNumber: 31,
  }), false);
});

test("matches data-specific audience rules", () => {
  const profile = {
    id: "user-1",
    email: "person@example.com",
    locale: "en",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    groupIds: ["group-1", "group-2"],
  };
  assert.equal(matchesSurveyAudience({
    locales: ["en"],
    emailDomains: ["example.com"],
    minAccountAgeDays: 10,
    minGroupCount: 2,
    groupIds: ["group-2"],
    rolloutPercentage: 100,
  }, profile, new Date("2026-02-01T00:00:00Z"), "test"), true);
  assert.equal(matchesSurveyAudience({ excludeUserIds: ["user-1"] }, profile), false);
  assert.equal(matchesSurveyAudience({ hasAnyGroup: false }, profile), false);
});

test("localizes survey copy and options with English fallback", () => {
  assert.equal(localizedSurveyText({ en: "Hello", tr: "Merhaba" }, "tr"), "Merhaba");
  assert.deepEqual(normalizedSurveyOptions([
    { id: "yes", label: { en: "Yes", tr: "Evet" } },
    "Other",
  ], "tr"), [
    { id: "yes", label: "Evet" },
    { id: "Other", label: "Other" },
  ]);
});
