// ./lib/archiver.ts
import { db } from "@/lib/db";
import { r2 } from "@/lib/r2";
import { b2 } from "@/lib/b2";
import { logInfo, reportError, reportWarning } from "@/lib/observability/logger";
import { runBackgroundJob } from "@/lib/observability/background-job";

type StorageTier = "hot" | "cold";

function isManagedStorageKey(value: string | null | undefined): value is string {
  return Boolean(
    value &&
    !value.startsWith("http://") &&
    !value.startsWith("https://") &&
    !value.startsWith("data:") &&
    !value.startsWith("/"),
  );
}

function storageTiersForClip(storageTier: string): StorageTier[] {
  if (storageTier === "COLD" || storageTier === "PRUNED") return ["cold"];
  if (storageTier === "MIGRATING") return ["hot", "cold"];
  return ["hot"];
}

function getContentType(filename: string) {
  if (filename.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (filename.endsWith('.ts')) return 'video/MP2T';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
  if (filename.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

export async function archiveClip(clipId: string) {
  const clip = await db.clip.findUnique({ 
    where: { id: clipId },
    include: { photoResponses: true }
  });
  
  if (!clip || clip.transcodeStatus !== "COMPLETED" || !clip.hlsUrl) {
    throw new Error("Clip not ready for archival or missing HLS URL.");
  }

  const hlsDir = clip.hlsUrl.substring(0, clip.hlsUrl.lastIndexOf("/"));
  
  logInfo("archive.discovery_started", { clipId }, "Discovering clip assets for archival");
  const hlsKeys = await r2.listObjects("vlogs", `${hlsDir}/`);

  const assets = [clip.thumbnailUrl];
  if (clip.thumbnailBlurUrl && clip.thumbnailBlurUrl !== clip.thumbnailUrl) {
    assets.push(clip.thumbnailBlurUrl);
  }
  for (const pr of clip.photoResponses) {
    assets.push(pr.imageUrl);
    if (pr.thumbnailUrl) assets.push(pr.thumbnailUrl);
    if (pr.thumbnailBlurUrl && pr.thumbnailBlurUrl !== pr.thumbnailUrl) assets.push(pr.thumbnailBlurUrl);
  }
  if (!hlsKeys.includes(clip.videoUrl)) {
    assets.push(clip.videoUrl);
  }

  logInfo(
    "archive.transfer_started",
    { clipId, hlsObjectCount: hlsKeys.length, assetCount: assets.length },
    "Transferring clip assets to cold storage",
  );
  
  const responseHlsKeys: string[] = [];
  for (const response of clip.photoResponses) {
    if (!isManagedStorageKey(response.hlsUrl) || !response.hlsUrl.includes("/")) continue;
    const responseHlsDir = response.hlsUrl.substring(0, response.hlsUrl.lastIndexOf("/"));
    responseHlsKeys.push(...await r2.listObjects("vlogs", `${responseHlsDir}/`));
  }

  const allKeysToMove = Array.from(new Set([...hlsKeys, ...responseHlsKeys, ...assets]));
  for (const key of allKeysToMove) {
    const buf = await r2.download("vlogs", key);
    await b2.upload("vlogs", key, buf, getContentType(key));
  }

  await db.clip.update({
    where: { id: clip.id },
    data: { storageTier: "COLD", archivedAt: new Date() }
  });

  await r2.deleteObjects("vlogs", allKeysToMove);
  logInfo("archive.completed", { clipId, objectCount: allKeysToMove.length }, "Clip archival completed");
}

export async function pruneArchivedClips() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const clips = await db.clip.findMany({
    where: { storageTier: "COLD", recordedAt: { lt: thirtyDaysAgo } }
  });
  
  for (const clip of clips) {
    if (!clip.hlsUrl) continue;
    
    logInfo("archive.prune_started", { clipId: clip.id }, "Pruning archived high-resolution stream");
    const hlsDir = clip.hlsUrl.substring(0, clip.hlsUrl.lastIndexOf("/"));
    
    try {
      const masterBuf = await b2.download("vlogs", clip.hlsUrl);
      let masterTxt = masterBuf.toString('utf-8');
      
      // Strip out stream_0 references
      masterTxt = masterTxt.replace(/#EXT-X-STREAM-INF:.*?\nstream_0\/playlist\.m3u8\n?/g, '');
      await b2.upload("vlogs", clip.hlsUrl, Buffer.from(masterTxt), 'application/vnd.apple.mpegurl');
      
      const allB2Keys = await b2.listObjects("vlogs", `${hlsDir}/stream_0/`);
      await b2.deleteObjects("vlogs", allB2Keys);

      await db.clip.update({ where: { id: clip.id }, data: { storageTier: "PRUNED" } });
    } catch (error) {
      reportError("archive.prune_failed", error, { clipId: clip.id });
    }
  }
}

export async function deleteExpiredClips() {
  const expirationDate = new Date(Date.now() - 180 * 24 * 3600 * 1000);
  const clips = await db.clip.findMany({
    where: { recordedAt: { lt: expirationDate } },
    include: { photoResponses: true }
  });

  for (const clip of clips) {
    logInfo("archive.expired_clip_deletion_started", { clipId: clip.id }, "Deleting expired clip");

    const hotKeys = new Set<string>();
    const coldKeys = new Set<string>();
    const directAssets = [
      clip.thumbnailUrl,
      clip.thumbnailBlurUrl,
      clip.videoUrl,
      ...clip.photoResponses.map((response) => response.imageUrl),
      ...clip.photoResponses.map((response) => response.thumbnailUrl),
      ...clip.photoResponses.map((response) => response.thumbnailBlurUrl),
    ].filter(isManagedStorageKey);

    for (const tier of storageTiersForClip(clip.storageTier)) {
      const keys = tier === "cold" ? coldKeys : hotKeys;
      directAssets.forEach((key) => keys.add(key));

      if (isManagedStorageKey(clip.hlsUrl) && clip.hlsUrl.includes("/")) {
        const hlsDir = clip.hlsUrl.substring(0, clip.hlsUrl.lastIndexOf("/"));
        const hlsKeys = tier === "cold"
          ? await b2.listObjects("vlogs", `${hlsDir}/`)
          : await r2.listObjects("vlogs", `${hlsDir}/`);
        hlsKeys.forEach((key) => keys.add(key));
      }
      for (const response of clip.photoResponses) {
        if (!isManagedStorageKey(response.hlsUrl) || !response.hlsUrl.includes("/")) continue;
        const responseHlsDir = response.hlsUrl.substring(0, response.hlsUrl.lastIndexOf("/"));
        const responseHlsKeys = tier === "cold"
          ? await b2.listObjects("vlogs", `${responseHlsDir}/`)
          : await r2.listObjects("vlogs", `${responseHlsDir}/`);
        responseHlsKeys.forEach((key) => keys.add(key));
      }
    }

    // Delete managed objects before the database row. If storage cleanup fails,
    // retain the row so the next worker pass can retry without orphaning media.
    await Promise.all([
      hotKeys.size ? r2.deleteObjects("vlogs", Array.from(hotKeys)) : Promise.resolve(),
      coldKeys.size ? b2.deleteObjects("vlogs", Array.from(coldKeys)) : Promise.resolve(),
    ]).catch((error) => {
      reportWarning("archive.expired_assets_cleanup_failed", error, { clipId: clip.id });
      throw error;
    });

    await db.clip.delete({ where: { id: clip.id } });
  }
}

let isArchiving = false;
const archiverState = globalThis as typeof globalThis & { __archiver_initialized?: boolean };

export async function runArchiverIteration(maxClips = Number.POSITIVE_INFINITY): Promise<Record<string, number>> {
  if (isArchiving) return { skippedCount: 1 };

  let archivedClipCount = 0;
  let failedClipCount = 0;
  try {
    isArchiving = true;
    const failedThisRun = new Set<string>();

    while (archivedClipCount + failedClipCount < maxClips) {
      const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000);

      const targetClip = await db.clip.findFirst({
        where: {
          id: { notIn: Array.from(failedThisRun) },
          storageTier: { in: ["HOT", "FAILED_MIGRATION"] },
          transcodeStatus: "COMPLETED",
          assignment: { date: { lte: twoDaysAgo } },
        },
        orderBy: { recordedAt: "asc" },
      });

      if (!targetClip) break;

      await db.clip.update({
        where: { id: targetClip.id },
        data: { storageTier: "MIGRATING" },
      });

      logInfo("archive.candidate_claimed", { clipId: targetClip.id }, "Archival candidate claimed");

      try {
        await archiveClip(targetClip.id);
        archivedClipCount++;
        logInfo("archive.candidate_completed", { clipId: targetClip.id }, "Archival candidate moved to cold storage");
      } catch (error) {
        failedClipCount++;
        reportError("archive.candidate_failed", error, { clipId: targetClip.id });
        failedThisRun.add(targetClip.id);

        await db.clip.update({
          where: { id: targetClip.id },
          data: { storageTier: "FAILED_MIGRATION" },
        });
      }
    }

    await pruneArchivedClips();
    await deleteExpiredClips();
    return { archivedClipCount, failedClipCount, skippedCount: 0 };
  } finally {
    isArchiving = false;
  }
}

export async function startArchiverWorker() {
  if (archiverState.__archiver_initialized) return;
  archiverState.__archiver_initialized = true;

  logInfo("archive.worker_initialized", {}, "Background archival worker initialized");
  
  try {
    await db.clip.updateMany({
      where: { storageTier: "MIGRATING" },
      data: { storageTier: "HOT" }
    });
  } catch (error) {
    reportError("archive.stuck_migrations_reset_failed", error);
  }

  setInterval(
    () => void runBackgroundJob("archive-worker-iteration", runArchiverIteration),
    15 * 60 * 1000,
  );
}
