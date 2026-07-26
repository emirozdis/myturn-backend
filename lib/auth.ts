import { headers } from "next/headers";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { prisma } from "@/lib/prisma";
import { identityMatchesProfile } from "@/lib/auth-policy";

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
}

export interface Session {
  user: SessionUser;
  firebase: {
    uid: string;
    authTime: number;
    signInProvider: string | null;
  };
}

export async function verifyFirebaseIdToken(
  token: string,
  checkRevoked = true,
): Promise<DecodedIdToken | null> {
  try {
    return await getFirebaseAuth().verifyIdToken(token, checkRevoked);
  } catch {
    return null;
  }
}

export async function getAuthSession(): Promise<Session | null> {
  try {
    const reqHeaders = await headers();
    const authHeader = reqHeaders.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    const token = authHeader.substring(7).trim();
    if (!token) return null;

    const decodedToken = await verifyFirebaseIdToken(token, true);
    if (!decodedToken?.uid) return null;

    const profile = await prisma.profile.findUnique({
      where: { id: decodedToken.uid },
    });
    if (!profile) return null;
    if (!identityMatchesProfile(
      {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified === true,
      },
      profile,
    )) return null;

    return {
      user: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        image: profile.image,
      },
      firebase: {
        uid: decodedToken.uid,
        authTime: decodedToken.auth_time,
        signInProvider: decodedToken.firebase?.sign_in_provider || null,
      },
    };
  } catch {
    return null;
  }
}
