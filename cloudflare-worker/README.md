# MyTurn Media Worker

Cloudflare Worker for authenticated media delivery from the MyTurn R2 bucket and Backblaze B2 archive. It validates media tokens and serves the requested objects with the configured origin policy.

This worker is versioned inside [myturn-backend](https://github.com/emirozdis/myturn-backend). The separate [cron worker](https://github.com/emirozdis/myturn-cron-worker) triggers scheduled backend jobs.

## Setup and checks

From this folder:

```sh
npm ci
npm test
npm run check
```

`check` performs a Wrangler deployment dry run. Configure the target Cloudflare account before deployment. The worker expects an R2 binding named `MY_BUCKET`; configure `ALLOWED_ORIGIN` and the archive settings `B2_ENDPOINT`, `B2_BUCKET_NAME`, and optionally `B2_REGION` for the target environment.

Store `MEDIA_SECRET_KEY`, `B2_ACCESS_KEY_ID`, and `B2_SECRET_ACCESS_KEY` using Wrangler secrets. The B2 key needs only read/list access to the archive bucket. Keep credentials out of `wrangler.toml`.

After configuring the bindings and secrets, `npm run deploy` deploys this worker.
