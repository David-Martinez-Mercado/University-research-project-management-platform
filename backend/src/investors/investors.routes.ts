import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authorize } from '../middleware/authorize';
import {
  buildReport,
  createLink,
  createLinkSchema,
  dashboardQuerySchema,
  deleteLink,
  getDashboard,
  idParamSchema,
  listLinks,
  listLinksQuerySchema,
} from './investors.service';

/** Mounted at /investor-links (administrators only). */
export const investorLinksRouter = Router();

investorLinksRouter.post(
  '/',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createLink(createLinkSchema.parse(req.body), req.user!));
  }),
);

investorLinksRouter.get(
  '/',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    res.json(await listLinks(listLinksQuerySchema.parse(req.query)));
  }),
);

investorLinksRouter.delete(
  '/:id',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    await deleteLink(idParamSchema.parse(req.params).id);
    res.status(204).end();
  }),
);

/** Mounted at /investors. */
export const investorsRouter = Router();

investorsRouter.get(
  '/:id/dashboard',
  ...authorize({ roles: ['ADMINISTRATOR', 'INVESTOR'] }),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await getDashboard(id, dashboardQuerySchema.parse(req.query), req.user!));
  }),
);

/** Mounted at /projects. */
export const reportRouter = Router();

reportRouter.get(
  '/:id/report',
  ...authorize({ roles: ['ADMINISTRATOR', 'INVESTOR', 'JUDGE'] }),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { fileName, pdf } = await buildReport(id, req.user!);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(pdf);
  }),
);
