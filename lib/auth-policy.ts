export function isRecentAuthentication(
  authTimeSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
  maximumAgeSeconds = 5 * 60,
) {
  const age = nowSeconds - authTimeSeconds;
  return Number.isFinite(age) && age >= 0 && age <= maximumAgeSeconds;
}

export function identityMatchesProfile(
  identity: { uid: string; email?: string; emailVerified: boolean },
  profile: { firebaseUid: string; email: string | null } | null,
) {
  if (!identity.uid || !identity.emailVerified || !profile) return false;
  if (identity.uid !== profile.firebaseUid) return false;
  const identityEmail = identity.email?.toLowerCase().trim() || null;
  const profileEmail = profile.email?.toLowerCase().trim() || null;
  return !identityEmail || !profileEmail || identityEmail === profileEmail;
}
