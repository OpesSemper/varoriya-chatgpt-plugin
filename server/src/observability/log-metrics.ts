import type { StructuredLogger } from "./logger.js";
import type { MetricLabels, MetricsSink } from "./metrics.js";

/** Emits low-cardinality metric samples as structured events for collection. */
export function createLogMetricsSink(logger: StructuredLogger): MetricsSink {
  const emit = (
    kind: "counter" | "histogram" | "gauge",
    name: string,
    value: number,
    labels: MetricLabels,
  ): void => {
    if (!/^[a-z][a-z0-9_]{1,127}$/.test(name)) {
      throw new TypeError("Metric name is invalid.");
    }
    if (!Number.isFinite(value)) throw new TypeError("Metric value is invalid.");
    const safeLabels = Object.fromEntries(
      Object.entries(labels).map(([key, label]) => {
        if (
          !/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
          !/^[A-Za-z0-9_.:-]{1,64}$/.test(label)
        ) {
          throw new TypeError("Metric label is invalid.");
        }
        return [`label_${key}`, label];
      }),
    );
    logger.log("info", "metric.emitted", {
      metric_kind: kind,
      metric_name: name,
      metric_value: value,
      ...safeLabels,
    });
  };
  return Object.freeze({
    increment(name: string, labels: MetricLabels, value = 1): void {
      emit("counter", name, value, labels);
    },
    observe(name: string, value: number, labels: MetricLabels): void {
      emit("histogram", name, value, labels);
    },
    gauge(name: string, value: number, labels: MetricLabels): void {
      emit("gauge", name, value, labels);
    },
  });
}
