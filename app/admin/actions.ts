"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_CHALLENGE_COOKIE_NAME,
  adminCookieOptions,
  adminChallengeCookieOptions,
  consumeAdminLoginChallenge,
  createAdminLoginChallenge,
  createAdminSessionToken,
  getAdminLoginChallenge,
  invalidateAdminLoginChallenge,
  isAdminAuthConfigured,
  requireAdmin,
  verifyAdminCredentials,
  verifyAdminLoginChallengeToken,
} from "@/lib/admin-auth";
import { writeAdminAudit } from "@/lib/admin-audit";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { permanentlyDeleteUserAccount } from "@/lib/account-deletion";
import { sendAdminLoginCodeEmail } from "@/lib/email";
import {
  isAllowedUpdateUrl,
  isValidAppVersion,
  SUPPORTED_APP_PLATFORMS,
  SUPPORTED_RELEASE_CHANNELS,
} from "@/lib/app-version-policy";
import { Prisma, type SurveyQuestionType, type SurveyStatus } from "@prisma/client";

function readString(formData: FormData, key: string, maxLength: number, trim = true) {
  const value = formData.get(key);
  if (typeof value !== "string") return "";
  return (trim ? value.trim() : value).slice(0, maxLength);
}

function boundedNumber(formData: FormData, key: string, minimum: number, maximum: number, fallback: number) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

async function clientIp() {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown"
  );
}

export async function loginAdmin(formData: FormData) {
  if (!isAdminAuthConfigured()) redirect("/admin/login?error=configuration");

  const email = readString(formData, "email", 320).toLowerCase();
  const password = readString(formData, "password", 1_000, false);
  const ipAddress = await clientIp();
  const limit = await rateLimit(`admin-login:${ipAddress}`, 8, 15 * 60 * 1_000);
  if (!limit.success) redirect(`/admin/login?error=rate&retry=${limit.retryAfter}`);

  const valid = await verifyAdminCredentials(email, password);
  if (!valid) {
    await writeAdminAudit({ actorEmail: email || "unknown", action: "auth.login_failed", ipAddress });
    redirect("/admin/login?error=invalid");
  }

  const challenge = await createAdminLoginChallenge(email);
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_CHALLENGE_COOKIE_NAME, challenge.challengeToken, adminChallengeCookieOptions);
  cookieStore.set(ADMIN_COOKIE_NAME, "", { ...adminCookieOptions, maxAge: 0 });
  try {
    await sendAdminLoginCodeEmail(email, challenge.code);
  } catch {
    await writeAdminAudit({ actorEmail: email, action: "auth.two_factor_delivery_failed", ipAddress });
    redirect("/admin/login?step=verify&error=delivery");
  }

  await writeAdminAudit({ actorEmail: email, action: "auth.two_factor_sent", ipAddress });
  redirect("/admin/login?step=verify");
}

export async function verifyAdminLoginCode(formData: FormData) {
  if (!isAdminAuthConfigured()) redirect("/admin/login?error=configuration");

  const code = readString(formData, "code", 6, false);
  const ipAddress = await clientIp();
  const cookieStore = await cookies();
  const challengeToken = cookieStore.get(ADMIN_CHALLENGE_COOKIE_NAME)?.value || "";
  const parsedChallenge = verifyAdminLoginChallengeToken(challengeToken);
  if (!parsedChallenge) redirect("/admin/login?error=challenge");
  const [ipLimit, challengeLimit] = await Promise.all([
    rateLimit(`admin-two-factor:${ipAddress}`, 8, 15 * 60 * 1_000),
    rateLimit(`admin-two-factor-challenge:${parsedChallenge.nonce}`, 8, 15 * 60 * 1_000),
  ]);
  if (!ipLimit.success || !challengeLimit.success) {
    redirect(`/admin/login?step=verify&error=rate&retry=${Math.max(ipLimit.retryAfter, challengeLimit.retryAfter)}`);
  }

  const challenge = await consumeAdminLoginChallenge(challengeToken, code);
  if (!challenge) {
    await writeAdminAudit({ actorEmail: process.env.ADMIN_EMAIL || "unknown", action: "auth.two_factor_failed", ipAddress });
    redirect("/admin/login?step=verify&error=code");
  }

  cookieStore.set(ADMIN_COOKIE_NAME, createAdminSessionToken(challenge.email), adminCookieOptions);
  cookieStore.set(ADMIN_CHALLENGE_COOKIE_NAME, "", { ...adminChallengeCookieOptions, maxAge: 0 });
  await writeAdminAudit({ actorEmail: challenge.email, action: "auth.login_succeeded", ipAddress });
  redirect("/admin");
}

