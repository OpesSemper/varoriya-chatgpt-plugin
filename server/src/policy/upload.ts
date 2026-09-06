import type { MediaPolicyConfig } from "../config.js";
import { AppError } from "../errors.js";
import type {
  AuthenticatedRequestContext,
  RequestContext,
  UploadInput,
} from "../types/varoriya.js";
import { validateMedia, type MediaValidationResult } from "./media.js";
import { toToolBoundaryError } from "./tool-boundary-error.js";

export interface MalwareScanResult {
  readonly verdict: "clean" | "malicious" | "unknown";
}

/** Scanner must inspect bytes in an isolated service/process. */
export interface MalwareScanner {
  scan(
    bytes: Uint8Array,
    metadata: MediaValidationResult,
    context: Pick<AuthenticatedRequestContext, "requestId" | "subject">,
  ): Promise<MalwareScanResult>;
}

/** Concrete fail-closed upload adapter; scanner injection is mandatory. */
export class UploadValidationPolicy {
  readonly #config: MediaPolicyConfig;
  readonly #scanner: MalwareScanner;

  public constructor(config: MediaPolicyConfig, scanner: MalwareScanner) {
    if (!scanner || typeof scanner.scan !== "function") {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "A malware scanner is required for media uploads.",
      });
    }
    this.#config = config;
    this.#scanner = scanner;
  }

  /** Bound validator; safe to pass directly into a tool registry. */
  public readonly validate = async (
    context: RequestContext,
    input: UploadInput,
  ): Promise<void> => {
    const subject = requiredSubject(context);
    const maximumEncodedLength =
      Math.ceil(this.#config.maxUploadBytes / 3) * 4 + 4;
    if (input.content_base64.length > maximumEncodedLength) {
      throw new AppError("PAYLOAD_TOO_LARGE", {
        status: 413,
        message: "The media file exceeds the configured size limit.",
        details: { max_bytes: this.#config.maxUploadBytes },
      });
    }
    const decodedSize = decodedBase64Size(input.content_base64);
    if (decodedSize > this.#config.maxUploadBytes) {
      throw new AppError("PAYLOAD_TOO_LARGE", {
        status: 413,
        message: "The media file exceeds the configured size limit.",
        details: { max_bytes: this.#config.maxUploadBytes },
      });
    }
    const bytes = decodeBase64(input.content_base64, decodedSize);
    const metadata = validateMedia(
      {
        declaredMimeType: input.mime_type,
        sizeBytes: bytes.length,
        prefix: bytes.subarray(0, 16),
        filename: input.filename,
      },
      this.#config,
    );
    let scan: MalwareScanResult;
    try {
      scan = await this.#scanner.scan(bytes, metadata, {
        requestId: context.requestId,
        subject,
      });
    } catch (cause) {
      throw new AppError("PROVIDER_UNAVAILABLE", {
        status: 503,
        message: "Media safety validation is temporarily unavailable.",
        recoverable: true,
        cause,
      });
    }
    if (!scan || scan.verdict !== "clean") {
      throw new AppError("INVALID_INPUT", {
        status: 400,
        message: "The media file did not pass safety validation.",
      });
    }
  };

  /** Adapter preserving the stable errors expected by MCP tool handlers. */
  public readonly validateForTool = async (
    context: RequestContext,
    input: UploadInput,
  ): Promise<void> => {
    try {
      await this.validate(context, input);
    } catch (error) {
      throw toToolBoundaryError(context.requestId, error);
    }
  };
}

function decodedBase64Size(value: string): number {
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw invalidBase64();
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const size = (value.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(size) || size < 1) throw invalidBase64();
  return size;
}

function decodeBase64(value: string, size: number): Uint8Array {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const output = new Uint8Array(size);
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const first = value[index];
    const second = value[index + 1];
    const third = value[index + 2];
    const fourth = value[index + 3];
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      throw invalidBase64();
    }
    const a = alphabet.indexOf(first);
    const b = alphabet.indexOf(second);
    const c = third === "=" ? 0 : alphabet.indexOf(third);
    const d = fourth === "=" ? 0 : alphabet.indexOf(fourth);
    if (a < 0 || b < 0 || c < 0 || d < 0) throw invalidBase64();
    if (
      (third === "=" && (b & 0x0f) !== 0) ||
      (fourth === "=" && (c & 0x03) !== 0)
    ) {
      throw invalidBase64();
    }
    const bits = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputIndex < size) output[outputIndex++] = (bits >> 16) & 0xff;
    if (outputIndex < size) output[outputIndex++] = (bits >> 8) & 0xff;
    if (outputIndex < size) output[outputIndex++] = bits & 0xff;
  }
  return output;
}

function requiredSubject(context: RequestContext): string {
  if (!context.subject) {
    throw new AppError("AUTH_REQUIRED", {
      status: 401,
      message: "Authentication is required.",
    });
  }
  return context.subject;
}

function invalidBase64(): AppError {
  return new AppError("INVALID_INPUT", {
    status: 400,
    message: "The media content encoding is invalid.",
  });
}
