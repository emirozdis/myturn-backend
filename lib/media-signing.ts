// ./lib/media-signing.ts
import crypto from "crypto";

const MEDIA_URL = process.env.NEXT_PUBLIC_MEDIA_URL || "https://media.myturn.app";

function signingSecret(): string {
  const secret = process.env.MEDIA_SECRET_KEY;
  if (!secret || secret.length < 32) {
    throw new Error("MEDIA_SECRET_KEY must be configured with at least 32 characters.");
  }
  return secret;
}

function base64url(str: string | Buffer) {
  if (typeof str === "string") {
    return Buffer.from(str).toString("base64url");
  }
  return str.toString("base64url");
}

/**
 * Mints an Edge Authorization Token and appends it to the applicable CDN domain.
 * Supports dynamic routing: if storage is 'COLD', transparently shifts base URL to the archive subdomain
 * matching the current environment (e.g., media-dev -> archive-media-dev).
 */
export function generateEdgeUrl(
  bucket: string, 
  path: string, 
  expiresInSeconds = 3600, 
  storageTier: "HOT" | "COLD" | "MIGRATING" | string = "HOT"
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  
  const cleanPath = path.startsWith("/") ? path.substring(1) : path;
  
  // Deduplicate bucket folder prefix if it is already prepended to the path
  const prefix = `${bucket}/`;
  const finalPath = cleanPath.startsWith(prefix) ? cleanPath.substring(prefix.length) : cleanPath;
  
  const fullPath = `${bucket}/${finalPath}`;
  
  const isHls = fullPath.includes(".m3u8");
  
  // Authorize directory prefix for HLS, or exact file path for standalone assets
  const authPath = isHls ? fullPath.substring(0, fullPath.lastIndexOf("/") + 1) : fullPath;

  const scope = isHls ? "prefix" : "exact";
  const payload = JSON.stringify({ v: 2, p: authPath, e: expiresAt, m: ["GET", "HEAD"], s: scope });
  const encodedPayload = base64url(payload);
  
  const signature = crypto
    .createHmac("sha256", signingSecret())
    .update(encodedPayload)
    .digest("base64url");
    
  const token = `${encodedPayload}.${signature}`;

  // Route to proper subdomain matching the environment configuration
  let activeBaseUrl = MEDIA_URL;
  if (storageTier === "COLD") {
    try {
      const urlObj = new URL(MEDIA_URL);
      // Handles both "media-dev." -> "archive-media-dev." and "media." -> "archive-media." gracefully
      if (urlObj.hostname.startsWith("media-")) {
        urlObj.hostname = "archive-" + urlObj.hostname;
      } else {
        urlObj.hostname = "archive-" + urlObj.hostname; // e.g. archive-media.domain.com
      }
      activeBaseUrl = urlObj.toString().replace(/\/$/, "");
    } catch {
      // Fallback fallback if environment var isn't perfectly structured
      activeBaseUrl = MEDIA_URL;
    }
  }
  
  return `${activeBaseUrl}/${fullPath}?token=${token}`;
}
