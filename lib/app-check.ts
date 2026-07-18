import { getAppCheck } from "firebase-admin/app-check";
import { getFirebaseAdminApp } from "@/lib/firebase-admin";

export async function verifyAppCheckToken(token: string) {
  return getAppCheck(getFirebaseAdminApp()).verifyToken(token);
}
