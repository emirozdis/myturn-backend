import { db } from "@/lib/db";
import { sendPushToUser } from "@/lib/push-server";
import {
  rollGroupAssignmentForDate,
  getLocalDateInTimezone,
  processGroupDayTransition,
  MIN_MEMBERS_FOR_DAILY_ASSIGNMENT,
  isAutomaticPassDue,
} from "@/lib/vlog-helpers";
import { finalizeUploadedClip as completeUpload } from "@/lib/upload-finalization";
import { r2 } from "@/lib/r2";
import { getBusinessClock, getVlogTimePeriod } from "@/lib/business-time";
import { passCurrentAssignment } from "@/lib/assignment-transitions";
import { logInfo, reportWarning } from "@/lib/observability/logger";
import { cleanupExpiredIncidents } from "@/lib/observability/incident-store";
import { runArchiverIteration } from "@/lib/archiver";

export type CronJobResult = Record<string, number>;

export type CronJobDefinition = {
  name: string;
  schedule: string;
  run: () => Promise<CronJobResult>;
};

function getLocalHourAndMinute(timezone: string): { hour: number; minute: number } {
  const { hour, minute } = getBusinessClock(new Date(), timezone);
  return { hour, minute };
}

function getSlotForHour(hour: number): number | null {
  if (hour === 10) return 0;
  if (hour === 13) return 1;
  if (hour === 16) return 2;
  if (hour === 19) return 3;
  if (hour === 22) return 4;
  return null;
}

function getSlotForClip(recordedAt: Date | string, timezone?: string): number {
  return getVlogTimePeriod(recordedAt, timezone || "UTC") ?? 5;
}

async function runFrozenGroupEvaluation(): Promise<CronJobResult> {
  logInfo("cron.frozen_groups_started", {}, "Frozen group evaluation started");
  const groups = await db.group.findMany({
    where: {
      boostGracePeriodEndsAt: { lt: new Date() },
      isFrozen: false,
    },
  });

  for (const group of groups) {
    const memberCount = await db.groupMember.count({ where: { groupId: group.id } });
    await db.group.update({
      where: { id: group.id },
      data: {
        isFrozen: memberCount > 4,
        boostGracePeriodEndsAt: null,
      },
    });
  }

  return { evaluatedGroupCount: groups.length };
}

async function runStrandedUploadCleanup(): Promise<CronJobResult> {
  logInfo("cron.stranded_upload_sweep_started", {}, "Stranded upload sweep started");
  const thresholdTime = new Date(Date.now() - 60 * 60 * 1000);
  const expiredSessions = await db.activeUpload.findMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() }, status: { in: ["INITIATED", "LEGACY_REJECTED"] } },
        { status: { in: ["FINALIZED", "PUBLISHED"] }, updatedAt: { lt: thresholdTime } },
      ],
    },
    take: 100,
  });

  for (const upload of expiredSessions) {
    if (!["FINALIZED", "PUBLISHED"].includes(upload.status)) {
      await r2.abortMultipartUpload("vlogs", upload.key, upload.uploadId);
    }
    await db.activeUpload.deleteMany({ where: { id: upload.id, status: upload.status } });
  }

  const strandedClips = await db.clip.findMany({
    where: {
      transcodeStatus: "UPLOADING",
      recordedAt: { lt: thresholdTime },
    },
  });
  let recoveredClipCount = 0;
  let abandonedClipCount = 0;

  for (const clip of strandedClips) {
    logInfo("cron.stranded_upload_checked", { clipId: clip.id }, "Checking stranded upload");
    try {
      await r2.head("vlogs", clip.videoUrl);
      logInfo("cron.stranded_upload_recovered", { clipId: clip.id }, "Stranded upload recovered");
      await completeUpload(clip.id, true);
      recoveredClipCount++;
    } catch (error: unknown) {
      reportWarning("cron.stranded_upload_abandoned", error, { clipId: clip.id });
      await db.clip.delete({ where: { id: clip.id } });
      abandonedClipCount++;
    }
  }

  return {
    expiredSessionCount: expiredSessions.length,
    strandedClipCount: strandedClips.length,
    recoveredClipCount,
    abandonedClipCount,
  };
}

async function runGroupDayTransition(): Promise<CronJobResult> {
  const groups = await db.group.findMany();
  let transitionedGroupCount = 0;

  for (const group of groups) {
    const { hour } = getLocalHourAndMinute(group.timezone);
    if (hour !== 0) continue;

    const localDate = await getLocalDateInTimezone(group.timezone);
    await processGroupDayTransition(group.id, localDate);
    transitionedGroupCount++;
  }

  if (transitionedGroupCount > 0) {
    logInfo(
      "cron.group_day_transition_completed",
      { groupCount: transitionedGroupCount },
      "Local-midnight group transitions completed",
    );
  }

  return { evaluatedGroupCount: groups.length, transitionedGroupCount };
}

