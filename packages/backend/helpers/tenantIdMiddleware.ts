import { Request, Response } from 'express';
import { xprisma } from '../prisma/client';
import { logInfo, logError } from './logger';

const revertTenantMiddleware = () => async (req: Request, res: Response, next: () => any) => {
    const pathsToSkip = ['/config'];
    if (pathsToSkip.includes(req.path)) return next();
    const {
        'x-revert-t-id': tenantId,
        'x-revert-api-token': token,
        'x-revert-t-token': tenantSecretToken,
    } = req.headers;
    if (tenantSecretToken && !token) {
        return next();
    }
    try {
        if (!tenantId) {
            return res.status(400).send({
                error: 'Tenant not found',
            });
        }
        const connection: any = await xprisma.connections.findMany({
            where: {
                t_id: tenantId as string,
                app: {
                    env: {
                        private_token: token as string,
                    },
                },
            },
            select: {
                tp_access_token: true,
                tp_id: true,
                t_id: true,
                tp_account_url: true,
                tp_customer_id: true,
                app_config: true,
                app_client_id: true,
                app: {
                    include: {
                        env: {
                            select: {
                                accountId: true,
                            },
                        },
                    },
                },
                schema_mapping_id: true,
            },
        });
        if (!connection || !connection.length) {
            logInfo(`Tenant not found ${tenantId}`);
            return res.status(400).send({
                error: 'Tenant not found',
            });
        }
        if (connection[0]) {
            res.locals.connection = connection[0];
        } else {
            return res.status(400).send({
                error: 'Tenant not found',
            });
        }
    } catch (error: any) {
        logError(error);
    }

    return next();
};

export default revertTenantMiddleware;
