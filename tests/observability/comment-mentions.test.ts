import assert from "node:assert/strict";
import test from "node:test";
import { findMentionedUserIds } from "../../lib/comment-mentions";

const members = [
  { id: "user-sam", handle: "sam" },
  { id: "user-sam-dev", handle: "sam.dev" },
  { id: "user-elif", handle: "elif_34" },
  { id: "no-handle", handle: null },
];

test("resolves group member handles without partial matches", () => {
  assert.deepEqual(
    findMentionedUserIds("Hey @sam.dev and @elif_34!", members),
    ["user-sam-dev", "user-elif"],
  );
});

test("deduplicates mentions and ignores email-like and unknown tokens", () => {
  assert.deepEqual(
    findMentionedUserIds("@sam, again @SAM — not test@sam or @stranger", members),
    ["user-sam"],
  );
});
