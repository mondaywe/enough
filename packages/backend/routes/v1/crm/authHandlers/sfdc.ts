import axios from 'axios';
import qs from 'qs';
import config from '../../../../config';
import { logInfo } from '../../../../helpers/logger';
import { xprisma } from '../../../../prisma/client';
import { TP_ID } from '@prisma/client';

import { IntegrationAuthProps, mapIntegrationIdToIntegrationName } from '../../../../constants/common';
import processOAuthResult from '../../../../helpers/auth/processOAuthResult';
import sendConnectionAddedEvent from '../../../../helpers/webhooks/connection';
import BaseOAuthHandler from '../../../../helpers/auth/baseOAuthHandler';
class SfdcAuthHandler extends BaseOAuthHandler {
    async handleOAuth({
        account,
        clientId,
        clientSecret,
        code,
        integrationId,
        revertPublicKey,
        svixAppId,
        environmentId,
        tenantId,
        tenantSecretToken,
        response,
        redirectUrl,
    }: IntegrationAuthProps) {
        try {
            // Handle the received code
            const url = 'https://login.salesforce.com/services/oauth2/token';
            const formData = {
                grant_type: 'authorization_code',
                client_id: clientId || config.SFDC_CLIENT_ID,
                client_secret: clientSecret || config.SFDC_CLIENT_SECRET,
                redirect_uri: `${config.OAUTH_REDIRECT_BASE}/sfdc`,
                code,
            };
            const result = await axios({
                method: 'post',
                url: url,
                data: qs.stringify(formData),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
                },
            });
            logInfo('OAuth creds for sfdc', result.data);
            const info = await axios({
                method: 'get',
                url: 'https://login.salesforce.com/services/oauth2/userinfo',
                headers: {
                    authorization: `Bearer ${result.data.access_token}`,
                },
            });
            logInfo('Oauth token info', info.data);
            await xprisma.connections.upsert({
                where: {
                    id: tenantId,
                },
                create: {
                    id: tenantId,
                    t_id: tenantId,
                    tp_id: integrationId,
                    tp_access_token: result.data.access_token,
                    tp_refresh_token: result.data.refresh_token,
                    tp_customer_id: info.data.email,
                    tp_account_url: info.data.urls['custom_domain'],
                    app_client_id: clientId || config.SFDC_CLIENT_ID,
                    app_client_secret: clientSecret || config.SFDC_CLIENT_SECRET,
                    owner_account_public_token: revertPublicKey,
                    appId: account?.apps[0].id,
                    environmentId: environmentId,
                },
                update: {
                    tp_access_token: result.data.access_token,
                    tp_refresh_token: result.data.refresh_token,
                    app_client_id: clientId || config.SFDC_CLIENT_ID,
                    app_client_secret: clientSecret || config.SFDC_CLIENT_SECRET,
                    tp_id: integrationId,
                    appId: account?.apps[0].id,
                    tp_customer_id: info.data.email,
                    tp_account_url: info.data.urls['custom_domain'],
                },
            });
            await sendConnectionAddedEvent(svixAppId, tenantId, TP_ID.sfdc, result.data.access_token, info.data.email);

            return processOAuthResult({
                status: true,
                revertPublicKey,
                tenantSecretToken,
                response,
                tenantId: tenantId,
                integrationName: mapIntegrationIdToIntegrationName[integrationId],
                tpCustomerId: info.data.email,
                redirectUrl,
            });
        } catch (error: any) {
            console.log('OAuthERROR', error);
            return processOAuthResult({
                status: false,
                error,
                revertPublicKey,
                tenantSecretToken,
                response,
                tenantId: tenantId,
                integrationName: mapIntegrationIdToIntegrationName[integrationId],
                redirectUrl,
            });
        }
    }
}

export default new SfdcAuthHandler();
