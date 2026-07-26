import { db } from "@/lib/db";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import {
  getNotificationText,
  createNotificationDeepLink,
  NotificationCategory,
  NotificationRequest,
} from "@/lib/notification-texts";
import { logInfo, reportError, reportWarning } from "@/lib/observability/logger";

const activeApps = getApps();

if (activeApps.length === 0) {
  try {
    // Process stringified private key matching Vercel/Node standard outputs
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey,
        }),
      });
      logInfo("push.firebase_initialized", {}, "Firebase Admin SDK initialized");
    } else {
      reportWarning(
        "push.firebase_configuration_missing",
        undefined,
        {},
        "Firebase Admin environment variables are incomplete",
      );
    }
  } catch (err) {
    reportError("push.firebase_initialization_failed", err);
  }
}

export async function sendPushNotification(
  token: string,
  payload: { title: string; body: string; url?: string }
) {
  const currentApps = getApps();
  if (currentApps.length === 0) {
    const logId = reportError(
      "push.not_configured",
      new Error("Firebase Admin SDK is not configured"),
    );
    return { error: "Push notification could not be sent.", code: "PUSH_NOT_CONFIGURED", logId };
  }

  try {
    const message = {
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      webpush: {
        fcmOptions: {
          link: payload.url || "/",
        },
        notification: {
          icon: "/logo.png",
          badge: "/logo.png",
        }
      },
      data: {
        url: payload.url || "/",
      },
    };

    // Obtain the modular messaging instance and send the payload
    const messagingInstance = getMessaging();
    const response = await messagingInstance.send(message);
    logInfo("push.sent", { providerMessageId: response }, "Push notification sent");
    
    return { success: true };
  } catch (error: unknown) {
    const errorCode = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : undefined;
    const logId = reportError("push.send_failed", error, { providerCode: errorCode });

    // Actively sweep DB to purge explicitly dead/revoked device tokens
    if (
      errorCode === 'messaging/invalid-registration-token' ||
      errorCode === 'messaging/registration-token-not-registered'
    ) {
      try {
        await db.pushSubscription.deleteMany({
          where: { token }
        });
        logInfo("push.stale_subscription_removed", {}, "Stale push subscription removed");
      } catch (dbErr) {
        reportError("push.stale_subscription_cleanup_failed", dbErr);
      }
    }
    
    return { error: "Push notification could not be sent.", code: errorCode, logId };
  }
}

export async function sendPushToUser(
  userId: string,
  request: NotificationRequest
) {
  try {
    const preferenceField: Record<NotificationCategory, "notifyTurns" | "notifyReminders" | "notifyPosts" | "notifyInteractions" | "notifySocial" | "notifyRecaps"> = {
      turns: "notifyTurns",
      reminders: "notifyReminders",
      posts: "notifyPosts",
      interactions: "notifyInteractions",
      social: "notifySocial",
      recaps: "notifyRecaps",
    };
    const user = await db.profile.findUnique({
      where: { id: userId },
      select: {
        locale: true,
        notifyTurns: true,
        notifyReminders: true,
        notifyPosts: true,
        notifyInteractions: true,
        notifySocial: true,
        notifyRecaps: true,
        pushSubscriptions: { select: { token: true } },
      },
    });

    if (!user || !user[preferenceField[request.category]]) {
      return { success: true, skipped: true };
    }

    if (user.pushSubscriptions.length === 0) {
      logInfo("push.no_registered_devices", { userId }, "User has no registered push devices");
      return { success: true, message: "Target user has no registered active devices." };
    }

    const payload = {
      ...getNotificationText(user.locale, request.key, request.vars),
      url: createNotificationDeepLink(request.deepLink),
    };
    const tasks = user.pushSubscriptions.map((sub) =>
      sendPushNotification(sub.token, payload)
    );

    // Batch send in parallel ensuring independent resolves
    await Promise.allSettled(tasks);
    return { success: true };
  } catch (error: unknown) {
    const logId = reportError("push.batch_failed", error, { userId });
    return { error: "Push notifications could not be dispatched.", logId };
  }
}
