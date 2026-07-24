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

  const rl = rateLimit(`mobile_login_${ip}`, 10, 15 * 60 * 1000);
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
    decodedToken = await getFirebaseAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired Firebase authentication token." },
      { status: 401 }
    );
  }

  const userEmail = decodedToken?.email ? decodedToken.email.toLowerCase().trim() : null;
  const uid = decodedToken?.uid;

  if (!uid) {
    return NextResponse.json(
      { error: "Firebase token does not contain a valid user ID." },
      { status: 400 }
    );
  }

  let user = await db.user.findFirst({
    where: {
      OR: [
        { id: uid },
        ...(userEmail ? [{ email: userEmail }] : []),
      ],
    },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
    },
  });

  if (!user && userEmail) {
    user = await db.user.create({
      data: {
        id: uid,
        email: userEmail,
        name: decodedToken.name || userEmail.split("@")[0],
        image: decodedToken.picture || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    });
  }

  if (!user) {
    return NextResponse.json(
      { error: "Account not found." },
      { status: 404 }
    );
  }

  const response = NextResponse.json({
    success: true,
    sessionToken: idToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    },
  });

  response.cookies.set("firebase_session", idToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NEXTAUTH_URL?.startsWith("https://") === true,
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";