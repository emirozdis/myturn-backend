// ./app/api/vlog/route.ts
import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { reportError, reportWarning } from "@/lib/observability/logger";
import { AppError } from "@/lib/observability/errors";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { sendPushToUser } from "@/lib/push-server";
import { calculateGroupLevel } from "@/lib/vibe";
import { generateEdgeUrl } from "@/lib/media-signing";
import { rateLimit } from "@/lib/rate-limit";
import { r2 } from "@/lib/r2";
import { b2 } from "@/lib/b2";
import { generateMissingThumbnails } from "@/lib/transcoder";
import { randomUUID } from "crypto";
import { checkUserProStatus, isArchiveLocked } from "../../../lib/pro-helper";
import {
  getVlogCircadianState,
  rollGroupAssignmentForDate,
  checkAndUnlockAchievement,
  getLocalDateInTimezone,
  MIN_MEMBERS_FOR_DAILY_ASSIGNMENT,
  isAutomaticPassDue,
} from "@/lib/vlog-helpers";
import { getVlogTimePeriodForHour, hasVlogInTimePeriod } from "@/lib/business-time";
import { authorizeMediaRead } from "@/lib/media-authorization";
import { finalizeUploadedClip } from "@/lib/upload-finalization";
import { claimCurrentAssignment, passCurrentAssignment } from "@/lib/assignment-transitions";
import { Prisma } from "@prisma/client";
import { hlsSafeResponses, publicClipPlaybackUrl, publicResponseMediaUrls } from "@/lib/media-delivery";
import { localizePrompt, localizePromptText } from "@/lib/prompt-localization";
import { findMentionedUserIds } from "@/lib/comment-mentions";

const ALLOWED_REACTION_EMOJIS = new Set(["❤️"]);
const MAX_COMMENT_LENGTH = 500;
const MAX_DAILY_COMMENTS = 100;

async function getUserLocale(userId: string): Promise<string> {
  const user = await db.profile.findUnique({ where: { id: userId }, select: { locale: true } });
  return user?.locale || "en";
}

async function getRequestLocale(req: NextRequest, userId: string): Promise<string> {
  const requestedLocale = req.headers.get("x-myturn-locale");
  if (requestedLocale === "en" || requestedLocale === "tr") return requestedLocale;
  return getUserLocale(userId);
}

async function getLocalizedPromptForUser(
  text: string | null,
  userId: string,
  req: NextRequest,
): Promise<string | null> {
  if (!text) return null;
  const [prompt, locale] = await Promise.all([
    db.prompt.findUnique({ where: { text }, select: { text: true, translations: true } }),
    getRequestLocale(req, userId),
  ]);
  return prompt ? localizePrompt(prompt, locale) : text;
}

