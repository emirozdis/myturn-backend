import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";

async function GETHandler() {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const unlocked = await db.unlockedAchievement.findMany({
      where: { userId: session.user.id },
    });

    return NextResponse.json({
      success: true,
      unlocked: unlocked.map((achievement) => ({
        ...achievement,
        groupId: achievement.groupId ?? "global",
      })),
    });
  } catch (error: unknown) {
    throw error;
  }
}
export const GET = withApiHandler(GETHandler);

export const dynamic = "force-dynamic";
