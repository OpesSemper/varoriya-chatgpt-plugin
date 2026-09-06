import type { JsonSchema } from "../types/varoriya.js";

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
      maxLength: 13_981_016,
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
