// src/middleware/tenant.ts
import { Request, Response, NextFunction } from 'express';

export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.header('X-Tenant-ID');
  if (!tenantId) {
    return res
      .status(400)
      .json({ error: 'Missing tenant identifier (please set X-Tenant-ID)' });
  }
  // attach for downstream use
  ;(req as any).tenantId = tenantId;
  next();
}
