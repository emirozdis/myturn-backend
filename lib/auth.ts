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

export async function getAuthSession(): Promise<Session | null> {
  try {
    const reqHeaders = await headers();
    const reqCookies = await cookies();

    let token: string | null = null;

    // Check Authorization header (Bearer <token>)
    const authHeader = reqHeaders.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }

    // Fallback to cookie check (firebase_session, next-auth.session-token, etc.)
    if (!token) {
      token =
        reqCookies.get("firebase_session")?.value ||
        reqCookies.get("next-auth.session-token")?.value ||
        reqCookies.get("__Secure-next-auth.session-token")?.value ||
        null;
    }

    if (!token) {
      return null;
    }

    const decodedToken = await verifyFirebaseIdToken(token);
    if (!decodedToken) {
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
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    });

    if (!user && emailNormalized) {
      user = await prisma.user.create({
        data: {
          id: uid,
          email: emailNormalized,
          name: decodedToken.name || emailNormalized.split("@")[0],
          image: decodedToken.picture || null,
          emailVerified: decodedToken.email_verified ? new Date() : null,
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
      return null;
    }

    setLogContext({ userId: user.id });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    };
  } catch (err) {
    return null;
  }
}
