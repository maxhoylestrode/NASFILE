import crypto from 'crypto';

/**
 * Public share link tokens — same hashing principle as invite tokens
 * (src/lib/inviteToken.ts): only a SHA-256 hash is ever persisted, so a
 * DB leak alone doesn't hand out working public links. The raw token is
 * shown to the owner exactly once, when the link is created.
 */
export function generateShareToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
