export type HealthState = "pass" | "fail";

export interface DependencyHealth {
  readonly name: string;
  readonly required: boolean;
  check(): Promise<void>;
}

export interface DependencyHealthResult {
  readonly name: string;
  readonly required: boolean;
  readonly state: HealthState;
  readonly durationMs: number;
}

export interface ReadinessResult {
  readonly status: "ready" | "not_ready";
  readonly checkedAt: string;
  readonly dependencies: readonly DependencyHealthResult[];
}

export interface HealthRegistry {
  liveness(): Readonly<{ status: "alive" }>;
  readiness(): Promise<ReadinessResult>;
}

export interface HealthRegistryOptions {
  readonly dependencies: readonly DependencyHealth[];
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly nowIso?: () => string;
}

/**
 * Required dependency failures make the process unready; optional dependency
 * failures stay observable but do not block traffic. Check implementations
 * must not return credentials, raw provider errors, or user data.
 */
export function createHealthRegistry(options: HealthRegistryOptions): HealthRegistry {
  const names = new Set<string>();
  for (const dependency of options.dependencies) {
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(dependency.name) || names.has(dependency.name)) {
      throw new Error("Dependency health names must be unique safe identifiers.");
    }
    names.add(dependency.name);
  }
  const timeoutMs = options.timeoutMs ?? 1_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("Health timeout must be between 1 and 30000 milliseconds.");
  }
  const now = options.now ?? Date.now;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const check = async (dependency: DependencyHealth): Promise<DependencyHealthResult> => {
    const startedAt = now();
    try {
      await withTimeout(dependency.check(), timeoutMs);
      return Object.freeze({
        name: dependency.name,
        required: dependency.required,
        state: "pass",
        durationMs: elapsed(startedAt, now()),
      });
    } catch {
      return Object.freeze({
        name: dependency.name,
        required: dependency.required,
        state: "fail",
        durationMs: elapsed(startedAt, now()),
      });
    }
  };
  return Object.freeze({
    liveness: () => Object.freeze({ status: "alive" }),
    async readiness() {
      const dependencies = Object.freeze(await Promise.all(options.dependencies.map(check)));
      const requiredFailed = dependencies.some(
        (dependency) => dependency.required && dependency.state === "fail",
      );
      return Object.freeze({
        status: requiredFailed ? "not_ready" : "ready",
        checkedAt: nowIso(),
        dependencies,
      });
    },
  });
}

function withTimeout(check: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("health check timeout")), timeoutMs);
    void check.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function elapsed(startedAt: number, endedAt: number): number {
  return Number.isFinite(endedAt - startedAt) && endedAt >= startedAt
    ? endedAt - startedAt
    : 0;
}
