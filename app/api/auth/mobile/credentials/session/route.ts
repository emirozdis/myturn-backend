import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { withApiHandler } from "@/lib/observability/api-handler";
import { getFirebaseAuth } from "@/lib/firebase-admin";

async function POSTHandler(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const idToken = typeof body?.idToken === "string" ? body.idToken.trim() : "";
  const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : "";

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

  let decodedToken = null;
  if (idToken) {
    try {
      decodedToken = await getFirebaseAuth().verifyIdToken(idToken);
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired Firebase authentication token." },
        { status: 401 }
      );
    }
  }

  const userEmail = decodedToken?.email ? decodedToken.email.toLowerCase().trim() : email;
  const uid = decodedToken?.uid;

  if (!userEmail && !uid) {
    return NextResponse.json(
      { error: "Firebase token or email is required." },
      { status: 400 }
    );
  }

  let user = await db.user.findFirst({
    where: {
      OR: [
        ...(uid ? [{ id: uid }] : []),
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

  if (!user && uid && userEmail) {
    user = await db.user.create({
      data: {
        id: uid,
        email: userEmail,
        name: decodedToken?.name || userEmail.split("@")[0],
        image: decodedToken?.picture || null,
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
    sessionToken: idToken || "",
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    },
  });

  if (idToken) {
    response.cookies.set("firebase_session", idToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NEXTAUTH_URL?.startsWith("https://") === true,
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
  }

  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
