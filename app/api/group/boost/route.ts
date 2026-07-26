import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { checkUserProStatus } from "@/lib/pro-helper";
import { rateLimit } from "@/lib/rate-limit";

async function POSTHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = await rateLimit(`boost_${session.user.id}`, 10, 60000);
    if (!rl.success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const rawBody = await req.json();
    const body = Array.isArray(rawBody) ? rawBody[0] : rawBody;
    const { groupId, action } = body || {};

    if (!groupId) return NextResponse.json({ error: "Group ID is required when trying to boost a group." }, { status: 400 });

    const membership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: session.user.id } },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json({ error: "You must be a member of this group." }, { status: 403 });
    }

    const requestedAction = action === "add" || action === "remove" ? action : "toggle";
    const [currentBoosts, userBoosts] = await Promise.all([
      db.groupBoost.count({ where: { groupId } }),
      db.groupBoost.findMany({
        where: { groupId, userId: session.user.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }),
    ]);
    const shouldRemove = requestedAction === "remove" || (requestedAction === "toggle" && userBoosts.length > 0);

    if (shouldRemove) {
      const boostToRemove = userBoosts[0];
      if (!boostToRemove) {
        return NextResponse.json({ error: "This group has no boost to remove." }, { status: 400 });
      }

      // Remove one allocation at a time so a member can keep their other boosts in this group.
      await db.groupBoost.delete({ where: { id: boostToRemove.id } });
      const newBoosts = currentBoosts - 1;
      
      // Trigger 3-Day Grace Period if boosts drop below 3
      if (newBoosts < 3 && currentBoosts >= 3) {
        const graceEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        await db.group.update({ 
          where: { id: groupId }, 
          data: { boostGracePeriodEndsAt: graceEnd } 
        });
      }

      return NextResponse.json({ success: true, boosted: false, boostCount: newBoosts, userBoostCount: userBoosts.length - 1 });
    } else {
      // Allocate a new boost. Pro includes one allocation; every purchased credit
      // adds another allocation, regardless of whether the account is Pro.
      const [isPro, user] = await Promise.all([
        checkUserProStatus(session.user.id),
        db.profile.findUnique({ where: { id: session.user.id }, select: { boostCredits: true } }),
      ]);
      const boostLimit = (isPro ? 1 : 0) + (user?.boostCredits || 0);
      const usedBoosts = await db.groupBoost.count({ where: { userId: session.user.id } });

      if (usedBoosts >= boostLimit) {
        return NextResponse.json(
          { error: "No boost credits are available. Purchase an extra boost or remove one from another group." },
          { status: 403 }
        );
      }

      await db.groupBoost.create({
        data: { groupId, userId: session.user.id }
      });

      const newBoosts = currentBoosts + 1;
      
      // Restore Pro Group Status, clear grace periods and unfreeze
      if (newBoosts >= 3) {
        const groupLevel = Math.max(3, Math.floor(1000 * Math.pow(newBoosts, 1.5)) > 0 ? 3 : 3);
        await db.group.update({ 
          where: { id: groupId }, 
          data: { 
            boostGracePeriodEndsAt: null, 
            isFrozen: false, 
            level: groupLevel 
          } 
        });
      }

      return NextResponse.json({ success: true, boosted: true, boostCount: newBoosts, userBoostCount: userBoosts.length + 1 });
    }
  } catch (error: unknown) {
    throw error;
  }
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
