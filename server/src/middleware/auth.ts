import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/environment';
import { findUserById, SystemslabUser } from '../models/user';

/** Claims in a Quickbuild-issued access token (see quickbuild backend/src/middleware/auth.ts). */
export interface AccessTokenPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthRequest extends Request {
  user?: SystemslabUser;
}

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded !== 'object' || typeof (decoded as AccessTokenPayload).userId !== 'string') {
    throw new jwt.JsonWebTokenError('Token has no user');
  }
  return decoded as AccessTokenPayload;
};

/**
 * Accepts the Systemslab.ai access token (issued by Quickbuild's /api/auth endpoints) and loads the user,
 * so a deactivated account stops commenting at once rather than when its token runs out.
 */
export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ success: false, message: 'Access token required' });
    return;
  }

  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, message: 'Access token expired', code: 'TOKEN_EXPIRED' });
      return;
    }
    res.status(401).json({ success: false, message: 'Invalid access token' });
    return;
  }

  try {
    const user = await findUserById(payload.userId);
    if (!user) {
      res.status(401).json({ success: false, message: 'User not found' });
      return;
    }
    if (!user.is_active) {
      res.status(403).json({ success: false, message: 'User account is deactivated' });
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};