export async function resendAdminLoginCode() {
  if (!isAdminAuthConfigured()) redirect("/admin/login?error=configuration");

  const ipAddress = await clientIp();
  const limit = await rateLimit(`admin-two-factor-resend:${ipAddress}`, 3, 10 * 60 * 1_000);
  if (!limit.success) redirect(`/admin/login?step=verify&error=rate&retry=${limit.retryAfter}`);

  const cookieStore = await cookies();
  const existingChallenge = await getAdminLoginChallenge();
  if (!existingChallenge) redirect("/admin/login?error=challenge");

  const challenge = await createAdminLoginChallenge(existingChallenge.email);
  cookieStore.set(ADMIN_CHALLENGE_COOKIE_NAME, challenge.challengeToken, adminChallengeCookieOptions);
  try {
    await sendAdminLoginCodeEmail(existingChallenge.email, challenge.code);
  } catch {
    await writeAdminAudit({ actorEmail: existingChallenge.email, action: "auth.two_factor_delivery_failed", ipAddress });
    redirect("/admin/login?step=verify&error=delivery");
  }

  await writeAdminAudit({ actorEmail: existingChallenge.email, action: "auth.two_factor_resent", ipAddress });
  redirect("/admin/login?step=verify&sent=1");
}

export async function cancelAdminLogin() {
  const cookieStore = await cookies();
  const challengeToken = cookieStore.get(ADMIN_CHALLENGE_COOKIE_NAME)?.value;
  await invalidateAdminLoginChallenge(challengeToken);
  cookieStore.set(ADMIN_CHALLENGE_COOKIE_NAME, "", { ...adminChallengeCookieOptions, maxAge: 0 });
  redirect("/admin/login");
}

export async function logoutAdmin() {
  const session = await requireAdmin();
  const ipAddress = await clientIp();
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, "", { ...adminCookieOptions, maxAge: 0 });
  cookieStore.set(ADMIN_CHALLENGE_COOKIE_NAME, "", { ...adminChallengeCookieOptions, maxAge: 0 });
  await writeAdminAudit({ actorEmail: session.email, action: "auth.logout", ipAddress });
  redirect("/admin/login");
}

