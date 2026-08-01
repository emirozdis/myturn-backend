import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { r2 } from "@/lib/r2";
import { calculateGroupLevel, getVibeArchetype } from "@/lib/vibe";
import { startTranscodeJob } from "@/lib/transcoder";
import { sendPushToUser } from "@/lib/push-server";
import { getBusinessClock } from "@/lib/business-time";
import { reportError } from "@/lib/observability/logger";
import { parseRecordingMetadata, type RecordingComposition } from "@/lib/recording-composition";

const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

function secondsUntilMidnight(timeZone: string) {
  const clock = getBusinessClock(new Date(), timeZone);
  return 86_400 - (clock.hour * 3600 + clock.minute * 60 + clock.second);
}

type FinalizationResult = {
  success?: true;
  error?: string;
  logId?: string;
  alreadyFinalized?: boolean;
  newlyUnlocked?: string[];
  groupLevelUp?: { from: number; to: number } | null;
  individualTierUp?: { from: string; to: string } | null;
};

function clipMetadata(clip: { metadata: unknown; metadataJson: unknown }) {
  return parseRecordingMetadata(clip.metadataJson ?? clip.metadata);
}

function isPhotoClip(clip: { mediaType: string; metadata: unknown; metadataJson: unknown }) {
  if (clip.mediaType === "photo") return true;
  return clipMetadata(clip)?.mediaType === "photo";
}

async function unlock(tx: Prisma.TransactionClient, userId: string, achievementId: string, groupId: string | null = null) {
  const created = await tx.unlockedAchievement.createMany({
    data: [{
      userId,
      achievementId,
      groupId,
    }],
    skipDuplicates: true,
  });
  return created.count === 1;
}

async function inSerializableTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 3) throw error;
    }
  }
  throw new Error("Transaction retry limit exceeded.");
}

async function dispatchTranscode(clipId: string) {
  let clip = await db.clip.findUnique({ where: { id: clipId } });
  if (!clip || clip.mediaType === "photo" || clip.transcodeStatus === "COMPLETED" || clip.transcodeReadyAt) return;
  if (clip.transcodeJobId && clip.transcodeJobId !== clip.id) return;
  if (clip.transcodeJobId && clip.transcodeStatus === "PROCESSING") return;

  const staleDispatch = new Date(Date.now() - 5 * 60_000);
  const claimed = await db.clip.updateMany({
    where: {
      id: clipId,
      OR: [{ transcodeJobId: null }, { transcodeJobId: clipId }],
      AND: [{ OR: [
        { transcodeStatus: { in: ["QUEUED", "FAILED"] } },
        { transcodeStatus: "DISPATCHING", transcodeDispatchAt: { lt: staleDispatch } },
      ] }],
    },
    data: { transcodeStatus: "DISPATCHING", transcodeDispatchAt: new Date(), transcodeJobId: clipId },
  });
  if (claimed.count !== 1) return;

  clip = await db.clip.findUnique({ where: { id: clipId } });
  if (!clip) return;
  const hlsDir = clip.videoUrl.substring(0, clip.videoUrl.lastIndexOf("/"));
  const outputHlsPath = hlsDir ? `${hlsDir}/${clip.id}_hls` : `${clip.id}_hls`;
  let facingMode: "user" | "environment" = "user";
  let composition: RecordingComposition | undefined;
  const metadata = clipMetadata(clip);
  if (metadata?.facingMode === "environment") facingMode = "environment";
  if (
    metadata?.composition
    && typeof metadata.composition === "object"
    && "version" in metadata.composition
    && metadata.composition.version === 1
  ) {
    composition = metadata.composition as RecordingComposition;
  }

  try {
    const transcodeJobId = await startTranscodeJob(
      clip.id,
      clip.videoUrl,
      outputHlsPath,
      clip.thumbnailUrl || undefined,
      clip.thumbnailBlurUrl || undefined,
      facingMode,
      composition,
    );
    await db.clip.updateMany({
      where: { id: clip.id, transcodeJobId, transcodeStatus: "DISPATCHING" },
      data: { transcodeStatus: "PROCESSING" },
    });
  } catch (error) {
    await db.clip.updateMany({
      where: { id: clip.id, transcodeStatus: "DISPATCHING", transcodeJobId: clip.id },
      data: { transcodeStatus: "FAILED" },
    });
    throw new Error("Video encoding initiation failed.", { cause: error });
  }
}

