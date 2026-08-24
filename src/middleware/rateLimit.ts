import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Per-IP limiter: blunt protection against a single source hammering
 * auth endpoints regardless of which account(s) it targets.
 */
export const perIpAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests from this IP, try again later' } },
});

/**
 * Per-account limiter: keyed on the email in the request body (falling
 * back to IP if no email is present) so an attacker can't get around the
 * per-IP limit by spraying one account's password from many IPs.
 */
export const perAccountLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : undefined;
    return email || req.ip || 'unknown';
  },
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts for this account, try again later' } },
});

/**
 * Slightly looser per-IP limiter for invite acceptance — invitees are
 * unauthenticated by definition, so this is the only backstop against
 * brute-forcing invite tokens.
 */
export const inviteAcceptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
});
