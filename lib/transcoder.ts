import { db } from "@/lib/db";
import { logicalUploadKey } from "@/lib/upload-source";
import { r2 } from "@/lib/r2";
import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createHmac, randomUUID } from "crypto";
import { logInfo, reportError, reportWarning } from "@/lib/observability/logger";
import type { RecordingComposition } from "@/lib/recording-composition";

const SUPERVISOR_URL = process.env.TRANSCODER_SUPERVISOR_URL || "";
const SUPERVISOR_SECRET = process.env.SUPERVISOR_MISSION_SECRET || "";
const NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "https://myturn.app";
const R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || "vlogs";
const IS_SINGLE_BUCKET = !!process.env.CLOUDFLARE_R2_BUCKET_NAME;

/**
 * Maps database relative keys to physical R2 keys based on 
 * single-bucket virtualization settings.
 */
function getPhysicalKey(key: string): string {
  if (IS_SINGLE_BUCKET) {
    const cleanKey = key.startsWith("/") ? key.substring(1) : key;
    return `vlogs/${cleanKey}`;
  }
  return key;
}

export function runFfmpeg(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

export async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 3, baseDelayMs = 2000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * attempt;
        reportWarning(
          "transcoder.retry_scheduled",
          err,
          { operation: label, attempt, maxAttempts, delayMs: delay },
          "Transcoder operation failed; retry scheduled",
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastErr;
}

export async function startTranscodeJob(
  clipId: string,
  sourceKey: string,
  outputHlsDir: string,
  thumbnailKey?: string,
  blurKey?: string,
  facingMode: "user" | "environment" = "user",
  composition?: RecordingComposition,
  callbackPayload?: Record<string, string>,
): Promise<string> {
  if (!SUPERVISOR_URL || !SUPERVISOR_SECRET || SUPERVISOR_SECRET.length < 32) {
    throw new Error("Transcoder supervisor mission delivery is not configured.");
  }

  logInfo("transcoder.dispatch_started", { clipId }, "Transcode dispatch started");

  const webhookUrl = `${NEXT_PUBLIC_APP_URL}/api/webhooks/transcoder`;

  const payload = {
    jobId: clipId,
    bucket: R2_BUCKET_NAME,
    sourceKey: getPhysicalKey(sourceKey),
    outputDirKey: getPhysicalKey(outputHlsDir),
    thumbnailKey: thumbnailKey ? getPhysicalKey(thumbnailKey) : undefined,
    blurKey: blurKey ? getPhysicalKey(blurKey) : undefined,
    webhookUrl,
    webhookPayload: JSON.stringify(callbackPayload || { clipId }),
    options: {
      generateHls: true,
      generateThumbnail: !!thumbnailKey,
      generateBlur: !!blurKey,
      facingMode,
      thumbnailTime: 0.5,
      composition,
    }
  };

  const missionBody = JSON.stringify({
    externalId: clipId,
    entityType: callbackPayload?.photoResponseId ? "photoResponse" : "clip",
    priority: 0,
    payload,
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const requestId = randomUUID();
  const signature = createHmac("sha256", SUPERVISOR_SECRET)
    .update(`${timestamp}.${requestId}.${missionBody}`)
    .digest("hex");
  const endpoint = new URL("/v1/missions", SUPERVISOR_URL).toString();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-supervisor-request-id": requestId,
      "x-supervisor-timestamp": timestamp,
      "x-supervisor-signature": `sha256=${signature}`,
    },
    body: missionBody,
    signal: AbortSignal.timeout(10_000),
  });
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`Supervisor mission registration failed with HTTP ${res.status}: ${responseText.slice(0, 1_000)}`);
  }
  let responseData: { status?: string; mission?: { externalId?: string } };
  try { responseData = JSON.parse(responseText) as typeof responseData; }
  catch { throw new Error("Supervisor returned invalid JSON"); }
  if (responseData.status !== "accepted" || responseData.mission?.externalId !== clipId) {
    throw new Error("Supervisor returned an invalid or mismatched mission acknowledgement");
  }

  logInfo(
    "transcoder.dispatch_completed",
    { clipId, transcodeJobId: clipId, supervisorRequestId: requestId },
    "Transcode mission durably registered with the Vast supervisor",
  );
  
  return clipId;
}

export async function generateMissingThumbnails(
  clipId: string
): Promise<{ thumbnailUrl: string; thumbnailBlurUrl: string } | null> {
  try {
    const clip = await db.clip.findUnique({ where: { id: clipId } });
    if (!clip) return null;
    const upload = await db.activeUpload.findUnique({ where: { clipId }, select: { key: true } });
    if (!upload) return null;
    const sourceKey = logicalUploadKey(upload.key);

    const needsThumb = !clip.thumbnailUrl || clip.thumbnailUrl === "" || clip.thumbnailUrl.includes("fallback");
    const needsBlur = !clip.thumbnailBlurUrl || clip.thumbnailBlurUrl === "";

    if (!needsThumb && !needsBlur) {
      return {
        thumbnailUrl: clip.thumbnailUrl,
        thumbnailBlurUrl: clip.thumbnailBlurUrl || "",
      };
    }

    let buffer: Buffer;
    try {
      buffer = await r2.download("vlogs", sourceKey);
    } catch (err: unknown) {
      throw new Error(`Failed to download source video for clip ${clipId}: ${err instanceof Error ? err.message : "Unknown storage error"}`);
    }

    const workDir = path.join(os.tmpdir(), `myturn_thumb_${clipId}`);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(workDir, { recursive: true });

    const inputPath = path.join(workDir, "input.mp4");
    await fs.writeFile(inputPath, buffer);

    const dirName = sourceKey.substring(0, sourceKey.lastIndexOf("/"));
    const fileId = randomUUID();

    let currentThumb = clip.thumbnailUrl;
    let currentBlur = clip.thumbnailBlurUrl;
    let updated = false;

    try {
      if (needsThumb) {
        const thumbLocalPath = path.join(workDir, "thumb.jpg");
        await runFfmpeg([
          "-y", "-fflags", "+igndts", "-r", "30", "-i", inputPath,
          "-ss", "0.5", "-vframes", "1", "-q:v", "2", thumbLocalPath,
        ], 30_000);
        const thumbBuf = await fs.readFile(thumbLocalPath);
        const thumbDest = dirName ? `${dirName}/${fileId}-thumb.jpg` : `${fileId}-thumb.jpg`;
        await r2.upload("vlogs", thumbDest, thumbBuf, "image/jpeg");
        currentThumb = thumbDest;
        updated = true;
      }

      if (needsBlur) {
        const blurLocalPath = path.join(workDir, "thumb-blur.jpg");
        await runFfmpeg([
          "-y", "-fflags", "+igndts", "-r", "30", "-i", inputPath,
          "-ss", "0.5", "-vf", "scale=80:142", "-vframes", "1", "-q:v", "15", blurLocalPath,
        ], 30_000);
        const blurBuf = await fs.readFile(blurLocalPath);
        const blurDest = dirName ? `${dirName}/${fileId}-thumb-blur.jpg` : `${fileId}-thumb-blur.jpg`;
        await r2.upload("vlogs", blurDest, blurBuf, "image/jpeg");
        currentBlur = blurDest;
        updated = true;
      }
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    if (updated) {
      await db.clip.update({
        where: { id: clipId },
        data: { thumbnailUrl: currentThumb, thumbnailBlurUrl: currentBlur },
      });
    }

    return { thumbnailUrl: currentThumb, thumbnailBlurUrl: currentBlur || "" };
  } catch (err) {
    reportError("transcoder.thumbnail_generation_failed", err, { clipId });
    return null;
  }
}
