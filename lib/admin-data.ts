import "server-only";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { r2Client } from "@/lib/r2";

export type ServiceHealth = {
  name: string;
  status: "healthy" | "degraded" | "offline" | "unconfigured";
  detail: string;
  latencyMs?: number;
};

export type TranscoderSupervisorHealth = ServiceHealth & {
  endpoint?: string;
  checkedAt: Date;
  database?: string;
  policyConfigured?: boolean;
  httpStatus?: number;
};

export type StorageSummary = {
  bytes: number;
  objects: number;
  available: boolean;
};

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function recentDays(days: number) {
  const today = startOfDay(new Date());
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (days - 1 - index));
    return date;
  });
}

function aggregateByDay(dates: Date[], days = 7) {
  return recentDays(days).map((day) => {
    const key = day.toISOString().slice(0, 10);
    return {
      date: key,
      label: day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      count: dates.filter((value) => value.toISOString().slice(0, 10) === key).length,
    };
  });
}

async function scanBucket(bucket: string, prefix?: string) {
  let continuationToken: string | undefined;
  let bytes = 0;
  let objects = 0;

  do {
    const response = await r2Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const item of response.Contents || []) {
      bytes += item.Size || 0;
      objects += 1;
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return { bytes, objects };
}

const readStorageSummary = unstable_cache(async (): Promise<StorageSummary> => {
  const configured = Boolean(
    process.env.CLOUDFLARE_R2_ACCOUNT_ID &&
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  );
  if (!configured) return { bytes: 0, objects: 0, available: false };

  try {
    const singleBucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
    const results = singleBucket
      ? [await scanBucket(singleBucket)]
      : await Promise.all(["vlogs", "avatars", "feedback"].map((bucket) => scanBucket(bucket)));
    return {
      bytes: results.reduce((total, result) => total + result.bytes, 0),
      objects: results.reduce((total, result) => total + result.objects, 0),
      available: true,
    };
  } catch {
    return { bytes: 0, objects: 0, available: false };
  }
}, ["admin-storage-summary"], { revalidate: 300 });

async function checkTranscoder(): Promise<TranscoderSupervisorHealth> {
  const checkedAt = new Date();
  const configuredUrl = process.env.TRANSCODER_SUPERVISOR_URL;
  if (!configuredUrl) {
    return { name: "Transcoder supervisor", status: "unconfigured", detail: "Supervisor endpoint is not configured", checkedAt };
  }

  const startedAt = Date.now();
  try {
    const url = new URL("/health", new URL(configuredUrl).origin);
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3_000) });
    const latencyMs = Date.now() - startedAt;
    const body = await response.json().catch(() => ({})) as { status?: string; database?: string; policyConfigured?: boolean };
    const reportedStatus = body.status?.toLowerCase();
    const status = response.ok && reportedStatus === "healthy"
      ? "healthy"
      : reportedStatus === "degraded" || (response.status >= 400 && response.status < 500)
        ? "degraded"
        : "offline";
    const detail = status === "healthy"
      ? "Supervisor API and orchestration loop are reachable"
      : reportedStatus === "degraded"
        ? "Supervisor is reachable but its policy is incomplete"
        : `Supervisor health endpoint returned HTTP ${response.status}`;
    return {
      name: "Transcoder supervisor",
      status,
      detail,
      latencyMs,
      endpoint: url.origin,
      checkedAt,
      database: body.database,
      policyConfigured: body.policyConfigured,
      httpStatus: response.status,
    };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      name: "Transcoder supervisor",
      status: "offline",
      detail: timedOut ? "Supervisor health check timed out after 3 seconds" : "Supervisor health endpoint could not be reached",
      latencyMs: Date.now() - startedAt,
      endpoint: (() => { try { return new URL(configuredUrl).origin; } catch { return configuredUrl; } })(),
      checkedAt,
    };
  }
}

