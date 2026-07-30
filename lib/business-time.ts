export type BusinessClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const OFFSET_PATTERN = /^(?:UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/i;

function offsetForIanaZone(zone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const representedAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour") % 24, value("minute"), value("second"));
  return Math.round((representedAsUtc - at.getTime()) / 60_000);
}

export function parseUtcOffset(value: string): number {
  const normalized = value.trim();
  if (/^(?:UTC|Z)$/i.test(normalized)) return 0;
  const match = OFFSET_PATTERN.exec(normalized);
  if (!match) throw new Error("Timezone must be a UTC offset such as UTC+03:00.");
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  const total = (hours * 60 + minutes) * (match[1] === "-" ? -1 : 1);
  if (minutes > 59 || total < -12 * 60 || total > 14 * 60) throw new Error("Timezone offset is outside UTC-12:00 to UTC+14:00.");
  return total;
}

export function formatUtcOffset(offsetMinutes: number): string {
  if (!Number.isInteger(offsetMinutes) || offsetMinutes < -12 * 60 || offsetMinutes > 14 * 60) {
    throw new Error("Invalid UTC offset.");
  }
  if (offsetMinutes === 0) return "UTC";
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function normalizeUtcOffset(value: unknown, at = new Date()): string {
  if (typeof value !== "string" || !value.trim()) return "UTC";
  try {
    return formatUtcOffset(parseUtcOffset(value));
  } catch {
    // Migration compatibility only: convert a valid legacy IANA zone to the
    // fixed offset that is active when the group is updated or read.
    try {
      return formatUtcOffset(offsetForIanaZone(value.trim(), at));
    } catch {
      throw new Error("Invalid timezone. Use a UTC offset such as UTC+03:00.");
    }
  }
}

export function getBusinessClock(at: Date, timezone: string): BusinessClock {
  const offset = parseUtcOffset(normalizeUtcOffset(timezone, at));
  const shifted = new Date(at.getTime() + offset * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

export function getBusinessDate(timezone: string, at = new Date()): Date {
  const clock = getBusinessClock(at, timezone);
  return new Date(Date.UTC(clock.year, clock.month - 1, clock.day));
}

export function getBusinessHour(at: Date | string, timezone: string): number {
  return getBusinessClock(new Date(at), timezone).hour;
}

export function getVlogTimePeriodForHour(hour: number): number | null {
  if (!Number.isInteger(hour) || hour < 9 || hour >= 24) return null;
  return Math.floor((hour - 9) / 3);
}

export function getVlogTimePeriod(recordedAt: Date | string, timezone: string): number | null {
  return getVlogTimePeriodForHour(getBusinessHour(recordedAt, timezone));
}

export function hasVlogInTimePeriod(
  recordedAts: readonly (Date | string)[],
  timezone: string,
  period: number,
): boolean {
  return recordedAts.some((recordedAt) => getVlogTimePeriod(recordedAt, timezone) === period);
}
