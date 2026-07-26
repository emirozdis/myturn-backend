import { getAppCheck } from "firebase-admin/app-check";
import { getFirebaseAdminApp } from "@/lib/firebase-admin";

export async function verifyAppCheckToken(token: string, consume = false) {
  const result = await getAppCheck(getFirebaseAdminApp()).verifyToken(
    token,
    consume ? { consume: true } : undefined,
  );
  if (consume && result.alreadyConsumed) {
    throw new Error("Firebase App Check token was already consumed.");
  }
  return result;
}
