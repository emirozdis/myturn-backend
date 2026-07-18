// ./app/api/media/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { generateEdgeUrl } from "@/lib/media-signing";
import { getAuthSession } from "@/lib/auth";
import { authorizeMediaRead } from "@/lib/media-authorization";

/**
 * DEPRECATED PROXY ENDPOINT
 * Safely redirects legacy requests and cached components natively to the new Edge Worker URL.
 */
async function GETHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) return new NextResponse("Unauthorized.", { status: 401 });
    const fullPath = req.nextUrl.pathname;
    const parts = fullPath.replace("/api/media/", "").split("/");
    if (parts.length < 2) {
      return new NextResponse("Invalid path parameters.", { status: 400 });
    }

    const bucket = parts[0];
    const storagePath = parts.slice(1).join("/");

    const authorization = await authorizeMediaRead(session.user.id, bucket, storagePath);
    if (!authorization) return new NextResponse("Media not found or access denied.", { status: 403 });

    const edgeUrl = generateEdgeUrl(bucket, authorization.path, 3600, authorization.storageTier);
    
    return NextResponse.redirect(edgeUrl, { status: 307 });
  } catch (error: unknown) {
    throw error;
  }
}

export const GET = withApiHandler(GETHandler);

export const dynamic = "force-dynamic";
