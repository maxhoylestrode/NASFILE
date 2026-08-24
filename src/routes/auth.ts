import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { perIpAuthLimiter, perAccountLoginLimiter } from '../middleware/rateLimit';
import { verifyPassword } from '../lib/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';
import { UnauthorizedError } from '../middleware/errors';
import jwt from 'jsonwebtoken';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

authRouter.post(
  '/login',
  perIpAuthLimiter,
  perAccountLoginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const { rows } = await pool.query<{ id: string; email: string; password_hash: string; is_admin: boolean }>(
      'SELECT id, email, password_hash, is_admin FROM users WHERE email = $1',
      [email],
    );
    const user = rows[0];

    // Constant-shape response whether the account exists or the password
    // is wrong — never reveal which one it was.
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const authUser = { id: user.id, email: user.email, isAdmin: user.is_admin };
    const accessToken = signAccessToken(authUser);
    const refreshToken = signRefreshToken(authUser);

    const rootFolder = await pool.query<{ id: string }>(
      'SELECT id FROM folders WHERE owner_id = $1 AND is_root = true',
      [user.id],
    );

    res.status(200).json({
      accessToken,
      refreshToken,
      user: authUser,
      rootFolderId: rootFolder.rows[0]?.id ?? null,
    });
  }),
);

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

authRouter.post(
  '/refresh',
  perIpAuthLimiter,
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Refresh token expired');
      }
      throw new UnauthorizedError('Invalid refresh token');
    }

    const { rows } = await pool.query<{ id: string; email: string; is_admin: boolean }>(
      'SELECT id, email, is_admin FROM users WHERE id = $1',
      [payload.sub],
    );
    const user = rows[0];
    if (!user) {
      // User was deleted after the refresh token was issued.
      throw new UnauthorizedError('Account no longer exists');
    }

    const authUser = { id: user.id, email: user.email, isAdmin: user.is_admin };
    const accessToken = signAccessToken(authUser);

    res.status(200).json({ accessToken });
  }),
);
