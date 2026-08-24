import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketCorsCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  UploadPartCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config';
import { logger } from './logger';

const credentials = { accessKeyId: config.MINIO_ACCESS_KEY, secretAccessKey: config.MINIO_SECRET_KEY };

// Server-to-MinIO operations (bucket bootstrap, multipart admin calls,
// object delete). Stays on the private network — never needs to be
// internet-reachable.
export const s3Internal = new S3Client({
  endpoint: `${config.MINIO_USE_SSL ? 'https' : 'http'}://${config.MINIO_ENDPOINT}:${config.MINIO_PORT}`,
  region: 'us-east-1', // MinIO ignores region but the SDK requires one
  credentials,
  forcePathStyle: true,
});

// Used ONLY to sign presigned URLs. SigV4 signatures bind to the host
// they were signed against, so this must be the public hostname a
// browser will actually hit (through Nginx Proxy Manager), not the
// internal endpoint above.
const s3Public = new S3Client({
  endpoint: config.MINIO_PUBLIC_URL,
  region: 'us-east-1',
  credentials,
  forcePathStyle: true,
});

const BUCKET = config.MINIO_BUCKET;

/**
 * Ensures the configured bucket exists and has CORS configured for
 * browser-direct multipart upload/download. Called once at startup.
 */
export async function bootstrapBucket(): Promise<void> {
  const exists = await s3Internal.send(new HeadBucketCommand({ Bucket: BUCKET })).then(
    () => true,
    () => false,
  );

  if (!exists) {
    await s3Internal.send(new CreateBucketCommand({ Bucket: BUCKET }));
    logger.info({ bucket: BUCKET }, 'MinIO bucket created');
  } else {
    logger.info({ bucket: BUCKET }, 'MinIO bucket already present');
  }

  // Best-effort: bucket-level CORS is needed for a browser to PUT parts
  // directly to presigned URLs and read the ETag response header. Not
  // every S3-compatible backend/version supports PutBucketCors, so this
  // is a warning, not a startup failure — if it's unsupported, CORS needs
  // to be set once out-of-band (see README).
  try {
    await s3Internal.send(
      new PutBucketCorsCommand({
        Bucket: BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedMethods: ['GET', 'PUT'],
              AllowedOrigins: ['*'], // tighten to your actual frontend origin once it exists
              AllowedHeaders: ['*'],
              ExposeHeaders: ['ETag'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    logger.info({ bucket: BUCKET }, 'MinIO bucket CORS configured');
  } catch (err) {
    logger.warn(
      { bucket: BUCKET, err: err instanceof Error ? err.message : err },
      'Could not set bucket CORS automatically — set it manually if browser uploads fail with a CORS error (see README)',
    );
  }
}

export function buildObjectKey(ownerId: string, fileId: string): string {
  return `${ownerId}/${fileId}`;
}

export async function createMultipartUpload(key: string): Promise<string> {
  const result = await s3Internal.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key }));
  if (!result.UploadId) throw new Error('MinIO did not return an UploadId');
  return result.UploadId;
}

export async function presignUploadPart(key: string, uploadId: string, partNumber: number): Promise<string> {
  return getSignedUrl(
    s3Public,
    new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: config.PRESIGN_UPLOAD_TTL_SECONDS },
  );
}

export interface CompletedPart {
  partNumber: number;
  eTag: string;
}

export async function completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
  await s3Internal.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.eTag })) },
    }),
  );
}

/**
 * Asks MinIO which parts have actually landed for an in-progress upload.
 * This is the resume path: a client that lost its local progress (crash,
 * browser refresh, days-later reconnect) doesn't need to have remembered
 * anything — MinIO is the source of truth.
 *
 * NOTE: not exercisable against the s3rver test double used in this
 * repo's automated tests (it doesn't implement ListParts). Verified via
 * scripts/smoke-test-multipart.sh against a real MinIO instance instead.
 */
export async function listUploadedParts(key: string, uploadId: string): Promise<CompletedPart[]> {
  const result = await s3Internal.send(new ListPartsCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
  return (result.Parts ?? [])
    .filter((p): p is { PartNumber: number; ETag: string } => p.PartNumber !== undefined && p.ETag !== undefined)
    .map((p) => ({ partNumber: p.PartNumber, eTag: p.ETag }));
}

/**
 * NOTE: not exercisable against the s3rver test double (it doesn't
 * implement AbortMultipartUpload — returns 405). Verified via
 * scripts/smoke-test-multipart.sh against a real MinIO instance instead.
 */
export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  await s3Internal.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
}

export async function deleteObject(key: string): Promise<void> {
  await s3Internal.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function presignDownload(
  key: string,
  downloadName: string,
  opts: { disposition?: 'attachment' | 'inline' } = {},
): Promise<string> {
  const disposition = opts.disposition ?? 'attachment';
  return getSignedUrl(
    s3Public,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      // 'inline' is used for public share links meant to be embedded
      // (an <img>/<iframe> pointed straight at the link) — the browser
      // renders the content instead of prompting to save it. Normal
      // authenticated downloads keep the existing 'attachment' default.
      ResponseContentDisposition: `${disposition}; filename="${downloadName.replace(/"/g, "'")}"`,
    }),
    { expiresIn: config.PRESIGN_DOWNLOAD_TTL_SECONDS },
  );
}
