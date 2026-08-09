const MAX_SCHEDULE_SEARCH_MINUTES = 8 * 24 * 60;

function fieldMatches(field: string, value: number, minimum: number, maximum: number): boolean {
  if (field === "*") return true;
  if (field.includes(",")) return field.split(",").some((part) => fieldMatches(part, value, minimum, maximum));
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));
    if (!Number.isInteger(step) || step < 1 || step > maximum - minimum + 1) throw new Error(`Unsupported cron field: ${field}`);
    return (value - minimum) % step === 0;
  }
  const exact = Number(field);
  if (!Number.isInteger(exact) || exact < minimum || exact > maximum) throw new Error(`Unsupported cron field: ${field}`);
  return value === exact;
}

export function cronScheduleMatches(schedule: string, date: Date): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5 || fields.slice(2).some((field) => field !== "*")) {
    throw new Error(`Unsupported cron schedule: ${schedule}`);
  }
  return fieldMatches(fields[0], date.getUTCMinutes(), 0, 59)
    && fieldMatches(fields[1], date.getUTCHours(), 0, 23);
}

function minuteFloor(date: Date): Date {
  const result = new Date(date);
  result.setUTCSeconds(0, 0);
  return result;
}

export function previousScheduledAt(schedule: string, from: Date): Date {
  const candidate = minuteFloor(from);
  for (let offset = 0; offset <= MAX_SCHEDULE_SEARCH_MINUTES; offset += 1) {
    if (cronScheduleMatches(schedule, candidate)) return new Date(candidate);
    candidate.setUTCMinutes(candidate.getUTCMinutes() - 1);
  }
  throw new Error(`No previous occurrence found for cron schedule: ${schedule}`);
}

export function nextScheduledAt(schedule: string, after: Date): Date {
  const candidate = minuteFloor(after);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  for (let offset = 0; offset <= MAX_SCHEDULE_SEARCH_MINUTES; offset += 1) {
    if (cronScheduleMatches(schedule, candidate)) return new Date(candidate);
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error(`No next occurrence found for cron schedule: ${schedule}`);
}
