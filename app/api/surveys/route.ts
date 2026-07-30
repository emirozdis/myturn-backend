import { Prisma, type SurveyQuestion } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { getAuthSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  localizedSurveyText,
  matchesSurveyAudience,
  matchesTechnicalTarget,
  normalizedSurveyOptions,
  type SurveyClientContext,
} from "@/lib/survey-targeting";

const MAX_FREE_TEXT_LENGTH = 10_000;
const VALID_PLATFORMS = new Set(["ios", "android", "web"]);
const VALID_CHANNELS = new Set(["development", "preview", "production"]);
type SurveyWithQuestions = Prisma.SurveyGetPayload<{ include: { questions: true } }>;

function jsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseClientContext(value: Record<string, unknown>): SurveyClientContext | null {
  const platform = typeof value.platform === "string" ? value.platform.toLowerCase() : "";
  const appVersion = typeof value.appVersion === "string" ? value.appVersion.trim().slice(0, 100) : "";
  const rawBuild = typeof value.buildNumber === "number"
    ? value.buildNumber
    : typeof value.buildNumber === "string" && /^\d+$/.test(value.buildNumber)
      ? Number(value.buildNumber)
      : null;
  const buildNumber = rawBuild !== null && Number.isSafeInteger(rawBuild) && rawBuild >= 0 ? rawBuild : null;
  const releaseChannel = typeof value.releaseChannel === "string" && VALID_CHANNELS.has(value.releaseChannel)
    ? value.releaseChannel
    : null;
  if (!VALID_PLATFORMS.has(platform) || !appVersion) return null;
  return { platform, appVersion, buildNumber, releaseChannel };
}

async function loadAudienceProfile(userId: string) {
  const profile = await db.profile.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      locale: true,
      createdAt: true,
      allowOptionalSurveys: true,
      groupMembers: { select: { groupId: true } },
    },
  });
  if (!profile) return null;
  return {
    ...profile,
    locale: String(profile.locale),
    groupIds: profile.groupMembers.map((membership) => membership.groupId),
  };
}

function publicSurvey(survey: SurveyWithQuestions, locale: string) {
  const currentQuestions = survey.questions
    .filter((question) => question.surveyRevision === survey.revision)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  return {
    id: survey.id,
    key: survey.key,
    revision: survey.revision,
    title: localizedSurveyText(survey.title, locale),
    description: localizedSurveyText(survey.description, locale),
    isMandatory: survey.isMandatory,
    endsAt: survey.endsAt?.toISOString() ?? null,
    presentation: publicPresentation(survey.presentation, locale),
    questions: currentQuestions.map((question) => ({
      id: question.id,
      key: question.key,
      type: question.type,
      prompt: localizedSurveyText(question.prompt, locale),
      description: localizedSurveyText(question.description, locale),
      options: normalizedSurveyOptions(question.options, locale),
      isRequired: question.isRequired,
      minLength: question.minLength,
      maxLength: question.maxLength,
      minSelected: question.minSelected,
      maxSelected: question.maxSelected,
    })),
  };
}

function publicPresentation(value: unknown, locale: string) {
  const presentation = jsonRecord(value);
  if (Object.keys(presentation).length === 0) return null;
  const accentColor = typeof presentation.accentColor === "string"
    && /^#[0-9a-f]{6}$/i.test(presentation.accentColor)
    ? presentation.accentColor
    : undefined;
  const numberInRange = (candidate: unknown, minimum: number, maximum: number) => (
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.max(minimum, Math.min(candidate, maximum))
      : undefined
  );
  return {
    accentColor,
    delayMs: numberInRange(presentation.delayMs, 250, 15_000),
    snoozeHours: numberInRange(presentation.snoozeHours, 1, 24 * 30),
    submitLabel: localizedSurveyText(presentation.submitLabel, locale) || undefined,
    successTitle: localizedSurveyText(presentation.successTitle, locale) || undefined,
    successBody: localizedSurveyText(presentation.successBody, locale) || undefined,
  };
}

function questionIsDeliverable(question: SurveyQuestion): boolean {
  if (!localizedSurveyText(question.prompt, "en")) return false;
  if (
    question.minLength !== null
    && question.maxLength !== null
    && question.minLength > question.maxLength
  ) return false;
  if (
    question.minSelected !== null
    && question.maxSelected !== null
    && question.minSelected > question.maxSelected
  ) return false;
  if (question.type === "FREE_TEXT") return true;
  const optionIds = normalizedSurveyOptions(question.options, "en").map((option) => option.id);
  return optionIds.length > 0 && new Set(optionIds).size === optionIds.length;
}

