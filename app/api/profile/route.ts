// ./app/api/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { logger } from "@/lib/observability/logger";
import { hlsSafeResponses, publicClipPlaybackUrl, publicResponseMediaUrls } from "@/lib/media-delivery";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { getVibeArchetype } from "@/lib/vibe";
import { generateEdgeUrl } from "@/lib/media-signing";
import { generateMissingThumbnails } from "@/lib/transcoder";
import { rateLimit } from "@/lib/rate-limit";
import { checkUserProStatus, isArchiveLocked } from "../../../lib/pro-helper";
import { r2 } from "@/lib/r2";
import { b2 } from "@/lib/b2";
import { consumeAuthCode } from "@/lib/auth-tokens";
import { getFirebaseAuth } from "@/lib/firebase-admin";

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

function expireSessionCookies(response: NextResponse) {
  for (const name of [
    "firebase_session",
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
    "authjs.session-token",
    "__Secure-authjs.session-token",
  ]) {
    response.cookies.set(name, "", {
      expires: new Date(0),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: name.startsWith("__Secure-"),
    });
  }
}

async function deleteRevenueCatCustomer(userId: string) {
  const apiKey = process.env.REVENUECAT_SECRET_KEY;
  if (!apiKey) return;

  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`RevenueCat customer deletion failed with status ${response.status}.`);
  }
}

async function deleteFirebaseIdentity(userId: string) {
  const auth = getFirebaseAuth();
  try {
    await auth.revokeRefreshTokens(userId);
    await auth.deleteUser(userId);
  } catch (error: unknown) {
    const code = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
    if (code !== "auth/user-not-found") throw error;
  }
}