export async function manageUserAccount(formData: FormData) {
  const session = await requireAdmin();
  const userId = readString(formData, "userId", 128);
  const operation = readString(formData, "operation", 30);
  const confirmation = readString(formData, "confirmation", 20, false);
  const reason = readString(formData, "reason", 500);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return;
  if (!["freeze", "unfreeze", "revoke_sessions", "delete"].includes(operation)) return;
  if (operation === "delete" ? confirmation !== "DELETE" : confirmation !== "CONFIRM") return;

  const existingUser = await db.profile.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firebaseUid: true, isSuspended: true },
  });
  if (!existingUser) return;

  if (operation === "delete") {
    const result = await permanentlyDeleteUserAccount(userId);
    if (result.deleted) {
      await writeAdminAudit({
        actorEmail: session.email,
        action: "user.deleted",
        targetType: "profile",
        targetId: userId,
        details: { email: result.email, confirmation: "explicit" },
        ipAddress: await clientIp(),
      });
    }
    revalidatePath("/admin");
    revalidatePath("/admin/users");
    return;
  }

  if (operation === "revoke_sessions") {
    await getFirebaseAuth().revokeRefreshTokens(existingUser.firebaseUid);
    await writeAdminAudit({
      actorEmail: session.email,
      action: "user.sessions_revoked",
      targetType: "profile",
      targetId: userId,
      details: { email: existingUser.email },
      ipAddress: await clientIp(),
    });
    revalidatePath("/admin/users");
    return;
  }

  const suspend = operation === "freeze";
  if (suspend === existingUser.isSuspended) return;
  const user = await db.profile.update({
    where: { id: userId },
    data: {
      isSuspended: suspend,
      suspendedAt: suspend ? new Date() : null,
      suspensionReason: suspend ? reason || "Frozen by administrator" : null,
    },
    select: { id: true, email: true, firebaseUid: true },
  });

  try {
    await getFirebaseAuth().updateUser(user.firebaseUid, { disabled: suspend });
    if (suspend) await getFirebaseAuth().revokeRefreshTokens(user.firebaseUid);
  } catch (error) {
    console.error("admin.firebase_user_state_sync_failed", error);
  }

  await writeAdminAudit({
    actorEmail: session.email,
    action: suspend ? "user.frozen" : "user.unfrozen",
    targetType: "profile",
    targetId: user.id,
    details: { email: user.email, reason: suspend ? reason || "Frozen by administrator" : null },
    ipAddress: await clientIp(),
  });
  revalidatePath("/admin");
  revalidatePath("/admin/users");
}

export async function updateFeedbackStatus(formData: FormData) {
  const session = await requireAdmin();
  const feedbackId = readString(formData, "feedbackId", 128);
  const status = readString(formData, "status", 40);
  if (!/^[0-9a-f-]{36}$/i.test(feedbackId) || !["open", "in_progress", "resolved", "closed"].includes(status)) return;

  await db.feedbackReport.update({ where: { id: feedbackId }, data: { status } });
  await writeAdminAudit({
    actorEmail: session.email,
    action: "feedback.status_updated",
    targetType: "feedback_report",
    targetId: feedbackId,
    details: { status },
    ipAddress: await clientIp(),
  });
  revalidatePath("/admin");
  revalidatePath("/admin/feedback");
}

export type VersionRequirementActionState = { error?: string };

export async function updateAppVersionRequirement(
  _state: VersionRequirementActionState,
  formData: FormData,
): Promise<VersionRequirementActionState> {
  const session = await requireAdmin();
  const platform = readString(formData, "platform", 20).toLowerCase();
  const releaseChannel = readString(formData, "releaseChannel", 30).toLowerCase();
  const minimumVersion = readString(formData, "minimumVersion", 50);
  const rawBuildNumber = readString(formData, "minimumBuildNumber", 20);
  const updateUrl = readString(formData, "updateUrl", 2_048);
  const confirmation = readString(formData, "confirmation", 20, false);

  if (!SUPPORTED_APP_PLATFORMS.has(platform)) return { error: "Choose a supported platform." };
  if (!SUPPORTED_RELEASE_CHANNELS.has(releaseChannel)) return { error: "Choose a supported release channel." };
  if (!isValidAppVersion(minimumVersion)) return { error: "Enter a valid dotted app version, such as 1.4.0." };
  if (!/^\d+$/.test(rawBuildNumber)) return { error: "Minimum build must be a whole number." };
  const minimumBuildNumber = Number(rawBuildNumber);
  if (!Number.isSafeInteger(minimumBuildNumber) || minimumBuildNumber < 0 || minimumBuildNumber > 2_147_483_647) {
    return { error: "Minimum build is outside the supported range." };
  }
  if (!isAllowedUpdateUrl(updateUrl)) return { error: "Update URL must be a valid HTTPS address." };
  if (confirmation !== "CONFIRM") return { error: "Review and confirm the policy change before saving." };

  const key = { platform, releaseChannel };
  const previous = await db.appVersionRequirement.findUnique({
    where: { platform_releaseChannel: key },
    select: { minimumVersion: true, minimumBuildNumber: true, updateUrl: true },
  });
  const requirement = await db.appVersionRequirement.upsert({
    where: { platform_releaseChannel: key },
    create: { ...key, minimumVersion, minimumBuildNumber, updateUrl },
    update: { minimumVersion, minimumBuildNumber, updateUrl },
    select: { id: true, platform: true, releaseChannel: true },
  });

  updateTag("app-version-requirements");
  await writeAdminAudit({
    actorEmail: session.email,
    action: "app_version_requirement.updated",
    targetType: "app_version_requirement",
    targetId: requirement.id,
    details: {
      platform: requirement.platform,
      releaseChannel: requirement.releaseChannel,
      previous: previous ?? { configured: false },
      current: { minimumVersion, minimumBuildNumber, updateUrl },
      confirmation: "explicit",
    },
    ipAddress: await clientIp(),
  });
  revalidatePath("/admin/versions");
  redirect(`/admin/versions?updated=${encodeURIComponent(`${platform}-${releaseChannel}`)}`);
}

