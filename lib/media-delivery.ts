import { generateEdgeUrl } from "@/lib/media-signing";

type DeliverableClip = {
  mediaType: string;
  imageUrl: string | null;
  storageTier: string;
};

/**
 * Keep the legacy videoUrl response field compatible without exposing the
 * original upload: videos receive an HLS URL and photos receive their image.
 */
export function publicClipPlaybackUrl(clip: DeliverableClip, hlsUrl: string | null): string {
  if (clip.mediaType !== "photo") return hlsUrl || "";
  if (!clip.imageUrl) return "";
  return clip.imageUrl.startsWith("http") || clip.imageUrl.startsWith("/")
    ? clip.imageUrl
    : generateEdgeUrl("vlogs", clip.imageUrl, 3600, clip.storageTier);
}

/** Photo responses are image-only; legacy snippet responses stay private. */
export function hlsSafeResponses<T extends {
  imageUrl: string;
  hlsUrl?: string | null;
  mediaType?: string | null;
  transcodeStatus?: string | null;
}>(responses: T[] | null | undefined): T[] {
  return (responses || []).filter((response) => !response.mediaType || response.mediaType === "photo");
}

/** Sign every public-facing response asset without exposing the raw snippet upload. */
export function publicResponseMediaUrls<T extends {
  imageUrl: string;
  thumbnailUrl?: string | null;
  thumbnailBlurUrl?: string | null;
}>(responses: T[], storageTier: string): T[] {
  const publicUrl = (value: string) => value.startsWith("http") || value.startsWith("/")
    ? value
    : generateEdgeUrl("vlogs", value, 3600, storageTier);

  return responses.map((response) => ({
    ...response,
    imageUrl: publicUrl(response.imageUrl),
    thumbnailUrl: response.thumbnailUrl ? publicUrl(response.thumbnailUrl) : response.thumbnailUrl,
    thumbnailBlurUrl: response.thumbnailBlurUrl ? publicUrl(response.thumbnailBlurUrl) : response.thumbnailBlurUrl,
  }));
}
