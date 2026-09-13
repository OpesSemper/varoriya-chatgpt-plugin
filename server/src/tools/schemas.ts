import type { JsonSchema } from "../types/varoriya.js";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;

const generationKind = { type: "string", enum: ["image", "video", "audio"] } as const;
const model = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9._-]+$",
} as const;
const opaqueId = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9._:-]+$",
} as const;

export const listModelsInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { capability: generationKind },
};

export const quoteGenerationInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["model", "kind", "parameters"],
  properties: {
    model,
    kind: generationKind,
    parameters: { type: "object", additionalProperties: true, maxProperties: 64 },
  },
};

export const getBalanceInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

export const uploadInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["filename", "mime_type", "content_base64"],
  properties: {
    filename: { type: "string", minLength: 1, maxLength: 255, pattern: "^[^/\\\\]+$" },
    mime_type: {
      type: "string",
      minLength: 3,
      maxLength: 127,
      pattern: "^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$",
    },
    content_base64: {
      type: "string",
      minLength: 4,
      maxLength: MAX_UPLOAD_BASE64_LENGTH,
      contentEncoding: "base64",
    },
  },
};

export const generateInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["model", "prompt", "quote_token", "confirm", "idempotency_key"],
  properties: {
    model,
    prompt: { type: "string", minLength: 1, maxLength: 8_000 },
    quote_token: { type: "string", minLength: 16, maxLength: 4_096 },
    confirm: { type: "boolean", const: true },
    idempotency_key: {
      type: "string",
      minLength: 16,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
    },
    input_file_ids: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      items: opaqueId,
    },
    parameters: { type: "object", additionalProperties: true, maxProperties: 64 },
  },
};

export const getJobInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["job_id"],
  properties: { job_id: opaqueId },
};

const money = {
  type: "object",
  additionalProperties: false,
  required: ["amount", "currency"],
  properties: {
    amount: { type: "string", pattern: "^(?:0|[1-9]\\d*)(?:\\.\\d{1,8})?$" },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
  },
} as const;

const modelPricing = {
  type: "object",
  additionalProperties: false,
  required: ["id", "capabilities"],
  properties: {
    id: model,
    display_name: { type: "string", minLength: 1, maxLength: 256 },
    capabilities: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: generationKind,
    },
    limits: { type: "object", additionalProperties: true },
    pricing: { type: "object", additionalProperties: true },
  },
} as const;

const job = {
  type: "object",
  additionalProperties: false,
  required: ["job_id", "status", "model", "next_action"],
  properties: {
    job_id: opaqueId,
    status: {
      type: "string",
      enum: ["queued", "running", "completed", "failed", "cancelled"],
    },
    model,
    quoted_cost: money,
    final_cost: money,
    result_urls: {
      type: "array",
      maxItems: 64,
      items: { type: "string", format: "uri", maxLength: 4096 },
    },
    result_url_expires_at: { type: "string", format: "date-time" },
    next_action: { type: "string", minLength: 1, maxLength: 1000 },
  },
} as const;

function toolResult(data: Readonly<Record<string, unknown>>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ok", "request_id"],
    properties: {
      ok: { type: "boolean" },
      request_id: opaqueId,
      data,
      error: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "recoverable"],
        properties: {
          code: {
            type: "string",
            enum: [
              "INVALID_INPUT",
              "AUTH_REQUIRED",
              "INVALID_TOKEN",
              "INSUFFICIENT_SCOPE",
              "RESOURCE_FORBIDDEN",
              "INVALID_QUOTE",
              "PRICE_CHANGED",
              "INSUFFICIENT_BALANCE",
              "UNSUPPORTED_MODEL",
              "RATE_LIMITED",
              "PROVIDER_UNAVAILABLE",
              "JOB_NOT_FOUND",
            ],
          },
          message: { type: "string", minLength: 1, maxLength: 1000 },
          recoverable: { type: "boolean" },
        },
      },
    },
    oneOf: [
      {
        properties: { ok: { const: true } },
        required: ["data"],
        not: { required: ["error"] },
      },
      {
        properties: { ok: { const: false } },
        required: ["error"],
        not: { required: ["data"] },
      },
    ],
  };
}

export const listModelsOutputSchema = toolResult({
  type: "object",
  additionalProperties: false,
  required: ["models"],
  properties: {
    models: { type: "array", items: modelPricing },
    updated_at: { type: "string", format: "date-time" },
  },
});

export const quoteGenerationOutputSchema = toolResult({
  type: "object",
  additionalProperties: false,
  required: ["quote_token", "model", "kind", "estimated_cost", "expires_at"],
  properties: {
    quote_token: { type: "string", minLength: 16, maxLength: 4096 },
    model,
    kind: generationKind,
    estimated_cost: money,
    expires_at: { type: "string", format: "date-time" },
    parameters: { type: "object", additionalProperties: true, maxProperties: 64 },
  },
});

export const getBalanceOutputSchema = toolResult({
  type: "object",
  additionalProperties: false,
  required: ["balance"],
  properties: {
    balance: money,
    account_id: opaqueId,
  },
});

export const uploadOutputSchema = toolResult({
  type: "object",
  additionalProperties: false,
  required: ["file_id"],
  properties: {
    file_id: opaqueId,
    status: { type: "string", minLength: 1, maxLength: 128 },
    mime_type: { type: "string", minLength: 3, maxLength: 127 },
    size_bytes: { type: "integer", minimum: 1 },
    expires_at: { type: "string", format: "date-time" },
  },
});

export const generationOutputSchema = toolResult(job);
export const getJobOutputSchema = toolResult(job);
