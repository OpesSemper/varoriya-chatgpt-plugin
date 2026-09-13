import { createConnection } from "node:net";

import type { MalwareScanner } from "../policy/upload.js";

export interface ClamAvScannerOptions {
  readonly host: string;
  readonly port?: number;
  readonly timeoutMs?: number;
  readonly chunkBytes?: number;
  readonly maxResponseBytes?: number;
}

/** ClamAV INSTREAM adapter. Transport failures remain fail-closed upstream. */
export class ClamAvScanner implements MalwareScanner {
  readonly #host: string;
  readonly #port: number;
  readonly #timeoutMs: number;
  readonly #chunkBytes: number;
  readonly #maxResponseBytes: number;

  public constructor(options: ClamAvScannerOptions) {
    if (!safeHost(options.host)) throw new TypeError("ClamAV host is invalid.");
    this.#host = options.host;
    this.#port = boundedInteger(options.port, 3310, 1, 65_535);
    this.#timeoutMs = boundedInteger(options.timeoutMs, 10_000, 100, 120_000);
    this.#chunkBytes = boundedInteger(
      options.chunkBytes,
      64 * 1024,
      1_024,
      1024 * 1024,
    );
    this.#maxResponseBytes = boundedInteger(
      options.maxResponseBytes,
      8_192,
      128,
      65_536,
    );
  }

  public async scan(bytes: Uint8Array): Promise<{
    readonly verdict: "clean" | "malicious" | "unknown";
  }> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
      return Object.freeze({ verdict: "unknown" });
    }
    const response = await this.exchange((write) => {
      write(Buffer.from("zINSTREAM\0", "ascii"));
      for (let offset = 0; offset < bytes.byteLength; offset += this.#chunkBytes) {
        const chunk = Buffer.from(
          bytes.buffer,
          bytes.byteOffset + offset,
          Math.min(this.#chunkBytes, bytes.byteLength - offset),
        );
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.byteLength, 0);
        write(length);
        write(chunk);
      }
      write(Buffer.alloc(4));
    });
    if (/\bOK\u0000?$/.test(response)) {
      return Object.freeze({ verdict: "clean" });
    }
    if (/\bFOUND\u0000?$/.test(response)) {
      return Object.freeze({ verdict: "malicious" });
    }
    return Object.freeze({ verdict: "unknown" });
  }

  public async check(): Promise<void> {
    const response = await this.exchange((write) => {
      write(Buffer.from("zPING\0", "ascii"));
    });
    if (!/^PONG\u0000?$/.test(response)) {
      throw new Error("ClamAV readiness failed.");
    }
  }

  private exchange(send: (write: (chunk: Uint8Array) => void) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.#host, port: this.#port });
      const chunks: Buffer[] = [];
      let responseBytes = 0;
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) {
          reject(error);
        } else {
          resolve(Buffer.concat(chunks).toString("utf8").trim());
        }
      };
      const timer = setTimeout(
        () => finish(new Error("ClamAV request timed out.")),
        this.#timeoutMs,
      );
      socket.once("error", (error) => finish(error));
      socket.on("data", (chunk: Buffer) => {
        responseBytes += chunk.byteLength;
        if (responseBytes > this.#maxResponseBytes) {
          finish(new Error("ClamAV response exceeded the configured limit."));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      socket.once("end", () => finish());
      socket.once("connect", () => {
        try {
          send((chunk) => socket.write(chunk));
          socket.end();
        } catch (error) {
          finish(error instanceof Error ? error : new Error("ClamAV write failed."));
        }
      });
    });
  }
}

function safeHost(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 253 &&
    /^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(value) &&
    !value.includes("..")
  );
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new TypeError("ClamAV configuration is invalid.");
  }
  return resolved;
}
