import dotenv from 'dotenv';
import { parseOriginList } from './cors';

dotenv.config();

export interface EnvironmentConfig {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL?: string;
  DB_SSL: boolean;
  DB_SSL_CA?: string;
  /** Shared with Quickbuild and the apps: the comments API accepts the Systemslab.ai access tokens Quickbuild issues. */
  JWT_SECRET: string;
  /** Every frontend that shows comments. */
  CORS_ORIGINS: string[];
  /** Apps that may hold comments. A thread names its app, so one app's admins cannot close another app's threads. */
  APPS: string[];
}

const nodeEnv = process.env.NODE_ENV || 'development';

const jwtSecret = process.env.JWT_SECRET || '';
if (!jwtSecret && nodeEnv === 'production') {
  throw new Error('JWT_SECRET must be set (use the same value as the Quickbuild backend)');
}

export const env: EnvironmentConfig = {
  NODE_ENV: nodeEnv,
  PORT: parseInt(process.env.PORT || '5010', 10),
  DATABASE_URL: process.env.DATABASE_URL,
  DB_SSL: process.env.DB_SSL === 'true',
  DB_SSL_CA: process.env.DB_SSL_CA,
  JWT_SECRET: jwtSecret || 'development-only-secret',
  CORS_ORIGINS: parseOriginList(process.env.CORS_ORIGINS || 'http://localhost:5176'),
  APPS: (process.env.APPS || 'practice,lifecycle,form')
    .split(',')
    .map(a => a.trim())
    .filter(Boolean),
};
