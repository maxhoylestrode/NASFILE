import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Internal address the app server itself uses to talk to MinIO
  // (bucket bootstrap, CreateMultipartUpload, CompleteMultipartUpload,
  // AbortMultipartUpload, ListParts, DeleteObject). This should stay on
  // the private network — it never needs to be internet-reachable.
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1).default('drive-clone'),

  // Public base URL used ONLY when signing presigned upload/download
  // URLs, e.g. https://s3.yourdomain.com. This must be the hostname a
  // browser will actually hit, reachable through Nginx Proxy Manager —
  // NOT the internal MINIO_ENDPOINT above. SigV4 signatures bind to the
  // host they were signed against, so this has to match exactly, and NPM
  // must pass the Host header through unchanged. See README for the NPM
  // proxy host setup.
  MINIO_PUBLIC_URL: z.string().url('MINIO_PUBLIC_URL must be a full URL, e.g. https://s3.yourdomain.com'),

  // Multipart upload tuning. Defaults: 100MB parts, 20GiB max file size
  // (~205 parts at the default part size, comfortably under S3's
  // 10,000-part ceiling).
  UPLOAD_PART_SIZE_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024 * 1024),
  PRESIGN_UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(6 * 60 * 60),
  PRESIGN_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60),
  STALE_UPLOAD_CLEANUP_HOURS: z.coerce.number().int().positive().default(48),

  // Invites
  INVITE_TTL_HOURS: z.coerce.number().int().positive().default(72),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Intentionally not using the app logger here: config loads before the
  // logger (or anything else) is safe to construct.
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