async function GETHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const intent = searchParams.get("intent");
    const groupId = searchParams.get("groupId");

    if (intent === "getTodayTurnState") {
      if (!groupId) {
        return NextResponse.json({ error: "Group parameters unresolved" }, { status: 400 });
      }

      const group = await db.group.findUnique({
        where: { id: groupId },
        select: {
          timezone: true,
          isFrozen: true,
          members: { where: { userId: session.user.id }, select: { userId: true } },
        },
      });
      if (!group) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }
      if (group.members.length === 0) {
        return NextResponse.json({ error: "Unauthorized. Not a member of this group." }, { status: 403 });
      }

      const { businessDate } = getVlogCircadianState(group.timezone);
      const assignment = await db.dailyAssignment.findFirst({
        where: { groupId, date: businessDate, status: { in: ["active", "completed"] } },
        select: {
          id: true,
          groupId: true,
          userId: true,
          isPassed: true,
          isClaimed: true,
          passedByUserId: true,
          status: true,
          date: true,
          user: {
            select: { id: true, name: true, image: true, handle: true, bio: true, location: true },
          },
        },
      });

      return NextResponse.json({
        success: true,
        assignment: assignment
          ? { ...assignment, group: { timezone: group.timezone, isFrozen: group.isFrozen } }
          : null,
      }, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const isUserPro = await checkUserProStatus(session.user.id);

    if (intent === "getOrCreateTodayAssignment") {
      if (!groupId) {
        return NextResponse.json({ error: "Group parameters unresolved" }, { status: 400 });
      }

      const group = await db.group.findUnique({ 
        where: { id: groupId },
        include: { members: true, boosts: true } 
      });

      if (!group) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }

      const isMember = group.members.some(m => m.userId === session.user.id);
      if (!isMember) {
        return NextResponse.json({ error: "Unauthorized. Not a member of this group." }, { status: 403 });
      }

      const isGroupPro = (group.boosts?.length || 0) >= 3;
      const isFrozen = group.isFrozen;
      const mustEnforceSd = (!isUserPro && !isGroupPro) || isFrozen;

      const circadian = getVlogCircadianState(group.timezone);

      const [promptCatalog, locale] = await Promise.all([
        db.prompt.findMany({
          select: { id: true, text: true, translations: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        getRequestLocale(req, session.user.id),
      ]);
      if (promptCatalog.length === 0) {
        throw new AppError({
          code: "PROMPT_CATALOG_EMPTY",
          status: 503,
          safeMessage: "Prompt selection is temporarily unavailable.",
          cause: new Error("No prompts are configured"),
        });
      }

      const promptIndex = Math.floor(circadian.businessDate.getTime() / 86400000) % promptCatalog.length;
      const dailyPrompt = localizePrompt(promptCatalog[promptIndex], locale);
      const isWaitingForMembers = group.members.length < MIN_MEMBERS_FOR_DAILY_ASSIGNMENT;

      let assignment;
      if (isWaitingForMembers) {
        assignment = null;
      } else if (circadian.isSleepMode) {
        assignment = await db.dailyAssignment.findFirst({
          where: { groupId, date: circadian.businessDate },
        });
      } else {
        assignment = await rollGroupAssignmentForDate(groupId, circadian.businessDate);
      }

      let hasVolunteered = false;
      let canVolunteer = false;
      let volunteerEligibilityReason = "";

      if (isWaitingForMembers) {
        volunteerEligibilityReason = "At least two group members are required before a vlogger can be selected.";
      } else if (circadian.isSleepMode && session.user.id) {
        const volunteerRecord = await db.volunteer.findUnique({
          where: {
            groupId_userId_targetDate: {
              groupId,
              userId: session.user.id,
              targetDate: circadian.localDate
            }
          }
        });
        hasVolunteered = !!volunteerRecord;

        if (circadian.currentHour >= 7 && circadian.currentHour < 9) {
          canVolunteer = false;
          volunteerEligibilityReason = "Volunteer window closed at 7 AM.";
        } else if (hasVolunteered) {
          canVolunteer = true;
        } else {
          const yesterdayDate = new Date(circadian.localDate);
          yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);

          const yesterdayAssignment = await db.dailyAssignment.findFirst({
            where: { groupId, date: yesterdayDate }
          });

          if (yesterdayAssignment?.userId === session.user.id) {
            canVolunteer = false;
            volunteerEligibilityReason = "You already vlogged yesterday.";
          } else {
            const recentAssignments = await db.dailyAssignment.findMany({
              where: { groupId, date: { lt: circadian.localDate } },
              orderBy: { date: "desc" },
              take: group.members.length * 2,
            });

            const currentMemberIds = new Set(group.members.map((m) => m.userId));
            const seenInCycle = new Set<string>();

            for (const asg of recentAssignments) {
              if (!currentMemberIds.has(asg.userId)) continue;
              if (seenInCycle.has(asg.userId)) break;
              seenInCycle.add(asg.userId);
              if (seenInCycle.size === currentMemberIds.size) break;
            }

            if (seenInCycle.has(session.user.id) && seenInCycle.size < currentMemberIds.size) {
              canVolunteer = false;
              volunteerEligibilityReason = "You vlogged recently in this cycle.";
            } else {
              canVolunteer = true;
            }
          }
        }
      }

      if (!assignment) {
        return NextResponse.json({ 
          success: true, 
          assignment: null, 
          assignmentAvailability: {
            status: isWaitingForMembers ? "waiting_for_members" : circadian.isSleepMode ? "sleep_mode" : "unavailable",
            memberCount: group.members.length,
            minimumMemberCount: MIN_MEMBERS_FOR_DAILY_ASSIGNMENT,
          },
          isSleepMode: circadian.isSleepMode,
          sleepTimeLeftSeconds: circadian.sleepTimeLeftSeconds,
          wakingTimeLeftSeconds: circadian.wakingTimeLeftSeconds,
          hasVolunteered,
          canVolunteer,
          volunteerEligibilityReason,
          dailyPrompt,
        });
      }

      const fullyPopulatedAssignment = await db.dailyAssignment.findFirst({
        where: { id: assignment.id },
        include: {
          group: { 
            select: { 
              timezone: true, xp: true, level: true, name: true,
              members: {
                include: {
                  user: { select: { id: true, name: true, handle: true, image: true } }
                }
              }
            } 
          },
          user: { select: { id: true, name: true, image: true, handle: true, bio: true, location: true } },
          pokes: {
            where: { pokerId: session.user.id },
            orderBy: { createdAt: "desc" },
            take: 1
          },
          clips: {
            where: { transcodeStatus: "COMPLETED" },
            orderBy: { recordedAt: "asc" },
            include: {
              reactions: true,
              photoResponses: {
                orderBy: { createdAt: "asc" },
                include: { user: { select: { id: true, name: true, image: true, handle: true } } },
              },
              comments: {
                orderBy: { createdAt: "asc" },
                include: {
                  user: { select: { id: true, name: true, image: true, handle: true } },
                  likes: { where: { userId: session.user.id }, select: { userId: true } },
                  _count: { select: { likes: true } },
                },
              },
              views: {
                include: { user: { select: { id: true, name: true, image: true, handle: true } } },
              },
            },
          },
        },
      });

      const uploadedClipCount = fullyPopulatedAssignment
        ? await db.clip.count({ where: { assignmentId: fullyPopulatedAssignment.id } })
        : 0;
      if (fullyPopulatedAssignment && uploadedClipCount === 0 && !fullyPopulatedAssignment.isPassed) {
        const currentMinutes = circadian.currentHour * 60 + (circadian.currentMinute || 0);
        if (isAutomaticPassDue(fullyPopulatedAssignment.createdAt, currentMinutes)) {
          const passed = await passCurrentAssignment(fullyPopulatedAssignment.id, fullyPopulatedAssignment.userId, true);
          if (passed) {
            fullyPopulatedAssignment.isPassed = true;
            fullyPopulatedAssignment.passedByUserId = passed.passedByUserId;
          }
        }
      }

      if (fullyPopulatedAssignment && fullyPopulatedAssignment.clips) {
        if (!fullyPopulatedAssignment.activePrompt) {
          const randomPrompt = promptCatalog[Math.floor(Math.random() * promptCatalog.length)];

          await db.dailyAssignment.update({
             where: { id: fullyPopulatedAssignment.id },
             data: { activePrompt: randomPrompt.text, activePromptId: randomPrompt.id }
          });
          fullyPopulatedAssignment.activePrompt = randomPrompt.text;
          fullyPopulatedAssignment.activePromptId = randomPrompt.id;
        } else if (!fullyPopulatedAssignment.activePromptId) {
          const catalogPrompt = promptCatalog.find((prompt) => {
            if (prompt.text === fullyPopulatedAssignment.activePrompt) return true;
            if (!prompt.translations || typeof prompt.translations !== "object" || Array.isArray(prompt.translations)) return false;
            return Object.values(prompt.translations).includes(fullyPopulatedAssignment.activePrompt);
          });
          if (catalogPrompt) {
            await db.dailyAssignment.update({
              where: { id: fullyPopulatedAssignment.id },
              data: { activePromptId: catalogPrompt.id },
            });
            fullyPopulatedAssignment.activePromptId = catalogPrompt.id;
          }
        }

        for (const clip of fullyPopulatedAssignment.clips) {
          if (!clip.thumbnailUrl || !clip.thumbnailBlurUrl) {
            const updated = await generateMissingThumbnails(clip.id);
            if (updated) {
              clip.thumbnailUrl = updated.thumbnailUrl;
              clip.thumbnailBlurUrl = updated.thumbnailBlurUrl;
            }
          }

          let finalHls = clip.hlsUrl;
          if (finalHls && mustEnforceSd) {
             finalHls = finalHls.replace("master.m3u8", "stream_2/playlist.m3u8");
          }

          if (finalHls) {
            clip.hlsUrl = finalHls.startsWith("http") || finalHls.startsWith("/") 
              ? finalHls 
              : generateEdgeUrl("vlogs", finalHls, 3600, clip.storageTier);
          }

          // Legacy clients receive the durable media URL in videoUrl even
          // though that compatibility field is not stored in the database.
          Object.assign(clip, {
            videoUrl: publicClipPlaybackUrl(
              clip,
              clip.transcodeStatus === "COMPLETED" ? clip.hlsUrl : null,
            ),
          });

          clip.thumbnailUrl = clip.thumbnailUrl.startsWith("http") || clip.thumbnailUrl.startsWith("/") 
            ? clip.thumbnailUrl 
            : generateEdgeUrl("vlogs", clip.thumbnailUrl, 3600, clip.storageTier);

          const thumbnailBlurTarget = clip.thumbnailBlurUrl || clip.thumbnailUrl;
          clip.thumbnailBlurUrl = thumbnailBlurTarget.startsWith("http") || thumbnailBlurTarget.startsWith("/") 
            ? thumbnailBlurTarget 
            : generateEdgeUrl("vlogs", thumbnailBlurTarget, 3600, clip.storageTier);

          clip.photoResponses = publicResponseMediaUrls(hlsSafeResponses(clip.photoResponses), clip.storageTier);
        }
      }

      const vloggerClipStats = fullyPopulatedAssignment
        ? await db.clip.findMany({
            where: {
              userId: fullyPopulatedAssignment.userId,
              transcodeStatus: "COMPLETED",
            },
            select: {
              _count: {
                select: {
                  reactions: true,
                  comments: true,
                },
              },
            },
          })
        : [];
      const assignmentWithMetrics = fullyPopulatedAssignment
        ? {
            ...fullyPopulatedAssignment,
            activePrompt: localizePromptText(fullyPopulatedAssignment.activePrompt, promptCatalog, locale),
            user: {
              ...fullyPopulatedAssignment.user,
              vlogCount: vloggerClipStats.length,
              likeCount: vloggerClipStats.reduce((sum, clip) => sum + clip._count.reactions, 0),
              commentCount: vloggerClipStats.reduce((sum, clip) => sum + clip._count.comments, 0),
            },
          }
        : null;

      return NextResponse.json({ 
        success: true, 
        assignment: assignmentWithMetrics,
        assignmentAvailability: {
          status: "assigned",
          memberCount: group.members.length,
          minimumMemberCount: MIN_MEMBERS_FOR_DAILY_ASSIGNMENT,
        },
        isSleepMode: circadian.isSleepMode,
        sleepTimeLeftSeconds: circadian.sleepTimeLeftSeconds,
        wakingTimeLeftSeconds: circadian.wakingTimeLeftSeconds,
        hasVolunteered,
        canVolunteer,
        volunteerEligibilityReason,
        dailyPrompt,
      });
    }

    if (intent === "getLatestCompilation") {
      if (!groupId) {
        return NextResponse.json({ error: "Group details unresolved" }, { status: 400 });
      }

      const group = await db.group.findUnique({
        where: { id: groupId },
        include: { boosts: true, members: true }
      });

      if (!group) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }

      const isMember = group.members.some(m => m.userId === session.user.id);
      if (!isMember) {
        return NextResponse.json({ error: "Unauthorized. Not a member of this group." }, { status: 403 });
      }

      const isGroupPro = (group.boosts?.length || 0) >= 3;
      const isFrozen = group.isFrozen;
      const mustEnforceSd = (!isUserPro && !isGroupPro) || isFrozen;
      const circadian = getVlogCircadianState(group.timezone);

      const assignment = await db.dailyAssignment.findFirst({
        where: { 
          groupId, 
          status: "completed",
          date: { lt: circadian.businessDate } 
        },
        orderBy: { date: "desc" },
        include: {
          user: { select: { id: true, name: true, image: true, handle: true } },
          clips: { 
            where: { transcodeStatus: "COMPLETED" },
            orderBy: { recordedAt: "asc" },
            include: {
              photoResponses: {
                include: { user: { select: { id: true, name: true, image: true, handle: true } } },
              }
            }
          }
        }
      });

      if (!assignment || assignment.clips.length === 0) {
        return NextResponse.json({ success: false });
      }

      const resolvedClips: unknown[] = [];
      for (const clip of assignment.clips) {
        let activeClip = clip;
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
           finalHls = finalHls.replace("master.m3u8", "stream_2/playlist.m3u8");
        }

        const hlsUrl = activeClip.transcodeStatus === "COMPLETED" && finalHls
          ? (finalHls.startsWith("http") || finalHls.startsWith("/") 
              ? finalHls 
              : generateEdgeUrl("vlogs", finalHls, 3600, activeClip.storageTier))
          : null;

        const videoUrl = publicClipPlaybackUrl(activeClip, hlsUrl);

        const thumbnailUrl = activeClip.thumbnailUrl.startsWith("http") || activeClip.thumbnailUrl.startsWith("/") 
          ? activeClip.thumbnailUrl 
          : generateEdgeUrl("vlogs", clip.thumbnailUrl, 3600, activeClip.storageTier);

        const thumbnailBlurTarget = activeClip.thumbnailBlurUrl || activeClip.thumbnailUrl;
        const thumbnailBlurUrl = thumbnailBlurTarget.startsWith("http") || thumbnailBlurTarget.startsWith("/") 
          ? thumbnailBlurTarget 
          : generateEdgeUrl("vlogs", thumbnailBlurTarget, 3600, clip.storageTier);

        activeClip.photoResponses = publicResponseMediaUrls(hlsSafeResponses(activeClip.photoResponses), clip.storageTier);

        resolvedClips.push({
          ...activeClip,
          videoUrl,
          hlsUrl,
          thumbnailUrl,
          thumbnailBlurUrl,
        });
      }

      return NextResponse.json({
        success: true,
        assignment: {
          ...assignment,
          activePrompt: await getLocalizedPromptForUser(assignment.activePrompt, session.user.id, req),
          clips: resolvedClips,
        }
      });
    }

    if (intent === "getSignedReadUrl") {
      const bucket = searchParams.get("bucket");
      const path = searchParams.get("path");

      if (!bucket || !path) {
        return NextResponse.json({ error: "Missing parameters." }, { status: 400 });
      }

      const authorization = await authorizeMediaRead(session.user.id, bucket, path);
      if (!authorization) return NextResponse.json({ error: "Media not found or access denied." }, { status: 403 });

      const url = generateEdgeUrl(bucket, authorization.path, 3600, authorization.storageTier);
      return NextResponse.json({ success: true, url });
    }

    if (intent === "getClip") {
      const clipId = searchParams.get("clipId");
      if (!clipId) {
        return NextResponse.json({ error: "Missing clipId parameter" }, { status: 400 });
      }

      const clip = await db.clip.findUnique({
        where: { id: clipId },
        include: {
          reactions: true,
          photoResponses: {
            orderBy: { createdAt: "asc" },
            include: { user: { select: { id: true, name: true, image: true, handle: true } } },
          },
          comments: {
            orderBy: { createdAt: "asc" },
            include: {
              user: { select: { id: true, name: true, image: true, handle: true } },
              likes: { where: { userId: session.user.id }, select: { userId: true } },
              _count: { select: { likes: true } },
            },
          },
          views: {
            include: { user: { select: { id: true, name: true, image: true, handle: true } } },
          },
        },
      });

      if (!clip) {
        return NextResponse.json({ error: "Clip not found" }, { status: 404 });
      }

      const isMember = await db.groupMember.findUnique({ where: { groupId_userId: { groupId: clip.groupId, userId: session.user.id } } });
      if (!isMember) {
        return NextResponse.json({ error: "Unauthorized. Not a member of this group." }, { status: 403 });
      }

      const group = await db.group.findUnique({ where: { id: clip.groupId }, include: { boosts: true } });
      const isGroupPro = (group?.boosts?.length || 0) >= 3;
      const isFrozen = group?.isFrozen || false;
      const mustEnforceSd = (!isUserPro && !isGroupPro) || isFrozen;

      if (isArchiveLocked(clip.recordedAt, isUserPro, isGroupPro, isFrozen, group?.timezone || "UTC")) {
        return NextResponse.json({ error: "Bu arşiv kilitlidir. Kilidi açmak için MyTurn Pro'ya geçin! 🔒" }, { status: 403 });
      }

      if (!clip.thumbnailUrl || !clip.thumbnailBlurUrl) {
        const updated = await generateMissingThumbnails(clip.id);
        if (updated) {
          clip.thumbnailUrl = updated.thumbnailUrl;
          clip.thumbnailBlurUrl = updated.thumbnailBlurUrl;
        }
      }

      let finalHls = clip.hlsUrl;
      if (finalHls && mustEnforceSd) {
         finalHls = finalHls.replace("master.m3u8", "stream_2/playlist.m3u8");
      }

      if (finalHls) {
        clip.hlsUrl = finalHls.startsWith("http") || finalHls.startsWith("/") 
          ? finalHls 
          : generateEdgeUrl("vlogs", finalHls, 3600, clip.storageTier);
      }

      Object.assign(clip, {
        videoUrl: publicClipPlaybackUrl(
          clip,
          clip.transcodeStatus === "COMPLETED" ? clip.hlsUrl : null,
        ),
      });

      clip.thumbnailUrl = clip.thumbnailUrl.startsWith("http") || clip.thumbnailUrl.startsWith("/") 
        ? clip.thumbnailUrl 
        : generateEdgeUrl("vlogs", clip.thumbnailUrl, 3600, clip.storageTier);

      const thumbnailBlurTarget = clip.thumbnailBlurUrl || clip.thumbnailUrl;
      clip.thumbnailBlurUrl = thumbnailBlurTarget.startsWith("http") || thumbnailBlurTarget.startsWith("/") 
        ? thumbnailBlurTarget 
        : generateEdgeUrl("vlogs", thumbnailBlurTarget, 3600, clip.storageTier);

      clip.photoResponses = publicResponseMediaUrls(hlsSafeResponses(clip.photoResponses), clip.storageTier);

      return NextResponse.json({ success: true, clip });
    }

    return NextResponse.json({ error: "Invalid intent query." }, { status: 400 });
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

    const body = await req.json();
    const { action, ...args } = body;

    if (action === "createClip") {
      return NextResponse.json(
        { error: "This upload flow has been replaced by the bounded multipart API." },
        { status: 410 },
      );
      /* Legacy single-object upload flow intentionally disabled.
      const { groupId, assignmentId, location, caption, duration, metadata, mediaType } = args;

      const rl = await rateLimit(`create_clip_${session.user.id}`, 5, 60000);
      if (!rl.success) return NextResponse.json({ error: `You're posting too fast! Try again in ${rl.retryAfter}s.` }, { status: 429 });

      const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
      if (!group) return NextResponse.json({ error: "Group parameters unresolved" }, { status: 400 });

      const isMember = group.members.some(m => m.userId === session.user.id);
      if (!isMember) return NextResponse.json({ error: "Bu gruba üye değilsiniz." }, { status: 403 });

      if (group.isFrozen) {
        return NextResponse.json({ error: "Grup donduruldu. Devam etmek için boost ekleyin veya üye sayısını azaltın." }, { status: 403 });
      }

      let parsedMetadata: any = {};
      if (metadata) {
        try {
          parsedMetadata = JSON.parse(metadata);
        } catch {
          parsedMetadata = {};
        }
      }
      
      const resolvedMediaType = mediaType || "vlog";
      const isPhoto = resolvedMediaType === "photo";

      if (resolvedMediaType === "vlog" && (duration === undefined || duration < 5 || duration > 120)) {
        return NextResponse.json({ error: "Video clip must be between 5 and 120 seconds." }, { status: 400 });
      }
      if (resolvedMediaType === "snippet" && (duration === undefined || duration < 2 || duration > 4)) {
        return NextResponse.json({ error: "Snippet must be between 2 and 4 seconds." }, { status: 400 });
      }

      const assignment = await db.dailyAssignment.findUnique({ where: { id: assignmentId } });
      if (!assignment) return NextResponse.json({ error: "Active daily assignment not found" }, { status: 404 });
      if (assignment.userId !== session.user.id) return NextResponse.json({ error: "It is not your turn to vlog today!" }, { status: 403 });

      const fileId = randomUUID();
      const videoExt = isPhoto ? "jpg" : "mp4";
      const videoContentType = isPhoto ? "image/jpeg" : "video/mp4";
      const videoPath = `${groupId}/${assignmentId}/${fileId}-media.${videoExt}`;
      const thumbPath = `${groupId}/${assignmentId}/${fileId}-thumb.jpg`;
      const blurPath = `${groupId}/${assignmentId}/${fileId}-thumb-blur.jpg`;

      if (caption && caption.trim()) {
        parsedMetadata.caption = caption.trim();
      }

      const payload: any = {
        assignmentId,
        userId: session.user.id,
        groupId,
        videoUrl: videoPath,
        thumbnailUrl: thumbPath,
        thumbnailBlurUrl: blurPath,
        location: location || null,
        transcodeStatus: "UPLOADING",
        storageTier: "HOT",
        mediaType: resolvedMediaType,
        metadata: JSON.stringify(parsedMetadata)
      };

      let clip;
      try {
        clip = await db.clip.create({ data: payload });
      } catch (dbErr: unknown) {
        if (dbErr instanceof Error && dbErr.message.includes('Unknown arg')) {
          reportWarning(
            "vlog.create_clip_stale_prisma_client",
            dbErr,
            { action: "createClip" },
            "Retrying clip creation with a safe baseline payload",
          );
          delete payload.metadata;
          delete payload.mediaType;
          clip = await db.clip.create({ data: payload });
        } else {
          throw dbErr;
        }
      }

      const videoUploadUrl = await r2.getSignedUploadUrl("vlogs", videoPath, videoContentType);
      const thumbUploadUrl = await r2.getSignedUploadUrl("vlogs", thumbPath, "image/jpeg");
      const blurUploadUrl = await r2.getSignedUploadUrl("vlogs", blurPath, "image/jpeg");

      return NextResponse.json({
        success: true,
        clip,
        uploadUrls: {
          video: videoUploadUrl,
          thumb: thumbUploadUrl,
          thumbBlur: blurUploadUrl,
        }
      }, { status: 201 });
      */
    }

    if (action === "passTurn") {
      const { assignmentId } = args;
      const updated = await passCurrentAssignment(assignmentId, session.user.id);
      if (!updated) return NextResponse.json({ error: "Assignment can no longer be passed." }, { status: 409 });

      for (const m of updated.group.members) {
        if (m.userId !== session.user.id) {
          await sendPushToUser(m.userId, {
            category: "turns",
            key: "cameraAvailable",
            deepLink: { screen: "today", groupId: updated.groupId, assignmentId: updated.id }
          });
        }
      }

      return NextResponse.json({
        success: true,
        assignment: {
          ...updated,
          activePrompt: await getLocalizedPromptForUser(updated.activePrompt, session.user.id, req),
        },
      });
    }

    if (action === "claimTurn") {
      const { assignmentId } = args;
      const updated = await claimCurrentAssignment(assignmentId, session.user.id);
      if (!updated) return NextResponse.json({ error: "Assignment was already claimed or is no longer available." }, { status: 409 });

      const claimer = await db.profile.findUnique({ where: { id: session.user.id } });

      for (const m of updated.group.members) {
        if (m.userId !== session.user.id) {
          await sendPushToUser(m.userId, {
            category: "turns",
            key: "cameraClaimed",
            vars: { actor: claimer?.name },
            deepLink: { screen: "today", groupId: updated.groupId, assignmentId: updated.id }
          });
        }
      }

      return NextResponse.json({
        success: true,
        assignment: {
          ...updated,
          activePrompt: await getLocalizedPromptForUser(updated.activePrompt, session.user.id, req),
        },
      });
    }

    if (action === "requestPhotoResponseUpload") {
      const { clipId, mediaType } = args;
      if (!clipId) {
        return NextResponse.json({ error: "Missing clipId parameter" }, { status: 400 });
      }

      const clip = await db.clip.findUnique({
        where: { id: clipId },
        select: { groupId: true, assignmentId: true, recordedAt: true }
      });

      if (!clip) {
        return NextResponse.json({ error: "Clip not found" }, { status: 404 });
      }

      const responseUploadLimit = await rateLimit(`response_upload_${session.user.id}`, 10, 60_000);
      if (!responseUploadLimit.success) return NextResponse.json({ error: "Too many upload attempts." }, { status: 429 });
      if (mediaType !== undefined && mediaType !== "photo") {
        return NextResponse.json({ error: "Photo responses only support images." }, { status: 400 });
      }
      const existingResponse = await db.photoResponse.findUnique({
        where: { clipId_userId: { clipId, userId: session.user.id } },
        select: { id: true, imageUrl: true, mediaType: true, transcodeStatus: true },
      });
      if (existingResponse?.mediaType === "photo") {
        return NextResponse.json({ error: "You already responded to this clip." }, { status: 409 });
      }
      const activeGrants = await db.mediaUploadGrant.count({
        where: { userId: session.user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      });
      if (activeGrants >= 3) return NextResponse.json({ error: "Too many active media uploads." }, { status: 429 });

      const member = await db.groupMember.findUnique({ where: { groupId_userId: { groupId: clip.groupId, userId: session.user.id } } });
      if (!member) return NextResponse.json({ error: "Bu gruba üye değilsiniz." }, { status: 403 });

      const isUserPro = await checkUserProStatus(session.user.id);
      const group = await db.group.findUnique({ where: { id: clip.groupId }, include: { boosts: true } });
      const isGroupPro = (group?.boosts?.length || 0) >= 3;
      const isFrozen = group?.isFrozen || false;
      
      if (isArchiveLocked(clip.recordedAt, isUserPro, isGroupPro, isFrozen, group?.timezone || "UTC")) {
        return NextResponse.json({ error: "Bu arşiv kilitlidir. Eylem gerçekleştirilemez." }, { status: 403 });
      }

      const resolvedMediaType = "photo";
      const ext = "jpg";
      const contentType = "image/jpeg";
      const fileId = randomUUID();
      const path = `${clip.groupId}/${clip.assignmentId}/responses/${fileId}.${ext}`;
      await db.mediaUploadGrant.create({
        data: {
          path,
          userId: session.user.id,
          clipId,
          mediaType: resolvedMediaType,
          contentType,
          maxBytes: 5 * 1024 * 1024,
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      });
      const uploadUrl = await r2.getSignedUploadUrl("vlogs", path, contentType, 15 * 60);

      return NextResponse.json({ success: true, uploadUrl, path });
    }

    if (action === "skipPrompt") {
      const { assignmentId } = args;
      const assignment = await db.dailyAssignment.findUnique({ where: { id: assignmentId } });
      if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
      if (assignment.userId !== session.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      if (assignment.promptSkips >= 3) return NextResponse.json({ error: "No skips left" }, { status: 400 });

      const [prompts, locale] = await Promise.all([
        db.prompt.findMany({ select: { id: true, text: true, translations: true } }),
        getRequestLocale(req, session.user.id),
      ]);
      if (prompts.length === 0) {
        throw new AppError({
          code: "PROMPT_CATALOG_EMPTY",
          status: 503,
          safeMessage: "Prompt selection is temporarily unavailable.",
          cause: new Error("No prompts are configured"),
        });
      }

      let newPrompt = prompts[Math.floor(Math.random() * prompts.length)];
      
      for(let i=0; i<5; i++) {
         const candidate = prompts[Math.floor(Math.random() * prompts.length)];
         if (candidate && candidate.text !== assignment.activePrompt) {
           newPrompt = candidate;
           break;
         }
      }

      const updatedAssignment = await db.dailyAssignment.update({
        where: { id: assignmentId },
        data: {
          activePrompt: newPrompt.text,
          activePromptId: newPrompt.id,
          promptSkips: assignment.promptSkips + 1
        }
      });

      return NextResponse.json({
        success: true,
        activePrompt: localizePrompt(newPrompt, locale),
        promptSkips: updatedAssignment.promptSkips,
      });
    }

    if (action === "toggleVolunteer") {
      const { groupId } = args;
      if (!groupId) {
        return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
      }

      const member = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: session.user.id } },
        include: { group: { select: { timezone: true } } },
      });
      if (!member) return NextResponse.json({ error: "Bu gruba üye değilsiniz." }, { status: 403 });

      const memberCount = await db.groupMember.count({ where: { groupId } });
      if (memberCount < MIN_MEMBERS_FOR_DAILY_ASSIGNMENT) {
        return NextResponse.json({ error: "Vlogger seçimi için grupta en az iki üye olmalıdır." }, { status: 409 });
      }

      const localDate = await getLocalDateInTimezone(member.group.timezone);
      const existing = await db.volunteer.findUnique({
        where: {
          groupId_userId_targetDate: {
            groupId,
            userId: session.user.id,
            targetDate: localDate,
          }
        }
      });

      if (existing) {
        await db.volunteer.delete({ where: { id: existing.id } });
        return NextResponse.json({ success: true, hasVolunteered: false });
      } else {
        await db.volunteer.create({
          data: {
            groupId,
            userId: session.user.id,
            targetDate: localDate,
          }
        });
        return NextResponse.json({ success: true, hasVolunteered: true });
      }
    }

    if (action === "addPhotoResponse") {
      const { clipId, path, mediaType } = args;
      const rlPhoto = await rateLimit(`photo_res_${session.user.id}`, 15, 60000);
      if (!rlPhoto.success) {
        return NextResponse.json({ error: `Lütfen tekrar denemeden önce biraz bekleyin.` }, { status: 429 });
      }
      if (mediaType !== undefined && mediaType !== "photo") {
        return NextResponse.json({ error: "Photo responses only support images." }, { status: 400 });
      }

      if (typeof path !== "string") return NextResponse.json({ error: "Missing upload path." }, { status: 400 });
      const clip = await db.clip.findUnique({ where: { id: clipId }, select: { recordedAt: true, groupId: true, storageTier: true } });
      if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

      const member = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId: clip.groupId, userId: session.user.id } }
      });
      if (!member) return NextResponse.json({ error: "Bu gruba üye değilsiniz." }, { status: 403 });

      const isUserPro = await checkUserProStatus(session.user.id);
      const group = await db.group.findUnique({ where: { id: clip.groupId }, include: { boosts: true } });
      const isGroupPro = (group?.boosts?.length || 0) >= 3;
      const isFrozen = group?.isFrozen || false;
      
      if (isArchiveLocked(clip.recordedAt, isUserPro, isGroupPro, isFrozen, group?.timezone || "UTC")) {
        return NextResponse.json({ error: "Arşiv kilitlidir. Eylem gerçekleştirilemez." }, { status: 403 });
      }

      const existing = await db.photoResponse.findFirst({
        where: { clipId, userId: session.user.id },
      });

      if (existing?.mediaType === "photo") {
        return NextResponse.json({ error: "You already added a photo response to this clip." }, { status: 400 });
      }

      const grant = await db.mediaUploadGrant.findFirst({
        where: { path, clipId, userId: session.user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!grant || grant.mediaType !== "photo" || (mediaType && mediaType !== "photo")) {
        return NextResponse.json({ error: "Upload grant is invalid or expired." }, { status: 403 });
      }
      const object = await r2.head("vlogs", path).catch(() => null);
      if (!object || Number(object.ContentLength || 0) < 1 || Number(object.ContentLength) > grant.maxBytes || object.ContentType !== grant.contentType) {
        if (object) await r2.deleteObjects("vlogs", [path]).catch(() => {});
        return NextResponse.json({ error: "Uploaded response failed validation." }, { status: 400 });
      }

      const photoResponse = await db.$transaction(async (tx) => {
        const consumed = await tx.mediaUploadGrant.updateMany({
          where: { id: grant.id, consumedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        });
        if (consumed.count !== 1) throw new Error("Upload grant was already consumed.");
        if (existing) {
          const removedLegacySnippet = await tx.photoResponse.deleteMany({
            where: { id: existing.id, mediaType: { not: "photo" } },
          });
          if (removedLegacySnippet.count !== 1) throw new Error("Legacy response could not be replaced.");
        }
        return tx.photoResponse.create({
          data: {
            clipId,
            userId: session.user.id,
            imageUrl: path,
            mediaType: "photo",
            transcodeStatus: "COMPLETED",
          },
          include: { user: { select: { id: true, name: true, image: true, handle: true } } },
        });
      });

      if (existing) {
        deleteResponseStorageAssets(existing, clip.storageTier).catch((cleanupError) => {
          reportWarning(
            "photo_response.legacy_snippet_cleanup_failed",
            cleanupError,
            { photoResponseId: existing.id, clipId },
            "Legacy snippet response assets could not be removed",
          );
        });
      }

      try {
        const targetClip = await db.clip.findUnique({
          where: { id: clipId },
          include: { group: { select: { name: true } }, user: { select: { id: true } } },
        });

        if (photoResponse.mediaType === "photo" && targetClip && targetClip.userId !== session.user.id) {
          const responder = await db.profile.findUnique({ where: { id: session.user.id }, select: { name: true } });
          await sendPushToUser(targetClip.userId, {
            category: "interactions",
            key: "photoResponse",
            vars: { actor: responder?.name, group: targetClip.group.name },
            deepLink: { screen: "today", groupId: targetClip.groupId, clipId, focus: "responses", itemId: photoResponse.id },
          });
        }
      } catch (pushErr) {
        reportError("push.photo_response_failed", pushErr, { clipId });
      }

      const [publicPhotoResponse] = publicResponseMediaUrls([photoResponse], clip.storageTier);

      return NextResponse.json({
        success: true,
        photoResponse: publicPhotoResponse,
        processing: false,
        responseId: photoResponse.id,
      });
    }

    if (action === "pokeVlogger") {
      const { assignmentId } = args;
      if (typeof assignmentId !== "string" || assignmentId.length < 8 || assignmentId.length > 128) {
        return NextResponse.json({ error: "Invalid assignment." }, { status: 400 });
      }
      const rlPoke = await rateLimit(`poke_${session.user.id}`, 20, 60000);
      if (!rlPoke.success) {
        return NextResponse.json({ error: "Uygulama genelinde çok sık dürtü gönderiyorsunuz!" }, { status: 429 });
      }

      const THIRTY_MINUTES = 30 * 60 * 1000;
      
      const lastPoke = await db.poke.findFirst({
        where: { assignmentId, pokerId: session.user.id },
        orderBy: { createdAt: "desc" }
      });

      if (lastPoke) {
        const timeSince = Date.now() - new Date(lastPoke.createdAt).getTime();
        if (timeSince < THIRTY_MINUTES) {
          const minutesLeft = Math.ceil((THIRTY_MINUTES - timeSince) / 60000);
          return NextResponse.json({ error: `Tekrar dürtmek için ${minutesLeft}dk beklemelisiniz.` }, { status: 400 });
        }
      }

      const assignment = await db.dailyAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          group: { include: { members: true } },
          clips: {
            where: { finalizedAt: { not: null } },
            select: { recordedAt: true },
          },
        }
      });
      
      if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
      if (assignment.group.isFrozen) {
        return NextResponse.json({ error: "Grup donduruldu. Devam etmek için boost ekleyin." }, { status: 403 });
      }

      const isMember = assignment.group.members.some(m => m.userId === session.user.id);
      if (!isMember) {
        return NextResponse.json({ error: "Bu gruba üye değilsiniz." }, { status: 403 });
      }

      const circadian = getVlogCircadianState(assignment.group.timezone);
      const isToday = new Date(assignment.date).getTime() === circadian.businessDate.getTime();

      if (
        !isToday
        || assignment.isPassed
        || (assignment.status !== "active" && assignment.status !== "completed")
      ) {
        return NextResponse.json({ error: "Sadece bugünün aktif görevleri için dürtebilirsiniz." }, { status: 400 });
      }
      if (assignment.userId === session.user.id) {
        return NextResponse.json({ error: "Kendinizi dürtemezsiniz." }, { status: 400 });
      }

      const activePeriod = getVlogTimePeriodForHour(circadian.currentHour);
      if (activePeriod === null) {
        return NextResponse.json({ error: "Şu anda aktif bir paylaşım zaman aralığı yok." }, { status: 400 });
      }

      const hasPostedInActivePeriod = hasVlogInTimePeriod(
        assignment.clips.map((clip) => clip.recordedAt),
        assignment.group.timezone,
        activePeriod,
      );
      if (hasPostedInActivePeriod) {
        return NextResponse.json({ error: "Vlogger bu zaman aralığında zaten paylaşım yaptı." }, { status: 400 });
      }

      await db.poke.create({
        data: {
          assignmentId,
          pokerId: session.user.id
        }
      });

      const poker = await db.profile.findUnique({ where: { id: session.user.id } });
      await sendPushToUser(assignment.userId, {
        category: "reminders",
        key: "poke",
        vars: { actor: poker?.name, group: assignment.group.name },
        deepLink: { screen: "record", groupId: assignment.groupId, assignmentId: assignment.id }
      });
      
      return NextResponse.json({ success: true });
    }

    if (action === "toggleReaction") {
      const { clipId, emoji } = args;
      if (typeof clipId !== "string" || clipId.length < 8 || clipId.length > 128 ||
          typeof emoji !== "string" || !ALLOWED_REACTION_EMOJIS.has(emoji)) {
        return NextResponse.json({ error: "Invalid reaction." }, { status: 400 });
      }
      const reactionLimit = await rateLimit(`reaction_${session.user.id}`, 60, 60000);
      if (!reactionLimit.success) {
        return NextResponse.json({ error: "Too many reactions. Please slow down." }, { status: 429 });
      }
      const clip = await db.clip.findUnique({ where: { id: clipId }, select: { recordedAt: true, groupId: true } });
      if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

      const member = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId: clip.groupId, userId: session.user.id } }
      });
      if (!member) return NextResponse.json({ error: "Bu gruba üye değilsiniz." }, { status: 403 });

      const isUserPro = await checkUserProStatus(session.user.id);
      const group = await db.group.findUnique({ where: { id: clip.groupId }, include: { boosts: true } });
      const isGroupPro = (group?.boosts?.length || 0) >= 3;
      const isFrozen = group?.isFrozen || false;
      
      if (isArchiveLocked(clip.recordedAt, isUserPro, isGroupPro, isFrozen, group?.timezone || "UTC")) {
        return NextResponse.json({ error: "Arşiv kilitlidir. Eylem gerçekleştirilemez." }, { status: 403 });
      }

      const existing = await db.reaction.findUnique({
        where: { clipId_userId_emoji: { clipId, userId: session.user.id, emoji } },
      });

      if (existing) {
        await db.reaction.delete({ where: { id: existing.id } });
        return NextResponse.json({ success: true, removed: true });
      }

      let reaction;
      try {
        reaction = await db.reaction.create({
          data: { clipId, userId: session.user.id, emoji },
        });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const concurrentReaction = await db.reaction.findUnique({
            where: { clipId_userId_emoji: { clipId, userId: session.user.id, emoji } },
          });
          return NextResponse.json({ success: true, reaction: concurrentReaction, unchanged: true });
        }
        throw error;
      }

      const newlyUnlocked: string[] = [];
      const totalReactions = await db.reaction.count({ where: { userId: session.user.id } });
      if (totalReactions >= 100) {
        const isNew = await checkAndUnlockAchievement(session.user.id, "hype-man");
        if (isNew) newlyUnlocked.push("hype-man");
      }

      try {
        const targetClip = await db.clip.findUnique({
          where: { id: clipId },
          include: { group: { select: { name: true } } },
        });

        if (targetClip && targetClip.userId !== session.user.id) {
          const reactor = await db.profile.findUnique({ where: { id: session.user.id }, select: { name: true } });
          await sendPushToUser(targetClip.userId, {
            category: "interactions",
            key: "reaction",
            vars: { actor: reactor?.name, group: targetClip.group.name, emoji },
            deepLink: { screen: "today", groupId: targetClip.groupId, clipId, focus: "reactions", itemId: reaction.id, userId: session.user.id },
          });
        }
      } catch (pushErr) {
        reportError("push.reaction_failed", pushErr, { clipId });
      }

      return NextResponse.json({ success: true, reaction, newlyUnlocked });
    }

    if (action === "toggleCommentLike") {
      const { commentId } = args;
      if (typeof commentId !== "string" || commentId.length < 8 || commentId.length > 128) {
        return NextResponse.json({ error: "Invalid comment." }, { status: 400 });
      }

      const likeLimit = await rateLimit(`comment_like_${session.user.id}`, 60, 60000);
      if (!likeLimit.success) {
        return NextResponse.json({ error: "Too many likes. Please slow down." }, { status: 429 });
      }

      const comment = await db.comment.findUnique({
        where: { id: commentId },
        select: {
          id: true,
          clip: { select: { groupId: true, recordedAt: true } },
        },
      });
      if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

      const member = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId: comment.clip.groupId, userId: session.user.id } },
      });
      if (!member) return NextResponse.json({ error: "Bu gruba üye değilsiniz." }, { status: 403 });

      const [isUserPro, group] = await Promise.all([
        checkUserProStatus(session.user.id),
        db.group.findUnique({ where: { id: comment.clip.groupId }, include: { boosts: true } }),
      ]);
      const isGroupPro = (group?.boosts?.length || 0) >= 3;
      const isFrozen = group?.isFrozen || false;
      if (isArchiveLocked(comment.clip.recordedAt, isUserPro, isGroupPro, isFrozen, group?.timezone || "UTC")) {
        return NextResponse.json({ error: "Arşiv kilitlidir. Eylem gerçekleştirilemez." }, { status: 403 });
      }

      const existing = await db.commentLike.findUnique({
        where: { commentId_userId: { commentId, userId: session.user.id } },
        select: { id: true },
      });

      let liked = true;
      if (existing) {
        await db.commentLike.delete({ where: { id: existing.id } });
        liked = false;
      } else {
        try {
          await db.commentLike.create({ data: { commentId, userId: session.user.id } });
        } catch (error: unknown) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
            throw error;
          }
        }
      }

      const likeCount = await db.commentLike.count({ where: { commentId } });
      return NextResponse.json({ success: true, commentId, liked, likeCount });
    }

    if (action === "addComment") {
      const { clipId, text: rawText, parentId: rawParentId } = args;
      const text = typeof rawText === "string" ? rawText.trim() : "";
      const parentId = rawParentId == null || rawParentId === "" ? null : rawParentId;
      if (typeof clipId !== "string" || clipId.length < 8 || clipId.length > 128 ||
          !text || text.length > MAX_COMMENT_LENGTH ||
          (parentId !== null && (typeof parentId !== "string" || parentId.length < 8 || parentId.length > 128))) {
        return NextResponse.json({ error: `Comments must contain 1-${MAX_COMMENT_LENGTH} characters.` }, { status: 400 });
      }
      const rlComm = await rateLimit(`comment_${session.user.id}`, 15, 60000);
      if (!rlComm.success) {
        return NextResponse.json({ error: `Çok hızlı yorum yapıyorsunuz. Yavaşlayın! ${rlComm.retryAfter}s sonra tekrar deneyin.` }, { status: 429 });
      }

      const clip = await db.clip.findUnique({ where: { id: clipId }, select: { groupId: true, userId: true, recordedAt: true } });
      if (!clip) return NextResponse.json({ error: "Target clip parameters unresolved" }, { status: 404 });

      const member = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId: clip.groupId, userId: session.user.id } }
      });
      if (!member) return NextResponse.json({ error: "Bu gruba üye değilsiniz." }, { status: 403 });

      const isUserPro = await checkUserProStatus(session.user.id);
      const group = await db.group.findUnique({ where: { id: clip.groupId }, include: { boosts: true } });
      const isGroupPro = (group?.boosts?.length || 0) >= 3;
      const isFrozen = group?.isFrozen || false;
      
      if (isArchiveLocked(clip.recordedAt, isUserPro, isGroupPro, isFrozen, group?.timezone || "UTC")) {
        return NextResponse.json({ error: "Arşiv kilitlidir. Yorum gönderilemez." }, { status: 403 });
      }

      const parentComment = parentId
        ? await db.comment.findFirst({
            where: { id: parentId, clipId },
            select: { id: true, userId: true },
          })
        : null;
      if (parentId && !parentComment) {
        return NextResponse.json({ error: "The reply target does not belong to this clip." }, { status: 400 });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const commentsBeforeCreate = await db.comment.count({
        where: { userId: session.user.id, createdAt: { gte: today } },
      });
      if (commentsBeforeCreate >= MAX_DAILY_COMMENTS) {
        return NextResponse.json({ error: "Daily comment limit reached." }, { status: 429 });
      }

      let comment;
      try {
        comment = await db.comment.create({
          data: { clipId, userId: session.user.id, text, parentId: parentId || null },
          include: {
            user: { select: { id: true, name: true, image: true, handle: true } },
            likes: { where: { userId: session.user.id }, select: { userId: true } },
            _count: { select: { likes: true } },
          },
        });
      } catch (dbErr: unknown) {
        if (dbErr instanceof Error && dbErr.message.includes('Unknown arg')) {
          reportWarning(
            "vlog.add_comment_stale_prisma_client",
            dbErr,
            { action: "addComment", clipId },
            "Retrying comment creation with a safe baseline payload",
          );
          comment = await db.comment.create({
            data: { clipId, userId: session.user.id, text, parentId: parentId || null },
            include: { user: { select: { id: true, name: true, image: true } } },
          });
        } else {
          throw dbErr;
        }
      }

      const newlyUnlocked: string[] = [];
      const commentsWrittenToday = commentsBeforeCreate + 1;

      if (commentsWrittenToday * 10 <= 30) {
        const targetGroup = await db.group.findUnique({ where: { id: clip.groupId } });
        let multiplier = 1;
        
        if (targetGroup) {
          const circadian = getVlogCircadianState(targetGroup.timezone);
          const assignment = await db.dailyAssignment.findUnique({
             where: { groupId_date: { groupId: clip.groupId, date: circadian.businessDate } }
          });
          if (assignment?.userId === session.user.id && assignment?.isVolunteer) {
            multiplier = 1.5;
          }
        }

        const groupMember = await db.groupMember.findUnique({
          where: { groupId_userId: { groupId: clip.groupId, userId: session.user.id } },
        });

        if (groupMember && targetGroup) {
          const indivXp = Math.floor(10 * multiplier);
          await db.groupMember.update({
            where: { id: groupMember.id },
            data: { xp: groupMember.xp + indivXp, lastActiveAt: new Date() },
          });

          const groupXp = Math.floor(5 * multiplier);
          const nextGroupXp = targetGroup.xp + groupXp;
          await db.group.update({
            where: { id: targetGroup.id },
            data: { xp: nextGroupXp, level: calculateGroupLevel(nextGroupXp) },
          });
        }
      }

      const totalComments = await db.comment.count({ where: { userId: session.user.id } });
      if (totalComments >= 50) {
        const isNew = await checkAndUnlockAchievement(session.user.id, "directors-commentary");
        if (isNew) newlyUnlocked.push("directors-commentary");
      }

      try {
        const commenter = await db.profile.findUnique({
          where: { id: session.user.id },
          select: { name: true, handle: true },
        });
        const truncatedText = text.length > 60 ? `${text.substring(0, 57)}...` : text;
        const notifiedUserIds = new Set<string>();
        const mentionableMembers = await db.groupMember.findMany({
          where: { groupId: clip.groupId },
          select: { user: { select: { id: true, handle: true } } },
        });
        const mentionedUserIds = findMentionedUserIds(
          text,
          mentionableMembers.map(({ user }) => user),
        ).filter((userId) => userId !== session.user.id);

        await Promise.all(mentionedUserIds.map(async (userId) => {
          notifiedUserIds.add(userId);
          await sendPushToUser(userId, {
            category: "interactions",
            key: "mention",
            vars: { actor: commenter?.name || commenter?.handle, text: truncatedText },
            deepLink: { screen: "today", groupId: clip.groupId, clipId, focus: "comments", itemId: comment.id },
          });
        }));

        if (parentComment) {
          if (parentComment.userId !== session.user.id && !notifiedUserIds.has(parentComment.userId)) {
            notifiedUserIds.add(parentComment.userId);
            await sendPushToUser(parentComment.userId, {
              category: "interactions",
              key: "commentReply",
              vars: { actor: commenter?.name || commenter?.handle, text: truncatedText },
              deepLink: { screen: "today", groupId: clip.groupId, clipId, focus: "comments", itemId: comment.id },
            });
          }
        }

        const targetClip = await db.clip.findUnique({
          where: { id: clipId },
          include: { group: { select: { name: true } } },
        });

        if (targetClip && targetClip.userId !== session.user.id && !notifiedUserIds.has(targetClip.userId)) {
          await sendPushToUser(targetClip.userId, {
            category: "interactions",
            key: "comment",
            vars: { actor: commenter?.name || commenter?.handle, text: truncatedText },
            deepLink: { screen: "today", groupId: targetClip.groupId, clipId, focus: "comments", itemId: comment.id },
          });
        }
      } catch (pushErr) {
        reportError("push.comment_failed", pushErr, { clipId });
      }

      return NextResponse.json({ success: true, comment, newlyUnlocked }, { status: 201 });
    }

    if (action === "trackView") {
      const { clipId } = args;
      const clip = await db.clip.findUnique({ where: { id: clipId }, select: { groupId: true, views: true, userId: true, recordedAt: true } });
      if (!clip) return NextResponse.json({ error: "Clip details unresolved" }, { status: 404 });

      const member = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId: clip.groupId, userId: session.user.id } }
      });
      if (!member) return NextResponse.json({ error: "Bu gruba üye değilsiniz." }, { status: 403 });

      const isUserPro = await checkUserProStatus(session.user.id);
      const group = await db.group.findUnique({ where: { id: clip.groupId }, include: { boosts: true } });
      const isGroupPro = (group?.boosts?.length || 0) >= 3;
      const isFrozen = group?.isFrozen || false;

      if (isArchiveLocked(clip.recordedAt, isUserPro, isGroupPro, isFrozen, group?.timezone || "UTC")) {
        return NextResponse.json({ error: "Arşiv kilitlidir." }, { status: 403 });
      }

      if (clip.userId === session.user.id) {
        return NextResponse.json({ success: true, alreadyViewed: true, isOwnClip: true });
      }

      const existing = await db.view.findUnique({
        where: { clipId_userId: { clipId, userId: session.user.id } },
      });

      if (existing) return NextResponse.json({ success: true, alreadyViewed: true });

      const view = await db.view.create({
        data: { clipId, userId: session.user.id },
      });

      const newlyUnlocked: string[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const viewsRegisteredToday = await db.view.count({
        where: { userId: session.user.id, createdAt: { gte: today } },
      });

      if (viewsRegisteredToday * 5 <= 15) {
        const targetGroup = await db.group.findUnique({ where: { id: clip.groupId } });
        let multiplier = 1;
        
        if (targetGroup) {
          const circadian = getVlogCircadianState(targetGroup.timezone);
          const assignment = await db.dailyAssignment.findUnique({
             where: { groupId_date: { groupId: clip.groupId, date: circadian.businessDate } }
          });
          if (assignment?.userId === session.user.id && assignment?.isVolunteer) {
            multiplier = 1.5;
          }
        }

        const groupMember = await db.groupMember.findUnique({
          where: { groupId_userId: { groupId: clip.groupId, userId: session.user.id } },
        });

        if (groupMember && targetGroup) {
          const indivXp = Math.floor(5 * multiplier);
          await db.groupMember.update({
            where: { id: groupMember.id },
            data: { xp: groupMember.xp + indivXp, lastActiveAt: new Date() },
          });

          const groupXp = Math.floor(2 * multiplier);
          const nextGroupXp = targetGroup.xp + groupXp;
          await db.group.update({
            where: { id: targetGroup.id },
            data: { xp: nextGroupXp, level: calculateGroupLevel(nextGroupXp) },
          });
        }
      }

      const viewsOnThisClip = await db.view.count({ where: { clipId } });
      if (viewsOnThisClip === 1) {
        const firstViewsCount = await db.view.count({
          where: {
            userId: session.user.id,
            clip: { views: { some: { userId: session.user.id } } },
          },
        });
        if (firstViewsCount >= 10) {
          const isNew = await checkAndUnlockAchievement(session.user.id, "first-responder", clip.groupId);
          if (isNew) newlyUnlocked.push("first-responder");
        }
      }

      return NextResponse.json({ success: true, view, newlyUnlocked });
    }

    if (action === "completeUpload") {
      const { clipId } = args;
      const result = await completeUpload(clipId, false, session.user.id);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Invalid POST action parameter." }, { status: 400 });
  } catch (error: unknown) {
    throw error;
  }
}

