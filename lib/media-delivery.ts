import { generateEdgeUrl } from "@/lib/media-signing";

type DeliverableClip = {
  mediaType: string;
  videoUrl: string;
  storageTier: string;
};

/**
 * Keep the legacy videoUrl response field compatible without exposing the
 * original upload: videos receive an HLS URL and photos receive their image.
 */
export function publicClipPlaybackUrl(clip: DeliverableClip, hlsUrl: string | null): string {
  if (clip.mediaType !== "photo") return hlsUrl || "";
  return clip.videoUrl.startsWith("http") || clip.videoUrl.startsWith("/")
    ? clip.videoUrl
    : generateEdgeUrl("vlogs", clip.videoUrl, 3600, clip.storageTier);
}

/**
 * Video responses currently have only a raw MP4 object and therefore cannot
 * be delivered under the HLS-only playback policy. Keep photo responses while
 * excluding legacy video responses until they have an HLS rendition.
 */
export function hlsSafeResponses<T extends { mediaType?: string | null }>(responses: T[] | null | undefined): T[] {
  return (responses || []).filter((response) => !response.mediaType || response.mediaType === "photo");
}
