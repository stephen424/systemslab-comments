import compression from 'compression';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/environment';
import { isOriginAllowed } from './config/cors';
import { authenticateToken } from './middleware/auth';
import threadRoutes from './routes/threads';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
// Only the bearer token authorises a request, so no cookies are needed or accepted.
app.use(cors({ origin: (origin, callback) => callback(null, isOriginAllowed(origin, env.CORS_ORIGINS)) }));
app.use(compression());
if (env.NODE_ENV !== 'test') app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'systemslab-comments' });
});

app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
app.use('/api', express.json({ limit: '100kb' }));
app.use('/api', authenticateToken, threadRoutes);

app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((error: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ success: false, message: 'The request body is not valid JSON' });
    return;
  }
  console.error(`Request failed: ${error.message}`);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

export default app;
