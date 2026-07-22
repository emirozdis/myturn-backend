import { headers, cookies } from "next/headers";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { prisma } from "@/lib/prisma";
import { setLogContext } from "@/lib/observability/request-context";

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
}

export interface Session {
  user: SessionUser;
}

export async function verifyFirebaseIdToken(token: string) {
  try {
    const auth = getFirebaseAuth();
    return await auth.verifyIdToken(token);
  } catch (error) {
    return null;
  }
}

// lib/auth.ts (DEBUG VERSION)
export async function getAuthSession(): Promise<Session | null> {
  try {
    const reqHeaders = await headers();
    const reqCookies = await cookies();

    let token: string | null = null;
    const authHeader = reqHeaders.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }

    if (!token) {
      token = reqCookies.get("firebase_session")?.value || null;
    }

    if (!token) {
      console.log("[AUTH DEBUG] No token found in Authorization header or cookie.");
      return null;
    }

    const decodedToken = await verifyFirebaseIdToken(token);
    if (!decodedToken) {
      console.log("[AUTH DEBUG] Firebase failed to verify token. Check Firebase project config or expired token.");
      return null;
    }

    const uid = decodedToken.uid;
    const emailNormalized = decodedToken.email ? decodedToken.email.toLowerCase().trim() : null;

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: uid },
          ...(emailNormalized ? [{ email: emailNormalized }] : []),
        ],
      },
    });

    if (!user && emailNormalized) {
      console.log("[AUTH DEBUG] User not found in DB. Creating new user record...");
      user = await prisma.user.create({
        data: {
          id: uid,
          email: emailNormalized,
          name: decodedToken.name || emailNormalized.split("@")[0],
          image: decodedToken.picture || null,
          emailVerified: decodedToken.email_verified ? new Date() : null,
        },
      });
    }

    if (!user) {
      console.log("[AUTH DEBUG] User record could not be found or created in Postgres DB.");
      return null;
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    };
  } catch (err) {
    console.error("[AUTH DEBUG] Error inside getAuthSession:", err);
    return null;
  }
}