async function GETHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const intent = searchParams.get("intent");

    if (intent === "onboardingStatus") {
      const profile = await db.profile.findUnique({
        where: { id: session.user.id },
        select: {
          name: true,
          handle: true,
        },
      });

      if (!profile) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const response = NextResponse.json({
        success: true,
        profileComplete: Boolean(profile.handle),
        name: profile.name,
      });
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    if (intent === "usernameAvailability") {
      const availabilityRateLimit = await rateLimit(`username_availability_${session.user.id}`, 30, 60000);
      if (!availabilityRateLimit.success) {
        return NextResponse.json(
          { error: `Too many username checks. Try again in ${availabilityRateLimit.retryAfter}s.` },
          { status: 429 },
        );
      }

      const handle = (searchParams.get("handle") || "").toLowerCase().trim();
      if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
        return NextResponse.json({ success: true, available: false });
      }

      const existing = await db.profile.findFirst({
        where: {
          handle,
          id: { not: session.user.id },
        },
        select: { id: true },
      });

      return NextResponse.json({ success: true, available: !existing });
    }

    const userId = searchParams.get("userId");
    const groupId = searchParams.get("groupId");

    if (userId) {
      // A group-scoped profile is only visible to members of that same group.
      // This also prevents a caller from using a group ID to browse clips from
      // a group they do not belong to.
      if (groupId) {
        const [viewerMembership, profileMembership] = await Promise.all([
          db.groupMember.findUnique({
            where: { groupId_userId: { userId: session.user.id, groupId } },
            select: { userId: true },
          }),
          db.groupMember.findUnique({
            where: { groupId_userId: { userId, groupId } },
            select: { userId: true },
          }),
        ]);

        if (!viewerMembership || !profileMembership) {
          return NextResponse.json({ error: "Group profile is unavailable" }, { status: 403 });
        }
      }

      const user = await db.profile.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          handle: true,
          image: true,
          bio: true,
          location: true,
          createdAt: true,
          _count: {
            select: {
              clips: { where: { transcodeStatus: "COMPLETED" } },
              groupMembers: true,
            },
          },
        },
      });

      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const memberXp = await db.groupMember.aggregate({
        where: { userId: user.id },
        _sum: { xp: true },
      });
      const totalXp = memberXp._sum.xp || 0;
      const archetype = getVibeArchetype(totalXp);

      let avatarUrl = user.image;
      if (user.image && !user.image.startsWith("http") && !user.image.startsWith("data:") && !user.image.startsWith("/")) {
        avatarUrl = generateEdgeUrl("avatars", user.image, 3600, "HOT");
      }

      const isThisUserPro = await checkUserProStatus(user.id);

      const rawClips = groupId
        ? await db.clip.findMany({
            where: { userId: user.id, groupId, transcodeStatus: "COMPLETED" },
            orderBy: { recordedAt: "desc" },
            take: 6,
            include: {
              _count: { select: { reactions: true, comments: true } },
              photoResponses: true,
            },
          })
        : [];

      const clips = rawClips.map((clip) => {
        const thumbnailUrl = clip.thumbnailUrl.startsWith("http") || clip.thumbnailUrl.startsWith("/")
          ? clip.thumbnailUrl
          : generateEdgeUrl("vlogs", clip.thumbnailUrl, 3600, clip.storageTier);
        const thumbnailBlurTarget = clip.thumbnailBlurUrl || clip.thumbnailUrl;
        const thumbnailBlurUrl = thumbnailBlurTarget.startsWith("http") || thumbnailBlurTarget.startsWith("/")
          ? thumbnailBlurTarget
          : generateEdgeUrl("vlogs", thumbnailBlurTarget, 3600, clip.storageTier);
        const hlsUrl = clip.hlsUrl && (clip.hlsUrl.startsWith("http") || clip.hlsUrl.startsWith("/"))
          ? clip.hlsUrl
          : clip.hlsUrl
            ? generateEdgeUrl("vlogs", clip.hlsUrl, 3600, clip.storageTier)
            : null;

        return {
          ...clip,
          videoUrl: publicClipPlaybackUrl(clip, hlsUrl),
          hlsUrl,
          thumbnailUrl,
          thumbnailBlurUrl,
          photoResponses: publicResponseMediaUrls(hlsSafeResponses(clip.photoResponses), clip.storageTier),
        };
      });

      logger.debug({
        event: "profile.public_served",
        profileUserId: user.id,
        isPro: isThisUserPro,
        clipCount: user._count.clips,
        groupCount: user._count.groupMembers,
      }, "Public profile served");

      return NextResponse.json({
        success: true,
        user: {
          ...user,
          image: avatarUrl,
          xp: totalXp,
          archetype,
          isPro: isThisUserPro,
          ...(groupId ? { clips } : {}),
        },
      });
    }

    const user = await db.profile.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        bio: true,
        handle: true,
        location: true,
        createdAt: true,
        boostCredits: true,
        _count: {
          select: {
            clips: { where: { transcodeStatus: "COMPLETED" } },
            groupMembers: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.handle) {
      const generatedHandle = user.name
        ? user.name.toLowerCase().replace(/\s+/g, "") + Math.floor(100 + Math.random() * 900)
        : `user${Math.floor(1000 + Math.random() * 9000)}`;
      
      await db.profile.update({
        where: { id: user.id },
        data: { handle: generatedHandle },
      });
      user.handle = generatedHandle;
    }

    const friendsCount = await db.friendship.count({
      where: {
        status: "accepted",
        OR: [
          { requesterId: user.id },
          { addresseeId: user.id },
        ],
      },
    });

    const rawClips = await db.clip.findMany({
      where: { userId: user.id, transcodeStatus: "COMPLETED" },
      orderBy: { recordedAt: "desc" },
      take: 6,
      include: {
        _count: {
          select: {
            reactions: true,
            comments: true,
          },
        },
        photoResponses: {
          include: { user: { select: { id: true, name: true, image: true, handle: true } } },
        }
      }
    });

    const allUserClipsWithStats = await db.clip.findMany({
      where: { userId: user.id, transcodeStatus: "COMPLETED" },
      select: {
        _count: {
          select: {
            reactions: true,
            comments: true,
            photoResponses: { where: { mediaType: "photo" } },
          },
        },
      },
    });

    const totalLikes = allUserClipsWithStats.reduce((sum, clip) => sum + clip._count.reactions, 0);
    const totalComments = allUserClipsWithStats.reduce((sum, clip) => sum + clip._count.comments, 0);
    const totalPhotoResponses = allUserClipsWithStats.reduce((sum, clip) => sum + clip._count.photoResponses, 0);

    const today = new Date();
    const currentMonth = today.getUTCMonth();
    const currentYear = today.getUTCFullYear();
    const monthStart = new Date(Date.UTC(currentYear, currentMonth, 1));
    const nextMonthStart = new Date(Date.UTC(currentYear, currentMonth + 1, 1));
    const calendarClips = await db.clip.findMany({
      where: {
        userId: user.id,
        transcodeStatus: "COMPLETED",
        recordedAt: { gte: monthStart, lt: nextMonthStart },
      },
      select: { recordedAt: true },
    });

    const isUserPro = await checkUserProStatus(session.user.id);
    logger.debug({ event: "profile.self_loaded", isPro: isUserPro, clipCount: rawClips.length }, "Self profile loaded");

    const clips: Array<(typeof rawClips)[number] & { videoUrl: string; isLocked: boolean }> = [];
    for (const clip of rawClips) {
      let activeClip = clip;
      const clipGroup = await db.group.findUnique({ where: { id: activeClip.groupId }, include: { boosts: true } });
      const isGroupPro = (clipGroup?.boosts?.length || 0) >= 3;
      const isFrozen = clipGroup?.isFrozen || false;
      const locked = isArchiveLocked(activeClip.recordedAt, isUserPro, isGroupPro, isFrozen, clipGroup?.timezone || "UTC");
      const mustEnforceSd = (!isUserPro && !isGroupPro) || isFrozen;

      logger.debug({
        event: "profile.clip_access_evaluated",
        clipId: activeClip.id,
        storageTier: activeClip.storageTier,
        locked,
        enforceSd: mustEnforceSd,
      }, "Profile clip access evaluated");

      if (locked) {
        clips.push({
          ...activeClip,
          videoUrl: "",
          hlsUrl: null,
          thumbnailUrl: "",
          thumbnailBlurUrl: null,
          photoResponses: [],
          isLocked: true,
        });
        continue;
      }

      if (!clip.thumbnailUrl || !clip.thumbnailBlurUrl) {
        const updatedThumbs = await generateMissingThumbnails(clip.id);
        if (updatedThumbs) {
          activeClip = {
            ...clip,
            thumbnailUrl: updatedThumbs.thumbnailUrl,
            thumbnailBlurUrl: updatedThumbs.thumbnailBlurUrl,
          };
        }
      }

      let finalHls = activeClip.hlsUrl;
      if (finalHls && mustEnforceSd) {
         // Narrow token scope by targeting the SD stream directory directly
         finalHls = finalHls.replace("master.m3u8", "stream_2/playlist.m3u8");
         logger.debug({ event: "profile.clip_hls_downgraded", clipId: activeClip.id }, "Profile clip HLS downgraded to SD");
      }

      const hlsUrl = !locked && activeClip.transcodeStatus === "COMPLETED" && finalHls
        ? (finalHls.startsWith("http") || finalHls.startsWith("/")
            ? finalHls
            : generateEdgeUrl("vlogs", finalHls, 3600, activeClip.storageTier))
        : null;

      const videoUrl = locked
        ? ""
        : publicClipPlaybackUrl(activeClip, hlsUrl);

      const thumbnailUrl = activeClip.thumbnailUrl.startsWith("http") || activeClip.thumbnailUrl.startsWith("/")
        ? activeClip.thumbnailUrl
        : generateEdgeUrl("vlogs", activeClip.thumbnailUrl, 3600, activeClip.storageTier);

      const thumbnailBlurTarget = activeClip.thumbnailBlurUrl || activeClip.thumbnailUrl;
      const thumbnailBlurUrl = thumbnailBlurTarget.startsWith("http") || thumbnailBlurTarget.startsWith("/")
        ? thumbnailBlurTarget
        : generateEdgeUrl("vlogs", thumbnailBlurTarget, 3600, activeClip.storageTier);

      activeClip.photoResponses = locked
        ? []
        : publicResponseMediaUrls(hlsSafeResponses(activeClip.photoResponses), activeClip.storageTier);

      clips.push({
        ...activeClip,
        videoUrl,
        hlsUrl,
        thumbnailUrl,
        thumbnailBlurUrl,
        isLocked: locked,
      });
    }

    let avatarUrl = user.image;
    if (user.image && !user.image.startsWith("http") && !user.image.startsWith("data:") && !user.image.startsWith("/")) {
      avatarUrl = generateEdgeUrl("avatars", user.image, 3600, "HOT");
    }

    const memberXp = await db.groupMember.aggregate({
      where: { userId: user.id },
      _sum: { xp: true },
    });
    const totalXp = memberXp._sum.xp || 0;
    const archetype = getVibeArchetype(totalXp);

    const unlocked = await db.unlockedAchievement.findMany({
      where: { userId: user.id },
      select: { achievementId: true },
    });
    const unlockedIds = unlocked.map((u) => u.achievementId);

    const userWithSignedImage = {
      ...user,
      image: avatarUrl,
      xp: totalXp,
      archetype,
      unlockedIds,
      isPro: isUserPro,
    };

    const daysInMonth = new Date(Date.UTC(currentYear, currentMonth + 1, 0)).getUTCDate();

    const calendarDays = Array.from({ length: daysInMonth }).map((_, i) => {
      const dayNum = i + 1;
      const vloggedOnDay = calendarClips.some(
        (c) => {
          const d = new Date(c.recordedAt);
          return d.getUTCDate() === dayNum && d.getUTCMonth() === currentMonth && d.getUTCFullYear() === currentYear;
        }
      );
      return { d: dayNum, type: vloggedOnDay ? "vlogged" : "empty" };
    });

    const lockedClipsCount = clips.filter(c => c.isLocked).length;
    logger.debug({
      event: "profile.self_response_ready",
      clipCount: clips.length,
      lockedClipCount: lockedClipsCount,
      isPro: isUserPro,
      achievementCount: unlockedIds.length,
    }, "Self profile response ready");

    return NextResponse.json({
      success: true,
      user: userWithSignedImage,
      totalVlogs: allUserClipsWithStats.length,
      totalLikes,
      totalComments,
      totalPhotos: totalPhotoResponses,
      groupsCount: user._count.groupMembers,
      friendsCount,
      clips,
      calendarDays,
    });
  } catch (error: unknown) {
    throw error;
  }
}

