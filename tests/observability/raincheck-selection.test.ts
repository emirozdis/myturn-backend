import assert from "node:assert/strict";
import test from "node:test";
import { getRaincheckUserId } from "../../lib/raincheck";

const members = new Set(["original-passer", "claimant"]);

test("keeps tomorrow's raincheck after another member claims the passed turn", () => {
  assert.equal(getRaincheckUserId({ passedByUserId: "original-passer" }, members), "original-passer");
});

test("removes the raincheck after a mandatory assignment auto-passes", () => {
  assert.equal(getRaincheckUserId({ passedByUserId: null }, members), null);
});

test("does not lock in a user who has left the group", () => {
  assert.equal(getRaincheckUserId({ passedByUserId: "former-member" }, members), null);
});
