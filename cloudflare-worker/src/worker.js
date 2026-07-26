// ./cloudflare-worker/src/worker.js

import { AwsClient } from "./aws4fetch.js";

const ALLOWED_METHODS = new Set(["GET", "HEAD"]);
const TOKEN_SCOPES = new Set(["exact", "prefix"]);

function decodeBase64Url(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const raw = atob(base64);
  const result = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    result[i] = raw.charCodeAt(i);
  }
  return result;
}

async function verifyToken(token, secret) {
  if (typeof token !== "string" || typeof secret !== "string" || !secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, signature] = parts;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  try {
    const signatureBytes = decodeBase64Url(signature);
    const signatureIsValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(encodedPayload)
    );
    if (!signatureIsValid) return null;

    const payloadStr = new TextDecoder().decode(decodeBase64Url(encodedPayload));
    const payload = JSON.parse(payloadStr);

    if (
      payload?.v !== 2 ||
      !Number.isInteger(payload.e) ||
      payload.e <= Math.floor(Date.now() / 1000) ||
      typeof payload.p !== "string" ||
      payload.p.length === 0 ||
      payload.p.startsWith("/") ||
      payload.p.includes("\\") ||
      !TOKEN_SCOPES.has(payload.s) ||
      !Array.isArray(payload.m) ||
      payload.m.length === 0 ||
      payload.m.some((method) => !ALLOWED_METHODS.has(method)) ||
      (payload.s === "prefix" && !payload.p.endsWith("/"))
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function isPathAuthorized(path, payload) {
  if (payload.s === "exact") return path === payload.p;
  return payload.s === "prefix" && payload.p.endsWith("/") && path.startsWith(payload.p);
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const allowedOrigin = env.ALLOWED_ORIGIN;

    // 1. CORS Preflight Handling
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin || "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "86400",
        }
      });
    }

    if (!ALLOWED_METHODS.has(request.method)) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD, OPTIONS" },
      });
    }

    if (!env.MEDIA_SECRET_KEY) {
      return new Response("Internal Server Error - Media Signing Secret Missing", { status: 500 });
    }

    // 2. Token Extraction
    const queryToken = url.searchParams.get("token");
    const cookies = request.headers.get("Cookie") || "";
    const cookieMatch = cookies.match(/(?:^|;) *media_session=([^;]*)/);
    const cookieToken = cookieMatch ? cookieMatch[1] : null;

    const tokenToVerify = queryToken || cookieToken;

    if (!tokenToVerify) {
      return new Response("Unauthorized - Missing Token", { status: 401 });
    }

    // 3. Signature & Expiry Verification
    const payload = await verifyToken(tokenToVerify, env.MEDIA_SECRET_KEY);
    if (!payload) {
      return new Response("Forbidden - Invalid or Expired Token", { status: 403 });
    }

    if (!payload.m.includes(request.method)) {
      return new Response("Forbidden - Method Mismatch", { status: 403 });
    }

    // 4. Path Scope Validation
    const cleanPath = path.startsWith("/") ? path.substring(1) : path;
    if (!isPathAuthorized(cleanPath, payload)) {
      return new Response("Forbidden - Path Mismatch", { status: 403 });
    }

    // If the subdomain contains "archive-" (e.g. archive-media-dev.myturn...)
    // we route the fetch via Backblaze B2 using AWS Signature V4.
    const isColdStorage = url.hostname.includes("archive-");

    // 5. Shared Response Headers setup
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", allowedOrigin || "*");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Accept-Ranges", "bytes");

    let body;
    let status = 200;

    if (isColdStorage) {
      // ─── BACKBLAZE B2 FETCH ROUTE ──────────────────────────────────────────
      // ADDED: Check for env.B2_BUCKET_NAME
      if (!env.B2_ENDPOINT || !env.B2_ACCESS_KEY_ID || !env.B2_SECRET_ACCESS_KEY || !env.B2_BUCKET_NAME) {
        return new Response("Internal Server Error - B2 Archive Configuration Missing", { status: 500 });
      }

      const b2Client = new AwsClient({
        accessKeyId: env.B2_ACCESS_KEY_ID,
        secretAccessKey: env.B2_SECRET_ACCESS_KEY,
        service: "s3",
        region: env.B2_REGION || "auto",
        sessionToken: undefined,
        cache: undefined,
        retries: undefined,
        initRetryMs: undefined,
      });

      // ADDED: Construct target URL using Path-Style S3 syntax 
      // (e.g., https://s3.us-east-005.backblazeb2.com/<bucket-name>/vlogs/...)
      const baseUrl = env.B2_ENDPOINT.endsWith("/") ? env.B2_ENDPOINT : env.B2_ENDPOINT + "/";
      const b2TargetUrl = new URL(`${env.B2_BUCKET_NAME}/${cleanPath}`, baseUrl);

      // Allowlist only the headers B2 actually needs.
      const b2RequestHeaders = new Headers();

      const range = request.headers.get("Range");
      if (range) b2RequestHeaders.set("Range", range);

      const ifNoneMatch = request.headers.get("If-None-Match");
      if (ifNoneMatch) b2RequestHeaders.set("If-None-Match", ifNoneMatch);

      const ifModifiedSince = request.headers.get("If-Modified-Since");
      if (ifModifiedSince) b2RequestHeaders.set("If-Modified-Since", ifModifiedSince);

      const b2Response = await b2Client.fetch(b2TargetUrl.toString(), {
        method: request.method,
        headers: b2RequestHeaders,
        signal: AbortSignal.timeout(10_000),
      });

      status = b2Response.status;
      if (status === 404) return new Response("Not Found", { status: 404 });
      if (status === 304) return new Response(null, { status: 304 });

      body = request.method === "HEAD" ? null : b2Response.body;

      // Passthrough crucial metadata mapped from B2
      const b2Etag = b2Response.headers.get("etag");
      if (b2Etag) headers.set("etag", b2Etag);

      const b2Length = b2Response.headers.get("content-length");
      if (b2Length) headers.set("Content-Length", b2Length);

      const b2Range = b2Response.headers.get("content-range");
      if (b2Range) headers.set("Content-Range", b2Range);

      const b2Type = b2Response.headers.get("content-type");
      if (b2Type) headers.set("Content-Type", b2Type);

    } else {
      // ─── CLOUDFLARE R2 BINDING ROUTE ───────────────────────────────────────
      const bucket = env.MY_BUCKET;
      if (!bucket) {
        return new Response("Internal Server Error - R2 Bucket Not Configured", { status: 500 });
      }

      const rangeHeader = request.headers.get("Range");
      const conditionalHeaders = new Headers();
      const ifNoneMatch = request.headers.get("If-None-Match");
      if (ifNoneMatch) conditionalHeaders.set("If-None-Match", ifNoneMatch);

      const ifModifiedSince = request.headers.get("If-Modified-Since");
      if (ifModifiedSince) conditionalHeaders.set("If-Modified-Since", ifModifiedSince);

      const getOptions = {};
      if (rangeHeader) getOptions.range = request.headers;
      if (ifNoneMatch || ifModifiedSince) getOptions.onlyIf = conditionalHeaders;

      let object;
      try {
        object = await bucket.get(cleanPath, getOptions);
      } catch {
        return new Response("Internal Server Error", { status: 500 });
      }

      if (object === null) return new Response("Not Found", { status: 404 });

      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);

      // R2 returns metadata without a body when an onlyIf condition fails.
      if (object.body === undefined) {
        return new Response(null, { status: 304, headers });
      }

      body = request.method === "HEAD" ? null : object.body;

      if (rangeHeader && object.range) {
        status = 206;
        headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
        headers.set("Content-Length", object.range.length.toString());
      } else {
        headers.set("Content-Length", object.size.toString());
      }
    }

    // 6. Inject Scoped Fallback Cookie
    if (queryToken) {
      const cookiePath = payload.p.startsWith("/") ? payload.p : `/${payload.p}`;
      headers.append(
        "Set-Cookie",
        `media_session=${queryToken}; Path=${cookiePath}; HttpOnly; Secure; SameSite=None; Max-Age=3600`
      );
    }

    // 7. Explicit Content-Type Fallback mapping
    const ext = cleanPath.split(".").pop().toLowerCase();
    const contentTypeMap = {
      "m3u8": "application/vnd.apple.mpegurl",
      "ts": "video/MP2T",
      "mp4": "video/mp4",
      "webm": "video/webm",
      "jpg": "image/jpeg",
      "jpeg": "image/jpeg",
      "png": "image/png",
    };

    if (contentTypeMap[ext] && !headers.has("Content-Type")) {
      headers.set("Content-Type", contentTypeMap[ext]);
    }

    // 8. Dynamic Caching Constraints
    if (cleanPath.endsWith(".m3u8")) {
      headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    } else {
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }

    return new Response(body, { status, headers });
  },
};

export default worker;
