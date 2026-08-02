export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: value >= 10 ? 1 : 2 })} ${units[index]}`;
}

export function formatDate(date: Date | string | null | undefined, includeTime = true) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(date));
}

export function relativeTime(date: Date | string) {
  const delta = new Date(date).getTime() - Date.now();
  const minutes = Math.round(delta / 60_000);
  if (Math.abs(minutes) < 60) return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(hours, "hour");
  const days = Math.round(hours / 24);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(days, "day");
}

export function jsonText(value: unknown, locale = "en") {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const localized = record[locale] ?? record.en ?? record.tr;
    if (typeof localized === "string") return localized;
  }
  return "Untitled";
}
