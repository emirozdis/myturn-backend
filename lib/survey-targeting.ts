import { createHash } from "node:crypto";

export type SurveyClientContext = {
  platform: string;
  appVersion: string;
  buildNumber: number | null;
  releaseChannel: string | null;
};

export type SurveyAudienceProfile = {
  id: string;
  email: string;
  locale: string;
  createdAt: Date;
  groupIds: string[];
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Compares dotted app versions without requiring strict SemVer. Numeric
 * segments are compared numerically and prerelease labels sort before a stable
 * release, so values such as 1.9, 1.10.0, and 2.0.0-beta remain predictable.
 */
export function compareAppVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [core, prerelease = ""] = value.trim().replace(/^v/i, "").split("-", 2);
    const segments = core.split(".").map((part) => {
      const match = part.match(/^\d+/);
      return match ? Number(match[0]) : 0;
    });
    return { segments, prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.segments.length, b.segments.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.segments[index] || 0) - (b.segments[index] || 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export function matchesTechnicalTarget(
  survey: {
    platforms: string[];
    releaseChannels: string[];
    appVersions: string[];
    minAppVersion: string | null;
    maxAppVersion: string | null;
    buildNumbers: number[];
    minBuildNumber: number | null;
    maxBuildNumber: number | null;
  },
  client: SurveyClientContext,
): boolean {
  if (survey.platforms.length > 0 && !survey.platforms.includes(client.platform)) return false;
  if (
    survey.releaseChannels.length > 0
    && (!client.releaseChannel || !survey.releaseChannels.includes(client.releaseChannel))
  ) return false;
  if (survey.appVersions.length > 0 && !survey.appVersions.includes(client.appVersion)) return false;
  if (survey.minAppVersion && compareAppVersions(client.appVersion, survey.minAppVersion) < 0) return false;
  if (survey.maxAppVersion && compareAppVersions(client.appVersion, survey.maxAppVersion) > 0) return false;
  if (
    survey.buildNumbers.length > 0
    && (client.buildNumber === null || !survey.buildNumbers.includes(client.buildNumber))
  ) return false;
  if (
    survey.minBuildNumber !== null
    && (client.buildNumber === null || client.buildNumber < survey.minBuildNumber)
  ) return false;
  if (
    survey.maxBuildNumber !== null
    && (client.buildNumber === null || client.buildNumber > survey.maxBuildNumber)
  ) return false;
  return true;
}

export function matchesSurveyAudience(
  audienceValue: unknown,
  profile: SurveyAudienceProfile,
  now = new Date(),
  surveyKey = "",
): boolean {
  const audience = record(audienceValue);
  const includeUserIds = stringArray(audience.includeUserIds);
  const excludeUserIds = stringArray(audience.excludeUserIds);
  const locales = stringArray(audience.locales);
  const emailDomains = stringArray(audience.emailDomains).map((value) => value.toLowerCase());
  const groupIds = stringArray(audience.groupIds);
  const accountAgeDays = (now.getTime() - profile.createdAt.getTime()) / 86_400_000;

  if (includeUserIds.length > 0 && !includeUserIds.includes(profile.id)) return false;
  if (excludeUserIds.includes(profile.id)) return false;
  if (locales.length > 0 && !locales.includes(profile.locale)) return false;
  if (
    emailDomains.length > 0
    && !emailDomains.some((domain) => profile.email.toLowerCase().endsWith(`@${domain.replace(/^@/, "")}`))
  ) return false;
  if (audience.hasAnyGroup === true && profile.groupIds.length === 0) return false;
  if (audience.hasAnyGroup === false && profile.groupIds.length > 0) return false;
  if (groupIds.length > 0 && !groupIds.some((id) => profile.groupIds.includes(id))) return false;

  const minGroupCount = finiteNumber(audience.minGroupCount);
  const maxGroupCount = finiteNumber(audience.maxGroupCount);
  const minAccountAgeDays = finiteNumber(audience.minAccountAgeDays);
  const maxAccountAgeDays = finiteNumber(audience.maxAccountAgeDays);
  if (minGroupCount !== null && profile.groupIds.length < minGroupCount) return false;
  if (maxGroupCount !== null && profile.groupIds.length > maxGroupCount) return false;
  if (minAccountAgeDays !== null && accountAgeDays < minAccountAgeDays) return false;
  if (maxAccountAgeDays !== null && accountAgeDays > maxAccountAgeDays) return false;

  if (typeof audience.createdAfter === "string") {
    const createdAfter = new Date(audience.createdAfter);
    if (!Number.isNaN(createdAfter.getTime()) && profile.createdAt < createdAfter) return false;
  }
  if (typeof audience.createdBefore === "string") {
    const createdBefore = new Date(audience.createdBefore);
    if (!Number.isNaN(createdBefore.getTime()) && profile.createdAt > createdBefore) return false;
  }

  const rolloutPercentage = finiteNumber(audience.rolloutPercentage);
  if (rolloutPercentage !== null) {
    if (rolloutPercentage <= 0) return false;
    if (rolloutPercentage < 100) {
      const seed = typeof audience.rolloutSeed === "string" ? audience.rolloutSeed : surveyKey;
      const bucket = createHash("sha256")
        .update(`${seed}:${profile.id}`)
        .digest()
        .readUInt32BE(0) % 10_000;
      if (bucket >= Math.round(rolloutPercentage * 100)) return false;
    }
  }

  return true;
}

export function localizedSurveyText(value: unknown, locale: string): string {
  if (typeof value === "string") return value.trim();
  const translations = record(value);
  const preferred = translations[locale];
  if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
  const english = translations.en;
  if (typeof english === "string" && english.trim()) return english.trim();
  const first = Object.values(translations).find((item) => typeof item === "string" && item.trim());
  return typeof first === "string" ? first.trim() : "";
}

export function normalizedSurveyOptions(value: unknown, locale: string) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item === "string" && item.trim()) {
      return [{ id: item, label: item }];
    }
    const option = record(item);
    const id = typeof option.id === "string"
      ? option.id
      : typeof option.value === "string"
        ? option.value
        : `option_${index + 1}`;
    const label = localizedSurveyText(option.label ?? option.text, locale);
    return label ? [{ id, label }] : [];
  });
}
