// ./lib/pro-helper.ts
import { prisma } from "./prisma";
import { getBusinessDate } from "./business-time";
import { logger, reportError, reportWarning } from "./observability/logger";

let reportedMissingRevenueCatKey = false;

export async function checkUserProStatus(userId: string): Promise<boolean> {
  const apiKey = process.env.REVENUECAT_SECRET_KEY;
  if (!apiKey) {
    const result = process.env.NODE_ENV === "development";
    if (!reportedMissingRevenueCatKey) {
      reportedMissingRevenueCatKey = true;
      reportWarning(
        "revenuecat.configuration_missing",
        undefined,
        { developmentOverride: result },
        "RevenueCat secret key is not configured",
      );
    }
    return result;
  }

  try {
    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { firebaseUid: true },
    });
    if (!profile) return false;
    const revenueCatUserId = profile.firebaseUid;
    logger.debug({ event: "revenuecat.entitlement_check_started", userId }, "Checking RevenueCat entitlement");
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(revenueCatUserId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const data = await res.json();
      const entitlements = data?.subscriber?.entitlements || {};
      const isPro = typeof entitlements["MyTurn Pro"] !== "undefined";
      logger.debug({ event: "revenuecat.entitlement_check_completed", userId, isPro }, "RevenueCat entitlement checked");
      return isPro;
    } else {
      reportWarning(
        "revenuecat.entitlement_check_rejected",
        undefined,
        { userId, providerStatus: res.status },
        "RevenueCat returned a non-success response",
      );
    }
  } catch (e) {
    reportError("revenuecat.entitlement_check_failed", e, { userId });
  }
  logger.debug({ event: "revenuecat.entitlement_defaulted", userId, isPro: false }, "RevenueCat entitlement defaulted");
  return false;
}

export async function getUserBoostLimit(userId: string): Promise<number> {
  const isPro = await checkUserProStatus(userId);
  const user = await prisma.profile.findUnique({ where: { id: userId }, select: { boostCredits: true } });
  const limit = (isPro ? 1 : 0) + (user?.boostCredits || 0);
  logger.debug({ event: "boost.limit_calculated", userId, limit }, "Boost limit calculated");
  return limit;
}

export function isArchiveLocked(date: Date | string, isUserPro: boolean, isGroupPro: boolean, isFrozen: boolean = false, timezone = "UTC"): boolean {
  const vlogDate = getBusinessDate(timezone, new Date(date));
  const now = getBusinessDate(timezone);

  const diffTime = now.getTime() - vlogDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  const locked = isFrozen ? diffDays > 14 : (isUserPro || isGroupPro ? false : diffDays > 14);

  logger.debug({
    event: "archive.access_evaluated",
    daysOld: diffDays,
    userPro: isUserPro,
    groupPro: isGroupPro,
    frozen: isFrozen,
    locked,
  }, "Archive access evaluated");

  return locked;
}
