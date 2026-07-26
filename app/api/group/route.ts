import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { checkUserProStatus } from "@/lib/pro-helper";
import { generateEdgeUrl } from "@/lib/media-signing";
import { normalizeUtcOffset } from "@/lib/business-time";
import { createInviteCodeCandidate } from "@/lib/invite-code";
import { Prisma } from "@prisma/client";
import { getLocalDateInTimezone, rollGroupAssignmentForDate } from "@/lib/vlog-helpers";
import { reportError } from "@/lib/observability/logger";

class GroupInvariantError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 3) throw error;
    }
  }
  throw new Error("Group transaction retry limit exceeded.");
}

async function generateInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = createInviteCodeCandidate();
    const existing = await db.group.findUnique({
      where: { inviteCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error("Could not allocate a unique invite code.");
}

async function GETHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const groupId = searchParams.get("groupId");

    if (groupId) {
      const group = await db.group.findFirst({
        where: {
          id: groupId,
          members: { some: { userId: session.user.id } },
        },
        include: {
          boosts: {
            include: {
              user: { select: { id: true, name: true, image: true } }
            }
          },
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  handle: true,
                  image: true,
                  bio: true,
                  location: true,
                },
              },
            },
          },
        },
      });

      if (!group) {
        return NextResponse.json({ error: "Group not found." }, { status: 404 });
      }

      let imageUrl = group.image;
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = generateEdgeUrl("avatars", imageUrl, 3600, "HOT");
      }

      const memberRecord = group.members.find(m => m.userId === session.user.id);

      return NextResponse.json({
        success: true,
        group: { ...group, timezone: normalizeUtcOffset(group.timezone), image: imageUrl, role: memberRecord!.role },
      });
    }

    const memberships = await db.groupMember.findMany({
      where: { userId: session.user.id },
      include: {
        group: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    handle: true,
                    image: true,
                  },
                },
              },
            },
            _count: {
              select: { members: true },
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

    const groups = memberships.map((m) => {
      const boostCount = m.group.boosts?.length || 0;
      const effectiveLevel = Math.max(m.group.level, boostCount >= 3 ? 3 : 1);
      
      let imageUrl = m.group.image;
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = generateEdgeUrl("avatars", imageUrl, 3600, "HOT");
      }

      return {
        id: m.group.id,
        name: m.group.name,
        image: imageUrl,
        inviteCode: m.group.inviteCode,
        timezone: normalizeUtcOffset(m.group.timezone),
        memberCount: m.group._count.members,
        role: m.role,
        xp: m.group.xp,
        level: effectiveLevel,
        boostCount,
        hasBoosted: m.group.boosts?.some(b => b.userId === session.user.id) || false,
        userBoostCount: m.group.boosts?.filter(b => b.userId === session.user.id).length || 0,
        isFrozen: m.group.isFrozen,
        boostGracePeriodEndsAt: m.group.boostGracePeriodEndsAt?.toISOString() || null,
        boosters: m.group.boosts?.map(b => ({
          id: b.user.id,
          name: b.user.name,
          image: b.user.image,
        })) || [],
        memberXp: m.xp,
        members: m.group.members.map((gm) => ({
          id: gm.user.id,
          name: gm.user.name,
          handle: gm.user.handle,
          image: gm.user.image,
          role: gm.role,
        })),
      };
    });

    return NextResponse.json({ success: true, groups });
  } catch (error: unknown) {
    throw error;
  }
}

