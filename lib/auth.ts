import { headers } from "next/headers";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { prisma } from "@/lib/prisma";
import { identityMatchesProfile } from "@/lib/auth-policy";
import { setLogContext } from "@/lib/observability/request-context";

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
    if (!authHeader?.startsWith("Bearer ")) {
      setLogContext({ authState: "anonymous" });
      return null;
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      setLogContext({ authState: "missing_token" });
      return null;
    }

    let decodedToken: DecodedIdToken;
    try {
      decodedToken = await getFirebaseAuth().verifyIdToken(token, true);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      const authState = code.includes("id-token-expired")
        ? "expired"
        : code.includes("id-token-revoked")
          ? "revoked"
          : code.includes("user-disabled")
            ? "disabled"
            : "invalid";
      setLogContext({ authState });
      return null;
    }
    if (!decodedToken?.uid) {
      setLogContext({ authState: "invalid" });
      return null;
    }

    const profile = await prisma.profile.findUnique({
      where: { firebaseUid: decodedToken.uid },
    });
    if (!profile) {
      setLogContext({ authState: "missing_profile" });
      return null;
    }
    if (profile.isSuspended) {
      setLogContext({ userId: profile.id, authState: "suspended" });
      return null;
    }
    if (!identityMatchesProfile(
      {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified === true,
      },
      profile,
    )) {
      setLogContext({ authState: "identity_mismatch" });
      return null;
    }

    setLogContext({ userId: profile.id, authState: "valid" });

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
    setLogContext({ authState: "invalid" });
    return null;
  }
}
