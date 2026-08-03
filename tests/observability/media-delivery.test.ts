import assert from "node:assert/strict";
import test from "node:test";
import { hlsSafeResponses, publicClipPlaybackUrl } from "../../lib/media-delivery";

test("publishes photo responses and hides all legacy snippet responses", () => {
  const responses = [
    { id: "photo", mediaType: "photo", imageUrl: "responses/photo.jpg", hlsUrl: null, transcodeStatus: "COMPLETED" },
    { id: "raw", mediaType: "snippet", imageUrl: "responses/raw.mp4", hlsUrl: null, transcodeStatus: "PROCESSING" },
    {
      id: "ready",
      mediaType: "snippet",
      imageUrl: "responses/source.mp4",
      hlsUrl: "responses/ready_hls/master.m3u8",
      thumbnailUrl: "responses/source-thumb.jpg",
      thumbnailBlurUrl: "responses/source-thumb-blur.jpg",
      transcodeStatus: "COMPLETED",
    },
  ];

  const delivered = hlsSafeResponses(responses);

  assert.deepEqual(delivered.map((response) => response.id), ["photo"]);
  assert.equal(responses[2].imageUrl, "responses/source.mp4");
});

test("computes the legacy videoUrl response without a stored videoUrl column", () => {
  assert.equal(publicClipPlaybackUrl({ mediaType: "vlog", imageUrl: null, storageTier: "HOT" }, "signed/master.m3u8"), "signed/master.m3u8");
  assert.equal(publicClipPlaybackUrl({ mediaType: "photo", imageUrl: "/photos/image.jpg", storageTier: "HOT" }, null), "/photos/image.jpg");
});
