/** Vendor-neutral metric names and interfaces. Do not use user identifiers as labels. */
export const METRIC_NAMES = Object.freeze({
  requestTotal: "varoriya_gateway_requests_total",
  requestDurationMs: "varoriya_gateway_request_duration_ms",
  authTotal: "varoriya_gateway_auth_total",
  toolTotal: "varoriya_gateway_tool_total",
  providerTotal: "varoriya_gateway_provider_total",
  providerDurationMs: "varoriya_gateway_provider_duration_ms",
  costDecisionTotal: "varoriya_gateway_cost_decisions_total",
  idempotencyTotal: "varoriya_gateway_idempotency_total",
  readinessTotal: "varoriya_gateway_readiness_total",
} as const);

export interface MetricLabels {
  readonly [name: string]: string;
}

export interface MetricsSink {
  increment(name: string, labels: MetricLabels, value?: number): void;
  observe(name: string, value: number, labels: MetricLabels): void;
  gauge(name: string, value: number, labels: MetricLabels): void;
}

export type Outcome = "success" | "failure" | "rejected";
export type AuthOutcome = "success" | "required" | "invalid" | "forbidden";
export type IdempotencyOutcome = "created" | "replayed" | "conflict" | "failed";

export interface OperationsMetrics {
  request(input: { route: "mcp" | "health"; status: number; durationMs: number }): void;
  auth(input: { mode: "oauth" | "dev-api-key"; outcome: AuthOutcome }): void;
  tool(input: { tool: string; outcome: Outcome }): void;
  provider(input: {
    operation: "quote" | "balance" | "upload" | "generate" | "get_job";
    outcome: Outcome;
    durationMs: number;
  }): void;
  cost(input: { decision: "allowed" | "limit_exceeded" | "insufficient_balance" }): void;
  idempotency(input: { operation: "generate"; outcome: IdempotencyOutcome }): void;
  readiness(input: { dependency: string; ready: boolean }): void;
}

/**
 * Emits a deliberately low-cardinality metric set. Never add request IDs,
 * user IDs, quote IDs, prompt text, file names, URLs, or provider IDs here.
 */
export function createOperationsMetrics(sink: MetricsSink): OperationsMetrics {
  return Object.freeze({
    request({ route, status, durationMs }: { route: "mcp" | "health"; status: number; durationMs: number }): void {
      sink.increment(METRIC_NAMES.requestTotal, { route, status: statusClass(status) });
      sink.observe(METRIC_NAMES.requestDurationMs, boundedDuration(durationMs), { route });
    },
    auth({ mode, outcome }: { mode: "oauth" | "dev-api-key"; outcome: AuthOutcome }): void {
      sink.increment(METRIC_NAMES.authTotal, { mode, outcome });
    },
    tool({ tool, outcome }: { tool: string; outcome: Outcome }): void {
      sink.increment(METRIC_NAMES.toolTotal, { tool: metricTool(tool), outcome });
    },
    provider({ operation, outcome, durationMs }: {
      operation: "quote" | "balance" | "upload" | "generate" | "get_job";
      outcome: Outcome;
      durationMs: number;
    }): void {
      sink.increment(METRIC_NAMES.providerTotal, { operation, outcome });
      sink.observe(METRIC_NAMES.providerDurationMs, boundedDuration(durationMs), { operation });
    },
    cost({ decision }: { decision: "allowed" | "limit_exceeded" | "insufficient_balance" }): void {
      sink.increment(METRIC_NAMES.costDecisionTotal, { decision });
    },
    idempotency({ operation, outcome }: { operation: "generate"; outcome: IdempotencyOutcome }): void {
      sink.increment(METRIC_NAMES.idempotencyTotal, { operation, outcome });
    },
    readiness({ dependency, ready }: { dependency: string; ready: boolean }): void {
      sink.gauge(METRIC_NAMES.readinessTotal, ready ? 1 : 0, {
        dependency: metricDependency(dependency),
      });
    },
  });
}

function statusClass(status: number): string {
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? `${Math.floor(status / 100)}xx`
    : "unknown";
}

function boundedDuration(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 3_600_000) : 0;
}

function metricTool(value: string): string {
  return /^[a-z][a-z0-9_]{1,63}$/.test(value) ? value : "unknown";
}

function metricDependency(value: string): string {
  return /^[a-z][a-z0-9_-]{1,63}$/.test(value) ? value : "unknown";
}
