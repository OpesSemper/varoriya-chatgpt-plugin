import type { MediaPolicyConfig } from "../config.js";
import { AppError } from "../errors.js";

export interface MediaCandidate {
  readonly declaredMimeType: string;
  readonly sizeBytes: number;
  /** Initial bytes used for signature detection; at least 16 are recommended. */
  readonly prefix: Uint8Array;
  readonly filename?: string;
}

export interface MediaValidationResult {
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly safeFilename?: string;
}

const EXTENSIONS_BY_MIME: Readonly<Record<string, readonly string[]>> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "video/mp4": ["mp4", "m4v"],
  "video/webm": ["webm"],
  "audio/mpeg": ["mp3"],
  "audio/wav": ["wav"],
};

/**
 * Validate declared MIME, byte signature, extension, and size before storage.
 * This does not replace isolated malware scanning or safe transcoding.
 */
export function validateMedia(
  candidate: MediaCandidate,
  config: MediaPolicyConfig,
): MediaValidationResult {
  const tooLarge = candidate.sizeBytes > config.maxUploadBytes;
  if (
    !Number.isSafeInteger(candidate.sizeBytes) ||
    candidate.sizeBytes <= 0 ||
    tooLarge
  ) {
    throw new AppError(tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT", {
      status: tooLarge ? 413 : 400,
      message: tooLarge
        ? "The media file exceeds the configured size limit."
        : "The media file size is invalid.",
      ...(tooLarge ? { details: { max_bytes: config.maxUploadBytes } } : {}),
    });
  }
  if (candidate.prefix.length > candidate.sizeBytes) throw invalidMedia();
  const declared = normalizeMimeType(candidate.declaredMimeType);
  const detected = detectMimeType(candidate.prefix);
  if (
    !detected ||
    declared !== detected ||
    !config.allowedMimeTypes.includes(detected)
  ) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", {
      status: 415,
      message: "The media type is unsupported or does not match its content.",
    });
  }
  const safeFilename = candidate.filename
    ? validateFilename(candidate.filename, detected)
    : undefined;
  return Object.freeze({
    mimeType: detected,
    sizeBytes: candidate.sizeBytes,
    ...(safeFilename ? { safeFilename } : {}),
  });
}

export function normalizeMimeType(value: string): string {
  if (typeof value !== "string") return "";
  const mime = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(
    mime,
  )
    ? mime
    : "";
}

/** Conservative magic-byte detection for the Version 1 allowlist. */
export function detectMimeType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  if (asciiAt(bytes, 4, "ftyp")) return "video/mp4";
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE")) {
    return "audio/wav";
  }
  if (
    asciiAt(bytes, 0, "ID3") ||
    (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)
  ) {
    return "audio/mpeg";
  }
  return undefined;
}

function validateFilename(filename: string, mimeType: string): string {
  if (
    filename.length < 1 ||
    filename.length > 255 ||
    /[\u0000-\u001f\u007f/\\]/.test(filename) ||
    filename === "." ||
    filename === ".."
  ) {
    throw invalidMedia();
  }
  const extension = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (!EXTENSIONS_BY_MIME[mimeType]?.includes(extension)) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", {
      status: 415,
      message: "The filename extension does not match the media content.",
    });
  }
  return filename.normalize("NFC");
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

function asciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (bytes.length < offset + expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function invalidMedia(): AppError {
  return new AppError("INVALID_INPUT", {
    status: 400,
    message: "The media file metadata is invalid.",
  });
}