async function GETHandler(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const intent = req.nextUrl.searchParams.get("intent");
  if (intent === "preferences") {
    const preference = await db.profile.findUnique({
      where: { id: session.user.id },
      select: { allowOptionalSurveys: true },
    });
    if (!preference) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ success: true, preferences: preference });
  }

  const client = parseClientContext({
    platform: req.nextUrl.searchParams.get("platform"),
    appVersion: req.nextUrl.searchParams.get("appVersion"),
    buildNumber: req.nextUrl.searchParams.get("buildNumber"),
    releaseChannel: req.nextUrl.searchParams.get("releaseChannel"),
  });
  if (!client) return NextResponse.json({ error: "Valid platform and appVersion are required" }, { status: 400 });

  const profile = await loadAudienceProfile(session.user.id);
  if (!profile) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const now = new Date();
  const surveys = await db.survey.findMany({
    where: {
      status: "ACTIVE",
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
    include: {
      questions: { orderBy: { sortOrder: "asc" } },
      responses: {
        where: { userId: session.user.id },
        select: { surveyRevision: true },
      },
    },
    orderBy: [{ isMandatory: "desc" }, { priority: "desc" }, { createdAt: "asc" }],
    take: 50,
  });

  const available = surveys.filter((survey) => {
    const completedCurrentRevision = survey.responses.some(
      (response) => response.surveyRevision === survey.revision,
    );
    const currentQuestions = survey.questions.filter(
      (question) => question.surveyRevision === survey.revision,
    );
    return !completedCurrentRevision
      && currentQuestions.length > 0
      && currentQuestions.every(questionIsDeliverable)
      && matchesTechnicalTarget(survey, client)
      && matchesSurveyAudience(survey.audience, profile, now, survey.key);
  });

  if (intent === "library") {
    const submissions = await db.surveyResponse.findMany({
      where: { userId: session.user.id },
      include: {
        survey: { select: { key: true, title: true, isMandatory: true } },
        answers: {
          include: { question: { select: { sortOrder: true } } },
        },
      },
      orderBy: { submittedAt: "desc" },
      take: 50,
    });
    return NextResponse.json({
      success: true,
      available: available.map((survey) => publicSurvey(survey, profile.locale)),
      submissions: submissions.map((submission) => ({
        id: submission.id,
        surveyKey: submission.survey.key,
        surveyRevision: submission.surveyRevision,
        title: localizedSurveyText(submission.survey.title, profile.locale),
        isMandatory: submission.survey.isMandatory,
        submittedAt: submission.submittedAt.toISOString(),
        platform: submission.platform,
        appVersion: submission.appVersion,
        buildNumber: submission.buildNumber,
        answers: submission.answers
          .sort((left, right) => left.question.sortOrder - right.question.sortOrder)
          .map((answer) => {
            const options = normalizedSurveyOptions(answer.optionsSnapshot, profile.locale);
            const labels = new Map(options.map((option) => [option.id, option.label]));
            const rawValue = answer.value;
            const displayValue = Array.isArray(rawValue)
              ? rawValue.map((value) => labels.get(String(value)) || String(value))
              : labels.get(String(rawValue)) || String(rawValue);
            return {
              id: answer.id,
              questionKey: answer.questionKey,
              prompt: localizedSurveyText(answer.promptSnapshot, profile.locale),
              value: rawValue,
              displayValue,
            };
          }),
      })),
      preferences: { allowOptionalSurveys: profile.allowOptionalSurveys },
    });
  }

  const pending = available.find(
    (survey) => survey.isMandatory || profile.allowOptionalSurveys,
  );
  return NextResponse.json({
    success: true,
    survey: pending ? publicSurvey(pending, profile.locale) : null,
    preferences: { allowOptionalSurveys: profile.allowOptionalSurveys },
  });
}

function validateAnswer(question: SurveyQuestion, value: unknown): { valid: true; value: Prisma.InputJsonValue } | { valid: false } {
  if (question.type === "FREE_TEXT") {
    if (typeof value !== "string") return { valid: false };
    const normalized = value.trim();
    const minimum = question.minLength ?? (question.isRequired ? 1 : 0);
    const maximum = Math.min(question.maxLength ?? MAX_FREE_TEXT_LENGTH, MAX_FREE_TEXT_LENGTH);
    if (normalized.length < minimum || normalized.length > maximum) return { valid: false };
    return { valid: true, value: normalized };
  }

  const options = normalizedSurveyOptions(question.options, "en");
  const allowed = new Set(options.map((option) => option.id));
  if (question.type === "SINGLE_SELECT") {
    if (typeof value !== "string" || !allowed.has(value)) return { valid: false };
    return { valid: true, value };
  }

  if (question.type === "MULTI_SELECT") {
    if (!Array.isArray(value)) return { valid: false };
    const selected = [...new Set(value.filter((item): item is string => typeof item === "string"))];
    const minimum = question.minSelected ?? (question.isRequired ? 1 : 0);
    const maximum = question.maxSelected ?? allowed.size;
    if (
      selected.length < minimum
      || selected.length > maximum
      || selected.some((id) => !allowed.has(id))
    ) return { valid: false };
    return { valid: true, value: selected };
  }
  return { valid: false };
}

