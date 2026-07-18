// ./lib/b2.ts
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const endpoint = process.env.B2_ENDPOINT || "";
const accessKeyId = process.env.B2_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.B2_SECRET_ACCESS_KEY || "";
const singleBucketName = process.env.B2_BUCKET_NAME || "";

export const b2Client = new S3Client({
  region: process.env.B2_REGION || "us-east-005",
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

function getBucketAndKey(bucketParam: string, keyParam: string) {
  if (singleBucketName) {
    const cleanKey = keyParam.startsWith("/") ? keyParam.substring(1) : keyParam;
    const prefix = `${bucketParam}/`;
    const finalKey = cleanKey.startsWith(prefix) ? cleanKey.substring(prefix.length) : cleanKey;
    return {
      bucket: singleBucketName,
      key: `${bucketParam}/${finalKey}`,
    };
  }
  return {
    bucket: bucketParam,
    key: keyParam,
  };
}

export const b2 = {
  async upload(bucketParam: string, keyParam: string, body: Buffer, contentType?: string): Promise<void> {
    const { bucket, key } = getBucketAndKey(bucketParam, keyParam);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    });
    await b2Client.send(command);
  },

  async download(bucketParam: string, keyParam: string): Promise<Buffer> {
    const { bucket, key } = getBucketAndKey(bucketParam, keyParam);
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const response = await b2Client.send(command);
    if (!response.Body) {
      throw new Error("No body data payload received from B2 storage endpoint.");
    }
    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
  },

  async head(bucketParam: string, keyParam: string): Promise<void> {
    const { bucket, key } = getBucketAndKey(bucketParam, keyParam);
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    await b2Client.send(command);
  },

  async listObjects(bucketParam: string, prefixParam: string): Promise<string[]> {
    const { bucket, key: prefix } = getBucketAndKey(bucketParam, prefixParam);
    let isTruncated = true;
    let token: string | undefined;
    const keys: string[] = [];

    while (isTruncated) {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      });
      const res = await b2Client.send(command);
      if (res.Contents) {
        res.Contents.forEach((c) => {
          if (c.Key) {
            if (singleBucketName) {
              if (c.Key.startsWith(`${bucketParam}/`)) {
                keys.push(c.Key.substring(bucketParam.length + 1));
              } else {
                keys.push(c.Key);
              }
            } else {
              keys.push(c.Key);
            }
          }
        });
      }
      isTruncated = res.IsTruncated ?? false;
      token = res.NextContinuationToken;
    }
    return keys;
  },

  async deleteObjects(bucketParam: string, keysParam: string[]): Promise<void> {
    if (keysParam.length === 0) return;
    
    const uniqueKeys = Array.from(new Set(keysParam.filter((k) => k)));
    const objectsToDelete = uniqueKeys.map((k) => ({ Key: getBucketAndKey(bucketParam, k).key }));

    for (let i = 0; i < objectsToDelete.length; i += 1000) {
      const batch = objectsToDelete.slice(i, i + 1000);
      const command = new DeleteObjectsCommand({
        Bucket: getBucketAndKey(bucketParam, "").bucket,
        Delete: { Objects: batch },
      });
      const response = await b2Client.send(command);
      if (response.Errors?.length) {
        throw new Error(`B2 failed to delete ${response.Errors.length} object(s).`);
      }
    }
  }
};