export async function getTranscoderSupervisorOverview(filters: { level?: string; jobId?: string; instanceId?: string; from?: string; to?: string; page?: number } = {}) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const allowedLogLevels = ["silly", "debug", "http", "info", "warn", "error", "fatal"];
  const logLevel = allowedLogLevels.includes(filters.level || "") ? filters.level : undefined;
  const jobId = filters.jobId?.trim().slice(0, 128) || undefined;
  const vastInstanceId = /^\d{1,12}$/.test(filters.instanceId || "") ? Number(filters.instanceId) : undefined;
  const parsedFrom = filters.from ? new Date(`${filters.from.replace(/Z$/, "")}Z`) : null;
  const parsedTo = filters.to ? new Date(`${filters.to.replace(/Z$/, "")}Z`) : null;
  const from = parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : undefined;
  const to = parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : undefined;
  const page = Math.max(0, Math.min(10_000, Math.floor(filters.page || 0)));
  const workerLogWhere = {
    ...(logLevel ? { level: logLevel } : {}),
    ...(jobId ? { jobId: { contains: jobId, mode: "insensitive" as const } } : {}),
    ...(vastInstanceId ? { vastInstanceId } : {}),
    ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [config, instances, missions, events, missionStatus, completed24h, failed24h, workerLogs, workerLogFilteredCount, workerLogs24h, workerErrors24h, supervisorHealth] = await Promise.all([
    db.transcoderSupervisorConfig.findUnique({ where: { id: "default" } }),
    db.transcoderInstance.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }),
    db.transcoderMission.findMany({ orderBy: { registeredAt: "desc" }, take: 100 }),
    db.transcoderSupervisorEvent.findMany({ orderBy: { createdAt: "desc" }, take: 150 }),
    db.transcoderMission.groupBy({ by: ["status"], _count: { _all: true } }),
    db.transcoderMission.count({ where: { status: "SUCCEEDED", completedAt: { gte: since } } }),
    db.transcoderMission.count({ where: { status: "FAILED_PERMANENTLY", completedAt: { gte: since } } }),
    db.transcoderWorkerLog.findMany({ where: workerLogWhere, orderBy: { occurredAt: "desc" }, skip: page * 250, take: 250 }),
    db.transcoderWorkerLog.count({ where: workerLogWhere }),
    db.transcoderWorkerLog.count({ where: { occurredAt: { gte: since } } }),
    db.transcoderWorkerLog.count({ where: { occurredAt: { gte: since }, level: { in: ["error", "fatal"] } } }),
    checkTranscoder(),
  ]);

  return {
    config,
    instances,
    missions,
    events,
    counts: Object.fromEntries(missionStatus.map((item) => [item.status, item._count._all])),
    completed24h,
    failed24h,
    workerLogs,
    workerLogFilteredCount,
    workerLogPage: page,
    workerLogs24h,
    workerErrors24h,
    supervisorHealth,
  };
}

