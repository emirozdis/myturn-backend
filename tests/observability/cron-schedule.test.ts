import assert from "node:assert/strict";
import test from "node:test";
import { cronScheduleMatches, nextScheduledAt, previousScheduledAt } from "../../lib/cron-schedule";

test("cron schedule matcher handles minute, interval, hourly, and daily schedules in UTC", () => {
  const date = new Date("2026-08-09T03:30:45.000Z");
  assert.equal(cronScheduleMatches("* * * * *", date), true);
  assert.equal(cronScheduleMatches("*/15 * * * *", date), true);
  assert.equal(cronScheduleMatches("*/30 * * * *", date), true);
  assert.equal(cronScheduleMatches("0 * * * *", date), false);
  assert.equal(cronScheduleMatches("30 3 * * *", date), true);
  assert.equal(cronScheduleMatches("17 3 * * *", date), false);
});

test("cron occurrence calculation does not replay every missed interval", () => {
  const now = new Date("2026-08-09T14:07:23.000Z");
  assert.equal(previousScheduledAt("*/15 * * * *", now).toISOString(), "2026-08-09T14:00:00.000Z");
  assert.equal(nextScheduledAt("*/15 * * * *", now).toISOString(), "2026-08-09T14:15:00.000Z");
  assert.equal(nextScheduledAt("17 3 * * *", now).toISOString(), "2026-08-10T03:17:00.000Z");
});

test("unsupported cron expressions fail closed", () => {
  assert.throws(() => cronScheduleMatches("0 0 1 * *", new Date()), /Unsupported cron schedule/);
  assert.throws(() => cronScheduleMatches("*/0 * * * *", new Date()), /Unsupported cron field/);
});
