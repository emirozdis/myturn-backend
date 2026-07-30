import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { getCachedAppVersionRequirement } from "@/lib/app-version-requirements";
import {
  isAllowedUpdateUrl,
  isValidAppVersion,
  requiresAppUpdate,
  SUPPORTED_APP_PLATFORMS,
  SUPPORTED_RELEASE_CHANNELS,
} from "@/lib/app-version-policy";

export const dynamic = "force-dynamic";

function nonEmptyParam(request: NextRequest, name: string) {
  return request.nextUrl.searchParams.get(name)?.trim() || "";
}

async function GETHandler(request: NextRequest) {
  const platform = nonEmptyParam(request, "platform");
  const releaseChannel = nonEmptyParam(request, "releaseChannel");
  const appVersion = nonEmptyParam(request, "appVersion");
  const rawBuildNumber = nonEmptyParam(request, "buildNumber");
  const buildNumber = /^\d+$/.test(rawBuildNumber)
    ? Number(rawBuildNumber)
    : Number.NaN;

  if (
    !SUPPORTED_APP_PLATFORMS.has(platform)
    || !SUPPORTED_RELEASE_CHANNELS.has(releaseChannel)
    || !isValidAppVersion(appVersion)
    || !Number.isSafeInteger(buildNumber)
  ) {
    return NextResponse.json(
      { error: "Valid platform, release channel, app version, and build number are required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requirement = await getCachedAppVersionRequirement(platform, releaseChannel);

  // Missing policy is a deployment/configuration error. Failing closed prevents
  // a client from bypassing the startup wall because a row was accidentally removed.
  if (!requirement) {
    return NextResponse.json(
      { error: "App version requirements are not configured for this client." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    !isValidAppVersion(requirement.minimumVersion)
    || !Number.isSafeInteger(requirement.minimumBuildNumber)
    || requirement.minimumBuildNumber < 0
    || !isAllowedUpdateUrl(requirement.updateUrl)
  ) {
    return NextResponse.json(
      { error: "App version requirements are configured incorrectly." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      success: true,
      updateRequired: requiresAppUpdate(
        { appVersion, buildNumber },
        requirement,
      ),
      requirement: {
        minimumVersion: requirement.minimumVersion,
        minimumBuildNumber: requirement.minimumBuildNumber,
        updateUrl: requirement.updateUrl,
        updatedAt: requirement.updatedAt,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = withApiHandler(GETHandler);
