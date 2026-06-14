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
  property?: string; // filter, e.g. "title~Loyalty"
  orderby?: string;
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
    timeout: 30000
  });
  return resp.data;
}

const listParams = (p: ListParams) => ({
  ...(p.limit ? { limit: p.limit } : {}),
  ...(p.property ? { property: p.property } : {}),
  ...(p.orderby ? { orderby: p.orderby } : {})
});

const accept = (full: boolean) => (full ? ACCEPT_FULL : ACCEPT_DEF);
const enc = encodeURIComponent;

// ── Schemas ─────────────────────────────────────────────────────────────────
export const listSchemas = (container: Container, p: ListParams = {}) =>
  srGet(`/${container}/schemas`, ACCEPT_LIST, listParams(p));

export const getSchema = (container: Container, schemaId: string, full = true) =>
  srGet(`/${container}/schemas/${enc(schemaId)}`, accept(full));

// ── Field groups ──────────────────────────────────────────────────────────────
export const listFieldGroups = (container: Container, p: ListParams = {}) =>
  srGet(`/${container}/fieldgroups`, ACCEPT_LIST, listParams(p));

export const getFieldGroup = (container: Container, fieldGroupId: string, full = true) =>
  srGet(`/${container}/fieldgroups/${enc(fieldGroupId)}`, accept(full));

// ── Union schemas (tenant container only) ─────────────────────────────────────
export const listUnionSchemas = (p: ListParams = {}) =>
  srGet(`/tenant/unions`, ACCEPT_LIST, listParams(p));

export const getUnionSchema = (unionId: string, full = true) =>
  srGet(`/tenant/unions/${enc(unionId)}`, accept(full));
