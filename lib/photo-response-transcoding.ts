import { db } from "@/lib/db";
import { startTranscodeJob } from "@/lib/transcoder";

export async function dispatchPhotoResponseTranscode(responseId: string): Promise<void> {
  let response = await db.photoResponse.findUnique({ where: { id: responseId } });
  if (!response || response.mediaType === "photo") return;
  const needsPosterBackfill = response.transcodeStatus === "COMPLETED"
    && Boolean(response.hlsUrl)
    && (!response.thumbnailUrl || !response.thumbnailBlurUrl);
  if (response.transcodeStatus === "COMPLETED" && !needsPosterBackfill) return;
  if (response.transcodeJobId && response.transcodeJobId !== response.id) return;

  const staleDispatch = new Date(Date.now() - 5 * 60_000);
  const staleProcessing = new Date(Date.now() - 30 * 60_000);
  const claimed = needsPosterBackfill
    ? await db.photoResponse.updateMany({
        where: {
          id: responseId,
          transcodeStatus: "COMPLETED",
          transcodeAttempts: { lt: 3 },
          OR: [{ thumbnailUrl: null }, { thumbnailBlurUrl: null }],
          AND: [{ OR: [{ transcodeDispatchAt: null }, { transcodeDispatchAt: { lt: staleProcessing } }] }],
        },
        data: { transcodeDispatchAt: new Date(), transcodeJobId: responseId },
      })
    : await db.photoResponse.updateMany({
        where: {
          id: responseId,
          transcodeAttempts: { lt: 3 },
          OR: [{ transcodeJobId: null }, { transcodeJobId: responseId }],
          AND: [{ OR: [
            { transcodeStatus: { in: ["QUEUED", "FAILED"] } },
            { transcodeStatus: "DISPATCHING", transcodeDispatchAt: { lt: staleDispatch } },
            { transcodeStatus: "PROCESSING", transcodeDispatchAt: { lt: staleProcessing } },
          ] }],
        },
        data: {
          transcodeStatus: "DISPATCHING",
          transcodeDispatchAt: new Date(),
          transcodeJobId: responseId,
        },
      });
  if (claimed.count !== 1) return;

  response = await db.photoResponse.findUnique({ where: { id: responseId } });
  if (!response) return;
  const sourceDir = response.imageUrl.substring(0, response.imageUrl.lastIndexOf("/"));
  const outputHlsDir = sourceDir
    ? `${sourceDir}/${response.id}_hls`
    : `${response.id}_hls`;
  const sourceBase = response.imageUrl.replace(/\.[^/.]+$/, "");
  const thumbnailUrl = `${sourceBase}-thumb.jpg`;
  const thumbnailBlurUrl = `${sourceBase}-thumb-blur.jpg`;

  try {
    const transcodeJobId = await startTranscodeJob(
      response.id,
      response.imageUrl,
      outputHlsDir,
      thumbnailUrl,
      thumbnailBlurUrl,
      "user",
      undefined,
      // clipId keeps this request compatible with transcoder versions that
      // predate typed response jobs; photoResponseId lets our webhook route it.
      { clipId: response.id, photoResponseId: response.id },
    );
    if (!needsPosterBackfill) {
      await db.photoResponse.updateMany({
        where: { id: response.id, transcodeJobId, transcodeStatus: "DISPATCHING" },
        data: { transcodeStatus: "PROCESSING" },
      });
    }
  } catch (error) {
    if (needsPosterBackfill) {
      await db.photoResponse.updateMany({
        where: { id: response.id, transcodeStatus: "COMPLETED", transcodeJobId: response.id },
        data: { transcodeDispatchAt: null },
      });
    } else {
      await db.photoResponse.updateMany({
        where: { id: response.id, transcodeStatus: "DISPATCHING", transcodeJobId: response.id },
        data: { transcodeStatus: "QUEUED" },
      });
    }
    throw new Error("Video response supervisor registration failed.", { cause: error });
  }
}
