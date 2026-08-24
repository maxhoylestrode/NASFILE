import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { config } from '../config';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { inviteAcceptLimiter, perIpAuthLimiter } from '../middleware/rateLimit';
import { generateInviteToken, hashInviteToken } from '../lib/inviteToken';
import { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH } from '../lib/password';
import { signAccessToken, signRefreshToken } from '../lib/jwt';
import { BadRequestError, ConflictError, UnauthorizedError } from '../middleware/errors';

export const invitesRouter = Router();

const createInviteSchema = z.object({
  email: z.string().email().toLowerCase().trim().optional(),
});

invitesRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  validate(createInviteSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body as z.infer<typeof createInviteSchema>;

    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);
    const expiresAt = new Date(Date.now() + config.INVITE_TTL_HOURS * 60 * 60 * 1000);

    const { rows } = await pool.query<{ id: string; expires_at: Date }>(
      `INSERT INTO invites (token_hash, email, created_by, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, expires_at`,
      [tokenHash, email ?? null, req.user!.id, expiresAt],
    );

    // The raw token is returned exactly once, here. It is not
    // recoverable afterward — only its hash is stored.
    res.status(201).json({
      id: rows[0]!.id,
      token,
      email: email ?? null,
      expiresAt: rows[0]!.expires_at,
    });
  }),
);

const acceptInviteSchema = z.object({
  token: z.string().min(1, 'token is required'),
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
});

invitesRouter.post(
  '/accept',
  perIpAuthLimiter,
  inviteAcceptLimiter,
  validate(acceptInviteSchema),
  asyncHandler(async (req, res) => {
    const { token, email, password } = req.body as z.infer<typeof acceptInviteSchema>;

    if (!isPasswordStrongEnough(password)) {
      throw new BadRequestError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const tokenHash = hashInviteToken(token);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Atomically claim the invite: only succeeds if it exists, is
      // unused, and unexpired. Row-level locking during the UPDATE makes
      // this safe against two concurrent accept requests racing on the
      // same token.
      const claimed = await client.query<{ id: string; email: string | null }>(
        `UPDATE invites
         SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING id, email`,
        [tokenHash],
      );

      if (claimed.rowCount === 0) {
        throw new UnauthorizedError('Invite is invalid, already used, or expired');
      }

      const invite = claimed.rows[0]!;

      if (invite.email && invite.email !== email) {
        throw new UnauthorizedError('Invite is invalid, already used, or expired');
      }

      const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      if ((existingUser.rowCount ?? 0) > 0) {
        throw new ConflictError('An account with this email already exists');
      }

      const passwordHash = await hashPassword(password);

      const userInsert = await client.query<{ id: string; email: string; is_admin: boolean }>(
        `INSERT INTO users (email, password_hash, is_admin)
         VALUES ($1, $2, false)
         RETURNING id, email, is_admin`,
        [email, passwordHash],
      );
      const user = userInsert.rows[0]!;

      // Every account gets exactly one root folder, created here.
      const rootFolder = await client.query<{ id: string }>(
        `INSERT INTO folders (owner_id, parent_id, name, is_root)
         VALUES ($1, NULL, 'My Drive', true)
         RETURNING id`,
        [user.id],
      );

      await client.query('UPDATE invites SET used_by = $1 WHERE id = $2', [user.id, invite.id]);

      await client.query('COMMIT');

      const authUser = { id: user.id, email: user.email, isAdmin: user.is_admin };
      const accessToken = signAccessToken(authUser);
      const refreshToken = signRefreshToken(authUser);

      res.status(201).json({ accessToken, refreshToken, user: authUser, rootFolderId: rootFolder.rows[0]!.id });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }),
);
