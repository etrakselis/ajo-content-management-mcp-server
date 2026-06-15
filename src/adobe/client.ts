import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { v4 as uuidv4 } from 'uuid';
import { tokenManager } from '../auth/token-manager.js';
import { logger, adobeApiErrorCounter } from '../telemetry/index.js';

export interface AdobeClientConfig {
  sandboxName: string;
  imsOrg: string;
  apiKey: string;
  orgName?: string;      // user-supplied display name, e.g. "Adobe"
  tenantId?: string;     // auto-detected AEP namespace, e.g. "etrakselis"
  authorEmail?: string;  // self-declared author email, recorded with content changes
  baseUrl?: string;
}

export interface PaginationParams {
  limit?: number;
  start?: string;
  orderBy?: string;
  property?: string[];
}

let clientConfig: AdobeClientConfig | null = null;
let httpClient: AxiosInstance | null = null;

export function configureAdobeClient(config: AdobeClientConfig): void {
  clientConfig = config;

  httpClient = axios.create({
    baseURL: config.baseUrl || 'https://platform.adobe.io/ajo/content',
    timeout: 30000
  });

  // Retry on network errors and 5xx
  axiosRetry(httpClient, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error: AxiosError) => {
      return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
        (error.response?.status !== undefined && error.response.status >= 500);
    },
    onRetry: (retryCount, error) => {
      logger.warn('Retrying Adobe API request', {
        retryCount,
        error: error.message,
        url: error.config?.url
      });
    }
  });

  // Request interceptor: inject auth headers
  httpClient.interceptors.request.use(async (config) => {
    const token = await tokenManager.getToken();
    config.headers['Authorization'] = `Bearer ${token}`;
    config.headers['x-api-key'] = clientConfig!.apiKey;
    config.headers['x-gw-ims-org-id'] = clientConfig!.imsOrg;
    config.headers['x-sandbox-name'] = clientConfig!.sandboxName;
    config.headers['x-request-id'] = uuidv4();
    return config;
  });

  // Response interceptor: log errors
  httpClient.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      if (error.response) {
        adobeApiErrorCounter.inc({
          endpoint: error.config?.url || 'unknown',
          status_code: String(error.response.status)
        });
        logger.error('Adobe API error', {
          status: error.response.status,
          url: error.config?.url,
          method: error.config?.method
        });
      }
      return Promise.reject(error);
    }
  );
}

export function isClientConfigured(): boolean {
  return clientConfig !== null && httpClient !== null;
}

export function getConfiguredSandboxName(): string | null {
  return clientConfig?.sandboxName ?? null;
}

export function getConfiguredOrgName(): string | null {
  return clientConfig?.orgName ?? null;
}

export function getConfiguredTenantId(): string | null {
  return clientConfig?.tenantId ?? null;
}

export function getConfiguredAuthorEmail(): string | null {
  return clientConfig?.authorEmail ?? null;
}

export function getConfiguredApiKey(): string | null {
  return clientConfig?.apiKey ?? null;
}

export function getConfiguredImsOrg(): string | null {
  return clientConfig?.imsOrg ?? null;
}

export function resetAdobeClient(): void {
  clientConfig = null;
  httpClient = null;
}

function getClient(): AxiosInstance {
  if (!httpClient) throw new Error('Adobe API client not configured');
  return httpClient;
}

function buildError(err: unknown): { code: string; message: string; details: unknown } {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;
    const codes: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT'
    };
    return {
      code: (status && codes[status]) || 'API_ERROR',
      message: data?.title || data?.message || err.message,
      details: data || {}
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { code: 'INTERNAL_ERROR', message: msg, details: {} };
}

// ─── Templates ───────────────────────────────────────────────────────────────

export async function listTemplates(params: PaginationParams = {}) {
  const client = getClient();
  const queryParams: Record<string, unknown> = {};
  if (params.limit) queryParams.limit = params.limit;
  if (params.start) queryParams.start = params.start;
  if (params.orderBy) queryParams.orderBy = params.orderBy;
  if (params.property) queryParams.property = params.property;

  const response = await client.get('/templates', {
    params: queryParams,
    headers: { Accept: 'application/vnd.adobe.ajo.template-list.v1+json' }
  });
  return response.data;
}

export async function createTemplate(payload: unknown) {
  const client = getClient();
  const response = await client.post('/templates', payload, {
    headers: { 'Content-Type': 'application/vnd.adobe.ajo.template.v1+json' }
  });
  return {
    id: response.headers['x-resource-id'],
    location: response.headers['location'],
    etag: response.headers['etag']
  };
}

export async function getTemplate(templateId: string) {
  const client = getClient();
  const response = await client.get(`/templates/${templateId}`, {
    headers: { Accept: 'application/vnd.adobe.ajo.template.v1+json' }
  });
  return { data: response.data, etag: response.headers['etag'] };
}

