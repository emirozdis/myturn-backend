import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import worker from "../src/worker.js";

const SECRET = "test-media-secret-that-is-at-least-32-characters";
const DEFAULT_PAYLOAD = {
  v: 2,
  p: "avatars/user.jpg",
  e: Math.floor(Date.now() / 1000) + 3600,
  m: ["GET", "HEAD"],
  s: "exact",
};

function signToken(overrides = {}) {
  const payload = { ...DEFAULT_PAYLOAD, ...overrides };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", SECRET)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function mediaRequest(path, { method = "GET", payload, headers } = {}) {
  const url = new URL(`https://media.example/${path}`);
  url.searchParams.set("token", signToken(payload));
  return new Request(url, { method, headers });
}

function r2Object(content = "media", { includeBody = true, range } = {}) {
  const size = Buffer.byteLength(content);
  return {
    ...(includeBody ? { body: new Response(content).body } : {}),
    size,
    range,
    httpEtag: '"test-etag"',
    writeHttpMetadata(headers) {
      headers.set("Content-Type", "application/octet-stream");
    },
  };
}

function testEnv(get) {
  return {
    MEDIA_SECRET_KEY: SECRET,
    ALLOWED_ORIGIN: "https://app.example",
    MY_BUCKET: { get },
  };
}

test("rejects methods other than GET, HEAD, and OPTIONS before storage access", async () => {
  let storageCalls = 0;
  const env = testEnv(async () => {
    storageCalls += 1;
    return r2Object();
  });

  const response = await worker.fetch(
    mediaRequest("avatars/user.jpg", { method: "DELETE" }),
    env
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, HEAD, OPTIONS");
  assert.equal(storageCalls, 0);
});

test("enforces the methods authorized by the token", async () => {
  const response = await worker.fetch(
    mediaRequest("avatars/user.jpg", {
      method: "HEAD",
      payload: { m: ["GET"] },
    }),
    testEnv(async () => r2Object())
  );

  assert.equal(response.status, 403);
  assert.equal(await response.text(), "Forbidden - Method Mismatch");
});

test("requires an exact match for exact-scope tokens", async () => {
  let storageCalls = 0;
  const response = await worker.fetch(
    mediaRequest("avatars/user.jpg.backup"),
    testEnv(async () => {
      storageCalls += 1;
      return r2Object();
    })
  );

  assert.equal(response.status, 403);
  assert.equal(storageCalls, 0);
});

test("allows descendants but rejects siblings for directory-prefix tokens", async () => {
  const env = testEnv(async () => r2Object("segment"));
  const payload = { p: "vlogs/clip/", s: "prefix" };

  const allowed = await worker.fetch(
    mediaRequest("vlogs/clip/720p/segment-1.ts", { payload }),
    env
  );
  const rejected = await worker.fetch(
    mediaRequest("vlogs/clip-evil/segment-1.ts", { payload }),
    env
  );

  assert.equal(allowed.status, 200);
  assert.equal(await allowed.text(), "segment");
  assert.equal(rejected.status, 403);
});

test("rejects prefix scopes without a directory boundary", async () => {
  const response = await worker.fetch(
    mediaRequest("vlogs/clip/segment-1.ts", {
      payload: { p: "vlogs/clip", s: "prefix" },
    }),
    testEnv(async () => r2Object())
  );

  assert.equal(response.status, 403);
  assert.equal(await response.text(), "Forbidden - Invalid or Expired Token");
});

test("returns 404 when a missing R2 object is requested conditionally", async () => {
  const response = await worker.fetch(
    mediaRequest("avatars/user.jpg", {
      headers: { "If-None-Match": '"test-etag"' },
    }),
    testEnv(async () => null)
  );

  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not Found");
});

test("returns a bodyless 304 when an existing R2 object fails onlyIf", async () => {
  const response = await worker.fetch(
    mediaRequest("avatars/user.jpg", {
      headers: { "If-None-Match": '"test-etag"' },
    }),
    testEnv(async () => r2Object("media", { includeBody: false }))
  );

  assert.equal(response.status, 304);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("etag"), '"test-etag"');
});

test("HEAD returns object metadata without a response body", async () => {
  const response = await worker.fetch(
    mediaRequest("avatars/user.jpg", { method: "HEAD" }),
    testEnv(async () => r2Object("media"))
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Length"), "5");
  assert.equal(await response.text(), "");
});
