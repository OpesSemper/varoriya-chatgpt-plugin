import { AppError } from "../../errors.js";

export function storageUnavailable(cause?: unknown): AppError {
  return new AppError("PROVIDER_UNAVAILABLE", {
    status: 503,
    message: "The durable security store is temporarily unavailable.",
    recoverable: true,
    cause,
  });
}

export async function failClosed<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw storageUnavailable(error);
  }
}

export function onlyRow<Row extends object>(
  rows: readonly Row[],
  message = "The durable security store returned an invalid result.",
): Row {
  const row = rows[0];
  if (!row || rows.length !== 1) {
    throw new AppError("PROVIDER_UNAVAILABLE", {
      status: 503,
      message,
      recoverable: true,
    });
  }
  return row;
}

export function parseSafeInteger(
  value: unknown,
  label: string,
  minimum = 0,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw storageUnavailable(new TypeError(`Invalid ${label}.`));
  }
  return parsed;
}

export function validateEpochMilliseconds(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch millisecond value.`);
  }
}

export function validatePositiveDuration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

export function validateSubject(subject: string): void {
  if (
    typeof subject !== "string" ||
    subject.length < 1 ||
    subject.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(subject)
  ) {
    throw new AppError("INVALID_TOKEN", {
      status: 401,
      message: "The authenticated identity is invalid.",
    });
  }
}

export function validateOpaqueId(value: string, label: string, maximum = 256): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new AppError("INVALID_INPUT", {
      status: 400,
      message: `The ${label} is invalid.`,
    });
  }
}
