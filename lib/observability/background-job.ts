import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { logInfo, reportError } from "./logger";
import { runWithRequestContext } from "./request-context";

export async function runBackgroundJob<T>(name: string, work: () => Promise<T>): Promise<T | undefined> {
  const jobRunId = randomUUID();
  const startedAt = performance.now();

  return runWithRequestContext(
    {
      requestId: jobRunId,
      jobRunId,
      method: "JOB",
      route: `job:${name}`,
    },
    async () => {
      logInfo("job.started", { job: name }, "Background job started");
      try {
        const result = await work();
        logInfo(
          "job.completed",
          { job: name, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 },
          "Background job completed",
        );
        return result;
      } catch (error: unknown) {
        reportError(
          "job.failed",
          error,
          { job: name, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 },
          "Background job failed",
        );
        return undefined;
      }
    },
  );
}

