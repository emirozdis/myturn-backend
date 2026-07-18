// app/api/social/route.ts
import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { sendPushToUser } from "@/lib/push-server";
import { rateLimit } from "@/lib/rate-limit";
import { generateEdgeUrl } from "@/lib/media-signing";
import { getBusinessDate } from "@/lib/business-time";

async function GETHandler() {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const memberships = await db.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            members: {
              include: {
                user: { select: { id: true, name: true, image: true } }
              }
            },
            _count: { select: { members: true } },
            clips: {
              where: { transcodeStatus: "COMPLETED" },
              orderBy: { recordedAt: "desc" },
              take: 1,
            },
            boosts: {
              include: {
                user: { select: { id: true, name: true, image: true } }
              }
            },
          },
        },
      },
    });

    const activeGroups = memberships.map((m) => {
      let imageUrl = m.group.image;
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = generateEdgeUrl("avatars", imageUrl, 3600, "HOT");
      }

      return {
        id: m.group.id,
        name: m.group.name,
        image: imageUrl,
        role: m.role,
        memberCount: m.group._count.members,
        members: m.group.members.map((gm) => {
          let memberAvatar = gm.user.image;
          if (memberAvatar && !memberAvatar.startsWith('http')) {
            memberAvatar = generateEdgeUrl("avatars", memberAvatar, 3600, "HOT");
          }
          return {
            id: gm.user.id,
            name: gm.user.name,
            image: memberAvatar,
          };
        }),
        lastVlogAt: m.group.clips[0]?.recordedAt.toISOString() || null,
        inviteCode: m.group.inviteCode,
        boostCount: m.group.boosts?.length || 0,
        hasBoosted: m.group.boosts?.some((b) => b.userId === userId) || false,
        boosters: m.group.boosts?.map(b => {
          let boosterAvatar = b.user.image;
          if (boosterAvatar && !boosterAvatar.startsWith('http')) {
            boosterAvatar = generateEdgeUrl("avatars", boosterAvatar, 3600, "HOT");
          }
          return {
            id: b.user.id,
            name: b.user.name,
            image: boosterAvatar,
          };
        }) || [],
      };
    });

    const friendships = await db.friendship.findMany({
      where: {
        OR: [{ requesterId: userId }, { addresseeId: userId }],
        status: "accepted",
      },
      include: {
        requester: { select: { id: true, name: true, handle: true, image: true } },
        addressee: { select: { id: true, name: true, handle: true, image: true } },
      },
    });

    const friendRecords = friendships.map((f) => {
      const friend = f.requesterId === userId ? f.addressee : f.requester;
      return friend;
    });
    const friendIds = friendRecords.map((friend) => friend.id);
    const sharedGroupIds = memberships.map((membership) => membership.groupId);
    const businessDateByGroup = new Map(
      memberships.map((membership) => [
        membership.groupId,
        getBusinessDate(membership.group.timezone).getTime(),
      ]),
    );
    const currentBusinessDates = Array.from(new Set(businessDateByGroup.values())).map((value) => new Date(value));
    const currentStoryAssignments = friendIds.length > 0 && sharedGroupIds.length > 0
      ? await db.dailyAssignment.findMany({
          where: {
            userId: { in: friendIds },
            groupId: { in: sharedGroupIds },
            date: { in: currentBusinessDates },
            clips: { some: { transcodeStatus: "COMPLETED" } },
          },
          select: { userId: true, groupId: true, date: true },
        })
      : [];
    const usersWithCurrentStory = new Set(
      currentStoryAssignments
        .filter((assignment) => assignment.date.getTime() === businessDateByGroup.get(assignment.groupId))
        .map((assignment) => assignment.userId),
    );

    const friends = friendRecords.map((friend) => {
      let friendAvatar = friend.image;
      if (friendAvatar && !friendAvatar.startsWith('http')) {
        friendAvatar = generateEdgeUrl("avatars", friendAvatar, 3600, "HOT");
      }

      return {
        id: friend.id,
        name: friend.name || "Member",
        handle: friend.handle || "",
        image: friendAvatar,
        status: "Friend",
        hasStory: usersWithCurrentStory.has(friend.id),
      };
    });

    const pendingRaw = await db.friendship.findMany({
      where: { addresseeId: userId, status: "pending" },
      include: { requester: { select: { id: true, name: true, handle: true, image: true } } },
    });

    const pendingRequests = pendingRaw.map((p) => {
      let requesterAvatar = p.requester.image;
      if (requesterAvatar && !requesterAvatar.startsWith('http')) {
        requesterAvatar = generateEdgeUrl("avatars", requesterAvatar, 3600, "HOT");
      }

      return {
        id: p.id,
        user: {
          ...p.requester,
          image: requesterAvatar,
        },
      };
    });

    // Query pending outgoing friend requests (sent requests)
    const sentRequestsRaw = await db.friendship.findMany({
      where: { requesterId: userId, status: "pending" },
      include: { addressee: { select: { id: true, name: true, handle: true, image: true } } },
    });

    const sentRequests = sentRequestsRaw.map((s) => {
      let addresseeAvatar = s.addressee.image;
      if (addresseeAvatar && !addresseeAvatar.startsWith('http')) {
        addresseeAvatar = generateEdgeUrl("avatars", addresseeAvatar, 3600, "HOT");
      }

      return {
        id: s.id,
        user: {
          ...s.addressee,
          image: addresseeAvatar,
        },
      };
    });

    const sentRequestsForExclude = await db.friendship.findMany({
      where: { requesterId: userId },
    });

    const excludeIds = [
      userId,
      ...friends.map((f) => f.id),
      ...pendingRaw.map((p) => p.requesterId),
      ...sentRequestsForExclude.map((s) => s.addresseeId),
    ];

    const suggestionsRaw = await db.user.findMany({
      where: { id: { notIn: excludeIds } },
      select: { id: true, name: true, image: true },
      take: 8,
    });

    const suggestionIds = suggestionsRaw.map((user) => user.id);
    const sharedSuggestionMemberships = suggestionIds.length > 0 && sharedGroupIds.length > 0
      ? await db.groupMember.findMany({
          where: {
            userId: { in: suggestionIds },
            groupId: { in: sharedGroupIds },
          },
          select: { userId: true },
        })
      : [];
    const sharedGroupCountByUser = sharedSuggestionMemberships.reduce((counts, membership) => {
      counts.set(membership.userId, (counts.get(membership.userId) || 0) + 1);
      return counts;
    }, new Map<string, number>());

    const suggestions = suggestionsRaw.map((u) => {
      let userAvatar = u.image;
      if (userAvatar && !userAvatar.startsWith('http')) {
        userAvatar = generateEdgeUrl("avatars", userAvatar, 3600, "HOT");
      }

      return {
        id: u.id,
        name: u.name || "Member",
        image: userAvatar,
        mutual: sharedGroupCountByUser.get(u.id) || 0,
        requested: false,
      };
    });

    return NextResponse.json({
      success: true,
      friends,
      pendingRequests,
      sentRequests,
      suggestions,
      groups: activeGroups,
      // Groups are private and discoverable only by an invite code.
      trending: [],
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

    const rl = rateLimit(`respond_friend_${session.user.id}`, 20, 60000);
    if (!rl.success) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rl.retryAfter}s.` },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { action, targetUserId, requestId, accept } = body;

    if (action === "send") {
      if (!targetUserId) {
        return NextResponse.json({ error: "Missing targetUserId parameter." }, { status: 400 });
      }

      // Defensive ID-vs-Handle resolution block to prevent foreign key errors
      let targetUser = null;
      if (targetUserId.length >= 20) {
        targetUser = await db.user.findUnique({
          where: { id: targetUserId }
        }).catch(() => null);
      }

      // Fallback: Query by user handle if no direct ID is matched
      if (!targetUser) {
        targetUser = await db.user.findFirst({
          where: { handle: targetUserId.toLowerCase().trim() }
        });
      }

      if (!targetUser) {
        return NextResponse.json({ error: "Kullanıcı bulunamadı." }, { status: 404 });
      }

      const resolvedTargetUserId = targetUser.id;

      if (session.user.id === resolvedTargetUserId) {
        return NextResponse.json({ error: "Kendinize arkadaşlık isteği gönderemezsiniz." }, { status: 400 });
      }

      const existing = await db.friendship.findFirst({
        where: {
          OR: [
            { requesterId: session.user.id, addresseeId: resolvedTargetUserId },
            { requesterId: resolvedTargetUserId, addresseeId: session.user.id },
          ]
        }
      });

      if (existing) {
        return NextResponse.json({ error: "Bu kullanıcıyla zaten bir arkadaşlığınız veya bekleyen bir isteğiniz var." }, { status: 400 });
      }

      await db.friendship.create({
        data: {
          requesterId: session.user.id,
          addresseeId: resolvedTargetUserId,
          status: "pending"
        }
      });

      const requester = await db.user.findUnique({ where: { id: session.user.id }});
      await sendPushToUser(resolvedTargetUserId, {
        category: "social",
        key: "friendRequest",
        vars: { actor: requester?.name },
        url: "/social"
      });

      return NextResponse.json({ success: true });
    }

    if (action === "respond") {
      if (!requestId) {
        return NextResponse.json({ error: "Missing requestId parameter." }, { status: 400 });
      }

      const request = await db.friendship.findUnique({
        where: { id: requestId }
      });

      if (!request || request.addresseeId !== session.user.id) {
        return NextResponse.json({ error: "Request not found or unauthorized." }, { status: 404 });
      }

      if (accept) {
        await db.friendship.update({
          where: { id: requestId },
          data: { status: "accepted" }
        });
        const addressee = await db.user.findUnique({ where: { id: session.user.id }});
        await sendPushToUser(request.requesterId, {
          category: "social",
          key: "friendAccepted",
          vars: { actor: addressee?.name },
          url: "/social"
        });
      } else {
        await db.friendship.delete({
          where: { id: requestId }
        });
      }

      return NextResponse.json({ success: true });
    }

    if (action === "cancel") {
      if (!requestId) {
        return NextResponse.json({ error: "Missing requestId parameter." }, { status: 400 });
      }

      const request = await db.friendship.findUnique({
        where: { id: requestId }
      });

      if (!request || request.requesterId !== session.user.id) {
        return NextResponse.json({ error: "Request not found or unauthorized." }, { status: 404 });
      }

      await db.friendship.delete({
        where: { id: requestId }
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (error: unknown) {
    throw error;
  }
}

export const GET = withApiHandler(GETHandler);

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
