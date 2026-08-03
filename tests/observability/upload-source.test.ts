import assert from "node:assert/strict";
import test from "node:test";
import { logicalUploadKey } from "../../lib/upload-source";

test("normalizes physical single-bucket upload keys for media operations", () => {
  assert.equal(logicalUploadKey("vlogs/group/clip-media.mp4"), "group/clip-media.mp4");
  assert.equal(logicalUploadKey("group/clip-media.mp4"), "group/clip-media.mp4");
});
