CREATE TYPE "SurveyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "SurveyQuestionType" AS ENUM ('FREE_TEXT', 'SINGLE_SELECT', 'MULTI_SELECT');

ALTER TABLE "profiles"
ADD COLUMN "allowOptionalSurveys" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "surveys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "SurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "title" JSONB NOT NULL,
    "description" JSONB,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "platforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "releaseChannels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "appVersions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "minAppVersion" TEXT,
    "maxAppVersion" TEXT,
    "buildNumbers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "minBuildNumber" INTEGER,
    "maxBuildNumber" INTEGER,
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "audience" JSONB,
    "presentation" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "survey_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "surveyId" UUID NOT NULL,
    "surveyRevision" INTEGER NOT NULL DEFAULT 1,
    "key" TEXT NOT NULL,
    "type" "SurveyQuestionType" NOT NULL,
    "prompt" JSONB NOT NULL,
    "description" JSONB,
    "options" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "minLength" INTEGER,
    "maxLength" INTEGER,
    "minSelected" INTEGER,
    "maxSelected" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "survey_questions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "survey_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "surveyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "surveyRevision" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "buildNumber" INTEGER,
    "releaseChannel" TEXT,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientContext" JSONB,
    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "survey_answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "responseId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "questionKey" TEXT NOT NULL,
    "promptSnapshot" JSONB NOT NULL,
    "optionsSnapshot" JSONB,
    "value" JSONB NOT NULL,
    CONSTRAINT "survey_answers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surveys_key_key" ON "surveys"("key");
CREATE INDEX "surveys_status_startsAt_endsAt_priority_idx" ON "surveys"("status", "startsAt", "endsAt", "priority");
CREATE UNIQUE INDEX "survey_questions_surveyId_surveyRevision_key_key" ON "survey_questions"("surveyId", "surveyRevision", "key");
CREATE UNIQUE INDEX "survey_questions_surveyId_surveyRevision_sortOrder_key" ON "survey_questions"("surveyId", "surveyRevision", "sortOrder");
CREATE UNIQUE INDEX "survey_responses_surveyId_userId_surveyRevision_key" ON "survey_responses"("surveyId", "userId", "surveyRevision");
CREATE INDEX "survey_responses_surveyId_submittedAt_idx" ON "survey_responses"("surveyId", "submittedAt");
CREATE INDEX "survey_responses_userId_submittedAt_idx" ON "survey_responses"("userId", "submittedAt");
CREATE UNIQUE INDEX "survey_answers_responseId_questionId_key" ON "survey_answers"("responseId", "questionId");
CREATE INDEX "survey_answers_questionId_idx" ON "survey_answers"("questionId");

ALTER TABLE "survey_questions"
ADD CONSTRAINT "survey_questions_surveyId_fkey"
FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "survey_responses"
ADD CONSTRAINT "survey_responses_surveyId_fkey"
FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "survey_responses"
ADD CONSTRAINT "survey_responses_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "survey_answers"
ADD CONSTRAINT "survey_answers_responseId_fkey"
FOREIGN KEY ("responseId") REFERENCES "survey_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "survey_answers"
ADD CONSTRAINT "survey_answers_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "survey_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
