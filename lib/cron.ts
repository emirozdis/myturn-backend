import cron from "node-cron";
import { startArchiverWorker } from "@/lib/archiver";
import { cronJobs } from "@/lib/cron-jobs";
import { runBackgroundJob } from "@/lib/observability/background-job";
import { logInfo } from "@/lib/observability/logger";

const cronState = globalThis as typeof globalThis & {
  __cron_initialized?: boolean;
};

export function startCronJobs() {
  if (cronState.__cron_initialized) return;
  cronState.__cron_initialized = true;

  logInfo("cron.initialized", {}, "Internal background jobs initialized");
  startArchiverWorker();

  for (const job of cronJobs) {
    cron.schedule(job.schedule, () => void runBackgroundJob(job.name, job.run));
  }
}