export type SurveyActionState = { error?: string; success?: boolean };

type SurveyBuilderQuestion = {
  key?: unknown;
  type?: unknown;
  promptEn?: unknown;
  promptTr?: unknown;
  descriptionEn?: unknown;
  descriptionTr?: unknown;
  isRequired?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  minSelected?: unknown;
  maxSelected?: unknown;
  options?: Array<{ id?: unknown; labelEn?: unknown; labelTr?: unknown }>;
};

function optionalInteger(value: FormDataEntryValue | null, minimum: number, maximum: number) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function commaList(value: string, maximum = 50) {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean))).slice(0, maximum);
}

function localized(en: string, tr: string) {
  return tr ? { en, tr } : { en };
}

type ParsedSurveyQuestion = {
  key: string;
  type: SurveyQuestionType;
  prompt: Prisma.InputJsonValue;
  description?: Prisma.InputJsonValue;
  options?: Prisma.InputJsonValue;
  isRequired: boolean;
  sortOrder: number;
  minLength?: number;
  maxLength?: number;
  minSelected?: number;
  maxSelected?: number;
};

type ParsedSurvey = {
  key: string;
  status: SurveyStatus;
  title: Prisma.InputJsonValue;
  description: Prisma.InputJsonValue | null;
  isMandatory: boolean;
  priority: number;
  platforms: string[];
  releaseChannels: string[];
  appVersions: string[];
  buildNumbers: number[];
  minAppVersion: string | null;
  maxAppVersion: string | null;
  minBuildNumber: number | null;
  maxBuildNumber: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  audience: Prisma.InputJsonValue | null;
  presentation: Prisma.InputJsonValue | null;
  metadata: Prisma.InputJsonValue | null;
  questions: ParsedSurveyQuestion[];
};

function integerList(value: string, maximum = 50) {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean).map(Number).filter((item) => Number.isSafeInteger(item) && item >= 0))).slice(0, maximum);
}

function optionalJsonObject(formData: FormData, key: string, label: string): { value: Prisma.InputJsonValue | null; error?: string } {
  const raw = readString(formData, key, 100_000, false).trim();
  if (!raw) return { value: null };
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { value: null, error: `${label} must be a JSON object.` };
    return { value: value as Prisma.InputJsonValue };
  } catch {
    return { value: null, error: `${label} contains invalid JSON.` };
  }
}

