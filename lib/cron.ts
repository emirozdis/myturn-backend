// ./lib/cron.ts
import cron from "node-cron";
import { db } from "@/lib/db";
import { sendPushToUser } from "@/lib/push-server";
import {
  rollGroupAssignmentForDate,
  getLocalDateInTimezone,
  processGroupDayTransition,
} from "@/lib/vlog-helpers";
import { finalizeUploadedClip as completeUpload } from "@/lib/upload-finalization";
import { startArchiverWorker } from "./archiver";
import { r2 } from "./r2";
import { getBusinessClock, getBusinessHour } from "./business-time";
import { passCurrentAssignment } from "./assignment-transitions";
import { logInfo, reportError, reportWarning } from "./observability/logger";
import { runBackgroundJob } from "./observability/background-job";

const cronState = globalThis as typeof globalThis & {
  __cron_initialized?: boolean;
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
  const hours = getBusinessHour(recordedAt, timezone || "UTC");

  if (hours >= 9 && hours < 12) return 0;
  if (hours >= 12 && hours < 15) return 1;
  if (hours >= 15 && hours < 18) return 2;
  if (hours >= 18 && hours < 21) return 3;
  if (hours >= 21 && hours < 24) return 4;
  return 5;
}

async function cleanupStrandedUploads() {
  const thresholdTime = new Date(Date.now() - 60 * 60 * 1000);

  try {
    const expiredSessions = await db.activeUpload.findMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() }, status: { in: ["INITIATED", "LEGACY_REJECTED"] } },
          { status: "FINALIZED", updatedAt: { lt: thresholdTime } },
        ],
      },
      take: 100,
    });
    for (const upload of expiredSessions) {
      if (upload.status !== "FINALIZED") {
        await r2.abortMultipartUpload("vlogs", upload.key, upload.uploadId);
      }
      await db.activeUpload.deleteMany({ where: { id: upload.id, status: upload.status } });
    }

    const strandedClips = await db.clip.findMany({
      where: {
        transcodeStatus: "UPLOADING",
        recordedAt: { lt: thresholdTime }
      }
    });

    for (const clip of strandedClips) {
      logInfo("cron.stranded_upload_checked", { clipId: clip.id }, "Checking stranded upload");
      try {
        await r2.head("vlogs", clip.videoUrl);
        logInfo("cron.stranded_upload_recovered", { clipId: clip.id }, "Stranded upload recovered");
        await completeUpload(clip.id, true);
      } catch (error: unknown) {
        reportWarning("cron.stranded_upload_abandoned", error, { clipId: clip.id });
        await db.clip.delete({ where: { id: clip.id } });
      }
    }
  } catch (error) {
    reportError("cron.stranded_upload_sweep_failed", error);
  }
}

export function startCronJobs() {
  if (cronState.__cron_initialized) return;
  cronState.__cron_initialized = true;

  logInfo("cron.initialized", {}, "Internal background jobs initialized");

  startArchiverWorker();

  // Evaluate and enforce Frozen states based on Grace Periods
  cron.schedule("0 * * * *", () => void runBackgroundJob("frozen-group-evaluation", async () => {
    logInfo("cron.frozen_groups_started", {}, "Frozen group evaluation started");
    try {
      const groups = await db.group.findMany({
        where: {
          boostGracePeriodEndsAt: { lt: new Date() },
          isFrozen: false
        }
      });

      for (const group of groups) {
        const memberCount = await db.groupMember.count({ where: { groupId: group.id } });
        if (memberCount > 4) {
          await db.group.update({ where: { id: group.id }, data: { isFrozen: true, boostGracePeriodEndsAt: null } });
        } else {
          await db.group.update({ where: { id: group.id }, data: { isFrozen: false, boostGracePeriodEndsAt: null } });
        }
      }
    } catch (error) {
      reportError("cron.frozen_groups_failed", error);
    }
  }));

  cron.schedule("*/30 * * * *", () => void runBackgroundJob("stranded-upload-cleanup", async () => {
    logInfo("cron.stranded_upload_sweep_started", {}, "Stranded upload sweep started");
    await cleanupStrandedUploads();
  }));

  // Close out the previous day at local midnight so completed recaps are
  // announced immediately instead of waiting for sleep mode to end at 09:00.
  // Quarter-hour execution covers every currently used UTC timezone offset;
  // the full midnight hour also provides retries without duplicate pushes.
  cron.schedule("*/15 * * * *", () => void runBackgroundJob("group-day-transition", async () => {
    try {
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
    } catch (error) {
      reportError("cron.group_day_transition_failed", error);
    }
  }));

  cron.schedule("0 * * * *", () => void runBackgroundJob("daily-assignment-roll", async () => {
    logInfo("cron.assignment_roll_started", {}, "Daily assignment roll started");
    try {
      const groups = await db.group.findMany();
      for (const group of groups) {
        const localDate = await getLocalDateInTimezone(group.timezone);
        await rollGroupAssignmentForDate(group.id, localDate);
      }
      logInfo("cron.assignment_roll_completed", { groupCount: groups.length }, "Daily assignment roll completed");
    } catch (error) {
      reportError("cron.assignment_roll_failed", error);
    }
  }));

  cron.schedule("*/30 * * * *", () => void runBackgroundJob("vlogger-reminders", async () => {
    logInfo("cron.reminders_started", {}, "Vlogger reminder evaluation started");
    try {
      const groups = await db.group.findMany({ where: { isFrozen: false } }); // Do not remind members of frozen groups
      let count = 0;

      for (const group of groups) {
        const { hour, minute } = getLocalHourAndMinute(group.timezone);
        const slot = getSlotForHour(hour);
        const localDate = await getLocalDateInTimezone(group.timezone);

        const assignment = await db.dailyAssignment.findFirst({
          where: {
            groupId: group.id,
            date: localDate,
          },
          include: {
            clips: true,
          },
        });

        if (assignment) {
          const totalMinutes = hour * 60 + minute;
          if (!assignment.isPassed && assignment.clips.length === 0 && totalMinutes >= 750) {
            const passed = await passCurrentAssignment(assignment.id, assignment.userId, true);
            if (!passed) continue;
            const members = await db.groupMember.findMany({ where: { groupId: group.id }});
            for (const m of members) {
              if (m.userId !== assignment.userId) {
                await sendPushToUser(m.userId, {
                  category: "turns",
                  key: "cameraAvailable",
                  url: "/today"
                });
              }
            }
            continue; 
          }

          if (slot !== null && minute >= 15 && minute <= 45 && !assignment.isPassed) {
            const hasClipsInSlot = assignment.clips.some(
              (clip) => getSlotForClip(clip.recordedAt, group.timezone) === slot
            );

            if (!hasClipsInSlot) {
              const slotLabels = ["Morning", "Midday", "Afternoon", "Evening", "Late Night"];
              const slotLabel = slotLabels[slot];

              await sendPushToUser(assignment.userId, {
                category: "reminders",
                key: "slotReminder",
                vars: { slot: slotLabel, group: group.name },
                url: "/record",
              });
              count++;
            }
          }
        }
      }
      if (count > 0) {
        logInfo("cron.reminders_completed", { reminderCount: count }, "Vlogger reminders sent");
      }
    } catch (error) {
      reportError("cron.reminders_failed", error);
    }
  }));
}
