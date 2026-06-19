import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { v4 as uuidv4 } from 'uuid';
import { tokenManager } from '../auth/token-manager.js';
import { logger, adobeApiErrorCounter } from '../telemetry/index.js';

export interface NamingConventionConfig {
  enabled: boolean;
  markdown: string;
}

export interface AdobeClientConfig {
  sandboxName: string;
  imsOrg: string;
  apiKey: string;
  orgName?: string;      // user-supplied display name, e.g. "Adobe"
  tenantId?: string;     // auto-detected AEP namespace, e.g. "etrakselis"
  authorEmail?: string;  // self-declared author email, recorded with content changes
  baseUrl?: string;
  namingConvention?: NamingConventionConfig;
}

export interface PaginationParams {
  limit?: number;
  start?: string;
  orderBy?: string;
  property?: string[];
}

let clientConfig: AdobeClientConfig | null = null;
let httpClient: AxiosInstance | null = null;

// Bounded per-request timeout for upstream AJO calls. A stalled upstream should
// fail fast with a structured TIMEOUT error (see buildError) rather than hang the
// MCP client until its own (much longer) cap. Override with AJO_HTTP_TIMEOUT_MS.
export const HTTP_TIMEOUT_MS = Number(process.env.AJO_HTTP_TIMEOUT_MS) || 30000;

// Collapse interpolated identifiers (UUIDs, numeric ids) in a request path to a
// fixed ":id" placeholder before using it as a Prometheus label. The raw paths
// embed per-object UUIDs (e.g. /templates/<uuid>), which would otherwise create
// an unbounded number of label values and grow the metrics registry without limit.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function normalizeEndpoint(url: string | undefined): string {
  if (!url) return 'unknown';
  const path = url.split('?')[0];
  return path.replace(UUID_RE, ':id');
}

export function configureAdobeClient(config: AdobeClientConfig): void {
  clientConfig = config;

  httpClient = axios.create({
    baseURL: config.baseUrl || 'https://platform.adobe.io/ajo/content',
    timeout: HTTP_TIMEOUT_MS,
    // Serialize array query params as repeated keys (?property=a&property=b) rather
    // than axios's default bracketed form (?property[]=a). The AJO Content API's FIQL
    // `property` filter is a repeatable parameter; with brackets it does not recognize
    // the caller's filter and silently falls back to its own default, so the caller's
    // filter is dropped and an unrelated, unfiltered list comes back. indexes:null
    // gives the repeated-key form AJO actually honors.
    paramsSerializer: { indexes: null }
  });

  // Retry on network errors and 5xx
  axiosRetry(httpClient, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error: AxiosError) => {
      // Don't retry a response timeout — retrying multiplies the wait by the retry
      // count (the 4-minute hang seen in testing). Fail fast and let buildError map
      // it to a structured TIMEOUT. Still retry genuine network drops and 5xx.
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return false;
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
          endpoint: normalizeEndpoint(error.config?.url),
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

export function getConfiguredNamingConvention(): NamingConventionConfig | undefined {
  return clientConfig?.namingConvention;
}

export function resetAdobeClient(): void {
  clientConfig = null;
  httpClient = null;
}

function getClient(): AxiosInstance {
  if (!httpClient) throw new Error('Adobe API client not configured');
  return httpClient;
}

// Fields from Adobe API error bodies that are internal service-routing detail —
// noise to an LLM and potentially exposing infrastructure surface. Strip them
// before the error reaches the model; keep everything else for actionability.
const INTERNAL_ERROR_FIELDS = new Set(['error-chain', 'invokingServiceId']);

function sanitizeErrorData(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data ?? {};
  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>).filter(([k]) => !INTERNAL_ERROR_FIELDS.has(k))
  );
}

// AJO error bodies bury the most specific, human-readable reason at varying
// depths (e.g. a rejected JSON-Patch path explains itself only in
// report.additionalContext.detailedMessage, while the top-level title is the
// generic "Bad Request. Validation failed."). Probe the known locations in
// most-specific-first order and return the best sentence found, so the model can
// recover from error.message alone without digging through error.details.
function extractDeepMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return typeof data === 'string' && data.trim() ? data : null;
  }
  const d = data as Record<string, unknown>;
  const report = d.report as Record<string, unknown> | undefined;
  const additional = report?.additionalContext as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    additional?.detailedMessage,
    report?.detailedMessage,
    report?.message,
    // AJO sometimes returns a list of field-level violations.
    Array.isArray(d.errors) && d.errors.length
      ? (d.errors as Array<Record<string, unknown>>)
          .map(e => e?.message ?? e?.detail).filter(Boolean).join('; ')
      : undefined,
    d.detail,
    d.detailedMessage,
    d.title,
    d.message
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function buildError(err: unknown): { code: string; message: string; details: unknown } {
  if (axios.isAxiosError(err)) {
    // A timed-out / aborted request has no response. Surface it as a distinct,
    // retryable TIMEOUT rather than a generic API_ERROR, so the model knows the
    // write/read may simply need to be retried (it was not rejected on its merits).
    if (!err.response && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /timeout/i.test(err.message))) {
      return {
        code: 'TIMEOUT',
        message: 'The upstream Adobe API did not respond in time (request timed out). This is usually transient — wait a few seconds and retry.',
        details: {}
      };
    }
    const status = err.response?.status;
    const data = err.response?.data;
    const codes: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT'
    };
    // Promote the deepest specific reason; never let the top-level message be
    // less informative than something sitting in a nested field.
    let message = extractDeepMessage(data) || err.message;
    // 409 is phrased for a UI ("Refresh to load the latest version"); translate it
    // into the tool call an agent must actually make to recover.
    if (status === 409) {
      message += ' (Stale etag: the resource changed since you fetched it. Re-fetch it with ' +
        'get_content_template / get_content_fragment to obtain the current etag, then re-submit your change.)';
    }
    // AJO returns a generic "Bad Patch request." for a JSON-Patch that targets a
    // member that does not yet exist (RFC 6902: `replace` requires the target to
    // exist). The common offender is setting /parentFolderId, /tagIds, or /labels on
    // an object that has none yet. Point the caller at op `add`, which creates-or-
    // overwrites. (The patch_ handlers also auto-normalize replace→add for these
    // paths, so this hint mainly covers other paths / direct misuse.)
    if (status === 400 && /bad patch request/i.test(message)) {
      message += ' (If you are setting a field that may not exist yet — e.g. /parentFolderId, /tagIds, or ' +
        '/labels — use JSON-Patch op "add" rather than "replace": "replace" requires the member to already exist.)';
    }
    // CJMMAS-3014: the object's STORED parentFolderId points at a folder that no longer
    // exists (e.g. the folder was deleted), so the server re-validates that stale
    // reference and rejects ANY write — even one that doesn't touch the folder. The raw
    // message reads as if the caller supplied a bad folder; clarify it and name the fix.
    if (/given folder is invalid|CJMMAS-3014/i.test(message)) {
      message += ' (This usually means the object\'s stored parentFolderId points to a folder that no longer ' +
        'exists — the server re-validates it on every write, so even an unrelated patch fails. Add ' +
        '{ "op": "remove", "path": "/parentFolderId" } to your patch (alongside your other ops) to clear the ' +
        'stale folder reference.)';
    }
    return {
      code: (status && codes[status]) || 'API_ERROR',
      message,
      details: sanitizeErrorData(data)
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { code: 'INTERNAL_ERROR', message: msg, details: {} };
}

