import { Router } from 'express';
import { adminModuleRouter } from '@modules/admin/admin.routes';

/** Platform admin app — mount at `/api/v1/admin`. */
export const adminRouter = Router();

adminRouter.use(adminModuleRouter);
