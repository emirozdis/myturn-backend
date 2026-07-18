import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { getAuthSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCurrentAgreement } from "@/lib/legal-agreements";

async function GETHandler(req: NextRequest) {
  const scope = new URL(req.url).searchParams.get("scope");

  if (scope !== "accepted") {
    return NextResponse.json({ success: true, agreement: getCurrentAgreement() });
  }

  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const acceptances = await db.agreementAcceptance.findMany({
    where: { userId: session.user.id },
    orderBy: { acceptedAt: "desc" },
    select: {
      id: true,
      agreementSlug: true,
      agreementVersion: true,
      agreementEffectiveAt: true,
      titleSnapshot: true,
      contentSnapshot: true,
      contentHash: true,
      acceptedAt: true,
    },
  });

  return NextResponse.json({ success: true, acceptances });
}

export const GET = withApiHandler(GETHandler);

export const dynamic = "force-dynamic";
