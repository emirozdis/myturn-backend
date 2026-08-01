import { Prisma } from "@prisma/client";

type PublicationCandidate = {
  id: string;
  transcodeStatus: string;
  transcodeReadyAt: Date | null;
};

export function consecutiveReadyClipIds(clips: PublicationCandidate[]): string[] {
  const publishable: string[] = [];

  for (const clip of clips) {
    // A permanently failed clip can no longer be published, so it must not
    // deadlock every future upload in this queue.
    if (["COMPLETED", "FAILED_PERMANENTLY"].includes(clip.transcodeStatus)) continue;
    if (!clip.transcodeReadyAt) break;
    publishable.push(clip.id);
  }

  return publishable;
}

export async function publishReadyClipsInOrder(
  tx: Prisma.TransactionClient,
  userId: string,
  groupId: string,
): Promise<string[]> {
  // Completion webhooks for this queue may arrive concurrently. The
  // transaction-scoped lock prevents both callbacks from observing an
  // incomplete view and leaving a ready clip stranded.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${groupId}`}, 0))`;

  const clips = await tx.clip.findMany({
    where: {
      userId,
      groupId,
      mediaType: { not: "photo" },
      finalizedAt: { not: null },
    },
    orderBy: [{ finalizedAt: "asc" }, { recordedAt: "asc" }, { id: "asc" }],
    select: { id: true, transcodeStatus: true, transcodeReadyAt: true },
  });
  const clipIds = consecutiveReadyClipIds(clips);
  if (!clipIds.length) return [];

  const published = await tx.clip.updateMany({
    where: { id: { in: clipIds }, transcodeStatus: { not: "COMPLETED" }, transcodeReadyAt: { not: null } },
    data: { transcodeStatus: "COMPLETED" },
  });
  if (published.count !== clipIds.length) {
    throw new Error("The ordered clip publication queue changed unexpectedly.");
  }

  await tx.activeUpload.updateMany({
    where: {
      clipId: { in: clipIds },
      status: { in: ["COMPLETING", "ASSEMBLED", "FINALIZED"] },
    },
    data: { status: "PUBLISHED" },
  });

  return clipIds;
}