async function deleteResponseStorageAssets(response: {
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  thumbnailBlurUrl?: string | null;
  hlsUrl?: string | null;
}, storageTier: string) {
  const directKeys = [response.imageUrl, response.thumbnailUrl, response.thumbnailBlurUrl]
    .filter((key): key is string => Boolean(key && !key.startsWith("http") && !key.startsWith("/")));
  const useColdStorage = storageTier === "COLD" || storageTier === "PRUNED";
  const useBothStores = storageTier === "MIGRATING";
  const hotKeys = new Set(useColdStorage ? [] : directKeys);
  const coldKeys = new Set(useColdStorage || useBothStores ? directKeys : []);

  if (response.hlsUrl && !response.hlsUrl.startsWith("http") && !response.hlsUrl.startsWith("/")) {
    const hlsPrefix = response.hlsUrl.includes("/")
      ? `${response.hlsUrl.substring(0, response.hlsUrl.lastIndexOf("/"))}/`
      : "";
    if (hlsPrefix) {
      if (!useColdStorage) {
        (await r2.listObjects("vlogs", hlsPrefix)).forEach((key) => hotKeys.add(key));
      }
      if (useColdStorage || useBothStores) {
        (await b2.listObjects("vlogs", hlsPrefix)).forEach((key) => coldKeys.add(key));
      }
    }
  }

  await Promise.all([
    hotKeys.size ? r2.deleteObjects("vlogs", Array.from(hotKeys)) : Promise.resolve(),
    coldKeys.size ? b2.deleteObjects("vlogs", Array.from(coldKeys)) : Promise.resolve(),
  ]);
}