export async function updateTemplate(templateId: string, payload: unknown, etag: string) {
  const client = getClient();
  await client.put(`/templates/${templateId}`, payload, {
    headers: {
      'Content-Type': 'application/vnd.adobe.ajo.template.v1+json',
      'If-Match': etag
    }
  });
  return { success: true };
}

export async function patchTemplate(templateId: string, patchOps: unknown[], etag: string) {
  const client = getClient();
  const response = await client.patch(`/templates/${templateId}`, patchOps, {
    headers: {
      'Content-Type': 'application/json-patch+json',
      'If-Match': etag
    }
  });
  return { data: response.data, etag: response.headers['etag'] };
}

export async function deleteTemplate(templateId: string) {
  const client = getClient();
  await client.delete(`/templates/${templateId}`);
  return { success: true };
}

// ─── Fragments ────────────────────────────────────────────────────────────────

export async function listFragments(params: PaginationParams = {}) {
  const client = getClient();
  const queryParams: Record<string, unknown> = {};
  if (params.limit) queryParams.limit = params.limit;
  if (params.start) queryParams.start = params.start;
  if (params.orderBy) queryParams.orderBy = params.orderBy;
  if (params.property) queryParams.property = params.property;

  const response = await client.get('/fragments', {
    params: queryParams,
    headers: { Accept: 'application/vnd.adobe.ajo.fragment-list.v1.0+json' }
  });
  return response.data;
}

export async function createFragment(payload: unknown) {
  const client = getClient();
  const response = await client.post('/fragments', payload, {
    headers: { 'Content-Type': 'application/vnd.adobe.ajo.fragment.v1.0+json' }
  });
  return {
    id: response.headers['x-resource-id'],
    location: response.headers['location'],
    etag: response.headers['etag']
  };
}

export async function getFragment(fragmentId: string) {
  const client = getClient();
  const response = await client.get(`/fragments/${fragmentId}`, {
    headers: { Accept: 'application/vnd.adobe.ajo.fragment.v1.0+json' }
  });
  return { data: response.data, etag: response.headers['etag'] };
}

export async function updateFragment(fragmentId: string, payload: unknown, etag: string) {
  const client = getClient();
  await client.put(`/fragments/${fragmentId}`, payload, {
    headers: {
      'Content-Type': 'application/vnd.adobe.ajo.fragment.v1.0+json',
      'If-Match': etag
    }
  });
  return { success: true };
}

export async function patchFragment(fragmentId: string, patchOps: unknown[], etag: string) {
  const client = getClient();
  await client.patch(`/fragments/${fragmentId}`, patchOps, {
    headers: {
      'Content-Type': 'application/json-patch+json',
      'If-Match': etag
    }
  });
  return { success: true };
}

export async function publishFragment(fragmentId: string) {
  const client = getClient();
  const response = await client.post('/fragments/publications',
    { fragmentId },
    { headers: { 'Content-Type': 'application/vnd.adobe.ajo.fragment.publication.request.v1.0+json' } }
  );
  return {
    accepted: true,
    location: response.headers['location'],
    retryAfter: response.headers['retry-after']
  };
}

export async function getLiveFragment(fragmentId: string) {
  const client = getClient();
  const response = await client.get(`/fragments/${fragmentId}/liveFragment`);
  return response.data;
}

export async function getLastPublicationStatus(fragmentId: string) {
  const client = getClient();
  const response = await client.get(`/fragments/${fragmentId}/lastPublicationStatus`);
  return response.data;
}

export async function archiveFragment(fragmentId: string) {
  if (!clientConfig) throw new Error('Adobe API client not configured');
  const token = await tokenManager.getToken();
  const response = await axios.post(
    'https://exc-unifiedcontent.experience.adobe.net/api/gql/profile/graphql/graphql?appId=cjmFragmentsUI',
    {
      operationName: 'updateAjoFragmentState',
      query: `mutation updateAjoFragmentState($id: String!, $etag: String!, $state: AjoFragmentState!) {
        updateAjoFragmentState(fragmentId: $id, etag: $etag, state: $state) { id etag }
      }`,
      variables: { id: fragmentId, etag: '', state: 'ARCHIVED' }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-api-key': 'exc_app',
        'x-gw-ims-org-id': clientConfig.imsOrg,
        'x-sandbox-name': clientConfig.sandboxName
      }
    }
  );
  const gqlErrors = response.data?.errors;
  if (gqlErrors?.length) {
    throw new Error(`Archive mutation error: ${JSON.stringify(gqlErrors)}`);
  }
  const result = response.data?.data?.updateAjoFragmentState;
  if (!result) throw new Error(`Archive mutation returned no data. Response: ${JSON.stringify(response.data)}`);
  return { id: result.id, etag: result.etag };
}

export { buildError };
