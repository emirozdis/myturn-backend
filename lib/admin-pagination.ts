export const ADMIN_LOG_PAGE_SIZES = [25, 50, 100, 250] as const;

export type AdminLogPageSize = (typeof ADMIN_LOG_PAGE_SIZES)[number];

export function parseAdminLogPage(value: string | number | undefined, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(10_000, Math.floor(parsed)));
}

export function parseAdminLogPageSize(value: string | number | undefined, fallback: AdminLogPageSize = 50): AdminLogPageSize {
  const parsed = typeof value === "number" ? value : Number(value);
  return ADMIN_LOG_PAGE_SIZES.includes(parsed as AdminLogPageSize) ? parsed as AdminLogPageSize : fallback;
}

export function pageWindow(total: number, page: number, pageSize: number) {
  const first = total === 0 ? 0 : page * pageSize + 1;
  return { first, last: Math.min(total, (page + 1) * pageSize), pages: Math.max(1, Math.ceil(total / pageSize)) };
}