async function deleteClipStorageAssets(clip: {
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  thumbnailBlurUrl?: string | null;
  hlsUrl?: string | null;
  photoResponses?: Array<{
    imageUrl?: string | null;
    thumbnailUrl?: string | null;
    thumbnailBlurUrl?: string | null;
    hlsUrl?: string | null;
  }>;
}) {
  const assetKeys = new Set<string>();

  if (clip.imageUrl) assetKeys.add(clip.imageUrl);
  if (clip.thumbnailUrl) assetKeys.add(clip.thumbnailUrl);
  if (clip.thumbnailBlurUrl && clip.thumbnailBlurUrl !== clip.thumbnailUrl) {
    assetKeys.add(clip.thumbnailBlurUrl);
  }

  if (clip.hlsUrl) {
    const hlsDir = clip.hlsUrl.includes("/") ? clip.hlsUrl.substring(0, clip.hlsUrl.lastIndexOf("/")) : "";
    if (hlsDir) {
      const hlsKeys = await r2.listObjects("vlogs", `${hlsDir}/`);
      hlsKeys.forEach((key) => assetKeys.add(key));
    }
    assetKeys.add(clip.hlsUrl);
  }

  for (const response of clip.photoResponses || []) {
    if (response.imageUrl) assetKeys.add(response.imageUrl);
    if (response.thumbnailUrl) assetKeys.add(response.thumbnailUrl);
    if (response.thumbnailBlurUrl) assetKeys.add(response.thumbnailBlurUrl);
    if (response.hlsUrl) {
      const hlsDir = response.hlsUrl.includes("/")
        ? response.hlsUrl.substring(0, response.hlsUrl.lastIndexOf("/"))
        : "";
      if (hlsDir) {
        const hlsKeys = await r2.listObjects("vlogs", `${hlsDir}/`);
        hlsKeys.forEach((key) => assetKeys.add(key));
      }
      assetKeys.add(response.hlsUrl);
    }
  }

  if (assetKeys.size > 0) {
    await r2.deleteObjects("vlogs", Array.from(assetKeys));
  }
}

