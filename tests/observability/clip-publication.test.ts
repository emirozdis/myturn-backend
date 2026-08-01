import test from "node:test";
import assert from "node:assert/strict";
import { consecutiveReadyClipIds } from "../../lib/clip-publication";

const readyAt = new Date("2026-08-01T12:00:00.000Z");

test("publishes the consecutive ready prefix after already-published clips", () => {
  assert.deepEqual(consecutiveReadyClipIds([
    { id: "published", transcodeStatus: "COMPLETED", transcodeReadyAt: readyAt },
    { id: "first", transcodeStatus: "PROCESSING", transcodeReadyAt: readyAt },
    { id: "second", transcodeStatus: "PROCESSING", transcodeReadyAt: readyAt },
  ]), ["first", "second"]);
});

test("does not publish a later ready clip while an earlier clip is processing", () => {
  assert.deepEqual(consecutiveReadyClipIds([
    { id: "first", transcodeStatus: "PROCESSING", transcodeReadyAt: null },
    { id: "second", transcodeStatus: "PROCESSING", transcodeReadyAt: readyAt },
  ]), []);
});

test("stops at the first unfinished clip", () => {
  assert.deepEqual(consecutiveReadyClipIds([
    { id: "first", transcodeStatus: "PROCESSING", transcodeReadyAt: readyAt },
    { id: "second", transcodeStatus: "PROCESSING", transcodeReadyAt: null },
    { id: "third", transcodeStatus: "PROCESSING", transcodeReadyAt: readyAt },
  ]), ["first"]);
});

test("a permanently failed clip does not deadlock future ready clips", () => {
  assert.deepEqual(consecutiveReadyClipIds([
    { id: "failed", transcodeStatus: "FAILED_PERMANENTLY", transcodeReadyAt: null },
    { id: "next", transcodeStatus: "PROCESSING", transcodeReadyAt: readyAt },
  ]), ["next"]);
});
