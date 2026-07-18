// ./app/api/streaks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { getVibeArchetype } from "@/lib/vibe";
import { generateEdgeUrl } from "@/lib/media-signing";
import { generateMissingThumbnails } from "@/lib/transcoder";
import { hlsSafeResponses, publicClipPlaybackUrl } from "@/lib/media-delivery";
import { checkUserProStatus, isArchiveLocked } from "../../../lib/pro-helper";
import { getBusinessClock } from "@/lib/business-time";

async function GETHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const groupId = searchParams.get("groupId");

    if (!groupId) {
      return NextResponse.json({ error: "Missing groupId query parameter." }, { status: 400 });
    }

    const group = await db.group.findUnique({
      where: { id: groupId },
      include: {
        boosts: true,
        members: {
          include: {
            user: { select: { id: true, name: true, image: true } },
          },
        },
      },
    });

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const isMember = group.members.some(m => m.userId === session.user.id);
    if (!isMember) {
      return NextResponse.json({ error: "Unauthorized. Not a member of this group." }, { status: 403 });
    }

    const isUserPro = await checkUserProStatus(session.user.id);
    const isGroupPro = (group.boosts?.length || 0) >= 3;
    const isFrozen = group.isFrozen;
    const mustEnforceSd = (!isUserPro && !isGroupPro) || isFrozen;

    const friendsStreaks = group.members
      .map((member) => ({
        name: member.user.name || "Member",
        streak: member.streak,
        img: member.user.image,
        isMe: member.userId === session.user.id,
        xp: member.xp,
        archetype: getVibeArchetype(member.xp),
        rank: 1,
      }))
      .sort((a, b) => b.xp - a.xp)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    const rawAssignments = await db.dailyAssignment.findMany({
      where: { groupId },
      include: {
        user: { select: { id: true, name: true, handle: true, image: true } },
        clips: {
          where: { transcodeStatus: "COMPLETED" },
          orderBy: { recordedAt: "asc" },
          include: {
            photoResponses: {
              include: { user: { select: { id: true, name: true, image: true, handle: true } } },
            },
            comments: {
              orderBy: { createdAt: "asc" },
              include: { user: { select: { id: true, name: true, image: true, handle: true } } },
            },
            reactions: true,
            views: {
              include: { user: { select: { id: true, name: true, image: true, handle: true } } },
            },
          }
        }
      },
      orderBy: { date: "asc" },
    });

    const resolvedAssignments = await Promise.all(
      rawAssignments.map(async (asg) => {
        const locked = isArchiveLocked(asg.clips[0]?.recordedAt || asg.date, isUserPro, isGroupPro, isFrozen, group.timezone);
        if (locked) {
          return {
            ...asg,
            isLocked: true,
            clips: asg.clips.map((clip) => ({
              ...clip,
              videoUrl: "",
              hlsUrl: null,
              thumbnailUrl: "",
              thumbnailBlurUrl: null,
              photoResponses: [],
              comments: [],
              views: [],
              reactions: [],
              isLocked: true,
            })),
          };
        }
        const resolvedClips = asg.clips && asg.clips.length > 0
          ? await Promise.all(
            asg.clips.map(async (clip) => {
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
                 // Narrow token scope by targeting the SD stream directory directly
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
                : generateEdgeUrl("vlogs", activeClip.thumbnailUrl, 3600, activeClip.storageTier);

              const thumbnailBlurTarget = activeClip.thumbnailBlurUrl || activeClip.thumbnailUrl;
              const thumbnailBlurUrl = thumbnailBlurTarget.startsWith("http") || thumbnailBlurTarget.startsWith("/") 
                ? thumbnailBlurTarget 
                : generateEdgeUrl("vlogs", thumbnailBlurTarget, 3600, clip.storageTier);

              activeClip.photoResponses = hlsSafeResponses(activeClip.photoResponses);
              if (activeClip.photoResponses) {
                for (const pr of activeClip.photoResponses) {
                  if (!pr.imageUrl.startsWith("http") && !pr.imageUrl.startsWith("/")) {
                    pr.imageUrl = generateEdgeUrl("vlogs", pr.imageUrl, 3600, clip.storageTier);
                  }
                }
              }

              return {
                ...activeClip,
                videoUrl,
                hlsUrl,
                thumbnailUrl,
                thumbnailBlurUrl,
              };
            })
          )
          : [];
        return { ...asg, clips: resolvedClips, isLocked: false };
      })
    );

    const today = getBusinessClock(new Date(), group.timezone);
    const currentMonth = today.month - 1;
    const currentYear = today.year;
    const daysInMonth = new Date(Date.UTC(currentYear, currentMonth + 1, 0)).getUTCDate();

    const calendarDays = Array.from({ length: daysInMonth }).map((_, i) => {
      const dayNum = i + 1;
      const matchingAssignment = resolvedAssignments.find((asg) => {
        const d = new Date(asg.date);
        return d.getUTCDate() === dayNum && d.getUTCMonth() === currentMonth && d.getUTCFullYear() === currentYear;
      });
      
      if (matchingAssignment) {
        const hasClips = matchingAssignment.clips && matchingAssignment.clips.length > 0;
        const type = hasClips 
          ? "vlogged" 
          : (matchingAssignment.status === "missed" ? "missed" : "empty");

        return {
          d: dayNum,
          type,
          assignment: {
            id: matchingAssignment.id,
            user: matchingAssignment.user,
            clips: matchingAssignment.clips,
            date: matchingAssignment.date,
          }
        };
      }
      
      return {
        d: dayNum,
        type: "empty",
      };
    });

    const historicalDays = resolvedAssignments
      .filter(asg => (asg.status === "completed" || asg.status === "active") && asg.clips.length > 0)
      .map(asg => {
        const locked = asg.isLocked;
        return {
          id: asg.id,
          user: asg.user,
          clips: asg.clips.map(clip => ({
            ...clip,
            videoUrl: locked ? "" : clip.videoUrl,
            hlsUrl: locked ? "" : clip.hlsUrl,
            thumbnailUrl: locked ? "" : clip.thumbnailUrl,
            thumbnailBlurUrl: locked ? null : (clip.thumbnailBlurUrl || clip.thumbnailUrl),
            photoResponses: locked ? [] : clip.photoResponses,
            comments: locked ? [] : clip.comments,
            views: locked ? [] : clip.views,
            reactions: locked ? [] : clip.reactions,
            isLocked: locked,
          })),
          date: asg.date,
          isLocked: locked,
        };
      });

    const userMembership = group.members.find((m) => m.userId === session.user.id);
    let runningStreak = 0;
    let bestStreak = 0;
    for (const assignment of rawAssignments) {
      if (assignment.userId !== session.user.id) continue;

      if (assignment.status === "completed" || assignment.clips.length > 0) {
        runningStreak += 1;
        bestStreak = Math.max(bestStreak, runningStreak);
      } else if (assignment.status === "missed") {
        runningStreak = 0;
      }
    }
    bestStreak = Math.max(bestStreak, userMembership?.streak || 0);

    const totalClips = await db.clip.count({
      where: { groupId, userId: session.user.id, transcodeStatus: "COMPLETED" },
    });

    return NextResponse.json({
      success: true,
      currentStreak: userMembership?.streak || 0,
      bestStreak,
      totalVlogs: totalClips,
      friendsStreaks,
      calendarDays,
      historicalDays,
    });
  } catch (error: unknown) {
    throw error;
  }
}

export const GET = withApiHandler(GETHandler);

export const dynamic = "force-dynamic";
