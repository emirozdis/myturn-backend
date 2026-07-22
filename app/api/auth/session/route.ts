import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { withApiHandler } from "@/lib/observability/api-handler";

async function GETHandler() {
  const session = await getAuthSession();
  if (!session?.user) {
    return NextResponse.json({ user: null });
  }
  return NextResponse.json({ user: session.user });
}

async function POSTHandler() {
  const session = await getAuthSession();
  if (!session?.user) {
    return NextResponse.json({ user: null });
  }
  return NextResponse.json({ user: session.user });
}

export const GET = withApiHandler(GETHandler);
export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
