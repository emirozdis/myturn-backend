import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AUTO_PASS_LOCAL_MINUTE, getVlogCircadianState } from "@/lib/vlog-helpers";

async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 3) throw error;
    }
  }
  throw new Error("Assignment transition retry limit exceeded.");
}

export async function passCurrentAssignment(assignmentId: string, actorUserId: string, automatic = false) {
  return serializable(async (tx) => {
    const assignment = await tx.dailyAssignment.findUnique({
      where: { id: assignmentId },
      include: { group: { include: { members: true } } },
    });
    if (!assignment || assignment.userId !== actorUserId || assignment.group.isFrozen) return null;
    const circadian = getVlogCircadianState(assignment.group.timezone);
    const businessDate = circadian.businessDate;
    const currentLocalMinute = circadian.currentHour * 60 + circadian.currentMinute;
    if (!automatic && currentLocalMinute >= AUTO_PASS_LOCAL_MINUTE) return null;
    const activeUploads = await tx.activeUpload.count({
      where: { assignmentId, status: { in: ["INITIATED", "COMPLETING", "ASSEMBLED"] } },
    });
    if (activeUploads > 0) return null;

    const changed = await tx.dailyAssignment.updateMany({
      where: {
        id: assignmentId,
        userId: actorUserId,
        date: businessDate,
        status: "active",
        isPassed: false,
        isClaimed: false,
        ...(automatic ? {} : { isMandatory: false }),
        clips: { none: {} },
      },
      data: {
        isPassed: true,
        passedByUserId: automatic || assignment.isMandatory ? null : actorUserId,
      },
    });
    if (changed.count !== 1) return null;
    return tx.dailyAssignment.findUnique({
      where: { id: assignmentId },
      include: { group: { include: { members: true } } },
    });
  });
}

export async function claimCurrentAssignment(assignmentId: string, claimantUserId: string) {
  return serializable(async (tx) => {
    const assignment = await tx.dailyAssignment.findUnique({
      where: { id: assignmentId },
      include: { group: { include: { members: true } } },
    });
    if (!assignment || assignment.group.isFrozen || !assignment.group.members.some((member) => member.userId === claimantUserId)) return null;
    const businessDate = getVlogCircadianState(assignment.group.timezone).businessDate;
    const activeUploads = await tx.activeUpload.count({
      where: { assignmentId, status: { in: ["INITIATED", "COMPLETING", "ASSEMBLED"] } },
    });
    if (activeUploads > 0) return null;

    const changed = await tx.dailyAssignment.updateMany({
      where: {
        id: assignmentId,
        date: businessDate,
        status: "active",
        isPassed: true,
        isClaimed: false,
        clips: { none: {} },
      },
      data: { isClaimed: true, isPassed: false, userId: claimantUserId },
    });
    if (changed.count !== 1) return null;
    return tx.dailyAssignment.findUnique({
      where: { id: assignmentId },
      include: { group: { include: { members: true } } },
    });
  });
}
