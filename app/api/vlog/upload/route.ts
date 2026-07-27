import { randomUUID } from "crypto";
import { withApiHandler } from "@/lib/observability/api-handler";
import { AppError } from "@/lib/observability/errors";
import { reportWarning } from "@/lib/observability/logger";
import { NextRequest, NextResponse } from "next/server";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { r2, r2Client } from "@/lib/r2";
import { rateLimit } from "@/lib/rate-limit";
import { getLocalDateInTimezone, MIN_MEMBERS_FOR_DAILY_ASSIGNMENT } from "@/lib/vlog-helpers";
import { finalizeUploadedClip as completeUpload } from "@/lib/upload-finalization";
import { Prisma } from "@prisma/client";
import { validateRecordingMetadata } from "@/lib/recording-composition";

const BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || "vlogs";
const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_CHUNKS = 50;
const UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

class UploadInvariantError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function isStorageNotFound(error: unknown) {
  const storageError = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return storageError?.name === "NotFound" || storageError?.name === "NoSuchKey" || storageError?.$metadata?.httpStatusCode === 404;
}

async function listUploadParts(uploadId: string, key: string) {
  const response = await r2Client.send(new ListPartsCommand({ Bucket: BUCKET_NAME, Key: key, UploadId: uploadId }));
  return (response.Parts || []).slice().sort((a, b) => (a.PartNumber || 0) - (b.PartNumber || 0));
}

async function ownedUpload(userId: string, uploadId: string) {
  return db.activeUpload.findFirst({ where: { uploadId, userId }, include: { group: true } });
}

async function discardLegacyUpload(upload: { id: string; uploadId: string; key: string }) {
  await r2Client.send(new AbortMultipartUploadCommand({ Bucket: BUCKET_NAME, Key: upload.key, UploadId: upload.uploadId })).catch(() => {});
  await db.activeUpload.deleteMany({ where: { id: upload.id, status: "LEGACY_REJECTED" } });
}

