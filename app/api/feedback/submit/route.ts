import { randomUUID } from "crypto";
import { withApiHandler } from "@/lib/observability/api-handler";
import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { r2 } from "@/lib/r2";
import { AppError } from "@/lib/observability/errors";
import { reportError } from "@/lib/observability/logger";

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_LOGS_LENGTH = 80_000;
const MAX_DEVICE_INFO_LENGTH = 12_000;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const ALLOWED_CATEGORIES = new Set(["bug", "idea", "other"]);

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

async function POSTHandler(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`feedback_${session.user.id}`, 5, 10 * 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: `Too many feedback reports. Try again in ${rl.retryAfter}s.` },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = optionalString(body.message, MAX_MESSAGE_LENGTH);
  const category = typeof body.category === "string" && ALLOWED_CATEGORIES.has(body.category)
    ? body.category
    : "other";
  if (!message) {
    return NextResponse.json({ error: "Feedback message is required" }, { status: 400 });
  }

  // Screenshot capture can be unavailable for some native surfaces or during
  // modal transitions. Treat it as an optional attachment instead of rejecting
  // an otherwise valid feedback report.
  const includeScreenshot = body.includeScreenshot === true && typeof body.screenshot === "string" && body.screenshot.length > 0;
  const includeLogs = body.includeLogs === true;
  const includeDeviceInfo = body.includeDeviceInfo === true;
  const logs = includeLogs ? optionalString(body.logs, MAX_LOGS_LENGTH) : null;
  const deviceInfo = includeDeviceInfo ? optionalString(body.deviceInfo, MAX_DEVICE_INFO_LENGTH) : null;

  let screenshotPath: string | null = null;
  if (includeScreenshot) {
    if (body.screenshot.length > Math.ceil(MAX_SCREENSHOT_BYTES * 4 / 3) + 100) {
      return NextResponse.json({ error: "Screenshot is too large" }, { status: 413 });
    }

    const base64 = body.screenshot.replace(/^data:image\/jpe?g;base64,/i, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      return NextResponse.json({ error: "Invalid screenshot data" }, { status: 400 });
    }

    const screenshot = Buffer.from(base64, "base64");
    if (!screenshot.length || screenshot.length > MAX_SCREENSHOT_BYTES) {
      return NextResponse.json({ error: "Screenshot is too large" }, { status: 413 });
    }
    if (screenshot[0] !== 0xff || screenshot[1] !== 0xd8 || screenshot[2] !== 0xff) {
      return NextResponse.json({ error: "Screenshot must be a JPEG image" }, { status: 415 });
    }

    screenshotPath = `${session.user.id}/${randomUUID()}.jpg`;
    try {
      await r2.upload("feedback", screenshotPath, screenshot, "image/jpeg");
    } catch (error) {
      throw new AppError({
        code: "FEEDBACK_SCREENSHOT_UPLOAD_FAILED",
        status: 502,
        safeMessage: "Could not upload screenshot.",
        cause: error,
      });
    }
  }

  try {
    const report = await db.feedbackReport.create({
      data: {
        userId: session.user.id,
        category,
        message,
        screen: optionalString(body.screen, 500),
        appVersion: optionalString(body.appVersion, 100),
        screenshotPath,
        logs,
        deviceInfo,
        includedScreenshot: includeScreenshot,
        includedLogs: includeLogs,
        includedDeviceInfo: includeDeviceInfo,
      },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json({ success: true, report });
  } catch (error) {
    if (screenshotPath) {
      await r2.deleteObjects("feedback", [screenshotPath]).catch((cleanupError) => {
        reportError("feedback.orphan_screenshot_cleanup_failed", cleanupError);
      });
    }
    throw error;
  }
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
