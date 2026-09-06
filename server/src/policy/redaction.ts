export const REDACTED = "[REDACTED]";
const CIRCULAR = "[CIRCULAR]";
const MAX_DEPTH = 8;
const MAX_COLLECTION_ITEMS = 100;
const MAX_LOG_STRING_LENGTH = 4_096;

const SENSITIVE_KEY = /(?:^|[_-])(?:authorization|cookie|credential|password|secret|token|api[_-]?key|prompt|media|content|signed[_-]?url)(?:$|[_-])/i;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

/** Return a new redacted header object suitable for structured logs. */
export function redactHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    output[key] = sensitiveKey(key) ? REDACTED : redactLogValue(value);
  }
  return Object.freeze(output);
}

/**
 * Defensive recursive redaction. Production logging should additionally use a
 * strict allowlist schema and omit prompts/media before calling this function.
 */
export function redactLogValue(value: unknown): unknown {
  return redact(value, new WeakSet<object>(), 0, "");
}

export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return redactString(rawUrl);
    }
    url.username = "";
    url.password = "";
    if (url.search) url.search = `?${REDACTED}`;
    if (url.hash) url.hash = `#${REDACTED}`;
    return url.toString();
  } catch {
    return redactString(rawUrl);
  }
}

function redact(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  key: string,
): unknown {
  if (sensitiveKey(key)) return REDACTED;
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? redactUrl(value) : redactString(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return undefined;
  if (typeof value === "function" || typeof value === "symbol") {
    return "[UNSERIALIZABLE]";
  }
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
  if (seen.has(value as object)) return CIRCULAR;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_COLLECTION_ITEMS)
      .map((item) => redact(item, seen, depth + 1, ""));
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(
    value as Record<string, unknown>,
  ).slice(0, MAX_COLLECTION_ITEMS)) {
    output[childKey] = redact(childValue, seen, depth + 1, childKey);
  }
  return output;
}

function redactString(value: string): string {
  const redacted = value
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(JWT, REDACTED);
  return redacted.length > MAX_LOG_STRING_LENGTH
    ? `${redacted.slice(0, MAX_LOG_STRING_LENGTH)}[TRUNCATED]`
    : redacted;
}

function sensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return SENSITIVE_KEY.test(normalized);
}