async function POSTHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });
    }

    const body = await req.json();
    const { action, name, timezone = "UTC", image, inviteCode, groupId, targetUserId } = body;

    if (action === "create") {
      const rl = await rateLimit(`create_group_${session.user.id}`, 5, 60000);
      if (!rl.success) {
        return NextResponse.json(
          { error: `Çok hızlı grup kuruyorsunuz. ${rl.retryAfter}s sonra tekrar deneyin.` },
          { status: 429 }
        );
      }

      if (!name) {
        return NextResponse.json({ error: "Grup adı zorunludur." }, { status: 400 });
      }

      const generatedCode = await generateInviteCode();
      const isUserPro = await checkUserProStatus(session.user.id);
      const membershipLimit = isUserPro ? 10 : 3;
      const normalizedTimezone = normalizeUtcOffset(timezone);

      const group = await serializable(async (tx) => {
        const membershipsCount = await tx.groupMember.count({ where: { userId: session.user.id } });
        if (membershipsCount >= membershipLimit) {
          throw new GroupInvariantError(`Maksimum grup limitine (${membershipLimit}) ulaştınız.`, 403);
        }
        return tx.group.create({
          data: {
            name,
            inviteCode: generatedCode,
            timezone: normalizedTimezone,
            image: null,
            members: {
              create: {
                userId: session.user.id,
                role: "admin",
              },
            },
          },
        });
      });

      return NextResponse.json({ success: true, group }, { status: 201 });
    }

    if (action === "updateImage") {
      if (!groupId) return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
      
      // Strict backend restriction: ONLY admins can modify the group image.
      const member = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: session.user.id } }
      });
      
      if (!member || member.role !== 'admin') {
        return NextResponse.json({ error: "Yetkisiz erişim. Grup fotoğrafını yalnızca yöneticiler değiştirebilir." }, { status: 403 });
      }

      if (image !== null && image !== undefined) {
        const expectedPrefix = `group_avatars/${groupId}_`;
        if (typeof image !== "string" || !image.startsWith(expectedPrefix) || !/\.(?:jpe?g|png|webp)$/i.test(image)) {
          return NextResponse.json({ error: "Invalid group image path." }, { status: 400 });
        }
      }
      
      const updated = await db.group.update({
        where: { id: groupId },
        data: { image: image || null }
      });

      let signedUrl = updated.image;
      if (signedUrl && !signedUrl.startsWith('http')) {
        signedUrl = generateEdgeUrl("avatars", signedUrl, 3600, "HOT");
      }

      return NextResponse.json({ success: true, group: { ...updated, image: signedUrl } });
    }

    if (action === "rotateInviteCode") {
      if (!groupId) return NextResponse.json({ error: "Missing groupId" }, { status: 400 });

      const rl = await rateLimit(`rotate_group_invite_${session.user.id}`, 5, 60000);
      if (!rl.success) {
        return NextResponse.json(
          { error: `Davet kodunu çok sık yeniliyorsunuz. ${rl.retryAfter}s sonra tekrar deneyin.` },
          { status: 429 }
        );
      }

      const membership = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: session.user.id } },
        select: { role: true },
      });
      if (!membership || membership.role !== "admin") {
        return NextResponse.json(
          { error: "Davet kodunu yalnızca grup yöneticileri yenileyebilir." },
          { status: 403 }
        );
      }

      const inviteCode = await generateInviteCode();
      const updated = await db.group.update({
        where: { id: groupId },
        data: { inviteCode },
        select: { id: true, inviteCode: true },
      });

      return NextResponse.json({ success: true, group: updated });
    }

    if (action === "transferLeadership") {
      if (!groupId || !targetUserId) {
        return NextResponse.json({ error: "Missing groupId or targetUserId." }, { status: 400 });
      }
      if (targetUserId === session.user.id) {
        return NextResponse.json({ error: "You are already the group leader." }, { status: 400 });
      }

      const rl = await rateLimit(`transfer_group_leadership_${session.user.id}`, 5, 60000);
      if (!rl.success) {
        return NextResponse.json({ error: `Too many leadership changes. Try again in ${rl.retryAfter}s.` }, { status: 429 });
      }

      await serializable(async (tx) => {
        const [leader, target] = await Promise.all([
          tx.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: session.user.id } } }),
          tx.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: targetUserId } } }),
        ]);
        if (!leader || leader.role !== "admin") throw new GroupInvariantError("Only the group leader can transfer leadership.", 403);
        if (!target) throw new GroupInvariantError("The selected user is not a member of this group.", 404);

        await tx.groupMember.update({ where: { id: leader.id }, data: { role: "member" } });
        await tx.groupMember.update({ where: { id: target.id }, data: { role: "admin" } });
      });

      return NextResponse.json({ success: true });
    }

    if (action === "kickMember") {
      if (!groupId || !targetUserId) {
        return NextResponse.json({ error: "Missing groupId or targetUserId." }, { status: 400 });
      }
      if (targetUserId === session.user.id) {
        return NextResponse.json({ error: "Use Leave group to remove yourself." }, { status: 400 });
      }

      const rl = await rateLimit(`kick_group_member_${session.user.id}`, 10, 60000);
      if (!rl.success) {
        return NextResponse.json({ error: `You are removing members too fast. Try again in ${rl.retryAfter}s.` }, { status: 429 });
      }

      await serializable(async (tx) => {
        const [leader, target, currentBoostCount] = await Promise.all([
          tx.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: session.user.id } } }),
          tx.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: targetUserId } } }),
          tx.groupBoost.count({ where: { groupId } }),
        ]);
        if (!leader || leader.role !== "admin") throw new GroupInvariantError("Only the group leader can remove members.", 403);
        if (!target) throw new GroupInvariantError("The selected user is not a member of this group.", 404);
        if (target.role === "admin") throw new GroupInvariantError("The group leader cannot be removed.", 400);

        const removedBoost = await tx.groupBoost.deleteMany({ where: { groupId, userId: targetUserId } });
        await tx.groupMember.delete({ where: { id: target.id } });
        const remainingCount = await tx.groupMember.count({ where: { groupId } });
        if (remainingCount <= 4) {
          await tx.group.update({ where: { id: groupId }, data: { isFrozen: false, boostGracePeriodEndsAt: null } });
        } else if (removedBoost.count > 0 && currentBoostCount >= 3 && currentBoostCount - removedBoost.count < 3) {
          await tx.group.update({
            where: { id: groupId },
            data: { boostGracePeriodEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
          });
        }
      });

      return NextResponse.json({ success: true });
    }

    if (action === "deleteGroup") {
      if (!groupId) return NextResponse.json({ error: "Missing groupId." }, { status: 400 });

      const rl = await rateLimit(`delete_group_${session.user.id}`, 5, 60000);
      if (!rl.success) {
        return NextResponse.json({ error: `You are deleting groups too fast. Try again in ${rl.retryAfter}s.` }, { status: 429 });
      }

      await serializable(async (tx) => {
        const leader = await tx.groupMember.findUnique({
          where: { groupId_userId: { groupId, userId: session.user.id } },
          select: { role: true },
        });
        if (!leader || leader.role !== "admin") throw new GroupInvariantError("Only the group leader can delete this group.", 403);
        await tx.group.delete({ where: { id: groupId } });
      });

      return NextResponse.json({ success: true });
    }

    if (action === "join") {
      if (!inviteCode) {
        return NextResponse.json({ error: "Davet kodu zorunludur." }, { status: 400 });
      }

      const rl = await rateLimit(`join_group_${session.user.id}`, 10, 60000);
      if (!rl.success) {
        return NextResponse.json(
          { error: `Çok hızlı katılıyorsunuz. ${rl.retryAfter}s sonra tekrar deneyin.` },
          { status: 429 }
        );
      }

      const formattedCode = inviteCode.trim().toUpperCase();
      const isUserPro = await checkUserProStatus(session.user.id);
      const membershipLimit = isUserPro ? 10 : 3;
      const joined = await serializable(async (tx) => {
        const group = await tx.group.findUnique({ where: { inviteCode: formattedCode }, include: { boosts: true } });
        if (!group) throw new GroupInvariantError("Geçersiz davet kodu. Grup bulunamadı.", 404);

        const existingMember = await tx.groupMember.findUnique({
          where: { groupId_userId: { groupId: group.id, userId: session.user.id } },
        });
        if (existingMember) return { group, alreadyMember: true };

        const [membershipsCount, membersCount] = await Promise.all([
          tx.groupMember.count({ where: { userId: session.user.id } }),
          tx.groupMember.count({ where: { groupId: group.id } }),
        ]);
        if (membershipsCount >= membershipLimit) throw new GroupInvariantError(`Maksimum grup limitine (${membershipLimit}) ulaştınız.`, 403);
        const groupLimit = group.boosts.length >= 3 ? 12 : 4;
        if (membersCount >= groupLimit) throw new GroupInvariantError(`Bu grup ${groupLimit} üye sınırına ulaştı.`, 403);

        await tx.groupMember.create({ data: { groupId: group.id, userId: session.user.id, role: "member" } });
        return { group, alreadyMember: false };
      });

      // Membership is the event that can make a new group eligible after the
      // scheduled daily roll has already run. Reconcile immediately; the
      // unique (groupId, date) constraint keeps this safe alongside cron and
      // read-time reconciliation.
      if (!joined.alreadyMember) {
        try {
          const localDate = await getLocalDateInTimezone(joined.group.timezone);
          await rollGroupAssignmentForDate(joined.group.id, localDate);
        } catch (error) {
          // Joining the group succeeded and must not be rolled back because a
          // best-effort assignment/push failed. The next read and cron retry it.
          reportError("group.assignment_reconciliation_failed", error, { groupId: joined.group.id });
        }
      }

      return NextResponse.json({ success: true, group: joined.group, alreadyMember: joined.alreadyMember });
    }

    return NextResponse.json({ error: "Geçersiz işlem tipi." }, { status: 400 });
  } catch (error: unknown) {
    if (error instanceof GroupInvariantError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

async function DELETEHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const groupId = searchParams.get("groupId");

    if (!groupId) {
      return NextResponse.json({ error: "Missing groupId parameter." }, { status: 400 });
    }

    const rl = await rateLimit(`leave_group_${session.user.id}`, 10, 60000);
    if (!rl.success) {
      return NextResponse.json(
        { error: `You are leaving groups too fast. Try again in ${rl.retryAfter}s.` },
        { status: 429 }
      );
    }

    await serializable(async (tx) => {
      const membership = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: session.user.id } },
      });
      if (!membership) throw new GroupInvariantError("Group membership not found.", 404);
      const remaining = await tx.groupMember.findMany({
        where: { groupId, id: { not: membership.id } },
        // Keep succession deterministic: the earliest remaining member is
        // first, with the record id resolving the unlikely timestamp tie.
        orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      });
      if (remaining.length === 0) {
        await tx.group.delete({ where: { id: groupId } });
        return;
      }
      if (membership.role === "admin") {
        const otherAdmin = remaining.some((member) => member.role === "admin");
        // When the departing member is the final leader, promote the person
        // who has been in the group the longest.
        if (!otherAdmin) await tx.groupMember.update({ where: { id: remaining[0].id }, data: { role: "admin" } });
      }
      await tx.groupMember.delete({ where: { id: membership.id } });
      if (remaining.length <= 4) {
        await tx.group.update({ where: { id: groupId }, data: { isFrozen: false, boostGracePeriodEndsAt: null } });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof GroupInvariantError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export const GET = withApiHandler(GETHandler);

export const POST = withApiHandler(POSTHandler);

export const DELETE = withApiHandler(DELETEHandler);

export const dynamic = "force-dynamic";