function parseSurvey(formData: FormData): { data: ParsedSurvey; error?: never } | { data?: never; error: string } {
  const key = readString(formData, "key", 100).toLowerCase();
  const titleEn = readString(formData, "titleEn", 300);
  const titleTr = readString(formData, "titleTr", 300);
  const descriptionEn = readString(formData, "descriptionEn", 2_000);
  const descriptionTr = readString(formData, "descriptionTr", 2_000);
  const statusValue = readString(formData, "status", 20).toUpperCase();
  const allowedStatuses: SurveyStatus[] = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"];
  const status = allowedStatuses.includes(statusValue as SurveyStatus) ? statusValue as SurveyStatus : "DRAFT";

  if (!/^[a-z0-9][a-z0-9_-]{2,99}$/.test(key)) return { error: "Use a unique key with letters, numbers, underscores, or hyphens." };
  if (!titleEn) return { error: "An English survey title is required." };

  let rawQuestions: SurveyBuilderQuestion[];
  try {
    const parsed = JSON.parse(readString(formData, "questions", 100_000, false));
    if (!Array.isArray(parsed)) throw new Error("Questions must be an array");
    rawQuestions = parsed.slice(0, 50);
  } catch {
    return { error: "The question set could not be read." };
  }
  if (!rawQuestions.length) return { error: "Add at least one question." };

  const seenKeys = new Set<string>();
  const questions: ParsedSurveyQuestion[] = [];

  for (const [index, question] of rawQuestions.entries()) {
    const questionKey = typeof question.key === "string" ? question.key.trim().toLowerCase().slice(0, 100) : "";
    const promptEn = typeof question.promptEn === "string" ? question.promptEn.trim().slice(0, 1_000) : "";
    const promptTr = typeof question.promptTr === "string" ? question.promptTr.trim().slice(0, 1_000) : "";
    const descriptionQuestionEn = typeof question.descriptionEn === "string" ? question.descriptionEn.trim().slice(0, 2_000) : "";
    const descriptionQuestionTr = typeof question.descriptionTr === "string" ? question.descriptionTr.trim().slice(0, 2_000) : "";
    const type = ["FREE_TEXT", "SINGLE_SELECT", "MULTI_SELECT"].includes(String(question.type))
      ? String(question.type) as SurveyQuestionType
      : null;
    if (!/^[a-z0-9][a-z0-9_-]{1,99}$/.test(questionKey) || seenKeys.has(questionKey)) return { error: `Question ${index + 1} needs a unique key.` };
    if (!promptEn || !type) return { error: `Question ${index + 1} needs an English prompt and valid type.` };
    seenKeys.add(questionKey);

    const base = {
      key: questionKey,
      type,
      prompt: localized(promptEn, promptTr) as Prisma.InputJsonValue,
      ...(descriptionQuestionEn ? { description: localized(descriptionQuestionEn, descriptionQuestionTr) as Prisma.InputJsonValue } : {}),
      isRequired: question.isRequired !== false,
      sortOrder: index + 1,
    };

    if (type === "FREE_TEXT") {
      const minLength = Number.isInteger(question.minLength) ? Math.max(0, Math.min(10_000, Number(question.minLength))) : 0;
      const maxLength = Number.isInteger(question.maxLength) ? Math.max(minLength, Math.min(10_000, Number(question.maxLength))) : 1_000;
      questions.push({ ...base, minLength, maxLength });
      continue;
    }

    const options = (Array.isArray(question.options) ? question.options : []).map((option) => ({
      id: typeof option.id === "string" ? option.id.trim().slice(0, 100) : "",
      labelEn: typeof option.labelEn === "string" ? option.labelEn.trim().slice(0, 300) : "",
      labelTr: typeof option.labelTr === "string" ? option.labelTr.trim().slice(0, 300) : "",
    })).filter((option) => option.id && option.labelEn);
    if (options.length < 2 || new Set(options.map((option) => option.id)).size !== options.length) return { error: `Question ${index + 1} needs at least two uniquely keyed options.` };
    const requestedMinimum = Number.isInteger(question.minSelected) ? Number(question.minSelected) : 1;
    const requestedMaximum = Number.isInteger(question.maxSelected) ? Number(question.maxSelected) : options.length;
    const minSelected = type === "SINGLE_SELECT" ? 1 : Math.max(0, Math.min(options.length, requestedMinimum));
    const maxSelected = type === "SINGLE_SELECT" ? 1 : Math.max(minSelected, Math.min(options.length, requestedMaximum));
    questions.push({
      ...base,
      options: options.map((option) => ({ id: option.id, label: localized(option.labelEn, option.labelTr) })) as Prisma.InputJsonValue,
      minSelected,
      maxSelected,
    });
  }

  const startsAtRaw = readString(formData, "startsAt", 50);
  const endsAtRaw = readString(formData, "endsAt", 50);
  const startsAt = startsAtRaw ? new Date(`${startsAtRaw}Z`) : null;
  const endsAt = endsAtRaw ? new Date(`${endsAtRaw}Z`) : null;
  if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) return { error: "The survey schedule contains an invalid date." };
  if (startsAt && endsAt && endsAt <= startsAt) return { error: "The end time must be after the start time." };

  const audience = optionalJsonObject(formData, "audience", "Audience rules");
  if (audience.error) return { error: audience.error };
  const presentation = optionalJsonObject(formData, "presentation", "Presentation");
  if (presentation.error) return { error: presentation.error };
  const metadata = optionalJsonObject(formData, "metadata", "Metadata");
  if (metadata.error) return { error: metadata.error };

  return {
    data: {
      key,
      status,
      title: localized(titleEn, titleTr),
      description: descriptionEn ? localized(descriptionEn, descriptionTr) : null,
      isMandatory: formData.get("isMandatory") === "on",
      priority: optionalInteger(formData.get("priority"), -10_000, 10_000) ?? 0,
      platforms: commaList(readString(formData, "platforms", 500)),
      releaseChannels: commaList(readString(formData, "releaseChannels", 500)),
      appVersions: commaList(readString(formData, "appVersions", 1_000)),
      buildNumbers: integerList(readString(formData, "buildNumbers", 1_000)),
      minAppVersion: readString(formData, "minAppVersion", 50) || null,
      maxAppVersion: readString(formData, "maxAppVersion", 50) || null,
      minBuildNumber: optionalInteger(formData.get("minBuildNumber"), 0, 10_000_000),
      maxBuildNumber: optionalInteger(formData.get("maxBuildNumber"), 0, 10_000_000),
      startsAt,
      endsAt,
      audience: audience.value,
      presentation: presentation.value,
      metadata: metadata.value,
      questions,
    },
  };
}

