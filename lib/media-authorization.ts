import { db } from "@/lib/db";
import { checkUserProStatus, isArchiveLocked } from "@/lib/pro-helper";

const ALLOWED_BUCKETS = new Set(["vlogs", "thumbnails", "avatars"]);

function normalizePath(path: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  const clean = decoded.replace(/^\/+/, "");
  if (!clean || clean.includes("\\") || clean.split("/").some((part) => part === ".." || part === "")) return null;
  return clean;
}

function hlsMasterFor(path: string): string | null {
  const parts = path.split("/");
  const rootIndex = parts.findIndex((part) => part.endsWith("_hls"));
  if (rootIndex < 0 || rootIndex === parts.length - 1) return null;
  return `${parts.slice(0, rootIndex + 1).join("/")}/master.m3u8`;
}

function canonicalAvatarPath(path: string): string {
  // Avatar records are stored as full storage keys, including the `avatars/`
  // prefix. Accept a prefixless legacy client request during rollout, but
  // always authorize and return the canonical key.
  return path.startsWith("avatars/") || path.includes("/") ? path : `avatars/${path}`;
}

export async function authorizeMediaRead(userId: string, bucket: string, rawPath: string) {
  if (!ALLOWED_BUCKETS.has(bucket)) return null;
  const path = normalizePath(rawPath);
  if (!path) return null;

  if (bucket === "avatars") {
    const avatarPath = canonicalAvatarPath(path);
    const userAvatar = await db.profile.findFirst({ where: { image: avatarPath }, select: { id: true } });
    if (userAvatar) return { path: avatarPath, storageTier: "HOT" };

    const groupAvatar = await db.group.findFirst({
      where: { image: avatarPath, members: { some: { userId } } },
      select: { id: true },
    });
    return groupAvatar ? { path: avatarPath, storageTier: "HOT" } : null;
  }

  const rawVideoResponse = await db.photoResponse.findFirst({
    where: { imageUrl: path, mediaType: { not: "photo" } },
    select: { id: true },
  });
  if (rawVideoResponse) return null;

  const possibleHlsMaster = hlsMasterFor(path);
  const clip = await db.clip.findFirst({
    where: {
      OR: [
        { videoUrl: path },
        { thumbnailUrl: path },
        { thumbnailBlurUrl: path },
        { hlsUrl: path },
        ...(possibleHlsMaster ? [{ hlsUrl: possibleHlsMaster }] : []),
        {
          photoResponses: {
            some: {
              OR: [
                { imageUrl: path },
                { hlsUrl: path },
                { thumbnailUrl: path },
                { thumbnailBlurUrl: path },
                ...(possibleHlsMaster ? [{ hlsUrl: possibleHlsMaster }] : []),
              ],
            },
          },
        },
      ],
    },
    include: {
      group: {
        select: {
          isFrozen: true,
          timezone: true,
          members: { where: { userId }, select: { id: true } },
          _count: { select: { boosts: true } },
        },
      },
    },
  });
  if (!clip || clip.group.members.length === 0) return null;

  // The original upload is an internal transcoding source, never a playback
  // asset. Photos still use videoUrl as their image object for legacy schema
  // compatibility, but video clips must only be read through HLS playlists and
  // their child segments.
  if (path === clip.videoUrl && clip.mediaType !== "photo") return null;

  const isUserPro = await checkUserProStatus(userId);
  if (isArchiveLocked(clip.recordedAt, isUserPro, clip.group._count.boosts >= 3, clip.group.isFrozen, clip.group.timezone)) return null;
  return { path, storageTier: clip.storageTier };
}
