import { compareAppVersions } from "@/lib/survey-targeting";

export const SUPPORTED_APP_PLATFORMS = new Set(["ios", "android"]);
export const SUPPORTED_RELEASE_CHANNELS = new Set([
  "development",
  "preview",
  "production",
]);

export type AppVersionClient = {
  platform: string;
  releaseChannel: string;
  appVersion: string;
  buildNumber: number;
};

export type AppVersionMinimum = {
  minimumVersion: string;
  minimumBuildNumber: number;
};

export function isValidAppVersion(value: string) {
  return /^(?:v)?\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

export function isAllowedUpdateUrl(value: string) {
  if (value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.username
      && !url.password
    );
  } catch {
    return false;
  }
}

export function requiresAppUpdate(
  client: Pick<AppVersionClient, "appVersion" | "buildNumber">,
  requirement: AppVersionMinimum,
) {
  return (
    compareAppVersions(client.appVersion, requirement.minimumVersion) < 0
    || client.buildNumber < requirement.minimumBuildNumber
  );
}
