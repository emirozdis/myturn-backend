// ./app/api/media/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { r2 } from "@/lib/r2";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { withApiHandler } from "@/lib/observability/api-handler";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

async function POSTHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized.", { status: 401 });
    }

    const rl = await rateLimit(`media_upload_${session.user.id}`, 10, 60000);
    if (!rl.success) {
      return new NextResponse(`Rate limit exceeded. Try again in ${rl.retryAfter}s.`, { status: 429 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const bucket = formData.get("bucket") as string | null;
    const path = formData.get("path") as string | null;

    if (!file || !bucket || !path) {
      return new NextResponse("Missing required fields.", { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return new NextResponse("Payload too large. Maximum file size is 5MB.", { status: 413 });
    }

    // This legacy endpoint is intentionally limited to group avatars. Vlogs use
    // the ownership-bound multipart flow and user avatars use /profile/avatar.
    const match = /^group_avatars\/([0-9a-f-]+)_[a-z0-9-]+\.(jpe?g|png|webp)$/i.exec(path);
    if (bucket !== "avatars" || !match) {
      return new NextResponse("This upload destination is not allowed.", { status: 403 });
    }

    const membership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: match[1], userId: session.user.id } },
      select: { role: true },
    });
    if (membership?.role !== "admin") {
      return new NextResponse("Only a group administrator may upload this image.", { status: 403 });
    }

    // --- Abuse Protection: Path Traversal Prevention ---
    if (path.includes("..") || path.startsWith("/")) {
      return new NextResponse("Invalid path definition.", { status: 400 });
    }

    // --- Abuse Protection: MIME Type Validation ---
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return new NextResponse("Invalid file format.", { status: 415 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    try {
      await r2.upload(bucket, path, buffer, file.type || "application/octet-stream");
    } catch (error: unknown) {
      throw error;
    }

    return NextResponse.json({ success: true, path });
  } catch (error: unknown) {
    throw error;
  }
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
