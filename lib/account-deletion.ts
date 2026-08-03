import "server-only";

import { b2 } from "@/lib/b2";
import { db } from "@/lib/db";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { r2 } from "@/lib/r2";

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

function addStorageKey(target: Set<string>, value: string | null | undefined) {
  if (isManagedStorageKey(value)) target.add(value);
}

function storageTiersForClip(storageTier: string): StorageTier[] {
  if (storageTier === "COLD" || storageTier === "PRUNED") return ["cold"];
  if (storageTier === "MIGRATING") return ["hot", "cold"];
  return ["hot"];
}

async function deleteRevenueCatCustomer(userId: string) {
  const apiKey = process.env.REVENUECAT_SECRET_KEY;
  if (!apiKey) return;

  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`RevenueCat customer deletion failed with status ${response.status}.`);
  }
}

async function deleteFirebaseIdentity(firebaseUid: string) {
  const auth = getFirebaseAuth();
  try {
    await auth.revokeRefreshTokens(firebaseUid);
    await auth.deleteUser(firebaseUid);
  } catch (error: unknown) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "auth/user-not-found") throw error;
  }
}

/**
 * Permanently removes an app user and the managed data that would otherwise be
 * orphaned by the profile cascade. This mirrors the self-service deletion
 * contract while allowing trusted server-side callers to supply a profile ID.
 */
