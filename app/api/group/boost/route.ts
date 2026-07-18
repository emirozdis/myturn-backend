import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { getUserBoostLimit } from "@/lib/pro-helper";
import { rateLimit } from "@/lib/rate-limit";

async function POSTHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit(`boost_${session.user.id}`, 10, 60000);
    if (!rl.success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const rawBody = await req.json();
    const body = Array.isArray(rawBody) ? rawBody[0] : rawBody;
    const { groupId } = body || {};

    if (!groupId) return NextResponse.json({ error: "Group ID is required when trying to boost a group." }, { status: 400 });

    const membership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: session.user.id } },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json({ error: "You must be a member of this group." }, { status: 403 });
    }

    const existingBoost = await db.groupBoost.findUnique({
      where: { groupId_userId: { groupId, userId: session.user.id } }
    });

    const currentBoosts = await db.groupBoost.count({ where: { groupId } });

    if (existingBoost) {
      // Revoke the active boost
      await db.groupBoost.delete({ where: { id: existingBoost.id } });
      const newBoosts = currentBoosts - 1;
      
      // Trigger 3-Day Grace Period if boosts drop below 3
      if (newBoosts < 3 && currentBoosts >= 3) {
        const graceEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        await db.group.update({ 
          where: { id: groupId }, 
          data: { boostGracePeriodEndsAt: graceEnd } 
        });
      }

      return NextResponse.json({ success: true, boosted: false });
    } else {
      // Allocate a new boost
      const boostLimit = await getUserBoostLimit(session.user.id);
      const usedBoosts = await db.groupBoost.count({ where: { userId: session.user.id } });

      if (usedBoosts >= boostLimit) {
        return NextResponse.json(
          { error: "Boost hakkınız bulunmuyor. Ekstra hak için MyTurn Pro'ya geçin veya aktif bir boost'unuzu geri alın." }, 
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

      return NextResponse.json({ success: true, boosted: true });
    }
  } catch (error: unknown) {
    throw error;
  }
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