async function DELETEHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const intent = searchParams.get("intent");
    const id = searchParams.get("id");

    if (!intent || !id) {
      return NextResponse.json({ error: "Missing intent or id delete parameters." }, { status: 400 });
    }

    if (intent === "deleteClip") {
      const clip = await db.clip.findUnique({ where: { id }, include: { photoResponses: true } });
      if (!clip || clip.userId !== session.user.id) {
        return NextResponse.json({ error: "Unauthorized to delete" }, { status: 403 });
      }

      try {
        await deleteClipStorageAssets(clip);
      } catch (storageError: unknown) {
        reportError("storage.clip_asset_cleanup_failed", storageError, { clipId: id });
      }

      await db.clip.delete({ where: { id } });
      return NextResponse.json({ success: true });
    }

    if (intent === "deleteComment") {
      const comment = await db.comment.findUnique({ where: { id } });
      if (!comment || comment.userId !== session.user.id) {
        return NextResponse.json({ error: "Unauthorized to delete" }, { status: 403 });
      }
      await db.comment.delete({ where: { id } });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid intent style." }, { status: 400 });
  } catch (error: unknown) {
    throw error;
  }
}

export async function completeUpload(clipId: string, systemOverride: boolean = false, sessionUserId?: string) {
  return finalizeUploadedClip(clipId, systemOverride, sessionUserId);
}

export const GET = withApiHandler(GETHandler);

export const POST = withApiHandler(POSTHandler);

export const DELETE = withApiHandler(DELETEHandler);

export const dynamic = "force-dynamic";
