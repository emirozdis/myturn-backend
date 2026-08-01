import { createHmac, timingSafeEqual } from "crypto";
import { withApiHandler } from "@/lib/observability/api-handler";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sendPushToUser } from "@/lib/push-server";
import { r2 } from "@/lib/r2";
import { AppError } from "@/lib/observability/errors";
import { publishReadyClipsInOrder } from "@/lib/clip-publication";

function cleanVirtualKey(key: unknown): string | null {
  if (typeof key !== "string" || !key || key.startsWith("/") || key.includes("..")) return null;
  return key.startsWith("vlogs/") ? key.substring(6) : key;
}

type WebhookBody = {
  jobId?: unknown;
  event?: unknown;
  payload?: unknown;
  data?: {
    hlsUrl?: unknown;
    thumbnailUrl?: unknown;
    thumbnailBlurUrl?: unknown;
  };
};

async function deleteOrphanedTranscodeOutput(data: WebhookBody["data"]) {
  const hlsUrl = cleanVirtualKey(data?.hlsUrl);
  const keys = new Set<string>();
  for (const value of [hlsUrl, cleanVirtualKey(data?.thumbnailUrl), cleanVirtualKey(data?.thumbnailBlurUrl)]) {
    if (value) keys.add(value);
  }
  if (hlsUrl?.includes("/")) {
    const prefix = `${hlsUrl.substring(0, hlsUrl.lastIndexOf("/"))}/`;
    const hlsKeys = await r2.listObjects("vlogs", prefix);
    hlsKeys.forEach((key) => keys.add(key));
  }
  if (keys.size) await r2.deleteObjects("vlogs", Array.from(keys));
}

