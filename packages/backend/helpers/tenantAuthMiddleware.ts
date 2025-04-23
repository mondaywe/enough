import { Request, Response } from 'express';
import prisma from '../prisma/client';
import { logError } from './logger';
import redis from '../redis/client';

const revertTenantAuthMiddleware = () => async (req: Request, res: Response, next: () => any) => {
    const pathsToSkip = ['/config', '/mappings'];
    if (pathsToSkip.includes(req.path)) return next();
    if (req.method === 'DELETE') return next(); // Do not check for tenantSecretToken for DELETE.
    const {
        'x-revert-public-token': token,
        'x-revert-t-id': tenantId,
        'x-revert-t-token': tenantSecretToken,
    } = req.headers;

    const storedTenantSecretToken = await redis.get(`tenantSecretToken_${tenantId}`);
    if (tenantSecretToken !== storedTenantSecretToken) {
        res.status(401).send({
            error: 'Api token unauthorized - invalid tenant secret',
        });
        return;
    }
    try {
        if (!tenantId) {
            return res.status(400).send({
                error: 'Tenant not found',
            });
        }
        const conn = await prisma.connections.findFirst({
            where: {
                t_id: tenantId as string,
                app: {
                    env: {
                        public_token: token as string,
                    },
                },
            },
            include: {
                app: {
                    include: { env: { include: { accounts: { include: { accountFieldMappingConfig: true } } } } },
                },
            },
        });
        const account = conn?.app?.env.accounts;
        if (!account) {
            return res.status(401).send({
                error: 'Api token unauthorized',
            });
        }

        res.locals.account = account;
        res.locals.connection = conn;
        return next();
    } catch (error: any) {
        logError(error);
        return res.status(400).send({
            error: 'Bad request',
        });
    }
};

export default revertTenantAuthMiddleware;
