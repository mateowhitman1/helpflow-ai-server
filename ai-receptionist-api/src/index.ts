// src/index.ts
import express from 'express';
import { config } from './config';
import { tenantMiddleware } from './middleware/tenant';
import { authMiddleware } from './middleware/auth';
import authRouter from './routes/auth';
import healthRouter from './routes/health';
import { errorHandler } from './middleware/errorHandler';
// import other routers, e.g.:
// import userRouter from './routes/users';
// import callRouter from './routes/calls';

const app = express();
app.use(express.json());

// 1) Resolve tenant on every request
app.use(tenantMiddleware);

// 2) Public endpoints
app.use('/auth', authRouter);
app.use('/health', healthRouter);

// 3) Protected API endpoints
app.use('/api', authMiddleware
  // , userRouter
  // , callRouter
);

// 4) Global error handler
app.use(errorHandler);

app.listen(config.port, () =>
  console.log(`🚀 Server running on http://localhost:${config.port}`)
);

