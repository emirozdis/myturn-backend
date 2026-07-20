import test from "node:test";
import assert from "node:assert/strict";
import { validateRecordingMetadata } from "../../lib/recording-composition";

const validMetadata = JSON.stringify({
  speedBaked: true,
  composition: {
    version: 1,
    totalBytes: 300,
    totalSourceDurationMs: 3_000,
    segments: [
      { offset: 0, length: 100, durationMs: 1_000, speed: 1, facingMode: "user" },
      { offset: 100, length: 200, durationMs: 2_000, speed: 2, facingMode: "environment" },
    ],
  },
});

test("accepts a contiguous mixed-speed recording composition", () => {
  const result = validateRecordingMetadata(validMetadata, 300, "snippet");
  assert.equal(result.segmented, true);
  assert.equal(result.metadata?.composition?.segments.length, 2);
  assert.equal(result.metadata?.composition?.segments[1].speed, 2);
});

test("rejects gaps or overlaps in recording byte ranges", () => {
  const parsed = JSON.parse(validMetadata);
  parsed.composition.segments[1].offset = 101;
  assert.throws(
    () => validateRecordingMetadata(JSON.stringify(parsed), 300, "snippet"),
    /invalid segment/i,
  );
});

test("rejects a manifest whose bytes do not match the multipart object", () => {
  assert.throws(
    () => validateRecordingMetadata(validMetadata, 301, "snippet"),
    /size does not match/i,
  );
});

test("rejects unsupported recording speeds", () => {
  const parsed = JSON.parse(validMetadata);
  parsed.composition.segments[0].speed = 4;
  assert.throws(
    () => validateRecordingMetadata(JSON.stringify(parsed), 300, "snippet"),
    /invalid segment/i,
  );
});

test("rejects recordings below the media-type minimum duration", () => {
  assert.throws(
    () => validateRecordingMetadata(validMetadata, 300, "vlog"),
    /totals are invalid/i,
  );
});

test("keeps legacy non-composition metadata backward compatible", () => {
  const result = validateRecordingMetadata(JSON.stringify({ facingMode: "user" }), 300, "vlog");
  assert.equal(result.segmented, false);
  assert.deepEqual(result.metadata, { facingMode: "user" });
});