export async function permanentlyDeleteUserAccount(userId: string) {
  const user = await db.profile.findUnique({
    where: { id: userId },
    select: {
      firebaseUid: true,
      email: true,
      image: true,
      groupMembers: {
        select: {
          groupId: true,
          role: true,
          group: { select: { image: true, _count: { select: { members: true, boosts: true } } } },
        },
      },
      groupBoosts: {
        select: { groupId: true, group: { select: { _count: { select: { boosts: true } } } } },
      },
      activeUploads: { select: { uploadId: true, key: true } },
      feedbackReports: {
        where: { screenshotPath: { not: null } },
        select: { screenshotPath: true },
      },
    },
  });

  if (!user) return { deleted: false, email: null };

  const groupsToDelete = user.groupMembers
    .filter((membership) => membership.group._count.members === 1)
    .map((membership) => membership.groupId);

  const clips = await db.clip.findMany({
    where: {
      OR: [
        { userId },
        { assignment: { userId } },
        ...(groupsToDelete.length ? [{ groupId: { in: groupsToDelete } }] : []),
      ],
    },
    select: {
      id: true,
      imageUrl: true,
      thumbnailUrl: true,
      thumbnailBlurUrl: true,
      hlsUrl: true,
      storageTier: true,
      photoResponses: {
        select: { imageUrl: true, hlsUrl: true, thumbnailUrl: true, thumbnailBlurUrl: true },
      },
    },
  });

  const deletedClipIds = clips.map((clip) => clip.id);
  const standaloneResponses = await db.photoResponse.findMany({
    where: { userId, ...(deletedClipIds.length ? { clipId: { notIn: deletedClipIds } } : {}) },
    select: {
      imageUrl: true,
      hlsUrl: true,
      thumbnailUrl: true,
      thumbnailBlurUrl: true,
      clip: { select: { storageTier: true } },
    },
  });

  const hotVlogKeys = new Set<string>();
  const coldVlogKeys = new Set<string>();
  const avatarKeys = new Set<string>();
  const keysForTier = (tier: StorageTier) => tier === "cold" ? coldVlogKeys : hotVlogKeys;

  for (const clip of clips) {
    for (const tier of storageTiersForClip(clip.storageTier)) {
      const keys = keysForTier(tier);
      addStorageKey(keys, clip.imageUrl);
      addStorageKey(keys, clip.thumbnailUrl);
      addStorageKey(keys, clip.thumbnailBlurUrl);
      addStorageKey(keys, clip.hlsUrl);
      clip.photoResponses.forEach((response) => {
        addStorageKey(keys, response.imageUrl);
        addStorageKey(keys, response.thumbnailUrl);
        addStorageKey(keys, response.thumbnailBlurUrl);
      });

      if (isManagedStorageKey(clip.hlsUrl) && clip.hlsUrl.includes("/")) {
        const prefix = `${clip.hlsUrl.substring(0, clip.hlsUrl.lastIndexOf("/"))}/`;
        const hlsKeys = tier === "cold" ? await b2.listObjects("vlogs", prefix) : await r2.listObjects("vlogs", prefix);
        hlsKeys.forEach((key) => keys.add(key));
      }
      for (const response of clip.photoResponses) {
        if (!isManagedStorageKey(response.hlsUrl) || !response.hlsUrl.includes("/")) continue;
        const prefix = `${response.hlsUrl.substring(0, response.hlsUrl.lastIndexOf("/"))}/`;
        const hlsKeys = tier === "cold" ? await b2.listObjects("vlogs", prefix) : await r2.listObjects("vlogs", prefix);
        hlsKeys.forEach((key) => keys.add(key));
      }
    }
  }

  for (const response of standaloneResponses) {
    for (const tier of storageTiersForClip(response.clip.storageTier)) {
      const keys = keysForTier(tier);
      addStorageKey(keys, response.imageUrl);
      addStorageKey(keys, response.thumbnailUrl);
      addStorageKey(keys, response.thumbnailBlurUrl);
      if (isManagedStorageKey(response.hlsUrl) && response.hlsUrl.includes("/")) {
        const prefix = `${response.hlsUrl.substring(0, response.hlsUrl.lastIndexOf("/"))}/`;
        const hlsKeys = tier === "cold" ? await b2.listObjects("vlogs", prefix) : await r2.listObjects("vlogs", prefix);
        hlsKeys.forEach((key) => keys.add(key));
      }
    }
  }

  for (const upload of user.activeUploads) {
    await r2.abortMultipartUpload("vlogs", upload.key, upload.uploadId);
    addStorageKey(hotVlogKeys, upload.key.startsWith("vlogs/") ? upload.key.slice(6) : upload.key);
  }

  addStorageKey(avatarKeys, user.image);
  (await r2.listObjects("avatars", `avatars/${userId}-`)).forEach((key) => avatarKeys.add(key));
  if (user.firebaseUid !== userId) {
    (await r2.listObjects("avatars", `avatars/${user.firebaseUid}-`)).forEach((key) => avatarKeys.add(key));
  }
  for (const membership of user.groupMembers) {
    if (!groupsToDelete.includes(membership.groupId)) continue;
    addStorageKey(avatarKeys, membership.group.image);
    (await r2.listObjects("avatars", `group_avatars/${membership.groupId}_`)).forEach((key) => avatarKeys.add(key));
  }

  const feedbackScreenshots = user.feedbackReports.flatMap((report) => report.screenshotPath ? [report.screenshotPath] : []);
  await Promise.all([
    hotVlogKeys.size ? r2.deleteObjects("vlogs", Array.from(hotVlogKeys)) : Promise.resolve(),
    coldVlogKeys.size ? b2.deleteObjects("vlogs", Array.from(coldVlogKeys)) : Promise.resolve(),
    avatarKeys.size ? r2.deleteObjects("avatars", Array.from(avatarKeys)) : Promise.resolve(),
    feedbackScreenshots.length ? r2.deleteObjects("feedback", feedbackScreenshots) : Promise.resolve(),
  ]);

  await deleteRevenueCatCustomer(user.firebaseUid);
  await deleteFirebaseIdentity(user.firebaseUid);

  const affectedGroupIds = Array.from(new Set([
    ...user.groupMembers.map((membership) => membership.groupId),
    ...user.groupBoosts.map((boost) => boost.groupId),
  ]));
  const formerBoostCounts = new Map(user.groupBoosts.map((boost) => [boost.groupId, boost.group._count.boosts]));
  const formerAdminGroupIds = new Set(user.groupMembers.filter((membership) => membership.role === "admin").map((membership) => membership.groupId));

  await db.$transaction(async (tx) => {
    if (user.email) {
      await tx.verificationToken.deleteMany({
        where: { identifier: { in: [`verify:${user.email}`, `reset:${user.email}`] } },
      });
      await tx.betaApplication.deleteMany({ where: { email: user.email } });
    }
    await tx.dailyAssignment.updateMany({ where: { passedByUserId: userId }, data: { passedByUserId: null } });
    await tx.backendIncident.deleteMany({ where: { OR: [{ userId }, { reportedUserId: userId }] } });
    await tx.profile.delete({ where: { id: userId } });

    for (const groupId of affectedGroupIds) {
      const group = await tx.group.findUnique({
        where: { id: groupId },
        select: { isFrozen: true, _count: { select: { members: true, boosts: true } } },
      });
      if (!group) continue;
      if (group._count.members === 0) {
        await tx.group.delete({ where: { id: groupId } });
        continue;
      }
      if (formerAdminGroupIds.has(groupId)) {
        const remainingAdmin = await tx.groupMember.findFirst({ where: { groupId, role: "admin" }, select: { id: true } });
        if (!remainingAdmin) {
          const successor = await tx.groupMember.findFirst({ where: { groupId }, orderBy: { joinedAt: "asc" }, select: { id: true } });
          if (successor) await tx.groupMember.update({ where: { id: successor.id }, data: { role: "admin" } });
        }
      }
      if (group.isFrozen && group._count.members <= 4) {
        await tx.group.update({ where: { id: groupId }, data: { isFrozen: false, boostGracePeriodEndsAt: null } });
      } else if ((formerBoostCounts.get(groupId) || 0) >= 3 && group._count.boosts < 3) {
        await tx.group.update({ where: { id: groupId }, data: { boostGracePeriodEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000) } });
      }
    }
  });

  return { deleted: true, email: user.email };
}