function surveyFields(data: ParsedSurvey) {
  return {
    key: data.key,
    status: data.status,
    title: data.title,
    description: data.description ?? Prisma.DbNull,
    isMandatory: data.isMandatory,
    priority: data.priority,
    platforms: data.platforms,
    releaseChannels: data.releaseChannels,
    appVersions: data.appVersions,
    buildNumbers: data.buildNumbers,
    minAppVersion: data.minAppVersion,
    maxAppVersion: data.maxAppVersion,
    minBuildNumber: data.minBuildNumber,
    maxBuildNumber: data.maxBuildNumber,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    audience: data.audience ?? Prisma.DbNull,
    presentation: data.presentation ?? Prisma.DbNull,
    metadata: data.metadata ?? Prisma.DbNull,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function questionShape(question: {
  key: string;
  type: SurveyQuestionType;
  prompt: unknown;
  description?: unknown;
  options?: unknown;
  isRequired: boolean;
  sortOrder: number;
  minLength?: number | null;
  maxLength?: number | null;
  minSelected?: number | null;
  maxSelected?: number | null;
}) {
  return {
    key: question.key,
    type: question.type,
    prompt: question.prompt,
    description: question.description ?? null,
    options: question.options ?? null,
    isRequired: question.isRequired,
    sortOrder: question.sortOrder,
    minLength: question.minLength ?? null,
    maxLength: question.maxLength ?? null,
    minSelected: question.minSelected ?? null,
    maxSelected: question.maxSelected ?? null,
  };
}

export async function createSurvey(_state: SurveyActionState, formData: FormData): Promise<SurveyActionState> {
  const session = await requireAdmin();
  const parsed = parseSurvey(formData);
  if (!parsed.data) return { error: parsed.error };
  const { data } = parsed;

  try {
    const survey = await db.survey.create({
      data: {
        ...surveyFields(data),
        revision: 1,
        questions: { create: data.questions.map((question) => ({ ...question, surveyRevision: 1 })) },
      },
      select: { id: true, key: true },
    });
    await writeAdminAudit({ actorEmail: session.email, action: "survey.created", targetType: "survey", targetId: survey.id, details: { key: survey.key, status: data.status, questionCount: data.questions.length }, ipAddress: await clientIp() });
    revalidatePath("/admin");
    revalidatePath("/admin/surveys");
    redirect("/admin/surveys?created=1");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "That survey key already exists." };
    throw error;
  }
}

export async function updateSurvey(_state: SurveyActionState, formData: FormData): Promise<SurveyActionState> {
  const session = await requireAdmin();
  const surveyId = readString(formData, "surveyId", 128);
  if (!/^[0-9a-f-]{36}$/i.test(surveyId)) return { error: "The survey identifier is invalid." };
  const parsed = parseSurvey(formData);
  if (!parsed.data) return { error: parsed.error };
  const { data } = parsed;

  try {
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.survey.findUnique({
        where: { id: surveyId },
        include: { questions: { orderBy: { sortOrder: "asc" } } },
      });
      if (!existing) return null;
      const currentQuestions = existing.questions.filter((question) => question.surveyRevision === existing.revision);
      const questionsChanged = stableJson(currentQuestions.map(questionShape)) !== stableJson(data.questions.map(questionShape));
      let nextRevision = existing.revision;

      if (questionsChanged) {
        const responseCount = await tx.surveyResponse.count({ where: { surveyId, surveyRevision: existing.revision } });
        if (responseCount > 0) {
          nextRevision += 1;
        } else {
          await tx.surveyQuestion.deleteMany({ where: { surveyId, surveyRevision: existing.revision } });
        }
        await tx.surveyQuestion.createMany({
          data: data.questions.map((question) => ({ ...question, surveyId, surveyRevision: nextRevision })),
        });
      }

      const updated = await tx.survey.update({
        where: { id: surveyId },
        data: { ...surveyFields(data), revision: nextRevision },
        select: { id: true, key: true, revision: true },
      });
      return { updated, oldKey: existing.key, questionsChanged };
    });
    if (!result) return { error: "This survey no longer exists." };

    await writeAdminAudit({
      actorEmail: session.email,
      action: "survey.updated",
      targetType: "survey",
      targetId: result.updated.id,
      details: {
        previousKey: result.oldKey,
        key: result.updated.key,
        status: data.status,
        revision: result.updated.revision,
        questionsChanged: result.questionsChanged,
        questionCount: data.questions.length,
      },
      ipAddress: await clientIp(),
    });
    revalidatePath("/admin");
    revalidatePath("/admin/surveys");
    redirect("/admin/surveys?updated=1");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "That survey key already exists." };
    throw error;
  }
}

