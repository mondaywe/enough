import { logError, logInfo } from '../../helpers/logger';
import { MessagesService } from '../../generated/typescript/api/resources/chat/resources/messages/service/MessagesService';
import revertTenantMiddleware from '../../helpers/tenantIdMiddleware';
import { UnifiedMessage } from '../../models/unified/message';
import { TP_ID } from '@prisma/client';
import axios from 'axios';
import { isStandardError } from '../../helpers/error';
import { InternalServerError } from '../../generated/typescript/api/resources/common';
import revertAuthMiddleware from '../../helpers/authMiddleware';
import { disunifyChatObject } from '../../helpers/crm/transform';
import { ChatStandardObjects } from '../../constants/common';

const objType = ChatStandardObjects.message;

const messageService = new MessagesService(
    {
        async createMessage(req, res) {
            try {
                const messageData = req.body as UnifiedMessage;
                const connection = res.locals.connection;
                const account = res.locals.account;
                const thirdPartyId = connection.tp_id;
                const thirdPartyToken = connection.tp_access_token;
                const tenantId = connection.t_id;
                const botToken = connection.app_config?.bot_token;
                const message = await disunifyChatObject<UnifiedMessage>({
                    obj: messageData,
                    tpId: thirdPartyId,
                    objType,
                    tenantSchemaMappingId: connection.schema_mapping_id,
                    accountFieldMappingConfig: account.accountFieldMappingConfig,
                });
                logInfo(
                    'Revert::CREATE/SEND MESSAGE',
                    connection.app?.env?.accountId,
                    tenantId,
                    thirdPartyId,
                    thirdPartyToken
                );

                switch (thirdPartyId) {
                    case TP_ID.slack: {
                        let slackRes: any = await axios({
                            method: 'post',
                            url: 'https://slack.com/api/chat.postMessage',
                            headers: {
                                'content-type': 'application/json',
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: JSON.stringify(message),
                        });
                        res.send({
                            status: 'ok',
                            result: slackRes.data,
                        });
                        break;
                    }
                    case TP_ID.discord: {
                        const url = `https://discord.com/api/channels/${messageData.channelId}/messages`;

                        let response: any = await axios({
                            method: 'post',
                            url: url,
                            data: message,
                            headers: { Authorization: `Bot ${botToken}` },
                        });

                        res.send({
                            status: 'ok',
                            result: response.data,
                        });
                        break;
                    }
                }
            } catch (error: any) {
                logError(error);
                console.error('Could not create/send message', error.response);
                if (isStandardError(error)) {
                    throw error;
                }
                throw new InternalServerError({ error: 'Internal server error' });
            }
        },
    },
    [revertAuthMiddleware(), revertTenantMiddleware()]
);

export { messageService };
