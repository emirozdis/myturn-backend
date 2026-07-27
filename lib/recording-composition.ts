export type CompositionFacingMode = "user" | "environment";
export type CompositionSpeed = 1 | 2;

export type RecordingCompositionSegment = {
  offset: number;
  length: number;
  durationMs: number;
  speed: CompositionSpeed;
  facingMode: CompositionFacingMode;
};

export type RecordingComposition = {
  version: 1;
  totalBytes: number;
  totalSourceDurationMs: number;
  segments: RecordingCompositionSegment[];
};

export type ValidatedRecordingMetadata = Record<string, unknown> & {
  composition?: RecordingComposition;
  speedBaked?: boolean;
  prompt?: string;
};

const MAX_SEGMENTS = 64;
const MAX_SOURCE_DURATION_MS = 125_000;
const MAX_SNIPPET_SOURCE_DURATION_MS = 6_000;
const MIN_VLOG_SOURCE_DURATION_MS = 5_000;
const MIN_SNIPPET_SOURCE_DURATION_MS = 2_000;

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function validateRecordingMetadata(
  rawMetadata: unknown,
  expectedBytes: number,
  mediaType: "photo" | "snippet" | "vlog",
): { metadata: ValidatedRecordingMetadata | null; serialized: string | null; segmented: boolean } {
  if (rawMetadata === undefined || rawMetadata === null || rawMetadata === "") {
    return { metadata: null, serialized: null, segmented: false };
  }
  if (typeof rawMetadata !== "string" || rawMetadata.length > 10_000) {
    throw new Error("Upload metadata is invalid or too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMetadata);
  } catch {
    throw new Error("Upload metadata is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Upload metadata must be an object.");
  }

  const metadata = parsed as ValidatedRecordingMetadata;
  if (metadata.prompt !== undefined) {
    if (typeof metadata.prompt !== "string" || metadata.prompt.trim().length > 500) {
      throw new Error("Clip prompt is invalid or too large.");
    }
    metadata.prompt = metadata.prompt.trim();
    if (!metadata.prompt) delete metadata.prompt;
  }
  if (metadata.composition === undefined) {
    return { metadata, serialized: JSON.stringify(metadata), segmented: false };
  }
  if (mediaType === "photo") throw new Error("Photos cannot contain a video composition.");

  const composition = metadata.composition as RecordingComposition;
  if (!composition || typeof composition !== "object" || composition.version !== 1) {
    throw new Error("Unsupported recording composition version.");
  }
  if (!Array.isArray(composition.segments) || composition.segments.length < 1 || composition.segments.length > MAX_SEGMENTS) {
    throw new Error("Recording composition has an invalid segment count.");
  }
  if (!isSafePositiveInteger(composition.totalBytes) || composition.totalBytes !== expectedBytes) {
    throw new Error("Recording composition size does not match the upload.");
  }
  if (!isSafePositiveInteger(composition.totalSourceDurationMs)) {
    throw new Error("Recording composition duration is invalid.");
  }

  let nextOffset = 0;
  let durationTotal = 0;
  for (const segment of composition.segments) {
    if (!segment || typeof segment !== "object" ||
        !Number.isSafeInteger(segment.offset) || segment.offset !== nextOffset ||
        !isSafePositiveInteger(segment.length) ||
        !isSafePositiveInteger(segment.durationMs) ||
        ![1, 2].includes(segment.speed) ||
        !["user", "environment"].includes(segment.facingMode)) {
      throw new Error("Recording composition contains an invalid segment.");
    }
    nextOffset += segment.length;
    durationTotal += segment.durationMs;
  }

  const durationLimit = mediaType === "snippet" ? MAX_SNIPPET_SOURCE_DURATION_MS : MAX_SOURCE_DURATION_MS;
  const minimumDuration = mediaType === "snippet" ? MIN_SNIPPET_SOURCE_DURATION_MS : MIN_VLOG_SOURCE_DURATION_MS;
  if (nextOffset !== expectedBytes || durationTotal !== composition.totalSourceDurationMs ||
      durationTotal < minimumDuration || durationTotal > durationLimit) {
    throw new Error("Recording composition totals are invalid.");
  }
  if (metadata.speedBaked !== true) {
    throw new Error("Recording composition must declare baked output speed.");
  }

  const normalized: ValidatedRecordingMetadata = {
    ...metadata,
    speedBaked: true,
    composition: {
      version: 1,
      totalBytes: composition.totalBytes,
      totalSourceDurationMs: composition.totalSourceDurationMs,
      segments: composition.segments.map((segment) => ({
        offset: segment.offset,
        length: segment.length,
        durationMs: segment.durationMs,
        speed: segment.speed,
        facingMode: segment.facingMode,
      })),
    },
  };

  return { metadata: normalized, serialized: JSON.stringify(normalized), segmented: true };
}