export async function deleteSurvey(formData: FormData) {
  const session = await requireAdmin();
  const surveyId = readString(formData, "surveyId", 128);
  const confirmation = readString(formData, "confirmation", 100, false);
  if (!/^[0-9a-f-]{36}$/i.test(surveyId)) return;

  const survey = await db.survey.findUnique({
    where: { id: surveyId },
    select: { id: true, key: true, _count: { select: { questions: true, responses: true } } },
  });
  if (!survey || confirmation !== survey.key) return;

  await db.$transaction(async (tx) => {
    await tx.surveyResponse.deleteMany({ where: { surveyId } });
    await tx.survey.delete({ where: { id: surveyId } });
  });
  await writeAdminAudit({
    actorEmail: session.email,
    action: "survey.deleted",
    targetType: "survey",
    targetId: survey.id,
    details: { key: survey.key, questionCount: survey._count.questions, responseCount: survey._count.responses, confirmation: "explicit" },
    ipAddress: await clientIp(),
  });
  revalidatePath("/admin");
  revalidatePath("/admin/surveys");
  redirect("/admin/surveys?deleted=1");
}

export async function updateTranscoderSupervisorConfig(formData: FormData) {
  const session = await requireAdmin();
  const allowedGpuModels = readString(formData, "allowedGpuModels", 2_000)
    .split(",").map((value) => value.trim()).filter(Boolean).slice(0, 50);
  const vastTemplateHash = readString(formData, "vastTemplateHash", 256);
  if (!vastTemplateHash) redirect("/admin/transcoder?error=template");

  const data = {
    enabled: formData.get("enabled") === "on",
    maxHourlyPrice: boundedNumber(formData, "maxHourlyPrice", 0.01, 100, 1.5),
    verifiedOnly: formData.get("verifiedOnly") === "on",
    datacenterOnly: formData.get("datacenterOnly") === "on",
    requireFullMachine: formData.get("requireFullMachine") === "on",
    allowedGpuModels,
    minimumGpuRamMb: Math.round(boundedNumber(formData, "minimumGpuRamMb", 1_000, 500_000, 16_000)),
    minimumCpuCores: Math.round(boundedNumber(formData, "minimumCpuCores", 1, 512, 4)),
    minimumRamMb: Math.round(boundedNumber(formData, "minimumRamMb", 1_000, 4_000_000, 16_000)),
    minimumReliability: boundedNumber(formData, "minimumReliability", 0, 1, 0.98),
    minimumDownloadMbps: boundedNumber(formData, "minimumDownloadMbps", 0, 100_000, 200),
    minimumUploadMbps: boundedNumber(formData, "minimumUploadMbps", 0, 100_000, 100),
    diskGb: Math.round(boundedNumber(formData, "diskGb", 10, 10_000, 20)),
    offerSearchLimit: Math.round(boundedNumber(formData, "offerSearchLimit", 10, 500, 100)),
    maxWorkers: Math.round(boundedNumber(formData, "maxWorkers", 1, 20, 1)),
    jobsPerWorker: Math.round(boundedNumber(formData, "jobsPerWorker", 1, 20, 1)),
    queueDepthPerNewWorker: Math.round(boundedNumber(formData, "queueDepthPerNewWorker", 1, 100, 1)),
    idleTimeoutSeconds: Math.round(boundedNumber(formData, "idleTimeoutSeconds", 30, 86_400, 300)),
    idleAction: readString(formData, "idleAction", 20) === "STOP" ? "STOP" : "DESTROY",
    startupTimeoutSeconds: Math.round(boundedNumber(formData, "startupTimeoutSeconds", 60, 3_600, 600)),
    healthPollSeconds: Math.round(boundedNumber(formData, "healthPollSeconds", 2, 60, 5)),
    maxInstanceFailures: Math.round(boundedNumber(formData, "maxInstanceFailures", 1, 20, 3)),
    maxMissionAttempts: Math.round(boundedNumber(formData, "maxMissionAttempts", 1, 10, 3)),
    workerLogRetentionDays: Math.round(boundedNumber(formData, "workerLogRetentionDays", 0, 3650, 30)),
    vastTemplateHash,
  };

  const previous = await db.transcoderSupervisorConfig.findUnique({ where: { id: "default" } });
  await db.transcoderSupervisorConfig.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: { ...data, policyVersion: { increment: 1 } },
  });
  await writeAdminAudit({
    actorEmail: session.email,
    action: "transcoder.policy_updated",
    targetType: "transcoder_supervisor_config",
    targetId: "default",
    details: { previousPolicyVersion: previous?.policyVersion ?? null, fullMachine: data.requireFullMachine, maxWorkers: data.maxWorkers },
    ipAddress: await clientIp(),
  });
  revalidatePath("/admin/transcoder");
  redirect("/admin/transcoder?updated=1");
}