async function POSTHandler(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rl = await rateLimit(`surveys_${session.user.id}`, 20, 60_000);
  if (!rl.success) return NextResponse.json({ error: "Too many survey requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.action === "preferences") {
    if (typeof body.allowOptionalSurveys !== "boolean") {
      return NextResponse.json({ error: "allowOptionalSurveys must be a boolean" }, { status: 400 });
    }
    const preferences = await db.profile.update({
      where: { id: session.user.id },
      data: { allowOptionalSurveys: body.allowOptionalSurveys },
      select: { allowOptionalSurveys: true },
    });
    return NextResponse.json({ success: true, preferences });
  }

  const client = parseClientContext(body);
  const manual = body.manual === true;
  const surveyId = typeof body.surveyId === "string" ? body.surveyId : "";
  const revision = typeof body.revision === "number" && Number.isSafeInteger(body.revision) ? body.revision : 0;
  const rawAnswers = body.answers !== null && typeof body.answers === "object" && !Array.isArray(body.answers)
    ? body.answers as Record<string, unknown>
    : null;
  if (!client || !surveyId || revision < 1 || !rawAnswers) {
    return NextResponse.json({ error: "Survey, revision, client context, and answers are required" }, { status: 400 });
  }

  const [survey, profile] = await Promise.all([
    db.survey.findUnique({
      where: { id: surveyId },
      include: { questions: { orderBy: { sortOrder: "asc" } } },
    }),
    loadAudienceProfile(session.user.id),
  ]);
  const now = new Date();
  if (
    !survey
    || !profile
    || survey.status !== "ACTIVE"
    || survey.revision !== revision
    || (survey.startsAt && survey.startsAt > now)
    || (survey.endsAt && survey.endsAt <= now)
    || (!manual && !survey.isMandatory && !profile.allowOptionalSurveys)
    || !matchesTechnicalTarget(survey, client)
    || !matchesSurveyAudience(survey.audience, profile, now, survey.key)
  ) {
    return NextResponse.json({ error: "This survey is no longer available" }, { status: 409 });
  }

  const currentQuestions = survey.questions.filter(
    (question) => question.surveyRevision === survey.revision,
  );
  if (currentQuestions.length === 0 || !currentQuestions.every(questionIsDeliverable)) {
    return NextResponse.json({ error: "This survey revision is not configured correctly" }, { status: 409 });
  }

  const answers = [];
  for (const question of currentQuestions) {
    const hasValue = Object.prototype.hasOwnProperty.call(rawAnswers, question.id);
    if (!hasValue && !question.isRequired) continue;
    if (!hasValue) return NextResponse.json({ error: `Answer required for ${question.key}` }, { status: 400 });
    const answer = validateAnswer(question, rawAnswers[question.id]);
    if (!answer.valid) return NextResponse.json({ error: `Invalid answer for ${question.key}` }, { status: 400 });
    answers.push({
      questionId: question.id,
      questionKey: question.key,
      promptSnapshot: question.prompt as Prisma.InputJsonValue,
      optionsSnapshot: question.options as Prisma.InputJsonValue | undefined,
      value: answer.value,
    });
  }

  try {
    const response = await db.surveyResponse.create({
      data: {
        surveyId: survey.id,
        userId: session.user.id,
        surveyRevision: survey.revision,
        platform: client.platform,
        appVersion: client.appVersion,
        buildNumber: client.buildNumber,
        releaseChannel: client.releaseChannel,
        clientContext: body.clientContext && typeof body.clientContext === "object"
          ? body.clientContext as Prisma.InputJsonValue
          : undefined,
        answers: { create: answers },
      },
      select: { id: true, submittedAt: true },
    });
    return NextResponse.json({ success: true, response });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ success: true, alreadySubmitted: true });
    }
    throw error;
  }
}

export const GET = withApiHandler(GETHandler);
export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
