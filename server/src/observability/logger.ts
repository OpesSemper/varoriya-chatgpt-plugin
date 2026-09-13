import { redactLogValue } from "../policy/redaction.js";

import type { RequestCorrelation } from "./request-correlation.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogSink {
  write(line: string): void;
}

export interface StructuredLogger {
  log(
    level: LogLevel,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void;
  withCorrelation(correlation: RequestCorrelation): StructuredLogger;
}

export interface JsonLoggerOptions {
  readonly service: string;
  readonly environment: string;
  readonly sink?: LogSink;
  readonly now?: () => Date;
  readonly fixedFields?: Readonly<Record<string, unknown>>;
}

type LogRecord = Readonly<Record<string, unknown>>;

/**
 * Writes one redacted JSON object per line. The logger intentionally has no
 * transport dependency so the deployment platform can collect stdout/stderr.
 */
export function createJsonLogger(options: JsonLoggerOptions): StructuredLogger {
  if (!safeIdentifier(options.service) || !safeIdentifier(options.environment)) {
    throw new Error("Logger service and environment must be safe identifiers.");
  }
  const sink = options.sink ?? process.stdout;
  const now = options.now ?? (() => new Date());
  const base = Object.freeze({
    ...(options.fixedFields ? { ...options.fixedFields } : {}),
    service: options.service,
    environment: options.environment,
  });

  const write = (record: LogRecord): void => {
    // Redaction is mandatory at this final boundary, even for fixed fields.
    sink.write(`${JSON.stringify(redactLogValue(record))}\n`);
  };
  const create = (correlation?: RequestCorrelation): StructuredLogger =>
    Object.freeze({
      log(
        level: LogLevel,
        event: string,
        fields: Readonly<Record<string, unknown>> = {},
      ): void {
        if (!safeEvent(event)) {
          throw new Error("Log event must be a safe dotted identifier.");
        }
        write({
          ...fields,
          ...base,
          timestamp: now().toISOString(),
          level,
          event,
          ...(correlation ? { request_id: correlation.requestId } : {}),
        });
      },
      withCorrelation(next: RequestCorrelation): StructuredLogger {
        return create(next);
      },
    });
  return create();
}

function safeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

function safeEvent(value: string): boolean {
  return /^[a-z][a-z0-9_.-]{1,127}$/.test(value);
}