export async function finalizeUploadedClip(
  clipId: string,
  systemOverride = false,
  sessionUserId?: string,
): Promise<FinalizationResult> {
  try {
    const clip = await db.clip.findUnique({ where: { id: clipId }, include: { assignment: true, group: true } });
    if (!clip) return { error: "Clip not found." };
    if (!systemOverride && clip.userId !== sessionUserId) return { error: "Unauthorized." };

    const isPhoto = isPhotoClip(clip);
    if (!clip.finalizedAt) {
      const object = await r2.head("vlogs", clip.videoUrl);
      const objectBytes = Number(object.ContentLength || 0);
      const maxBytes = isPhoto ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
      const type = object.ContentType || "";
      if (objectBytes < 1 || objectBytes > maxBytes || (isPhoto ? !type.startsWith("image/") : !(type.startsWith("video/") || type === "application/octet-stream"))) {
        return { error: "Uploaded media failed server validation." };
      }
    }

    const reward = await inSerializableTransaction(async (tx) => {
      const claim = await tx.clip.updateMany({
        where: { id: clip.id, finalizedAt: null },
        data: { finalizedAt: new Date(), transcodeStatus: isPhoto ? "COMPLETED" : "QUEUED" },
      });
      if (claim.count !== 1) return { claimed: false, newlyUnlocked: [] as string[], groupLevelUp: null, individualTierUp: null };

      const first = await tx.dailyAssignment.updateMany({
        where: { id: clip.assignmentId, status: "active" },
        data: { status: "completed" },
      });
      const isFirstClip = first.count === 1;
      const member = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId: clip.groupId, userId: clip.userId } },
      });
      if (!member) throw new Error("Uploader is no longer a group member.");

      let individualXpGain = 100;
      let groupXpGain = 100;
      const age = Date.now() - clip.assignment.createdAt.getTime();
      if (age < 2 * 60 * 60 * 1000) {
        individualXpGain += 50;
        groupXpGain += 50;
      }

      const newlyUnlocked: string[] = [];
      if (secondsUntilMidnight(clip.group.timezone) < 3600 && member.streak >= 10) {
        individualXpGain += 150;
        groupXpGain += 150;
        if (await unlock(tx, clip.userId, "the-savior", clip.groupId)) newlyUnlocked.push("the-savior");
      }
      if (age < 30 * 60 * 1000 && await unlock(tx, clip.userId, "zero-hour", clip.groupId)) newlyUnlocked.push("zero-hour");
      if (clip.assignment.isVolunteer) {
        individualXpGain = Math.floor(individualXpGain * 1.5);
        groupXpGain = Math.floor(groupXpGain * 1.5);
      }

      const updatedMember = await tx.groupMember.update({
        where: { id: member.id },
        data: {
          xp: { increment: individualXpGain },
          streak: isFirstClip ? { increment: 1 } : undefined,
          lastActiveAt: new Date(),
        },
      });
      const beforeArchetype = getVibeArchetype(updatedMember.xp - individualXpGain);
      const afterArchetype = getVibeArchetype(updatedMember.xp);
      const individualTierUp = beforeArchetype !== afterArchetype ? { from: beforeArchetype, to: afterArchetype } : null;
      if (updatedMember.streak >= 5 && await unlock(tx, clip.userId, "on-duty", clip.groupId)) newlyUnlocked.push("on-duty");
      if (updatedMember.streak >= 15 && await unlock(tx, clip.userId, "the-guardian", clip.groupId)) newlyUnlocked.push("the-guardian");

      const updatedGroup = await tx.group.update({ where: { id: clip.groupId }, data: { xp: { increment: groupXpGain } } });
      const nextLevel = calculateGroupLevel(updatedGroup.xp);
      const groupLevelUp = nextLevel > updatedGroup.level ? { from: updatedGroup.level, to: nextLevel } : null;
      if (nextLevel !== updatedGroup.level) await tx.group.update({ where: { id: clip.groupId }, data: { level: nextLevel } });

      if (isFirstClip && clip.assignment.isVolunteer) {
        if (await unlock(tx, clip.userId, "the-tribute")) newlyUnlocked.push("the-tribute");
        const volunteerCount = await tx.dailyAssignment.count({ where: { userId: clip.userId, isVolunteer: true, status: "completed" } });
        if (volunteerCount >= 5 && await unlock(tx, clip.userId, "the-altruist")) newlyUnlocked.push("the-altruist");
      }

      const clipsCount = await tx.clip.count({ where: { userId: clip.userId } });
      if (clipsCount >= 50 && await unlock(tx, clip.userId, "silver-screen")) newlyUnlocked.push("silver-screen");
      if (clipsCount >= 150 && await unlock(tx, clip.userId, "gold-standard")) newlyUnlocked.push("gold-standard");
      const localHour = getBusinessClock(new Date(), clip.group.timezone).hour;
      if (localHour >= 1 && localHour < 5 && await unlock(tx, clip.userId, "night-owl", clip.groupId)) newlyUnlocked.push("night-owl");

      return { claimed: true, newlyUnlocked, groupLevelUp, individualTierUp };
    });

    if (!isPhoto) await dispatchTranscode(clip.id);

    if (isPhoto && reward.claimed) {
      const [poster, members] = await Promise.all([
        db.profile.findUnique({ where: { id: clip.userId }, select: { name: true, handle: true } }),
        db.groupMember.findMany({ where: { groupId: clip.groupId }, select: { userId: true } }),
      ]);
      const posterName = poster?.name || (poster?.handle ? `@${poster.handle}` : undefined);
      await Promise.allSettled(members.map((member) => sendPushToUser(member.userId, member.userId === clip.userId
        ? { category: "posts", key: "ownPhotoReady", deepLink: { screen: "today", groupId: clip.groupId, clipId: clip.id } }
        : { category: "posts", key: "newPhotoReady", vars: { actor: posterName, group: clip.group.name }, deepLink: { screen: "today", groupId: clip.groupId, clipId: clip.id } })));
    }

    return {
      success: true,
      alreadyFinalized: !reward.claimed,
      newlyUnlocked: reward.newlyUnlocked,
      groupLevelUp: reward.groupLevelUp,
      individualTierUp: reward.individualTierUp,
    };
  } catch (error: unknown) {
    const logId = reportError("upload.finalization_failed", error, { clipId });
    return { error: "Failed to process upload completion.", logId };
  }
}
