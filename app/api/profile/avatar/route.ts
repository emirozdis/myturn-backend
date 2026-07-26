import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { generateEdgeUrl } from "@/lib/media-signing";
import { r2 } from "@/lib/r2";
import { rateLimit } from "@/lib/rate-limit";
import { randomUUID } from "crypto";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_BASE64_CHARS = Math.ceil(MAX_AVATAR_BYTES / 3) * 4;
const MAX_AVATAR_DIMENSION = 8192;
const MAX_AVATAR_PIXELS = 25_000_000;

type ValidatedImage = {
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
};

function validDimensions(width: number, height: number) {
  return Number.isInteger(width) && Number.isInteger(height) &&
    width > 0 && height > 0 &&
    width <= MAX_AVATAR_DIMENSION && height <= MAX_AVATAR_DIMENSION &&
    width * height <= MAX_AVATAR_PIXELS;
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 ||
      buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
    return null;
  }

  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function validateImagePayload(value: unknown): ValidatedImage | null {
  if (typeof value !== "string") return null;
  const dataUri = value.match(/^data:image\/(?:jpeg|jpg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
  const encoded = dataUri?.[1] ?? value;
  if (encoded.length < 4 || encoded.length > MAX_AVATAR_BASE64_CHARS ||
      encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return null;
  }

  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length < 24 || buffer.length > MAX_AVATAR_BYTES || buffer.toString("base64") !== encoded) {
    return null;
  }

  const jpeg = jpegDimensions(buffer);
  if (jpeg && validDimensions(jpeg.width, jpeg.height)) {
    return { buffer, contentType: "image/jpeg", extension: "jpg" };
  }

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngEnd = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const isPng = buffer.subarray(0, 8).equals(pngSignature) &&
    buffer.subarray(12, 16).toString("ascii") === "IHDR" &&
    buffer.subarray(buffer.length - 12).equals(pngEnd);
  if (isPng) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (validDimensions(width, height)) {
      return { buffer, contentType: "image/png", extension: "png" };
    }
  }

  return null;
}

async function POSTHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimit(`upload_avatar_${session.user.id}`, 5, 60000);
    if (!rl.success) {
      return NextResponse.json(
        { error: `You are uploading avatars too fast. Try again in ${rl.retryAfter}s.` },
        { status: 429 }
      );
    }

    const contentLength = Number(req.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_AVATAR_BASE64_CHARS + 2048) {
      return NextResponse.json({ error: "Avatar exceeds the 5 MB limit." }, { status: 413 });
    }

    const body = await req.json().catch(() => ({}));
    const image = validateImagePayload(body.base64Data);
    if (!image) {
      return NextResponse.json(
        { error: "Avatar must be a valid JPEG or PNG image no larger than 5 MB." },
        { status: 400 },
      );
    }

    const userId = session.user.id;
    const fileId = randomUUID();
    const path = `avatars/${userId}-${fileId}.${image.extension}`;

    await r2.upload("avatars", path, image.buffer, image.contentType);

    await db.profile.update({
      where: { id: userId },
      data: { image: path },
    });

    const imageUrl = generateEdgeUrl("avatars", path, 3600, "HOT");

    return NextResponse.json({ success: true, imagePath: path, imageUrl });
  } catch (error: unknown) {
    throw error;
  }
}
export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
