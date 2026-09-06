import { AppError } from "../errors.js";
import type {
  GenerationKind,
  RequestContext,
} from "../types/varoriya.js";

export interface ModelAllowlistEntry {
  readonly model: string;
  readonly kinds: readonly GenerationKind[];
  readonly requiredScopes?: readonly string[];
  readonly subjects?: readonly string[];
}

/** Exact-match allowlist. An empty policy denies every model. */
export class ModelAllowlistPolicy {
  readonly #entries: readonly ModelAllowlistEntry[];

  public constructor(entries: readonly ModelAllowlistEntry[]) {
    const validated = entries.map(validateEntry);
    const seen = new Set<string>();
    for (const entry of validated) {
      for (const kind of entry.kinds) {
        const key = `${entry.model}\u0000${kind}`;
        // Overlap could accidentally bypass a subject/scope restriction.
        if (seen.has(key)) throw invalidConfiguration();
        seen.add(key);
      }
    }
    this.#entries = Object.freeze(validated);
  }

  /** Bound predicate; safe to pass directly into a tool registry. */
  public readonly isAllowed = (
    context: RequestContext,
    model: string,
    kind: GenerationKind,
  ): boolean =>
    this.#entries.some(
      (entry) =>
        entry.model === model &&
        entry.kinds.includes(kind) &&
        (entry.requiredScopes ?? []).every((scope) =>
          context.scopes.has(scope),
        ) &&
        (!entry.subjects ||
          (context.subject !== undefined &&
            entry.subjects.includes(context.subject))),
    );
}

function validateEntry(entry: ModelAllowlistEntry): ModelAllowlistEntry {
  if (
    !/^[A-Za-z0-9._-]{1,128}$/.test(entry.model) ||
    entry.kinds.length === 0 ||
    entry.kinds.some((kind) => !validKind(kind)) ||
    new Set(entry.kinds).size !== entry.kinds.length ||
    (entry.requiredScopes ?? []).some(
      (scope) => !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(scope),
    ) ||
    (entry.subjects !== undefined && entry.subjects.length === 0) ||
    (entry.subjects ?? []).some(
      (subject) =>
        subject.length < 1 ||
        subject.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(subject),
    )
  ) {
    throw invalidConfiguration();
  }
  return Object.freeze({
    model: entry.model,
    kinds: Object.freeze(Array.from(entry.kinds)),
    ...(entry.requiredScopes
      ? { requiredScopes: Object.freeze(Array.from(entry.requiredScopes)) }
      : {}),
    ...(entry.subjects
      ? { subjects: Object.freeze(Array.from(entry.subjects)) }
      : {}),
  });
}

function validKind(value: unknown): value is GenerationKind {
  return value === "image" || value === "video" || value === "audio";
}

function invalidConfiguration(): AppError {
  return new AppError("CONFIG_INVALID", {
    status: 500,
    message: "The model allowlist is invalid or ambiguous.",
  });
}
