import { createHash } from "node:crypto";
import { withApiHandler } from "@/lib/observability/api-handler";
import { NextResponse } from "next/server";
import {
  PRIVACY_POLICY_EFFECTIVE_AT,
  PRIVACY_POLICY_TEXT,
  PRIVACY_POLICY_VERSION,
} from "@/lib/privacy-policy";

export const dynamic = "force-dynamic";

async function GETHandler() {
  return NextResponse.json(
    {
      success: true,
      policy: {
        slug: "privacy-policy",
        version: PRIVACY_POLICY_VERSION,
        title: "MyTurn Privacy Policy",
        effectiveAt: PRIVACY_POLICY_EFFECTIVE_AT,
        content: PRIVACY_POLICY_TEXT,
        contentHash: createHash("sha256").update(PRIVACY_POLICY_TEXT).digest("hex"),
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    },
  );
}

export const GET = withApiHandler(GETHandler);
