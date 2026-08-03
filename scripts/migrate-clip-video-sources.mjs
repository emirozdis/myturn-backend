import fs from "node:fs";
import process from "node:process";
import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import pg from "pg";

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const prepareOnly = args.has("--prepare-only");
const envArg = process.argv.slice(2).find((arg) => arg.startsWith("--env="));
const envFile = envArg ? envArg.slice("--env=".length) : ".env";

if (!fs.existsSync(envFile)) throw new Error(`Environment file not found: ${envFile}`);
dotenv.config({ path: envFile, override: true });

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required.");

const terminalStatuses = new Set(["COMPLETED", "FAILED_PERMANENTLY"]);
const logicalKey = (key) => key.startsWith("vlogs/") ? key.slice("vlogs/".length) : key;

function storageTarget(kind, key) {
  if (kind === "r2") {
    const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME || "vlogs";
    return {
      bucket,
      key: process.env.CLOUDFLARE_R2_BUCKET_NAME ? `vlogs/${logicalKey(key)}` : logicalKey(key),
    };
  }
  const bucket = process.env.B2_BUCKET_NAME || "vlogs";
  return {
    bucket,
    key: process.env.B2_BUCKET_NAME ? `vlogs/${logicalKey(key)}` : logicalKey(key),
  };
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "",
  },
});

const b2 = new S3Client({
  region: process.env.B2_REGION || "us-east-005",
  endpoint: process.env.B2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.B2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.B2_SECRET_ACCESS_KEY || "",
  },
});

async function deleteExact(kind, key) {
  const target = storageTarget(kind, key);
  const client = kind === "r2" ? r2 : b2;
  const response = await client.send(new DeleteObjectsCommand({
    Bucket: target.bucket,
    Delete: { Objects: [{ Key: target.key }], Quiet: true },
  }));
  if (response.Errors?.length) {
    throw new Error(`${kind.toUpperCase()} failed to delete ${target.key}: ${response.Errors[0].Code || "unknown error"}`);
  }
}

function storesForTier(storageTier) {
  if (storageTier === "COLD" || storageTier === "PRUNED") return ["b2"];
  if (storageTier === "MIGRATING" || storageTier === "FAILED_MIGRATION") return ["r2", "b2"];
  return ["r2"];
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const target = new URL(databaseUrl);
  const columnResult = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'clips'
      AND column_name IN ('videoUrl', 'imageUrl')
  `);
  const columns = new Set(columnResult.rows.map((row) => row.column_name));
  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", host: target.hostname, database: target.pathname.slice(1) }));

  if (!columns.has("videoUrl")) {
    console.log("clips.videoUrl is already absent; nothing to clean.");
    process.exitCode = 0;
  } else {
    if (execute) {
      await client.query(`ALTER TABLE "clips" ALTER COLUMN "videoUrl" DROP NOT NULL`);
      await client.query(`ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT`);
      await client.query(`
        UPDATE "clips"
        SET "imageUrl" = "videoUrl"
        WHERE "mediaType" = 'photo' AND "imageUrl" IS NULL
      `);
    }

    if (prepareOnly) {
      if (!execute) throw new Error("--prepare-only requires --execute.");
      console.log("Expanded clips with imageUrl and backfilled photo paths; source pointers were not changed.");
      process.exitCode = 0;
    } else {

    const result = await client.query(`
      SELECT c.id, c."videoUrl", c."mediaType", c."storageTier", c."transcodeStatus", au.key AS "uploadKey"
      FROM clips c
      LEFT JOIN active_uploads au ON au."clipId" = c.id
      WHERE c."videoUrl" IS NOT NULL
      ORDER BY c."recordedAt", c.id
    `);

    const summary = { photos: 0, terminalVideos: 0, terminalizedLegacyFailures: 0, retryableVideos: 0, skipped: 0, deletedR2: 0, deletedB2: 0, nulled: 0 };
    for (const row of result.rows) {
      if (row.mediaType === "photo") {
        summary.photos++;
        if (execute) {
          await client.query(`UPDATE clips SET "videoUrl" = NULL WHERE id = $1`, [row.id]);
          summary.nulled++;
        }
        continue;
      }

      if (!terminalStatuses.has(row.transcodeStatus)) {
        if (row.transcodeStatus === "FAILED" && !row.uploadKey) {
          summary.terminalizedLegacyFailures++;
          if (execute) {
            for (const store of storesForTier(row.storageTier)) {
              await deleteExact(store, row.videoUrl);
              if (store === "r2") summary.deletedR2++;
              else summary.deletedB2++;
            }
            await client.query(`
              UPDATE clips
              SET "videoUrl" = NULL, "transcodeStatus" = 'FAILED_PERMANENTLY'
              WHERE id = $1
            `, [row.id]);
            summary.nulled++;
          }
          continue;
        }
        if (!row.uploadKey || logicalKey(row.uploadKey) !== logicalKey(row.videoUrl)) {
          summary.skipped++;
          console.warn(`Skipping retryable clip ${row.id}: ActiveUpload.key does not preserve its source.`);
          continue;
        }
        summary.retryableVideos++;
        if (execute) {
          await client.query(`UPDATE clips SET "videoUrl" = NULL WHERE id = $1`, [row.id]);
          summary.nulled++;
        }
        continue;
      }

      summary.terminalVideos++;
      if (execute) {
        for (const store of storesForTier(row.storageTier)) {
          await deleteExact(store, row.videoUrl);
          if (store === "r2") summary.deletedR2++;
          else summary.deletedB2++;
        }
        await client.query(`UPDATE clips SET "videoUrl" = NULL WHERE id = $1`, [row.id]);
        summary.nulled++;
      }
    }

    const remaining = execute
      ? Number((await client.query(`SELECT COUNT(*) AS count FROM clips WHERE "videoUrl" IS NOT NULL`)).rows[0].count)
      : result.rowCount;
    console.log(JSON.stringify({ ...summary, remainingVideoUrlRows: remaining }, null, 2));
    if (execute && remaining > 0) {
      throw new Error(`${remaining} videoUrl row(s) remain; refusing to consider cleanup complete.`);
    }
    }
  }
} finally {
  await client.end();
}