// Resolve the post-write etag: prefer the value the PUT returned in its header;
// if absent, do ONE best-effort read to fetch it. Any failure here is swallowed —
// the write already committed, so we must never turn this enrichment into an error.
async function resolveNewEtag(
  headerEtag: string | undefined,
  read: () => Promise<{ etag?: string }>
): Promise<string | undefined> {
  if (headerEtag) return headerEtag;
  try {
    return (await read()).etag;
  } catch {
    return undefined;
  }
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
  const response = await client.put(`/templates/${templateId}`, payload, {
    headers: {
      'Content-Type': 'application/vnd.adobe.ajo.template.v1+json',
      'If-Match': etag
    }
  });
  // The PUT has committed. Returning the new etag lets the caller chain a follow-up
  // write without a 409 + extra get_. Enrichment is best-effort: prefer the response
  // header, fall back to a single read, and NEVER throw after the commit.
  const newEtag = await resolveNewEtag(response.headers?.['etag'], () => getTemplate(templateId));
  return { success: true, ...(newEtag ? { etag: newEtag } : {}) };
}

export async function patchTemplate(templateId: string, patchOps: unknown[], etag: string) {
  const client = getClient();
  const response = await client.patch(`/templates/${templateId}`, patchOps, {
    headers: {
      'Content-Type': 'application/json-patch+json',
      'If-Match': etag
    }
  });
  // Mirror patch_content_fragment: return only the new etag (best-effort). The PATCH
  // has committed; tolerate a 204/empty body and a missing ETag header rather than
  // throwing — a post-commit throw would be a false negative the caller retries.
  const newEtag = response.headers?.['etag'];
  return { success: true, ...(newEtag ? { etag: newEtag } : {}) };
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
  const response = await client.put(`/fragments/${fragmentId}`, payload, {
    headers: {
      'Content-Type': 'application/vnd.adobe.ajo.fragment.v1.0+json',
      'If-Match': etag
    }
  });
  const newEtag = await resolveNewEtag(response.headers?.['etag'], () => getFragment(fragmentId));
  return { success: true, ...(newEtag ? { etag: newEtag } : {}) };
}

export async function patchFragment(fragmentId: string, patchOps: unknown[], etag: string) {
  const client = getClient();
  const response = await client.patch(`/fragments/${fragmentId}`, patchOps, {
    headers: {
      'Content-Type': 'application/json-patch+json',
      'If-Match': etag
    }
  });
  // Mirror patchTemplate: return the new etag (best-effort) so a caller — including
  // the create_ two-step folder placement — can chain a follow-up write without a
  // 409. Tolerate a 204/empty body and a missing ETag header rather than throwing.
  const newEtag = response.headers?.['etag'];
  return { success: true, ...(newEtag ? { etag: newEtag } : {}) };
}

export async function publishFragment(fragmentId: string) {
  const client = getClient();
  const response = await client.post('/fragments/publications',
    { fragmentId },
    { headers: { 'Content-Type': 'application/vnd.adobe.ajo.fragment.publication.request.v1.0+json' } }
  );
  const retryAfterHeader = response.headers['retry-after'];
  const raw = retryAfterHeader !== undefined ? Number(retryAfterHeader) : NaN;
  // Normalize to SECONDS to match the documented contract and the HTTP Retry-After
  // convention. AJO returns this in milliseconds (e.g. 1000 = 1s); a client that
  // waited that many *seconds* would stall for ~16 minutes. Treat a large value as
  // ms and convert; a small value is already seconds. Omit if absent/unparseable.
  const retryAfter = Number.isNaN(raw)
    ? undefined
    : raw > 60 ? Math.max(1, Math.round(raw / 1000)) : raw;
  return {
    accepted: true,
    location: response.headers['location'],
    retryAfter
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
