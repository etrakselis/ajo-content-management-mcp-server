// Read-only client for the Adobe Experience Platform Schema Registry API
// (base path /data/foundation/schemaregistry). Used to look up the real XDM
// structures — schemas, field groups, and union schemas — so the LLM can insert
// personalization attribute paths that actually exist in the customer's sandbox
// (custom field groups under their tenant namespace) instead of guessing default
// XDM paths.
//
// Auth reuses the same IMS token + headers as the content client. These calls
// require the **AEP / Schema Registry API** to be enabled on the credential's
// Developer Console project — without it the registry returns 403.

import axios from 'axios';
import { tokenManager } from '../auth/token-manager.js';
import { getConfiguredApiKey, getConfiguredImsOrg, getConfiguredSandboxName } from './client.js';

const BASE_URL = 'https://platform.adobe.io/data/foundation/schemaregistry';

// Accept headers control response verbosity. `xed-id` returns concise summaries
// (good for listing); `xed-full` returns the fully-resolved schema with every
// referenced field group inlined — i.e. the complete property tree / attribute
// paths needed for personalization. `xed` returns the unresolved definition.
const ACCEPT_LIST = 'application/vnd.adobe.xed-id+json';
const ACCEPT_FULL = 'application/vnd.adobe.xed-full+json';
const ACCEPT_DEF = 'application/vnd.adobe.xed+json';

export type Container = 'tenant' | 'global';

interface ListParams {
  limit?: number;
  property?: string | string[]; // filter(s), e.g. "title~Loyalty" or ["title~Loyalty"]
  orderBy?: string;
  start?: string | number;
}

export interface SrListResponse {
  results?: unknown[];
  items?: unknown[];
  _page?: unknown;
  _links?: unknown;
  [key: string]: unknown;
}

// Schema Registry returns "results" while AJO Content returns "items". Normalize
// to "items" so both list families have a consistent envelope.
function normalizeListResponse(resp: SrListResponse): SrListResponse {
  if (Array.isArray(resp.results) && !resp.items) {
    const { results, ...rest } = resp;
    return { ...rest, items: results };
  }
  return resp;
}

async function srGet<T = unknown>(path: string, accept: string, params?: Record<string, unknown>): Promise<T> {
  const token = await tokenManager.getToken();
  const resp = await axios.get<T>(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-key': getConfiguredApiKey() ?? '',
      'x-gw-ims-org-id': getConfiguredImsOrg() ?? '',
      'x-sandbox-name': getConfiguredSandboxName() ?? '',
      Accept: accept
    },
    params,
    // Repeated-key form (?property=a&property=b) for array filters, matching the
    // content client — the Registry honors repeated `property` params (AND).
    paramsSerializer: { indexes: null },
    timeout: 30000
  });
  return resp.data;
}

// Schema Registry API uses lowercase "orderby"; tool input accepts "orderBy" (capital B)
// to match the content list tools — lowercase it here before hitting the wire.
const listParams = (p: ListParams) => ({
  ...(p.limit !== undefined ? { limit: p.limit } : {}),
  ...(p.property ? { property: p.property } : {}),
  ...(p.orderBy ? { orderby: p.orderBy } : {}),
  ...(p.start !== undefined ? { start: p.start } : {})
});

const accept = (full: boolean) => (full ? ACCEPT_FULL : ACCEPT_DEF);
const enc = encodeURIComponent;

// ── Schemas ─────────────────────────────────────────────────────────────────
export const listSchemas = async (container: Container, p: ListParams = {}) =>
  normalizeListResponse(await srGet<SrListResponse>(`/${container}/schemas`, ACCEPT_LIST, listParams(p)));

export const getSchema = (container: Container, schemaId: string, full = true) =>
  srGet(`/${container}/schemas/${enc(schemaId)}`, accept(full));

// ── Field groups ──────────────────────────────────────────────────────────────
export const listFieldGroups = async (container: Container, p: ListParams = {}) =>
  normalizeListResponse(await srGet<SrListResponse>(`/${container}/fieldgroups`, ACCEPT_LIST, listParams(p)));

export const getFieldGroup = (container: Container, fieldGroupId: string, full = true) =>
  srGet(`/${container}/fieldgroups/${enc(fieldGroupId)}`, accept(full));

// ── Union schemas (tenant container only) ─────────────────────────────────────
export const listUnionSchemas = async (p: ListParams = {}) =>
  normalizeListResponse(await srGet<SrListResponse>(`/tenant/unions`, ACCEPT_LIST, listParams(p)));

export const getUnionSchema = (unionId: string, full = true) =>
  srGet(`/tenant/unions/${enc(unionId)}`, accept(full));
