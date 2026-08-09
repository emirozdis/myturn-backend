ALTER TABLE "transcoder_supervisor_config"
ADD COLUMN "missionTimeoutSeconds" INTEGER NOT NULL DEFAULT 1800;

ALTER TABLE "transcoder_supervisor_config"
ADD CONSTRAINT "transcoder_supervisor_config_mission_timeout_check"
CHECK ("missionTimeoutSeconds" BETWEEN 60 AND 86400);
