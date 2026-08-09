# External cron tick scheduler

MyTurn uses one external scheduler request for all application maintenance:

```cron
* * * * *
```

```bash
curl --fail --silent --show-error \
  --max-time 290 \
  --request POST \
  --header "Authorization: Bearer <CRON_SECRET>" \
  https://<production-domain>/api/cron/tick
```

`CRON_SECRET` must contain at least 32 characters and must be stored only in
the Vercel production environment and the external scheduler's secret store.
The endpoint is deliberately absent from `vercel.json`; Vercel Cron is not used.

## Durable schedules

The endpoint evaluates these schedules in UTC. Group business-time jobs still
evaluate every group's configured timezone internally.

| Job | Schedule |
| --- | --- |
| Transcode mission recovery | `* * * * *` |
| Group day transition | `*/15 * * * *` |
| Archive worker iteration | `*/15 * * * *` |
| Stranded upload cleanup | `*/30 * * * *` |
| Vlogger reminders and automatic pass | `*/30 * * * *` |
| Frozen group evaluation | `0 * * * *` |
| Daily assignment roll | `0 * * * *` |
| Incident retention cleanup | `17 3 * * *` |
| Cron run-history cleanup | `27 3 * * *` |

The PostgreSQL migration `20260809030000_add_durable_cron_scheduler` must be
applied before deploying the endpoint. It creates `cron_job_states`, containing
the durable schedule and lease for each job, and `cron_job_runs`, containing
the immutable execution history.

## Failure and concurrency behavior

- A tick atomically claims every due job before executing work.
- A second or duplicate tick cannot claim a job with a live lease.
- A successful job advances directly to its next calendar occurrence.
- A failed job retries after 1, 2, 5, 10, and then at most 15 minutes.
- A process interrupted while holding a lease is reclaimed after ten minutes;
  its unfinished run is marked `ABANDONED` with structured context.
- Downtime produces one catch-up run per job. It does not replay every missed
  interval in a burst.
- Job run history is retained for 30 days.
- A tick returns HTTP 500 when a claimed job fails, allowing the external
  scheduler and monitoring system to alert. A duplicate tick with nothing due
  returns HTTP 200.

Logs use the events `cron.tick.started`, `cron.tick.claimed`,
`cron.job.started`, `cron.job.completed`, `cron.job.failed`, and
`cron.tick.completed`. Every job event includes the tick ID, durable run ID,
scheduled time, attempt, duration, and job-specific result or sanitized error.

## Removed routes and timers

These routes no longer exist and must not remain in external scheduler config:

- `/api/cron`
- `/api/cron/transcoder`
- `/api/cron/incidents`

Process-local `node-cron` startup and the `node-cron` dependency were removed.
The Vast supervisor remains an independent always-running service and does not
use this endpoint.

The PostgreSQL backup is also independent. Keep the Coolify/server scheduled
task `/usr/local/bin/backup-supabase` running once daily; an HTTP tick must not
own infrastructure backup execution.