function verifySignature(body: string, timestamp: string | null, signatureHeader: string | null): boolean {
  const secret = process.env.TRANSCODER_WEBHOOK_SECRET;
  if (!secret || secret.length < 32 || !timestamp || !signatureHeader) return false;
  const parsedTimestamp = Number(timestamp);
  if (!Number.isInteger(parsedTimestamp) || Math.abs(Math.floor(Date.now() / 1000) - parsedTimestamp) > 300) return false;

  const receivedHex = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : "";
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  const received = Buffer.from(receivedHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function POSTHandler(req: NextRequest) {
  const rawBody = await req.text();
  const eventId = req.headers.get("x-webhook-id");
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId) || !verifySignature(rawBody, req.headers.get("x-webhook-timestamp"), req.headers.get("x-webhook-signature"))) {
    return NextResponse.json({ error: "Invalid webhook authentication." }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { jobId, event, payload: callbackPayload, data } = body;
  if (typeof jobId !== "string" || typeof event !== "string" || !["Saved", "Error"].includes(event)) {
    return NextResponse.json({ error: "Invalid callback payload." }, { status: 400 });
  }

  let callbackClipId: string | undefined;
  let callbackPhotoResponseId: string | undefined;
  try {
    const parsed = typeof callbackPayload === "string" ? JSON.parse(callbackPayload) : callbackPayload;
    callbackClipId = typeof parsed?.clipId === "string" ? parsed.clipId : undefined;
    callbackPhotoResponseId = typeof parsed?.photoResponseId === "string" ? parsed.photoResponseId : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid callback metadata." }, { status: 400 });
  }

  const [clip, photoResponse] = await Promise.all([
    db.clip.findUnique({ where: { transcodeJobId: jobId } }),
    db.photoResponse.findUnique({ where: { transcodeJobId: jobId } }),
  ]);
  if (!clip && !photoResponse) {
    if (event === "Saved") {
      try {
        await deleteOrphanedTranscodeOutput(data);
      } catch (cleanupError) {
        throw new AppError({
          code: "TRANSCODER_ORPHAN_CLEANUP_FAILED",
          status: 500,
          safeMessage: "Transcoder cleanup failed.",
          cause: cleanupError,
          details: { jobId },
        });
      }
    }
    return NextResponse.json({ error: "Unknown transcoder job." }, { status: 404 });
  }
  if ((clip && callbackClipId !== clip.id) || (photoResponse && callbackPhotoResponseId !== photoResponse.id)) {
    return NextResponse.json({ error: "Unknown transcoder job." }, { status: 404 });
  }

  const sourceUrl = clip?.videoUrl || photoResponse!.imageUrl;
  const entityId = clip?.id || photoResponse!.id;
  const hlsDir = sourceUrl.substring(0, sourceUrl.lastIndexOf("/"));
  const expectedHls = hlsDir ? `${hlsDir}/${entityId}_hls/master.m3u8` : `${entityId}_hls/master.m3u8`;
  const responseSourceBase = photoResponse?.imageUrl.replace(/\.[^/.]+$/, "");
  const expectedResponseThumbnail = responseSourceBase ? `${responseSourceBase}-thumb.jpg` : null;
  const expectedResponseBlur = responseSourceBase ? `${responseSourceBase}-thumb-blur.jpg` : null;
  const hlsUrl = cleanVirtualKey(data?.hlsUrl);
  const thumbnailUrl = cleanVirtualKey(data?.thumbnailUrl);
  const thumbnailBlurUrl = cleanVirtualKey(data?.thumbnailBlurUrl);
  // Accept callbacks from jobs dispatched just before thumbnail support was
  // deployed. The retry worker will backfill their missing poster assets.
  const responsePosterKeysValid = (thumbnailUrl === expectedResponseThumbnail && thumbnailBlurUrl === expectedResponseBlur)
    || (thumbnailUrl === null && thumbnailBlurUrl === null);
  const outputKeysInvalid = clip
    ? hlsUrl !== expectedHls || thumbnailUrl !== clip.thumbnailUrl || thumbnailBlurUrl !== clip.thumbnailBlurUrl
    : hlsUrl !== expectedHls || !responsePosterKeysValid;
  if (event === "Saved" && outputKeysInvalid) {
    return NextResponse.json({ error: "Transcoder output keys do not match this job." }, { status: 400 });
  }

  try {
    await db.transcoderWebhookEvent.create({
      data: { id: eventId, jobId, event: event === "Saved" ? "Saved" : "Error" },
    });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.transcoderWebhookEvent.findUnique({ where: { id: eventId }, select: { processedAt: true } });
      if (existing?.processedAt) return NextResponse.json({ success: true, replay: true });
    } else {
      throw error;
    }
  }

  const publishedClipIds = await db.$transaction(async (tx) => {
    const claim = await tx.transcoderWebhookEvent.updateMany({
      where: { id: eventId, processedAt: null },
      data: { processedAt: new Date() },
    });
    if (claim.count !== 1) return null;

    if (event === "Saved" && clip) {
      await tx.clip.updateMany({
        where: { id: clip.id, transcodeStatus: { not: "COMPLETED" } },
        data: { transcodeReadyAt: new Date(), hlsUrl, thumbnailUrl: thumbnailUrl!, thumbnailBlurUrl },
      });
      return publishReadyClipsInOrder(tx, clip.userId, clip.groupId);
    } else if (event === "Saved" && photoResponse) {
      await tx.photoResponse.update({
        where: { id: photoResponse.id },
        data: { transcodeStatus: "COMPLETED", hlsUrl, thumbnailUrl, thumbnailBlurUrl },
      });
    } else if (clip && clip.transcodeStatus !== "COMPLETED" && !clip.transcodeReadyAt) {
      const attempts = clip.transcodeAttempts + 1;
      await tx.clip.update({
        where: { id: clip.id },
        data: { transcodeStatus: attempts >= 3 ? "FAILED_PERMANENTLY" : "FAILED", transcodeAttempts: attempts },
      });
      if (attempts >= 3) return publishReadyClipsInOrder(tx, clip.userId, clip.groupId);
    } else if (photoResponse && (
      photoResponse.transcodeStatus !== "COMPLETED"
      || !photoResponse.thumbnailUrl
      || !photoResponse.thumbnailBlurUrl
    )) {
      const attempts = photoResponse.transcodeAttempts + 1;
      await tx.photoResponse.update({
        where: { id: photoResponse.id },
        data: photoResponse.transcodeStatus === "COMPLETED"
          ? { transcodeAttempts: attempts }
          : { transcodeStatus: attempts >= 3 ? "FAILED_PERMANENTLY" : "FAILED", transcodeAttempts: attempts },
      });
    }
    return [];
  });

  if (publishedClipIds === null) return NextResponse.json({ success: true, replay: true });

  if (clip && publishedClipIds.length) {
    const [poster, group, members] = await Promise.all([
      db.profile.findUnique({ where: { id: clip.userId }, select: { name: true, handle: true } }),
      db.group.findUnique({ where: { id: clip.groupId }, select: { name: true } }),
      db.groupMember.findMany({ where: { groupId: clip.groupId }, select: { userId: true } }),
    ]);
    const posterName = poster?.name || (poster?.handle ? `@${poster.handle}` : undefined);
    for (const publishedClipId of publishedClipIds) {
      await Promise.allSettled(members.map((member) => sendPushToUser(member.userId, member.userId === clip.userId
        ? { category: "posts", key: "ownMomentReady", deepLink: { screen: "today", groupId: clip.groupId, clipId: publishedClipId } }
        : { category: "posts", key: "newMomentReady", vars: { actor: posterName, group: group?.name }, deepLink: { screen: "today", groupId: clip.groupId, clipId: publishedClipId } })));
    }
  }

  if (event === "Saved" && photoResponse && photoResponse.transcodeStatus !== "COMPLETED") {
    const [targetClip, responder] = await Promise.all([
      db.clip.findUnique({
        where: { id: photoResponse.clipId },
        include: { group: { select: { name: true } }, user: { select: { id: true } } },
      }),
      db.profile.findUnique({ where: { id: photoResponse.userId }, select: { name: true } }),
    ]);
    if (targetClip && targetClip.userId !== photoResponse.userId) {
      await sendPushToUser(targetClip.userId, {
        category: "interactions",
        key: "photoResponse",
        vars: { actor: responder?.name, group: targetClip.group.name },
        deepLink: {
          screen: "today",
          groupId: targetClip.groupId,
          clipId: targetClip.id,
          focus: "responses",
          itemId: photoResponse.id,
        },
      });
    }
  }

  return NextResponse.json({ success: true });
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
