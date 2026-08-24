import crypto from 'crypto';

/**
 * Invite tokens are opaque random strings handed to the invitee out of
 * band (e.g. copy-pasted link). We only ever persist a SHA-256 hash of
 * the token — the same principle as password hashing — so a DB leak
 * doesn't hand out usable invites.
 */
export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
