import axios from 'axios';
import { TP_ID } from '@prisma/client';

import { CompanyService } from '../../generated/typescript/api/resources/crm/resources/company/service/CompanyService';
import { NotFoundError } from '../../generated/typescript/api/resources/common';
import { InternalServerError } from '../../generated/typescript/api/resources/common';
import { logInfo, logError } from '../../helpers/logger';
import revertTenantMiddleware from '../../helpers/tenantIdMiddleware';
import revertAuthMiddleware from '../../helpers/authMiddleware';
import { isStandardError } from '../../helpers/error';
import { unifyObject, disunifyObject } from '../../helpers/crm/transform';
import { UnifiedCompany } from '../../models/unified/company';
import { PipedriveCompany, PipedrivePagination } from '../../constants/pipedrive';
import { StandardObjects } from '../../constants/common';
import { getAssociationObjects, isValidAssociationTypeRequestedByUser } from '../../helpers/crm/hubspot';

const objType = StandardObjects.company;

const companyService = new CompanyService(
    {
        async getCompany(req, res) {
            try {
                const connection = res.locals.connection;
                const account = res.locals.account;
                const companyId = req.params.id;
                const fields = req.query.fields;
                const thirdPartyId = connection.tp_id;
                const thirdPartyToken = connection.tp_access_token;
                const tenantId = connection.t_id;
                const associations = req.query.associations ? req.query.associations.split(',') : [];
                logInfo(
                    'Revert::GET COMPANY',
                    connection.app?.env?.accountId,
                    tenantId,
                    thirdPartyId,
                    thirdPartyToken,
                    companyId,
                );

                switch (thirdPartyId) {
                    case TP_ID.hubspot: {
                        const formattedFields = [
                            ...String(fields || '').split(','),
                            'name',
                            'hs_object_id',
                            'city',
                            'state',
                            'zip',
                            'industry',
                            'description',
                            'numberofemployees',
                            'phone',
                            'annualrevenue',
                        ];
                        const validAssociations = [...associations].filter((item) =>
                            isValidAssociationTypeRequestedByUser(item),
                        );
                        const invalidAssociations = [...associations].filter(
                            (item) =>
                                item !== 'undefined' && item !== 'null' && !isValidAssociationTypeRequestedByUser(item),
                        );

                        const url =
                            `https://api.hubapi.com/crm/v3/objects/companies/${companyId}?properties=${formattedFields}` +
                            (validAssociations.length > 0 ? `&associations=${validAssociations}` : '');

                        const company = await axios({
                            method: 'get',
                            url: url,
                            headers: {
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                        });
                        const associatedData = await getAssociationObjects(
                            company.data?.associations,
                            thirdPartyToken,
                            thirdPartyId,
                            connection,
                            account,
                            invalidAssociations,
                        );
                        res.send({
                            status: 'ok',
                            result: await unifyObject<any, UnifiedCompany>({
                                obj: {
                                    ...company.data,
                                    ...company.data?.properties,
                                    associations: associatedData,
                                },
                                tpId: thirdPartyId,
                                objType,
                                tenantSchemaMappingId: connection.schema_mapping_id,
                                accountFieldMappingConfig: account.accountFieldMappingConfig,
                            }),
                        });
                        break;
                    }
                    case TP_ID.zohocrm: {
                        let company: any = await axios({
                            method: 'get',
                            url: `https://www.zohoapis.com/crm/v3/Accounts/${companyId}?fields=${fields}`,
                            headers: {
                                authorization: `Zoho-oauthtoken ${thirdPartyToken}`,
                            },
                        });
                        company = await unifyObject<any, UnifiedCompany>({
                            obj: company.data.data?.[0],
                            tpId: thirdPartyId,
                            objType,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });
                        res.send({ status: 'ok', result: company });
                        break;
                    }
                    case TP_ID.sfdc: {
                        const instanceUrl = connection.tp_account_url;
                        const company = await axios({
                            method: 'get',
                            url: `${instanceUrl}/services/data/v56.0/sobjects/Account/${companyId}`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                            },
                        });
                        res.send({
                            status: 'ok',
                            result: await unifyObject<any, UnifiedCompany>({
                                obj: company.data,
                                tpId: thirdPartyId,
                                objType,
                                tenantSchemaMappingId: connection.schema_mapping_id,
                                accountFieldMappingConfig: account.accountFieldMappingConfig,
                            }),
                        });
                        break;
                    }
                    case TP_ID.pipedrive: {
                        const result = await axios.get<{ data: Partial<PipedriveCompany> } & PipedrivePagination>(
                            `${connection.tp_account_url}/v1/organizations/${companyId}`,
                            {
                                headers: {
                                    Authorization: `Bearer ${thirdPartyToken}`,
                                },
                            },
                        );
                        const company = result.data;
                        res.send({
                            status: 'ok',
                            result: await unifyObject<any, UnifiedCompany>({
                                obj: company.data,
                                tpId: thirdPartyId,
                                objType,
                                tenantSchemaMappingId: connection.schema_mapping_id,
                                accountFieldMappingConfig: account.accountFieldMappingConfig,
                            }),
                        });
                        break;
                    }
                    case TP_ID.ms_dynamics_365_sales: {
                        const result = await axios({
                            method: 'get',
                            url: `${connection.tp_account_url}/api/data/v9.2/accounts(${companyId})`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                'OData-MaxVersion': '4.0',
                                'OData-Version': '4.0',
                                Accept: 'application/json',
                            },
                        });

                        const unifiedCompany = await unifyObject<any, UnifiedCompany>({
                            obj: result.data,
                            tpId: thirdPartyId,
                            objType,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({ status: 'ok', result: unifiedCompany });
                        return;
                    }
                    default: {
                        throw new NotFoundError({ error: 'Unrecognized CRM' });
                    }
                }
            } catch (error: any) {
                logError(error);
                console.error('Could not fetch company', error);
                if (isStandardError(error)) {
                    throw error;
                }
                throw new InternalServerError({ error: 'Internal server error' });
            }
        },
        async getCompanies(req, res) {
            try {
                const connection = res.locals.connection;
                const account = res.locals.account;
                const fields = req.query.fields;
                const pageSize = parseInt(String(req.query.pageSize));
                const cursor = req.query.cursor;
                const thirdPartyId = connection.tp_id;
                const thirdPartyToken = connection.tp_access_token;
                const tenantId = connection.t_id;
                const associations = req.query.associations ? req.query.associations.split(',') : [];

                logInfo(
                    'Revert::GET ALL COMPANIES',
                    connection.app?.env?.accountId,
                    tenantId,
                    thirdPartyId,
                    thirdPartyToken,
                );

                switch (thirdPartyId) {
                    case TP_ID.hubspot: {
                        const formattedFields = [
                            ...String(fields || '').split(','),
                            'name',
                            'hs_object_id',
                            'city',
                            'state',
                            'zip',
                            'industry',
                            'description',
                            'numberofemployees',
                            'phone',
                            'annualrevenue',
                        ];
                        const pagingString = `${pageSize ? `&limit=${pageSize}` : ''}${
                            cursor ? `&after=${cursor}` : ''
                        }`;
                        const validAssociations = [...associations].filter((item) =>
                            isValidAssociationTypeRequestedByUser(item),
                        );
                        const invalidAssociations = [...associations].filter(
                            (item) =>
                                item !== 'undefined' && item !== 'null' && !isValidAssociationTypeRequestedByUser(item),
                        );

                        const url =
                            `https://api.hubapi.com/crm/v3/objects/companies?properties=${formattedFields}${pagingString}` +
                            (validAssociations.length > 0 ? `&associations=${validAssociations}` : '');

                        let companies: any = await axios({
                            method: 'get',
                            url: url,
                            headers: {
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                        });
                        const nextCursor = companies.data?.paging?.next?.after || undefined;
                        companies = companies.data.results as any[];
                        companies = await Promise.all(
                            companies?.map(async (c: any) => {
                                const associatedData = await getAssociationObjects(
                                    c?.associations,
                                    thirdPartyToken,
                                    thirdPartyId,
                                    connection,
                                    account,
                                    invalidAssociations,
                                );
                                return await unifyObject<any, UnifiedCompany>({
                                    obj: { ...c, ...c?.properties, associations: associatedData },
                                    tpId: thirdPartyId,
                                    objType,
                                    tenantSchemaMappingId: connection.schema_mapping_id,
                                    accountFieldMappingConfig: account.accountFieldMappingConfig,
                                });
                            }),
                        );
                        res.send({
                            status: 'ok',
                            next: nextCursor,
                            previous: undefined, // Field not supported by Hubspot.
                            results: companies,
                        });
                        break;
                    }
                    case TP_ID.zohocrm: {
                        const pagingString = `${pageSize ? `&per_page=${pageSize}` : ''}${
                            cursor ? `&page_token=${cursor}` : ''
                        }`;
                        let companies: any = await axios({
                            method: 'get',
                            url: `https://www.zohoapis.com/crm/v3/Accounts?fields=${fields}${pagingString}`,
                            headers: {
                                authorization: `Zoho-oauthtoken ${thirdPartyToken}`,
                            },
                        });
                        const nextCursor = companies.data?.info?.next_page_token || undefined;
                        const prevCursor = companies.data?.info?.previous_page_token || undefined;
                        companies = companies.data.data;
                        companies = await Promise.all(
                            companies?.map(
                                async (l: any) =>
                                    await unifyObject<any, UnifiedCompany>({
                                        obj: l,
                                        tpId: thirdPartyId,
                                        objType,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    }),
                            ),
                        );
                        res.send({ status: 'ok', next: nextCursor, previous: prevCursor, results: companies });
                        break;
                    }
                    case TP_ID.sfdc: {
                        let pagingString = `${pageSize ? `ORDER+BY+Id+DESC+LIMIT+${pageSize}+` : ''}${
                            cursor ? `OFFSET+${cursor}` : ''
                        }`;
                        if (!pageSize && !cursor) {
                            pagingString = 'LIMIT 200';
                        }
                        const instanceUrl = connection.tp_account_url;
                        // NOTE: Handle "ALL" for Hubspot & Zoho
                        const query =
                            !fields || fields === 'ALL'
                                ? `SELECT+fields(all)+from+Account+${pagingString}`
                                : `SELECT+${(fields as string).split(',').join('+,+')}+from+Account+${pagingString}`;
                        let companies: any = await axios({
                            method: 'get',
                            url: `${instanceUrl}/services/data/v56.0/query/?q=${query}`,
                            headers: {
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                        });
                        const nextCursor = pageSize
                            ? String(companies.data?.totalSize + (parseInt(String(cursor)) || 0))
                            : undefined;
                        const prevCursor =
                            cursor && parseInt(String(cursor)) > 0
                                ? String(parseInt(String(cursor)) - companies.data?.totalSize)
                                : undefined;
                        companies = companies.data?.records;
                        companies = await Promise.all(
                            companies?.map(
                                async (l: any) =>
                                    await unifyObject<any, UnifiedCompany>({
                                        obj: l,
                                        tpId: thirdPartyId,
                                        objType,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    }),
                            ),
                        );
                        res.send({ status: 'ok', next: nextCursor, previous: prevCursor, results: companies });
                        break;
                    }
                    case TP_ID.pipedrive: {
                        const pagingString = `${pageSize ? `&limit=${pageSize}` : ''}${
                            cursor ? `&start=${cursor}` : ''
                        }`;
                        const result = await axios.get<{ data: Partial<PipedriveCompany>[] } & PipedrivePagination>(
                            `${connection.tp_account_url}/v1/organizations?${pagingString}`,
                            {
                                headers: {
                                    Authorization: `Bearer ${thirdPartyToken}`,
                                },
                            },
                        );
                        const nextCursor = String(result.data?.additional_data?.pagination.next_start) || undefined;
                        const prevCursor = undefined;
                        const companies = result.data.data;
                        const unifiedCompanies = await Promise.all(
                            companies?.map(
                                async (d) =>
                                    await unifyObject<any, UnifiedCompany>({
                                        obj: d,
                                        tpId: thirdPartyId,
                                        objType,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    }),
                            ),
                        );
                        res.send({ status: 'ok', next: nextCursor, previous: prevCursor, results: unifiedCompanies });
                        break;
                    }
                    case TP_ID.ms_dynamics_365_sales: {
                        const pagingString = cursor ? encodeURI(cursor).split('?')[1] : '';

                        const result = await axios({
                            method: 'get',
                            url: `${connection.tp_account_url}/api/data/v9.2/accounts?${pagingString}`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                'OData-MaxVersion': '4.0',
                                'OData-Version': '4.0',
                                Accept: 'application/json',
                                Prefer: pageSize ? `odata.maxpagesize=${pageSize}` : '',
                            },
                        });

                        const unifiedCompanies = await Promise.all(
                            result.data.value.map(
                                async (company: any) =>
                                    await unifyObject<any, UnifiedCompany>({
                                        obj: company,
                                        tpId: thirdPartyId,
                                        objType,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    }),
                            ),
                        );

                        res.send({
                            status: 'ok',
                            next: result.data['@odata.nextLink'],
                            previous: undefined,
                            results: unifiedCompanies,
                        });
                        return;
                    }
                    default: {
                        throw new NotFoundError({ error: 'Unrecognized CRM' });
                    }
                }
            } catch (error: any) {
                logError(error);
                console.error('Could not fetch companies', error);
                if (isStandardError(error)) {
                    throw error;
                }
                throw new InternalServerError({ error: 'Internal server error' });
            }
        },
        async createCompany(req, res) {
            try {
                const companyData = req.body as UnifiedCompany;
                const connection = res.locals.connection;
                const account = res.locals.account;
                const thirdPartyId = connection.tp_id;
                const thirdPartyToken = connection.tp_access_token;
                const tenantId = connection.t_id;
                const company = await disunifyObject<UnifiedCompany>({
                    obj: companyData,
                    tpId: thirdPartyId,
                    objType,
                    tenantSchemaMappingId: connection.schema_mapping_id,
                    accountFieldMappingConfig: account.accountFieldMappingConfig,
                });
                console.log('Revert::CREATE COMPANY', connection.app?.env?.accountId, tenantId, company);

                switch (thirdPartyId) {
                    case TP_ID.hubspot: {
                        const response = await axios({
                            method: 'post',
                            url: `https://api.hubapi.com/crm/v3/objects/companies/`,
                            headers: {
                                'content-type': 'application/json',
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: JSON.stringify(company),
                        });
                        res.send({
                            status: 'ok',
                            message: 'Hubspot company created',
                            result: { id: response.data?.id, ...company },
                        });
                        break;
                    }
                    case TP_ID.zohocrm: {
                        const result = await axios({
                            method: 'post',
                            url: `https://www.zohoapis.com/crm/v3/Accounts`,
                            headers: {
                                authorization: `Zoho-oauthtoken ${thirdPartyToken}`,
                            },
                            data: JSON.stringify(company),
                        });
                        if (companyData.associations?.dealId) {
                            await axios.put(
                                `https://www.zohoapis.com/crm/v3/Deals/${companyData.associations.dealId}`,
                                {
                                    data: [{ Account_Name: { id: result.data?.data?.[0]?.details?.id } }],
                                },
                                {
                                    headers: {
                                        authorization: `Zoho-oauthtoken ${thirdPartyToken}`,
                                    },
                                },
                            );
                        }
                        res.send({ status: 'ok', message: 'Zoho company created', result: company });
                        break;
                    }
                    case TP_ID.sfdc: {
                        const instanceUrl = connection.tp_account_url;
                        const companyCreated = await axios({
                            method: 'post',
                            url: `${instanceUrl}/services/data/v56.0/sobjects/Account/`,
                            headers: {
                                'content-type': 'application/json',
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: JSON.stringify(company),
                        });
                        if (companyData.associations?.dealId) {
                            await axios({
                                method: 'patch',
                                url: `${instanceUrl}/services/data/v56.0/sobjects/Opportunity/${companyData.associations.dealId}`,
                                headers: {
                                    'content-type': 'application/json',
                                    authorization: `Bearer ${thirdPartyToken}`,
                                },
                                data: JSON.stringify({ AccountId: companyCreated.data?.id }),
                            });
                        }
                        res.send({
                            status: 'ok',
                            message: 'SFDC company created',
                            result: companyCreated.data,
                        });
                        break;
                    }
                    case TP_ID.pipedrive: {
                        const instanceUrl = connection.tp_account_url;
                        const pipedriveCompany = company as Partial<PipedriveCompany>;
                        const companyCreated = await axios.post<{ data: Partial<PipedriveCompany> }>(
                            `${instanceUrl}/v1/organizations`,
                            pipedriveCompany,
                            {
                                headers: {
                                    Authorization: `Bearer ${thirdPartyToken}`,
                                },
                            },
                        );
                        res.send({
                            status: 'ok',
                            message: 'Pipedrive company created',
                            result: {
                                ...companyCreated.data.data,
                            },
                        });
                        break;
                    }
                    case TP_ID.ms_dynamics_365_sales: {
                        const response = await axios({
                            method: 'post',
                            url: `${connection.tp_account_url}/api/data/v9.2/accounts`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                'OData-MaxVersion': '4.0',
                                'OData-Version': '4.0',
                                Accept: 'application/json',
                                'Content-Type': 'application/json',
                            },
                            data: company,
                        });

                        res.send({
                            status: 'ok',
                            message: 'Company created in MS Dynamics 365',
                            result: response.data,
                        });

                        break;
                    }
                    default: {
                        throw new NotFoundError({ error: 'Unrecognized CRM' });
                    }
                }
            } catch (error: any) {
                logError(error);
                console.error('Could not create company', error.response);
                if (isStandardError(error)) {
                    throw error;
                }
                throw new InternalServerError({ error: 'Internal server error' });
            }
        },
        async updateCompany(req, res) {
            try {
                const connection = res.locals.connection;
                const account = res.locals.account;
                const companyData = req.body as UnifiedCompany;
                const companyId = req.params.id;
                const thirdPartyId = connection.tp_id;
                const thirdPartyToken = connection.tp_access_token;
                const tenantId = connection.t_id;
                const company = await disunifyObject<UnifiedCompany>({
                    obj: companyData,
                    tpId: thirdPartyId,
                    objType,
                    tenantSchemaMappingId: connection.schema_mapping_id,
                    accountFieldMappingConfig: account.accountFieldMappingConfig,
                });
                console.log('Revert::UPDATE COMPANY', connection.app?.env?.accountId, tenantId, company, companyId);

                switch (thirdPartyId) {
                    case TP_ID.hubspot: {
                        await axios({
                            method: 'patch',
                            url: `https://api.hubapi.com/crm/v3/objects/companies/${companyId}`,
                            headers: {
                                'content-type': 'application/json',
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: JSON.stringify(company),
                        });
                        res.send({
                            status: 'ok',
                            message: 'Hubspot company updated',
                            result: company,
                        });
                        break;
                    }
                    case TP_ID.zohocrm: {
                        await axios({
                            method: 'put',
                            url: `https://www.zohoapis.com/crm/v3/Accounts/${companyId}`,
                            headers: {
                                authorization: `Zoho-oauthtoken ${thirdPartyToken}`,
                            },
                            data: JSON.stringify(company),
                        });
                        res.send({ status: 'ok', message: 'Zoho company updated', result: company });
                        break;
                    }
                    case TP_ID.sfdc: {
                        const instanceUrl = connection.tp_account_url;
                        await axios({
                            method: 'patch',
                            url: `${instanceUrl}/services/data/v56.0/sobjects/Account/${companyId}`,
                            headers: {
                                'content-type': 'application/json',
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: JSON.stringify(company),
                        });
                        res.send({ status: 'ok', message: 'SFDC company updated', result: company });
                        break;
                    }
                    case TP_ID.pipedrive: {
                        const companyUpdated = await axios.put<{ data: Partial<PipedriveCompany> }>(
                            `${connection.tp_account_url}/v1/organizations/${companyId}`,
                            company,
                            {
                                headers: {
                                    Authorization: `Bearer ${thirdPartyToken}`,
                                },
                            },
                        );
                        res.send({
                            status: 'ok',
                            message: 'Pipedrive company updated',
                            result: {
                                ...companyUpdated.data.data,
                            },
                        });
                        break;
                    }
                    case TP_ID.ms_dynamics_365_sales: {
                        const response = await axios({
                            method: 'patch',
                            url: `${connection.tp_account_url}/api/data/v9.2/accounts(${companyId})`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                'OData-MaxVersion': '4.0',
                                'OData-Version': '4.0',
                                Accept: 'application/json',
                                'Content-Type': 'application/json',
                            },
                            data: company,
                        });

                        res.send({ status: 'ok', message: 'MS Dynamics 365 company updated', result: response.data });
                        break;
                    }
                    default: {
                        throw new NotFoundError({ error: 'Unrecognized CRM' });
                    }
                }
            } catch (error: any) {
                logError(error);
                console.error('Could not update company', error.response);
                if (isStandardError(error)) {
                    throw error;
                }
                throw new InternalServerError({ error: 'Internal server error' });
            }
        },
        async searchCompanies(req, res) {
            try {
                const connection = res.locals.connection;
                const account = res.locals.account;
                const fields = req.query.fields;
                const searchCriteria: any = req.body.searchCriteria;
                const formattedFields = (fields || '').split('').filter(Boolean);
                const thirdPartyId = connection.tp_id;
                const thirdPartyToken = connection.tp_access_token;
                const tenantId = connection.t_id;
                const pageSize = parseInt(String(req.query.pageSize));
                const cursor = req.query.cursor;

                logInfo('Revert::SEARCH COMPANY', connection.app?.env?.accountId, tenantId, searchCriteria, fields);

                switch (thirdPartyId) {
                    case TP_ID.hubspot: {
                        let companies: any = await axios({
                            method: 'post',
                            url: `https://api.hubapi.com/crm/v3/objects/companies/search`,
                            headers: {
                                'content-type': 'application/json',
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: JSON.stringify({
                                ...searchCriteria,
                                limit: pageSize || 100,
                                after: cursor || 0,
                                properties: [
                                    'name',
                                    'hs_object_id',
                                    'city',
                                    'state',
                                    'zip',
                                    'industry',
                                    'description',
                                    'numberofemployees',
                                    'phone',
                                    'annualrevenue',
                                    ...formattedFields,
                                ],
                            }),
                        });

                        const nextCursor = companies.data?.paging?.next?.after || undefined;

                        companies = companies.data.results as any[];
                        companies = await Promise.all(
                            companies?.map(
                                async (c: any) =>
                                    await unifyObject<any, UnifiedCompany>({
                                        obj: { ...c, ...c?.properties },
                                        tpId: thirdPartyId,
                                        objType,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    }),
                            ),
                        );
                        res.send({
                            status: 'ok',
                            next: nextCursor,
                            previous: undefined,
                            results: companies,
                        });
                        break;
                    }
                    case TP_ID.zohocrm: {
                        const pagingString = `${pageSize ? `&per_page=${pageSize}` : ''}${
                            cursor ? `&page_token=${cursor}` : ''
                        }`;
                        let companies: any = await axios({
                            method: 'get',
                            url: `https://www.zohoapis.com/crm/v3/Accounts/search?criteria=${searchCriteria}${pagingString}`,
                            headers: {
                                authorization: `Zoho-oauthtoken ${thirdPartyToken}`,
                            },
                        });
                        const nextCursor = companies.data?.info?.next_page_token || undefined;
                        const prevCursor = companies.data?.info?.previous_page_token || undefined;
                        companies = companies.data.data;
                        companies = await Promise.all(
                            companies?.map(
                                async (c: any) =>
                                    await unifyObject<any, UnifiedCompany>({
                                        obj: c,
                                        tpId: thirdPartyId,
                                        objType,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    }),
                            ),
                        );
                        res.send({ status: 'ok', next: nextCursor, previous: prevCursor, results: companies });
                        break;
                    }
                    case TP_ID.sfdc: {
                        const instanceUrl = connection.tp_account_url;
                        let companies: any = await axios({
                            method: 'get',
                            url: `${instanceUrl}/services/data/v56.0/search?q=${searchCriteria}`,
                            headers: {
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                        });
                        companies = companies?.data?.searchRecords;
                        companies = await Promise.all(
                            companies?.map(
                                async (c: any) =>
                                    await unifyObject<any, UnifiedCompany>({
                                        obj: c,
                                        tpId: thirdPartyId,
                                        objType,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    }),
                            ),
                        );
                        res.send({ status: 'ok', results: companies });
                        break;
                    }
                    case TP_ID.pipedrive: {
                        const instanceUrl = connection.tp_account_url;
                        const pagingString = `${pageSize ? `&limit=${pageSize}` : ''}${
                            cursor ? `&start=${cursor}` : ''
                        }`;
                        const result = await axios.get<
                            { data: { items: { item: any; result_score: number }[] } } & PipedrivePagination
                        >(
                            `${instanceUrl}/v1/organizations/search?term=${searchCriteria}${
                                formattedFields.length ? `&fields=${formattedFields.join(',')}` : ''
                            }${pagingString}`,
                            {
                                headers: {
                                    Authorization: `Bearer ${thirdPartyToken}`,
                                },
                            },
                        );
                        const nextCursor = String(result.data?.additional_data?.pagination.next_start) || undefined;
                        const prevCursor = undefined;

                        const companies = result.data.data.items.map((item) => item.item);
                        const unifiedCompanies = await Promise.all(
                            companies?.map(
                                async (d: any) =>
                                    await unifyObject<any, UnifiedCompany>({
                                        obj: d,
                                        tpId: thirdPartyId,
                                        objType,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    }),
                            ),
                        );
                        res.send({ status: 'ok', next: nextCursor, previous: prevCursor, results: unifiedCompanies });
                        break;
                    }
                    case TP_ID.ms_dynamics_365_sales: {
                        let searchString = fields ? `$select=${fields}` : '';
                        if (searchCriteria) {
                            searchString += fields ? `&$filter=${searchCriteria}` : `$filter=${searchCriteria}`;
                        }
                        const pagingString = cursor ? encodeURI(cursor).split('?')[1] : '';
                        const result = await axios({
                            method: 'get',
                            url: `${connection.tp_account_url}/api/data/v9.2/accounts?${searchString}${pagingString}`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                'OData-MaxVersion': '4.0',
                                'OData-Version': '4.0',
                                Accept: 'application/json',
                                Prefer: pageSize ? `odata.maxpagesize=${pageSize}` : '',
                            },
                        });

                        const unifiedCompanies = await Promise.all(
                            result.data.value.map(
                                async (contact: any) =>
                                    await unifyObject<any, UnifiedCompany>({
                                        obj: contact,
                                        tpId: thirdPartyId,
                                        objType,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    }),
                            ),
                        );

                        res.send({
                            status: 'ok',
                            next: result.data['@odata.nextLink'],
                            previous: undefined,
                            results: unifiedCompanies,
                        });
                        break;
                    }
                    default: {
                        throw new NotFoundError({ error: 'Unrecognized CRM' });
                    }
                }
            } catch (error: any) {
                logError(error);
                console.error('Could not search CRM', error);
                if (isStandardError(error)) {
                    throw error;
                }
                throw new InternalServerError({ error: 'Internal server error' });
            }
        },
    },
    [revertAuthMiddleware(), revertTenantMiddleware()],
);

export { companyService };