async function GETHandler(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const uploadId = req.nextUrl.searchParams.get("uploadId");
  if (req.nextUrl.searchParams.get("action") !== "status" || !uploadId) {
    return NextResponse.json({ error: "Invalid status request." }, { status: 400 });
  }

  const upload = await ownedUpload(session.user.id, uploadId);
  if (!upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  if (upload.status === "LEGACY_REJECTED") {
    await discardLegacyUpload(upload);
    return NextResponse.json({ error: "This upload session must be restarted." }, { status: 410 });
  }
  if (upload.status !== "INITIATED") return NextResponse.json({ success: true, parts: [], status: upload.status, clipId: upload.clipId });
  if (upload.expiresAt <= new Date()) return NextResponse.json({ error: "Upload session expired." }, { status: 410 });

  const parts = await listUploadParts(upload.uploadId, upload.key);
  return NextResponse.json({ success: true, parts: parts.map((part) => ({ partNumber: part.PartNumber, etag: part.ETag, size: part.Size })) });
}

async function POSTHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action, groupId, assignmentId, location, caption, metadata, mediaType, uploadId, clipId, responseId } = body || {};

    if (action === "response-status") {
      if (typeof responseId !== "string") return NextResponse.json({ error: "Missing response ID." }, { status: 400 });
      const response = await db.photoResponse.findFirst({
        where: { id: responseId, userId: session.user.id },
        select: { id: true, clipId: true, transcodeStatus: true },
      });
      return response
        ? NextResponse.json({ success: true, response })
        : NextResponse.json({ error: "Response not found." }, { status: 404 });
    }

    if (action === "clip-status") {
      if (typeof clipId !== "string") return NextResponse.json({ error: "Missing clipId." }, { status: 400 });
      const clip = await db.clip.findFirst({
        where: { id: clipId, userId: session.user.id },
        select: { id: true, transcodeStatus: true, mediaType: true },
      });
      if (clip?.transcodeStatus === "COMPLETED") {
        await db.activeUpload.updateMany({
          where: { clipId: clip.id, userId: session.user.id, status: "FINALIZED" },
          data: { status: "PUBLISHED" },
        });
      }
      return clip
        ? NextResponse.json({ success: true, clip })
        : NextResponse.json({ error: "Clip not found." }, { status: 404 });
    }

    if (action === "status") {
      if (typeof uploadId !== "string") return NextResponse.json({ error: "Missing uploadId." }, { status: 400 });
      const upload = await ownedUpload(session.user.id, uploadId);
      if (!upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
      if (upload.status === "LEGACY_REJECTED") {
        await discardLegacyUpload(upload);
        return NextResponse.json({ error: "This upload session must be restarted." }, { status: 410 });
      }
      if (upload.status !== "INITIATED") return NextResponse.json({ success: true, parts: [], status: upload.status, clipId: upload.clipId });
      if (upload.expiresAt <= new Date()) return NextResponse.json({ error: "Upload session expired." }, { status: 410 });
      const parts = await listUploadParts(upload.uploadId, upload.key);
      return NextResponse.json({ success: true, parts: parts.map((part) => ({ partNumber: part.PartNumber, etag: part.ETag, size: part.Size })) });
    }

    if (action === "initiate") {
      const rl = await rateLimit(`initiate_upload_${session.user.id}`, 10, 60_000);
      if (!rl.success) return NextResponse.json({ error: "Too many upload attempts." }, { status: 429 });

      const expiredUploads = await db.activeUpload.findMany({
        where: { userId: session.user.id, status: { in: ["INITIATED", "LEGACY_REJECTED"] }, expiresAt: { lte: new Date() } },
        take: 10,
      });
      await Promise.allSettled(expiredUploads.map((upload) => r2Client.send(new AbortMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: upload.key,
        UploadId: upload.uploadId,
      }))));
      if (expiredUploads.length) {
        await db.activeUpload.deleteMany({ where: { id: { in: expiredUploads.map((upload) => upload.id) }, status: { in: ["INITIATED", "LEGACY_REJECTED"] } } });
      }
      const activeSessionCount = await db.activeUpload.count({
        where: { userId: session.user.id, status: { in: ["INITIATED", "COMPLETING", "ASSEMBLED"] }, expiresAt: { gt: new Date() } },
      });
      if (activeSessionCount >= 3) {
        return NextResponse.json({ error: "Too many active uploads. Finish or cancel one first." }, { status: 429 });
      }

      const resolvedMediaType = mediaType === "photo" ? "photo" : mediaType === "snippet" ? "snippet" : mediaType === "vlog" ? "vlog" : null;
      const expectedChunks = Number(body.totalChunks);
      const expectedBytesNumber = Number(body.totalBytes);
      const maxBytes = resolvedMediaType === "photo" ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
      if (!resolvedMediaType || !Number.isSafeInteger(expectedBytesNumber) || expectedBytesNumber < 1 || expectedBytesNumber > maxBytes) {
        return NextResponse.json({ error: "Invalid or oversized media." }, { status: 413 });
      }
      if (!Number.isInteger(expectedChunks) || expectedChunks < 1 || expectedChunks > MAX_CHUNKS || expectedChunks !== Math.ceil(expectedBytesNumber / CHUNK_SIZE)) {
        return NextResponse.json({ error: "Invalid multipart layout." }, { status: 400 });
      }
      if ((metadata && (typeof metadata !== "string" || metadata.length > 10_000)) || (location && (typeof location !== "string" || location.length > 200)) || (caption && (typeof caption !== "string" || caption.length > 500))) {
        return NextResponse.json({ error: "Upload metadata is too large." }, { status: 400 });
      }
      let validatedMetadata: ReturnType<typeof validateRecordingMetadata>;
      try {
        validatedMetadata = validateRecordingMetadata(metadata, expectedBytesNumber, resolvedMediaType);
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Upload metadata is invalid." }, { status: 400 });
      }
      if (typeof groupId !== "string" || typeof assignmentId !== "string") {
        return NextResponse.json({ error: "Missing group or assignment." }, { status: 400 });
      }

      const [assignment, memberCount] = await Promise.all([
        db.dailyAssignment.findFirst({
          where: {
            id: assignmentId,
            groupId,
            userId: session.user.id,
            group: { members: { some: { userId: session.user.id } } },
          },
          include: { group: true },
        }),
        db.groupMember.count({ where: { groupId } }),
      ]);
      if (!assignment || memberCount < MIN_MEMBERS_FOR_DAILY_ASSIGNMENT || assignment.group.isFrozen || assignment.isPassed || !["active", "completed"].includes(assignment.status)) {
        return NextResponse.json({ error: "This assignment is not uploadable." }, { status: 403 });
      }
      if (validatedMetadata.metadata?.prompt && assignment.activePrompt) {
        const catalogPrompt = await db.prompt.findUnique({
          where: { text: assignment.activePrompt },
          select: { id: true },
        });
        if (catalogPrompt) {
          validatedMetadata.metadata.promptId = catalogPrompt.id;
          validatedMetadata.serialized = JSON.stringify(validatedMetadata.metadata);
        }
      }
      const localDate = (await getLocalDateInTimezone(assignment.group.timezone)).toISOString().slice(0, 10);
      if (assignment.date.toISOString().slice(0, 10) !== localDate) {
        return NextResponse.json({ error: "This assignment is no longer current." }, { status: 403 });
      }

      const mediaId = randomUUID();
      const newClipId = randomUUID();
      const ext = resolvedMediaType === "photo" ? "jpg" : "mp4";
      const contentType = resolvedMediaType === "photo"
        ? "image/jpeg"
        : validatedMetadata.segmented
          ? "application/octet-stream"
          : "video/mp4";
      const rawKey = `${groupId}/${assignmentId}/${mediaId}-media.${ext}`;
      const physicalKey = process.env.CLOUDFLARE_R2_BUCKET_NAME ? `vlogs/${rawKey}` : rawKey;
      const initiated = await r2Client.send(new CreateMultipartUploadCommand({ Bucket: BUCKET_NAME, Key: physicalKey, ContentType: contentType }));
      if (!initiated.UploadId) throw new Error("Storage did not create an upload session.");
      const storageUploadId = initiated.UploadId;

      const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
      try {
        await db.$transaction(async (tx) => {
          const currentMemberCount = await tx.groupMember.count({ where: { groupId } });
          if (currentMemberCount < MIN_MEMBERS_FOR_DAILY_ASSIGNMENT) {
            throw new UploadInvariantError("At least two group members are required to vlog.", 409);
          }
          const currentAssignment = await tx.dailyAssignment.findFirst({
            where: {
              id: assignmentId,
              groupId,
              userId: session.user.id,
              isPassed: false,
              status: { in: ["active", "completed"] },
              group: { isFrozen: false, members: { some: { userId: session.user.id } } },
            },
            include: { group: { select: { timezone: true } } },
          });
          if (!currentAssignment) throw new UploadInvariantError("This assignment is not uploadable.", 409);
          const currentDate = await getLocalDateInTimezone(currentAssignment.group.timezone);
          if (currentAssignment.date.toISOString().slice(0, 10) !== currentDate.toISOString().slice(0, 10)) {
            throw new UploadInvariantError("This assignment is no longer current.", 409);
          }
          const activeUploads = await tx.activeUpload.count({
            where: { userId: session.user.id, status: { in: ["INITIATED", "COMPLETING", "ASSEMBLED"] }, expiresAt: { gt: new Date() } },
          });
          if (activeUploads >= 3) throw new UploadInvariantError("Too many active uploads. Finish or cancel one first.", 429);

          await tx.activeUpload.create({
            data: {
              uploadId: storageUploadId,
              key: physicalKey,
              clipId: newClipId,
              groupId,
              assignmentId,
              userId: session.user.id,
              mediaType: resolvedMediaType,
              contentType,
              expectedChunks,
              expectedBytes: BigInt(expectedBytesNumber),
              expiresAt,
              location: location || null,
              caption: caption || null,
              metadata: validatedMetadata.serialized,
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        await r2Client.send(new AbortMultipartUploadCommand({ Bucket: BUCKET_NAME, Key: physicalKey, UploadId: storageUploadId })).catch(() => {});
        if (error instanceof UploadInvariantError) {
          return NextResponse.json({ error: error.message }, { status: error.status });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
          return NextResponse.json({ error: "Assignment changed while upload started. Please retry." }, { status: 409 });
        }
        throw error;
      }

      const presignedUrls = await Promise.all(Array.from({ length: expectedChunks }, (_, index) => getSignedUrl(r2Client, new UploadPartCommand({
        Bucket: BUCKET_NAME,
        Key: physicalKey,
        UploadId: storageUploadId,
        PartNumber: index + 1,
      }), { expiresIn: UPLOAD_TTL_MS / 1000 })));

      return NextResponse.json({ success: true, uploadId: storageUploadId, key: physicalKey, clipId: newClipId, expiresAt, presignedUrls });
    }

    if (action === "complete") {
      if (typeof uploadId !== "string") return NextResponse.json({ error: "Missing uploadId." }, { status: 400 });
      let upload = await ownedUpload(session.user.id, uploadId);
      if (!upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
      if (upload.status === "LEGACY_REJECTED") {
        await discardLegacyUpload(upload);
        return NextResponse.json({ error: "This upload session must be restarted." }, { status: 410 });
      }

      let clip = await db.clip.findUnique({ where: { id: upload.clipId } });
      if (!clip) {
        if (upload.expiresAt <= new Date() && upload.status === "INITIATED") return NextResponse.json({ error: "Upload session expired." }, { status: 410 });

        if (upload.status === "INITIATED") {
          const claim = await db.activeUpload.updateMany({ where: { id: upload.id, status: "INITIATED" }, data: { status: "COMPLETING" } });
          if (claim.count !== 1) return NextResponse.json({ error: "Upload is already being completed." }, { status: 409 });
          upload = (await ownedUpload(session.user.id, uploadId))!;
        } else if (upload.status === "COMPLETING" && Date.now() - upload.updatedAt.getTime() < 5 * 60_000) {
          return NextResponse.json({ error: "Upload is already being completed." }, { status: 409 });
        }

        let assembled = upload.status === "ASSEMBLED" || upload.status === "FINALIZED";
        if (!assembled && upload.status === "COMPLETING") {
          try {
            const object = await r2.head("vlogs", upload.key.startsWith("vlogs/") ? upload.key.slice(6) : upload.key);
            assembled = Number(object.ContentLength) === Number(upload.expectedBytes) && object.ContentType === upload.contentType;
          } catch (error) {
            if (!isStorageNotFound(error)) throw error;
          }
        }

        if (!assembled) {
          const parts = await listUploadParts(upload.uploadId, upload.key);
          if (parts.length !== upload.expectedChunks || parts.some((part, index) => part.PartNumber !== index + 1 || !part.ETag || !Number.isFinite(part.Size))) {
            await db.activeUpload.update({ where: { id: upload.id }, data: { status: "INITIATED" } });
            return NextResponse.json({ error: "Multipart upload is incomplete." }, { status: 400 });
          }
          const totalBytes = parts.reduce((sum, part) => sum + Number(part.Size || 0), 0);
          const badPartSize = parts.some((part, index) => index < parts.length - 1 && Number(part.Size) < CHUNK_SIZE);
          if (badPartSize || totalBytes !== Number(upload.expectedBytes)) {
            await db.activeUpload.update({ where: { id: upload.id }, data: { status: "INITIATED" } });
            return NextResponse.json({ error: "Uploaded parts do not match the negotiated file." }, { status: 400 });
          }
          await r2Client.send(new CompleteMultipartUploadCommand({
            Bucket: BUCKET_NAME,
            Key: upload.key,
            UploadId: upload.uploadId,
            MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.PartNumber, ETag: part.ETag })) },
          }));
          await db.activeUpload.update({ where: { id: upload.id }, data: { status: "ASSEMBLED" } });
        }

        const dbVideoUrl = upload.key.startsWith("vlogs/") ? upload.key.slice(6) : upload.key;
        const isPhoto = upload.mediaType === "photo";
        const requestedPromptId = (() => {
          if (!upload.metadata) return null;
          try {
            const value = JSON.parse(upload.metadata)?.promptId;
            return typeof value === "string" && value ? value : null;
          } catch {
            return null;
          }
        })();
        const clipPromptId = requestedPromptId
          ? (await db.prompt.findUnique({
              where: { id: requestedPromptId },
              select: { id: true },
            }))?.id || null
          : null;
        clip = await db.clip.upsert({
          where: { id: upload.clipId },
          update: {},
          create: {
            id: upload.clipId,
            assignmentId: upload.assignmentId,
            userId: upload.userId,
            groupId: upload.groupId,
            videoUrl: dbVideoUrl,
            thumbnailUrl: isPhoto ? dbVideoUrl : dbVideoUrl.replace("-media.mp4", "-thumb.jpg"),
            thumbnailBlurUrl: isPhoto ? dbVideoUrl : dbVideoUrl.replace("-media.mp4", "-thumb-blur.jpg"),
            location: upload.location,
            transcodeStatus: "UPLOADING",
            mediaType: upload.mediaType,
            promptId: clipPromptId,
            metadata: upload.metadata,
          },
        });
      }

      const conclude = await completeUpload(clip.id, true);
      if (conclude.error) {
        throw new AppError({
          code: "UPLOAD_FINALIZATION_FAILED",
          status: 500,
          safeMessage: "Upload finalization failed.",
          cause: new Error(conclude.error),
          details: { clipId: clip.id },
        });
      }
      const refreshed = await db.clip.findUnique({ where: { id: clip.id } });
      const uploadStatus = refreshed?.transcodeStatus === "COMPLETED" ? "PUBLISHED" : "FINALIZED";
      await db.activeUpload.updateMany({
        where: {
          id: upload.id,
          status: { in: ["COMPLETING", "ASSEMBLED", "FINALIZED"] },
        },
        data: { status: uploadStatus },
      });
      const publicClip = refreshed
        ? {
            ...refreshed,
            videoUrl: refreshed.mediaType === "photo" ? refreshed.videoUrl : (refreshed.hlsUrl || ""),
          }
        : null;
      return NextResponse.json({ success: true, clip: publicClip, transcodeStatus: refreshed?.transcodeStatus, conclude });
    }

    if (action === "abort") {
      if (typeof uploadId !== "string") return NextResponse.json({ error: "Missing uploadId." }, { status: 400 });
      const upload = await ownedUpload(session.user.id, uploadId);
      if (!upload) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
      const removed = await db.activeUpload.deleteMany({ where: { id: upload.id, status: { in: ["INITIATED", "LEGACY_REJECTED"] } } });
      if (removed.count !== 1) return NextResponse.json({ error: "An assembled upload cannot be aborted." }, { status: 409 });
      await r2Client.send(new AbortMultipartUploadCommand({ Bucket: BUCKET_NAME, Key: upload.key, UploadId: upload.uploadId })).catch((error) => {
        if (!isStorageNotFound(error)) reportWarning("upload.multipart_abort_failed", error, { uploadId: upload.id });
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (error: unknown) {
    throw error;
  }
}

export const GET = withApiHandler(GETHandler);

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
