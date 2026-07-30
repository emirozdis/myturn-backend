CREATE TABLE "app_version_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform" TEXT NOT NULL,
    "releaseChannel" TEXT NOT NULL,
    "minimumVersion" TEXT NOT NULL,
    "minimumBuildNumber" INTEGER NOT NULL,
    "storeUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_version_requirements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "app_version_requirements_minimumBuildNumber_check"
      CHECK ("minimumBuildNumber" >= 0),
    CONSTRAINT "app_version_requirements_platform_check"
      CHECK ("platform" IN ('ios', 'android')),
    CONSTRAINT "app_version_requirements_releaseChannel_check"
      CHECK ("releaseChannel" IN ('development', 'preview', 'production'))
);

CREATE UNIQUE INDEX "app_version_requirements_platform_releaseChannel_key"
ON "app_version_requirements"("platform", "releaseChannel");

INSERT INTO "app_version_requirements"
  ("platform", "releaseChannel", "minimumVersion", "minimumBuildNumber", "storeUrl")
VALUES
  ('ios', 'development', '1.0.0', 19, 'https://apps.apple.com/app/id6792202991'),
  ('ios', 'preview', '1.0.0', 19, 'https://apps.apple.com/app/id6792202991'),
  ('ios', 'production', '1.0.0', 19, 'https://apps.apple.com/app/id6792202991'),
  ('android', 'development', '1.0.0', 19, 'https://play.google.com/store/apps/details?id=com.emirozdis.myturn'),
  ('android', 'preview', '1.0.0', 19, 'https://play.google.com/store/apps/details?id=com.emirozdis.myturn'),
  ('android', 'production', '1.0.0', 19, 'https://play.google.com/store/apps/details?id=com.emirozdis.myturn');