export async function getAdminOverview() {
  const now = new Date();
  const today = startOfDay(now);
  const weekAgo = new Date(today);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1_000);

  const databaseStartedAt = Date.now();
  const [
    totalUsers,
    suspendedUsers,
    activeMembers,
    totalVlogs,
    vlogsToday,
    openFeedback,
    activeSurveys,
    surveyResponses,
    errors24h,
    recentIncidents,
    recentFeedback,
    newProfiles,
    weeklyClips,
    weeklyIncidents,
    auditLogs,
    storage,
    transcoder,
  ] = await Promise.all([
    db.profile.count(),
    db.profile.count({ where: { isSuspended: true } }),
    db.groupMember.findMany({
      where: { lastActiveAt: { gte: monthAgo } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    db.clip.count({ where: { mediaType: "vlog" } }),
    db.clip.count({ where: { mediaType: "vlog", recordedAt: { gte: today } } }),
    db.feedbackReport.count({ where: { status: { in: ["open", "in_progress"] } } }),
    db.survey.count({ where: { status: "ACTIVE" } }),
    db.surveyResponse.count(),
    db.backendIncident.count({ where: { level: { in: ["error", "fatal"] }, createdAt: { gte: dayAgo } } }),
    db.backendIncident.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    db.feedbackReport.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { user: { select: { name: true, email: true } } },
    }),
    db.profile.findMany({ where: { createdAt: { gte: weekAgo } }, select: { createdAt: true } }),
    db.clip.findMany({ where: { recordedAt: { gte: weekAgo }, mediaType: "vlog" }, select: { recordedAt: true } }),
    db.backendIncident.findMany({ where: { createdAt: { gte: weekAgo } }, select: { createdAt: true } }),
    db.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 6 }).catch(() => []),
    readStorageSummary(),
    checkTranscoder(),
  ]);

  const databaseLatencyMs = Date.now() - databaseStartedAt;
  const services: ServiceHealth[] = [
    { name: "API & database", status: "healthy", detail: "PostgreSQL queries are responding", latencyMs: databaseLatencyMs },
    transcoder,
    storage.available
      ? { name: "Object storage", status: "healthy", detail: `${storage.objects.toLocaleString()} objects indexed` }
      : { name: "Object storage", status: "degraded", detail: "Storage metrics are unavailable" },
    errors24h > 10
      ? { name: "Error budget", status: "degraded", detail: `${errors24h} errors in the last 24 hours` }
      : { name: "Error budget", status: "healthy", detail: `${errors24h} errors in the last 24 hours` },
  ];

  return {
    metrics: {
      totalUsers,
      activeUsers: activeMembers.length,
      suspendedUsers,
      totalVlogs,
      vlogsToday,
      openFeedback,
      activeSurveys,
      surveyResponses,
      errors24h,
      storage,
    },
    growth: aggregateByDay(newProfiles.map((item) => item.createdAt)),
    uploads: aggregateByDay(weeklyClips.map((item) => item.recordedAt)),
    incidents: aggregateByDay(weeklyIncidents.map((item) => item.createdAt)),
    recentIncidents,
    recentFeedback,
    auditLogs,
    services,
    generatedAt: now,
  };
}

export async function getUsers(query: string, status: string) {
  const normalizedQuery = query.trim().slice(0, 100);
  return db.profile.findMany({
    where: {
      ...(status === "suspended" ? { isSuspended: true } : status === "active" ? { isSuspended: false } : {}),
      ...(normalizedQuery ? {
        OR: [
          { name: { contains: normalizedQuery, mode: "insensitive" as const } },
          { email: { contains: normalizedQuery, mode: "insensitive" as const } },
          { handle: { contains: normalizedQuery, mode: "insensitive" as const } },
        ],
      } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      _count: { select: { clips: true, groupMembers: true, feedbackReports: true } },
      groupMembers: { orderBy: { lastActiveAt: "desc" }, take: 1, select: { lastActiveAt: true } },
    },
  });
}

export async function getAppVersionRequirements() {
  return db.appVersionRequirement.findMany({
    orderBy: [{ platform: "asc" }, { releaseChannel: "asc" }],
  });
}

export async function getFeedback(status: string) {
  return db.feedbackReport.findMany({
    where: status && status !== "all" ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { name: true, email: true, handle: true } } },
  });
}

export async function getSurveys() {
  return db.survey.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: {
      _count: { select: { questions: true, responses: true } },
      questions: { orderBy: [{ surveyRevision: "desc" }, { sortOrder: "asc" }] },
      responses: {
        orderBy: { submittedAt: "desc" },
        include: {
          user: { select: { id: true, name: true, email: true, handle: true } },
          answers: { orderBy: { questionKey: "asc" } },
        },
      },
    },
  });
}

export async function getIncidents(level: string, source: string) {
  return db.backendIncident.findMany({
    where: {
      ...(level && level !== "all" ? { level: level as "warn" | "error" | "fatal" } : {}),
      ...(source && source !== "all" ? { source: source as "server" | "client" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 150,
  });
}

export async function getAuditLogs() {
  return db.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 150 });
}
