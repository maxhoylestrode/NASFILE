import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  isAdmin: boolean;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string; // user id
  type: 'refresh';
}

export function signAccessToken(user: { id: string; email: string; isAdmin: boolean }): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    type: 'access',
  };
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, { expiresIn: config.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'] });
}

export function signRefreshToken(user: { id: string }): string {
  const payload: RefreshTokenPayload = { sub: user.id, type: 'refresh' };
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, { expiresIn: config.JWT_REFRESH_TTL as jwt.SignOptions['expiresIn'] });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
  if (typeof decoded === 'string' || decoded.type !== 'access') {
    throw new jwt.JsonWebTokenError('Not an access token');
  }
  return decoded as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, config.JWT_REFRESH_SECRET);
  if (typeof decoded === 'string' || decoded.type !== 'refresh') {
    throw new jwt.JsonWebTokenError('Not a refresh token');
  }
  return decoded as RefreshTokenPayload;
}
