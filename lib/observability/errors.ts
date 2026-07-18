export type AppErrorOptions = {
  code: string;
  status: number;
  safeMessage: string;
  cause?: unknown;
  expose?: boolean;
  details?: Record<string, unknown>;
  level?: "info" | "warn" | "error";
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly safeMessage: string;
  readonly expose: boolean;
  readonly details?: Record<string, unknown>;
  readonly level: "info" | "warn" | "error";

  constructor(options: AppErrorOptions) {
    super(options.safeMessage, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.status = options.status;
    this.safeMessage = options.safeMessage;
    this.expose = options.expose ?? options.status < 500;
    this.details = options.details;
    this.level = options.level ?? (options.status >= 500 ? "error" : "info");
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

