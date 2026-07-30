import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

export const APP_VERSION_REQUIREMENT_CACHE_SECONDS = 300;

/**
 * The mobile client still checks on every launch. Only the database lookup is
 * cached server-side, keyed by platform and release channel, to keep that
 * mandatory request off the launch latency critical path after the first hit.
 */
export const getCachedAppVersionRequirement = unstable_cache(
  async (platform: string, releaseChannel: string) => {
    const requirement = await db.appVersionRequirement.findUnique({
      where: {
        platform_releaseChannel: { platform, releaseChannel },
      },
      select: {
        minimumVersion: true,
        minimumBuildNumber: true,
        updateUrl: true,
        updatedAt: true,
      },
    });
    if (!requirement) return null;
    return {
      ...requirement,
      updatedAt: requirement.updatedAt.toISOString(),
    };
  },
  ["app-version-requirement-v1"],
  {
    revalidate: APP_VERSION_REQUIREMENT_CACHE_SECONDS,
    tags: ["app-version-requirements"],
  },
);
