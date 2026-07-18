// ./lib/vlog-helpers.ts
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sendPushToUser } from "@/lib/push-server";
import { reportError } from "@/lib/observability/logger";
import { getBusinessClock, getBusinessDate } from "@/lib/business-time";

export function getVlogCircadianState(timezone: string) {
  const now = new Date();
  const { hour, minute, second } = getBusinessClock(now, timezone);
  const localDate = getBusinessDate(timezone, now);
  const currentSeconds = hour * 3600 + minute * 60 + second;
  const isSleepMode = hour >= 0 && hour < 9;

  const businessDate = new Date(localDate);
  if (isSleepMode) {
    businessDate.setUTCDate(businessDate.getUTCDate() - 1);
  }

  const sleepTimeLeftSeconds = isSleepMode ? (9 * 3600 - currentSeconds) : 0;
  const wakingTimeLeftSeconds = isSleepMode ? 0 : (24 * 3600 - currentSeconds);

  return {
    localDate,
    businessDate,
    isSleepMode,
    sleepTimeLeftSeconds,
    wakingTimeLeftSeconds,
    currentHour: hour,
    currentMinute: minute,
  };
}


export function getSecondsUntilMidnightInTz(timezone: string): number {
  const { hour, minute, second } = getBusinessClock(new Date(), timezone);
  return Math.max(0, 24 * 3600 - (hour * 3600 + minute * 60 + second));
}

export async function getLocalDateInTimezone(timezone: string): Promise<Date> {
  return getBusinessDate(timezone);
}

