import { Client as MinioClient } from 'minio';
import { config } from './config';
import { logger } from './logger';

export const minioClient = new MinioClient({
  endPoint: config.MINIO_ENDPOINT,
  port: config.MINIO_PORT,
  useSSL: config.MINIO_USE_SSL,
  accessKey: config.MINIO_ACCESS_KEY,
  secretKey: config.MINIO_SECRET_KEY,
});

/**
 * Ensures the configured bucket exists. Called once at startup. Object
 * upload/download (Session 3) will assume this bucket is already present.
 */
export async function bootstrapBucket(): Promise<void> {
  const bucket = config.MINIO_BUCKET;
  const exists = await minioClient.bucketExists(bucket).catch((err) => {
    // bucketExists throws (rather than returning false) on some backends
    // when the bucket is genuinely missing vs. a real connectivity error.
    // Treat NoSuchBucket-shaped errors as "does not exist" and rethrow
    // anything else.
    if (err?.code === 'NoSuchBucket' || err?.code === 'NotFound') return false;
    throw err;
  });

  if (exists) {
    logger.info({ bucket }, 'MinIO bucket already present');
    return;
  }

  await minioClient.makeBucket(bucket);
  logger.info({ bucket }, 'MinIO bucket created');
}
