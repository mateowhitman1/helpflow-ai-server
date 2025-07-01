import { Router, Request, Response } from 'express';
import { generateToken } from '../services/jwtService';
const router = Router();

router.post('/login', (req: Request, res: Response) => {
  // TODO: validate credentials against your user store
  const token = generateToken({ userId: 'placeholder' });
  res.json({ token, tenants: [{ id: 'tenant1', name: 'Default Tenant' }] });
});

router.post('/select-tenant', (req: Request, res: Response) => {
  const { tenantId } = req.body;
  const authToken = generateToken({ tenantId, userId: 'placeholder' });
  res.json({ authToken });
});

export default router;