export async function processGroupDayTransition(groupId: string, localDate: Date) {
  const missedAssignments = await db.dailyAssignment.findMany({
    where: {
      groupId,
      status: "active",
      date: { lt: localDate },
    },
  });

  for (const asg of missedAssignments) {
    await db.$transaction(async (tx) => {
      const transitioned = await tx.dailyAssignment.updateMany({
        where: { id: asg.id, status: "active" },
        data: { status: "missed" },
      });
      if (transitioned.count !== 1) return;

      const member = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: asg.userId } },
      });
      if (!member) return;

      const event = await tx.groupMemberXpEvent.createMany({
        data: [{
          groupId,
          groupMemberId: member.id,
          businessDate: localDate,
          reason: `MISSED_ASSIGNMENT:${asg.id}`,
          amount: -150,
        }],
        skipDuplicates: true,
      });
      if (event.count !== 1) return;

      await tx.groupMember.update({
        where: { id: member.id },
        data: { streak: 0 },
      });
      await tx.$executeRaw`UPDATE "group_members" SET "xp" = GREATEST(0, "xp" - 150) WHERE "id" = ${member.id}`;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  const completedAssignments = await db.dailyAssignment.findMany({
    where: {
      groupId,
      status: "completed",
      date: { lt: localDate },
      recapNotified: false
    },
    include: { user: true, group: true }
  });

  for (const assignment of completedAssignments) {
    const claimed = await db.dailyAssignment.updateMany({
      where: { id: assignment.id, recapNotified: false },
      data: { recapNotified: true }
    });
    if (claimed.count !== 1) continue;

    const members = await db.groupMember.findMany({ where: { groupId } });
    for (const member of members) {
      if (member.userId !== assignment.userId) {
        await sendPushToUser(member.userId, {
          category: "recaps",
          key: "recapFriend",
          vars: { group: assignment.group.name },
          url: "/streaks",
        });
      } else {
        await sendPushToUser(member.userId, {
          category: "recaps",
          key: "recapOwn",
          vars: { group: assignment.group.name },
          url: "/streaks",
        });
      }
    }
  }

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const inactiveMembers = await db.groupMember.findMany({
    where: { groupId, lastActiveAt: { lt: fiveDaysAgo } },
  });

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  for (const member of inactiveMembers) {
    let decayAmount = 20;
    const lastActiveTime = new Date(member.lastActiveAt).getTime();
    if (lastActiveTime < fourteenDaysAgo.getTime()) {
      decayAmount += 50; 
    }

    await db.$transaction(async (tx) => {
      const event = await tx.groupMemberXpEvent.createMany({
        data: [{
          groupId,
          groupMemberId: member.id,
          businessDate: localDate,
          reason: "INACTIVITY_DECAY",
          amount: -decayAmount,
        }],
        skipDuplicates: true,
      });
      if (event.count !== 1) return;
      await tx.$executeRaw`UPDATE "group_members" SET "xp" = GREATEST(0, "xp" - ${decayAmount}) WHERE "id" = ${member.id}`;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export async function rollGroupAssignmentForDate(groupId: string, localDate: Date) {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: true },
  });

  if (!group || group.members.length === 0) {
    return null;
  }

  const circadian = getVlogCircadianState(group.timezone);
  if (circadian.isSleepMode) {
    return await db.dailyAssignment.findFirst({
      where: { groupId, date: circadian.businessDate }
    });
  }

  await processGroupDayTransition(groupId, localDate);

  const existingAssignment = await db.dailyAssignment.findFirst({
    where: { groupId, date: localDate },
  });

  if (existingAssignment) {
    return existingAssignment;
  }

  const yesterdayDate = new Date(localDate);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);

  const yesterdayAssignment = await db.dailyAssignment.findFirst({
    where: { groupId, date: yesterdayDate },
  });

  // Evaluate Raincheck locking constraints
  let forceUserId: string | null = null;
  if (yesterdayAssignment?.isPassed && yesterdayAssignment.passedByUserId) {
    const isStillMember = group.members.some(m => m.userId === yesterdayAssignment.passedByUserId);
    if (isStillMember) {
      forceUserId = yesterdayAssignment.passedByUserId;
    }
  }

  const recentAssignments = await db.dailyAssignment.findMany({
    where: { groupId, date: { lt: localDate } },
    orderBy: { date: "desc" },
    take: group.members.length * 2,
  });

  const currentMemberIds = new Set(group.members.map((m) => m.userId));
  const seenInCycle = new Set<string>();

  for (const asg of recentAssignments) {
    if (!currentMemberIds.has(asg.userId)) continue;
    if (seenInCycle.has(asg.userId)) break;
    seenInCycle.add(asg.userId);
    if (seenInCycle.size === currentMemberIds.size) break;
  }

  let pool = group.members.filter((m) => !seenInCycle.has(m.userId));

  if (pool.length === 0) {
    pool = [...group.members];
  }

  if (pool.length > 1 && yesterdayAssignment) {
    pool = pool.filter((m) => m.userId !== yesterdayAssignment.userId);
  }

  if (pool.length === 0 && group.members.length > 0) {
    pool = [...group.members];
  }

  const volunteers = await db.volunteer.findMany({
    where: { groupId, targetDate: localDate }
  });

  const volunteerIds = new Set(volunteers.map((v) => v.userId));
  let finalPool = pool;
  let isVolunteer = false;

  // Raincheck enforcement explicitly overrides volunteers to ensure debt collection
  if (volunteerIds.size > 0 && !forceUserId) {
    const eligibleVolunteers = pool.filter((m) => volunteerIds.has(m.userId));
    if (eligibleVolunteers.length > 0) {
      finalPool = eligibleVolunteers;
      isVolunteer = true;
    }
  }

  const chosenMember = finalPool[Math.floor(Math.random() * finalPool.length)];
  const finalUserId = forceUserId ? forceUserId : chosenMember.userId;

  const prompts = await db.prompt.findMany({ select: { text: true } });
  if (prompts.length === 0) {
    throw new Error("Cannot create a daily assignment because no prompts are configured.");
  }
  const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)].text;

  let assignment;
  try {
    assignment = await db.dailyAssignment.create({
      data: {
        groupId,
        userId: finalUserId,
        date: localDate,
        status: "active",
        isVolunteer,
        isMandatory: !!forceUserId,
        activePrompt: randomPrompt,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return db.dailyAssignment.findUnique({
        where: { groupId_date: { groupId, date: localDate } },
      });
    }
    throw error;
  }

  try {
    const groupMembers = await db.groupMember.findMany({
      where: { groupId },
      include: {
        user: { select: { id: true, name: true, handle: true } },
      },
    });

    for (const member of groupMembers) {
      if (member.userId === finalUserId) {
        await sendPushToUser(member.userId, {
          category: "turns",
          key: forceUserId ? "mandatoryTurn" : "yourTurn",
          vars: { group: group.name },
          url: "/record",
        });
      } else {
        await sendPushToUser(member.userId, {
          category: "turns",
          key: "todayVloggerSelected",
          url: "/today",
        });
      }
    }
  } catch (pushErr) {
    reportError("push.assignment_roll_failed", pushErr, { groupId, assignmentId: assignment.id });
  }

  return assignment;
}

export async function checkAndUnlockAchievement(userId: string, achievementId: string, groupId: string = "global"): Promise<boolean> {
  try {
    const existing = await db.unlockedAchievement.findUnique({
      where: {
        userId_achievementId_groupId: {
          userId,
          achievementId,
          groupId,
        },
      },
    });

    if (!existing) {
      await db.unlockedAchievement.create({
        data: {
          userId,
          achievementId,
          groupId,
        },
      });
      return true;
    }
    return false;
  } catch (err) {
    reportError("achievement.unlock_failed", err, { userId, achievementId, groupId });
    return false;
  }
}
