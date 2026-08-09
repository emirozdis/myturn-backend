const LIMITED_USE_APP_CHECK_ROUTES = new Set([
  "POST /api/auth/change-password",
  "POST /api/auth/reset-password",
  "POST /api/boost/purchase",
]);

export function requiresLimitedUseAppCheck(method: string, pathname: string) {
  return LIMITED_USE_APP_CHECK_ROUTES.has(`${method.toUpperCase()} ${pathname}`);
}

export function isAppCheckExempt(method: string, pathname: string) {
  if (pathname === "/api/cron/tick" && method.toUpperCase() === "POST") return true;
  if (pathname === "/api/legal/privacy") return true;
  if (pathname === "/api/account-deletion/request") return true;
  if (pathname === "/api/profile" && method.toUpperCase() === "DELETE") return true;
  return (
    pathname === "/api/auth/mobile/google/start" ||
    pathname === "/api/auth/mobile/google/callback"
  );
}