async function runDailyAssignmentRoll(): Promise<CronJobResult> {
  logInfo("cron.assignment_roll_started", {}, "Daily assignment roll started");
  const groups = await db.group.findMany();
  for (const group of groups) {
    const localDate = await getLocalDateInTimezone(group.timezone);
    await rollGroupAssignmentForDate(group.id, localDate);
  }
  logInfo("cron.assignment_roll_completed", { groupCount: groups.length }, "Daily assignment roll completed");
  return { groupCount: groups.length };
}

async function runVloggerReminders(): Promise<CronJobResult> {
  logInfo("cron.reminders_started", {}, "Vlogger reminder evaluation started");
  const groups = await db.group.findMany({
    where: { isFrozen: false },
    include: { _count: { select: { members: true } } },
  });
  let reminderCount = 0;
  let passedAssignmentCount = 0;

  for (const group of groups) {
    if (group._count.members < MIN_MEMBERS_FOR_DAILY_ASSIGNMENT) continue;
    const { hour, minute } = getLocalHourAndMinute(group.timezone);
    const slot = getSlotForHour(hour);
    const localDate = await getLocalDateInTimezone(group.timezone);
    const assignment = await db.dailyAssignment.findFirst({
      where: { groupId: group.id, date: localDate },
      include: { clips: true },
    });

    if (!assignment) continue;

    const totalMinutes = hour * 60 + minute;
    if (!assignment.isPassed && assignment.clips.length === 0 && isAutomaticPassDue(assignment.createdAt, totalMinutes)) {
      const passed = await passCurrentAssignment(assignment.id, assignment.userId, true);
      if (!passed) continue;
      passedAssignmentCount++;
      const members = await db.groupMember.findMany({ where: { groupId: group.id } });
      for (const member of members) {
        if (member.userId !== assignment.userId) {
          await sendPushToUser(member.userId, {
            category: "turns",
            key: "cameraAvailable",
            deepLink: { screen: "today", groupId: group.id, assignmentId: assignment.id },
          });
        }
      }
      continue;
    }

    if (slot !== null && minute >= 15 && minute <= 45 && !assignment.isPassed) {
      const hasClipsInSlot = assignment.clips.some(
        (clip) => getSlotForClip(clip.recordedAt, group.timezone) === slot,
      );

      if (!hasClipsInSlot) {
        const slotLabels = ["Morning", "Midday", "Afternoon", "Evening", "Late Night"];
        await sendPushToUser(assignment.userId, {
          category: "reminders",
          key: "slotReminder",
          vars: { slot: slotLabels[slot], group: group.name },
          deepLink: { screen: "record", groupId: group.id, assignmentId: assignment.id },
        });
        reminderCount++;
      }
    }
  }

  if (reminderCount > 0) {
    logInfo("cron.reminders_completed", { reminderCount }, "Vlogger reminders sent");
  }

  return { evaluatedGroupCount: groups.length, reminderCount, passedAssignmentCount };
}

async function runIncidentRetentionCleanup(): Promise<CronJobResult> {
  const deletedCount = await cleanupExpiredIncidents();
  logInfo(
    "incident.retention_cleanup_completed",
    { deletedCount },
    "Expired incidents deleted",
  );
  return { deletedCount };
}

export const cronJobs: readonly CronJobDefinition[] = [
  { name: "frozen-group-evaluation", schedule: "0 * * * *", run: runFrozenGroupEvaluation },
  { name: "stranded-upload-cleanup", schedule: "*/30 * * * *", run: runStrandedUploadCleanup },
  { name: "group-day-transition", schedule: "*/15 * * * *", run: runGroupDayTransition },
  { name: "daily-assignment-roll", schedule: "0 * * * *", run: runDailyAssignmentRoll },
  { name: "vlogger-reminders", schedule: "*/30 * * * *", run: runVloggerReminders },
  { name: "incident-retention-cleanup", schedule: "17 3 * * *", run: runIncidentRetentionCleanup },
];

// The archiver uses setInterval on a long-lived server, but must be explicitly
// invoked alongside cron jobs when deployed to an ephemeral serverless runtime.
export const serverlessCronJobs: readonly CronJobDefinition[] = [
  ...cronJobs,
  {
    name: "archive-worker-iteration",
    schedule: "*/15 * * * *",
    run: () => runArchiverIteration(10),
  },
];