async function POSTHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimit(`update_profile_${session.user.id}`, 10, 60000);
    if (!rl.success) {
      return NextResponse.json(
        { error: `You are updating your profile too fast. Try again in ${rl.retryAfter}s.` },
        { status: 429 }
      );
    }

    const data = await req.json();
    const { name, handle, bio, location } = data;

    if (!name || !handle) {
      return NextResponse.json({ error: "Name and handle are required fields." }, { status: 400 });
    }

    const formattedHandle = handle.toLowerCase().trim().replace(/\s+/g, "");

    const existing = await db.profile.findFirst({
      where: {
        handle: formattedHandle,
        id: { not: session.user.id },
      },
    });

    if (existing) {
      return NextResponse.json({ error: "Username/handle is already taken by another user." }, { status: 409 });
    }

    const updated = await db.profile.update({
      where: { id: session.user.id },
      data: {
        name,
        handle: formattedHandle,
        bio,
        location,
      },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        bio: true,
        handle: true,
        location: true,
        createdAt: true,
        boostCredits: true,
      },
    });

    return NextResponse.json({ success: true, user: updated });
  } catch (error: unknown) {
    throw error;
  }
}

async function DELETEHandler(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.confirmation !== "DELETE") {
      return NextResponse.json(
        { error: "Explicit account deletion confirmation is required." },
        { status: 400 },
      );
    }

    const session = await getAuthSession();
    let userId = session?.user?.id;

    if (!userId) {
      const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown_ip";
      const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : "";
      const code = typeof body?.code === "string" ? body.code.trim() : "";
      if (!email || !/^\d{6}$/.test(code)) {
        return NextResponse.json({ error: "A valid email and 6-digit verification code are required." }, { status: 400 });
      }

      if (!(await rateLimit(`delete_account_web_ip_${ip}`, 10, 60 * 60 * 1000)).success ||
          !(await rateLimit(`delete_account_web_email_${email}`, 5, 60 * 60 * 1000)).success) {
        return NextResponse.json({ error: "Too many deletion attempts. Please try again later." }, { status: 429 });
      }

      const codeIsValid = await consumeAuthCode("delete", email, code);
      if (!codeIsValid) {
        return NextResponse.json({ error: "This deletion code is invalid or expired." }, { status: 401 });
      }

      const verifiedUser = await db.profile.findUnique({ where: { email }, select: { id: true } });
      if (!verifiedUser) {
        const response = NextResponse.json({ success: true });
        expireSessionCookies(response);
        return response;
      }
      userId = verifiedUser.id;
    }

    const rl = await rateLimit(`delete_account_${userId}`, 3, 60 * 60 * 1000);
    if (!rl.success) {
      return NextResponse.json(
        { error: `Too many account deletion attempts. Try again in ${rl.retryAfter}s.` },
        { status: 429 },
      );
    }

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
            group: {
              select: {
                image: true,
                _count: { select: { members: true, boosts: true } },
              },
            },
          },
        },
        groupBoosts: {
          select: {
            groupId: true,
            group: { select: { _count: { select: { boosts: true } } } },
          },
        },
        activeUploads: {
          select: { uploadId: true, key: true },
        },
        feedbackReports: {
          where: { screenshotPath: { not: null } },
          select: { screenshotPath: true },
        },
      },
    });

    if (!user) {
      const response = NextResponse.json({ success: true });
      expireSessionCookies(response);
      return response;
    }

    const groupsToDelete = user.groupMembers
      .filter((membership) => membership.group._count.members === 1)
      .map((membership) => membership.groupId);

    // A user deletion cascades through their assignments. Empty groups are also
    // removed below, so gather every clip whose database row will disappear.
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
        photoResponses: { select: { imageUrl: true, hlsUrl: true, thumbnailUrl: true, thumbnailBlurUrl: true } },
      },
    });

    const deletedClipIds = clips.map((clip) => clip.id);
    const standaloneResponses = await db.photoResponse.findMany({
      where: {
        userId,
        ...(deletedClipIds.length ? { clipId: { notIn: deletedClipIds } } : {}),
      },
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
      const tiers = storageTiersForClip(clip.storageTier);
      for (const tier of tiers) {
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
          const hlsPrefix = `${clip.hlsUrl.substring(0, clip.hlsUrl.lastIndexOf("/"))}/`;
          const hlsKeys = tier === "cold"
            ? await b2.listObjects("vlogs", hlsPrefix)
            : await r2.listObjects("vlogs", hlsPrefix);
          hlsKeys.forEach((key) => keys.add(key));
        }
        for (const response of clip.photoResponses) {
          if (!isManagedStorageKey(response.hlsUrl) || !response.hlsUrl.includes("/")) continue;
          const responseHlsPrefix = `${response.hlsUrl.substring(0, response.hlsUrl.lastIndexOf("/"))}/`;
          const responseHlsKeys = tier === "cold"
            ? await b2.listObjects("vlogs", responseHlsPrefix)
            : await r2.listObjects("vlogs", responseHlsPrefix);
          responseHlsKeys.forEach((key) => keys.add(key));
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
          const responseHlsPrefix = `${response.hlsUrl.substring(0, response.hlsUrl.lastIndexOf("/"))}/`;
          const responseHlsKeys = tier === "cold"
            ? await b2.listObjects("vlogs", responseHlsPrefix)
            : await r2.listObjects("vlogs", responseHlsPrefix);
          responseHlsKeys.forEach((key) => keys.add(key));
        }
      }
    }

    // Abort multipart sessions before deleting their object keys so unfinished
    // fragments do not survive the account.
    for (const upload of user.activeUploads) {
      await r2.abortMultipartUpload("vlogs", upload.key, upload.uploadId);
      const logicalKey = upload.key.startsWith("vlogs/") ? upload.key.slice("vlogs/".length) : upload.key;
      addStorageKey(hotVlogKeys, logicalKey);
    }

    if (isManagedStorageKey(user.image)) addStorageKey(avatarKeys, user.image);
    const historicalAvatars = await r2.listObjects("avatars", `avatars/${userId}-`);
    historicalAvatars.forEach((key) => avatarKeys.add(key));
    if (user.firebaseUid !== userId) {
      const legacyFirebaseAvatars = await r2.listObjects("avatars", `avatars/${user.firebaseUid}-`);
      legacyFirebaseAvatars.forEach((key) => avatarKeys.add(key));
    }

    for (const membership of user.groupMembers) {
      if (!groupsToDelete.includes(membership.groupId)) continue;
      addStorageKey(avatarKeys, membership.group.image);
      const historicalGroupAvatars = await r2.listObjects("avatars", `group_avatars/${membership.groupId}_`);
      historicalGroupAvatars.forEach((key) => avatarKeys.add(key));
    }

    const feedbackScreenshots = user.feedbackReports.flatMap((report) =>
      report.screenshotPath ? [report.screenshotPath] : [],
    );

    // Storage goes first. If it cannot be verified as deleted, keep the account
    // row so the operation can be retried without orphaning inaccessible media.
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
    const formerBoostCounts = new Map(
      user.groupBoosts.map((boost) => [boost.groupId, boost.group._count.boosts]),
    );
    const formerAdminGroupIds = new Set(
      user.groupMembers
        .filter((membership) => membership.role === "admin")
        .map((membership) => membership.groupId),
    );

    await db.$transaction(async (tx) => {
      if (user.email) {
        await tx.verificationToken.deleteMany({
          where: { identifier: { in: [`verify:${user.email}`, `reset:${user.email}`] } },
        });
        await tx.betaApplication.deleteMany({ where: { email: user.email } });
      }

      // passedByUserId is historical metadata rather than a Prisma relation,
      // so clear it explicitly before deleting the relational user graph.
      await tx.dailyAssignment.updateMany({
        where: { passedByUserId: userId },
        data: { passedByUserId: null },
      });

      // Diagnostic incidents may contain the user's internal ID. Remove them
      // as part of the same account-deletion transaction.
      await tx.backendIncident.deleteMany({
        where: { OR: [{ userId }, { reportedUserId: userId }] },
      });

      await tx.profile.delete({ where: { id: userId } });

      for (const groupId of affectedGroupIds) {
        const group = await tx.group.findUnique({
          where: { id: groupId },
          select: {
            isFrozen: true,
            _count: { select: { members: true, boosts: true } },
          },
        });
        if (!group) continue;

        if (group._count.members === 0) {
          await tx.group.delete({ where: { id: groupId } });
          continue;
        }

        if (formerAdminGroupIds.has(groupId)) {
          const remainingAdmin = await tx.groupMember.findFirst({
            where: { groupId, role: "admin" },
            select: { id: true },
          });
          if (!remainingAdmin) {
            const successor = await tx.groupMember.findFirst({
              where: { groupId },
              orderBy: { joinedAt: "asc" },
              select: { id: true },
            });
            if (successor) {
              await tx.groupMember.update({
                where: { id: successor.id },
                data: { role: "admin" },
              });
            }
          }
        }

        if (group.isFrozen && group._count.members <= 4) {
          await tx.group.update({
            where: { id: groupId },
            data: { isFrozen: false, boostGracePeriodEndsAt: null },
          });
        } else if ((formerBoostCounts.get(groupId) || 0) >= 3 && group._count.boosts < 3) {
          await tx.group.update({
            where: { id: groupId },
            data: { boostGracePeriodEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
          });
        }
      }
    });

    const response = NextResponse.json({ success: true });
    expireSessionCookies(response);
    return response;
  } catch (error: unknown) {
    throw error;
  }
}

export const GET = withApiHandler(GETHandler);

export const POST = withApiHandler(POSTHandler);

export const DELETE = withApiHandler(DELETEHandler);

export const dynamic = "force-dynamic";
