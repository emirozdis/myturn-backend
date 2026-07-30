import test from "node:test";
import assert from "node:assert/strict";
import {
  getVlogTimePeriod,
  getVlogTimePeriodForHour,
  hasVlogInTimePeriod,
} from "../../lib/business-time";

test("maps each active three-hour window to a distinct vlog period", () => {
  assert.equal(getVlogTimePeriodForHour(9), 0);
  assert.equal(getVlogTimePeriodForHour(11), 0);
  assert.equal(getVlogTimePeriodForHour(12), 1);
  assert.equal(getVlogTimePeriodForHour(15), 2);
  assert.equal(getVlogTimePeriodForHour(18), 3);
  assert.equal(getVlogTimePeriodForHour(21), 4);
  assert.equal(getVlogTimePeriodForHour(23), 4);
});

test("does not expose a poke period during sleep hours", () => {
  assert.equal(getVlogTimePeriodForHour(0), null);
  assert.equal(getVlogTimePeriodForHour(8), null);
  assert.equal(getVlogTimePeriodForHour(24), null);
});

test("compares clip periods in the group timezone", () => {
  assert.equal(getVlogTimePeriod("2026-07-30T08:30:00.000Z", "UTC+03:00"), 0);
  assert.equal(getVlogTimePeriod("2026-07-30T09:30:00.000Z", "UTC+03:00"), 1);
});

test("clips from earlier periods do not count as a post in the active period", () => {
  const earlierClip = "2026-07-30T08:30:00.000Z"; // 11:30 at UTC+03:00, period 0

  assert.equal(hasVlogInTimePeriod([earlierClip], "UTC+03:00", 1), false);
  assert.equal(
    hasVlogInTimePeriod([earlierClip, "2026-07-30T09:30:00.000Z"], "UTC+03:00", 1),
    true,
  );
});
