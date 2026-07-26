import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { withApiHandler } from "@/lib/observability/api-handler";
import { getFirebaseAuth } from "@/lib/firebase-admin";

async function POSTHandler(req: NextRequest) {
  const rawBody = await req.json().catch(() => null);
  const body = Array.isArray(rawBody) ? rawBody[0] : rawBody;
  let idToken = typeof body?.idToken === "string" ? body.idToken.trim() : "";

  // Fallback: Check Authorization header if not passed in body
  if (!idToken) {
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      idToken = authHeader.substring(7).trim();
    }
  }

  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for") ||
    "unknown_ip";

  const rl = await rateLimit(`mobile_login_${ip}`, 10, 15 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429 }
    );
  }

  if (!idToken) {
    return NextResponse.json(
      { error: "A valid Firebase ID token is required." },
      { status: 400 }
    );
  }

  let decodedToken = null;
  try {
    decodedToken = await getFirebaseAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired Firebase authentication token." },
      { status: 401 }
    );
  }

  const userEmail = decodedToken?.email ? decodedToken.email.toLowerCase().trim() : null;
  const uid = decodedToken?.uid;

  if (!uid || !userEmail || decodedToken.email_verified !== true) {
    return NextResponse.json(
      { error: "A verified Firebase identity is required." },
      { status: 403 }
    );
  }

  const profile = await db.profile.findUnique({
    where: { id: uid },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
    },
  });

  if (!profile || profile.email?.toLowerCase().trim() !== userEmail) {
    return NextResponse.json(
      { error: "Account is not provisioned." },
      { status: 403 }
    );
  }

  const response = NextResponse.json({
    success: true,
    user: {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      image: profile.image,
    },
  });

  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
