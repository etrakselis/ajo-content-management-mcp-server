// Client for the Adobe Experience Platform Unified Tags & Folders API
// (Folders under /unifiedfolders, Tags + Tag categories under /unifiedtags).
// Used to organize the same content this server manages — folders give content a
// navigable tree, tags/categories give it a metadata taxonomy for discovery.
//
// Auth reuses the same IMS token + headers as the content client. The Folders
// endpoints are sandbox-scoped (they require x-sandbox-name); the Tag endpoints
// are documented as org-level, but we always send x-sandbox-name anyway — it is
// harmless where ignored and required where the tag store is sandbox-scoped, and
// it keeps a single header set across every call (matching the content client).
//
// Base URL follows the API spec's gateway (experience.adobe.io); override with
// AJO_UNIFIED_TAGS_BASE_URL for non-standard gateways.

import axios, { Method } from 'axios';
import { tokenManager } from '../auth/token-manager.js';
import { getConfiguredApiKey, getConfiguredImsOrg, getConfiguredSandboxName } from './client.js';

const BASE_URL = process.env.AJO_UNIFIED_TAGS_BASE_URL ?? 'https://experience.adobe.io';

const enc = encodeURIComponent;

interface RequestOptions {
  params?: Record<string, unknown>;
  data?: unknown;
  // Only set on requests that carry a body (POST/PATCH); the spec mandates
  // application/json for those.
  withBody?: boolean;
}

async function utRequest<T = unknown>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const token = await tokenManager.getToken();
  const resp = await axios.request<T>({
    method,
    url: `${BASE_URL}${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-key': getConfiguredApiKey() ?? '',
      'x-gw-ims-org-id': getConfiguredImsOrg() ?? '',
      'x-sandbox-name': getConfiguredSandboxName() ?? '',
      ...(opts.withBody ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json'
    },
    ...(opts.params ? { params: opts.params } : {}),
    ...(opts.data !== undefined ? { data: opts.data } : {}),
    // Repeated-key form (?property=a&property=b) for array filters, matching the
    // content and Schema Registry clients.
    paramsSerializer: { indexes: null },
    timeout: 30000
  });
  return resp.data;
}

// ── List query params (tags + tag categories share this grammar) ──────────────
export interface TagListParams {
  start?: string;
  limit?: number;
  property?: string | string[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const tagListParams = (p: TagListParams): Record<string, unknown> => ({
  ...(p.start !== undefined ? { start: p.start } : {}),
  ...(p.limit !== undefined ? { limit: p.limit } : {}),
  ...(p.property ? { property: p.property } : {}),
  ...(p.sortBy ? { sortBy: p.sortBy } : {}),
  // The Unified Tags API NPEs ("String.equals because sortOrder is null") when
  // sortBy is sent without a sortOrder. Default to 'asc' so a caller can sort by a
  // field without having to also remember the direction.
  ...(p.sortBy ? { sortOrder: p.sortOrder ?? 'asc' } : (p.sortOrder ? { sortOrder: p.sortOrder } : {}))
});

// ── Folders ───────────────────────────────────────────────────────────────────
export const createFolder = (folderType: string, body: { name: string; parentFolderId?: string | null }) =>
  utRequest('post', `/unifiedfolders/folders/${enc(folderType)}`, { data: body, withBody: true });

export const getFolder = (folderType: string, folderId: string) =>
  utRequest('get', `/unifiedfolders/folders/${enc(folderType)}/${enc(folderId)}`);

export const updateFolder = (folderType: string, folderId: string, patchOps: unknown[]) =>
  utRequest('patch', `/unifiedfolders/folders/${enc(folderType)}/${enc(folderId)}`, { data: patchOps, withBody: true });

export const deleteFolder = (folderType: string, folderId: string) =>
  utRequest('delete', `/unifiedfolders/folders/${enc(folderType)}/${enc(folderId)}`);

export const getSubfolders = (folderType: string, folderId: string) =>
  utRequest('get', `/unifiedfolders/folders/${enc(folderType)}/${enc(folderId)}/subfolders`);

export const validateFolder = (folderType: string, folderId: string) =>
  utRequest('get', `/unifiedfolders/folders/${enc(folderType)}/${enc(folderId)}/validate`);

// Resolve a folder UUID to its full human-readable path (e.g. "Campaigns/Email/Holiday 2026").
// Results are cached per sandbox+folderType+folderId so repeated commits don't re-fetch.
const folderPathCache = new Map<string, string>();

export async function resolveAjoFolderPath(folderType: string, folderId: string): Promise<string> {
  const sandbox = getConfiguredSandboxName() ?? '';
  const cacheKey = `${sandbox}:${folderType}:${folderId}`;
  if (folderPathCache.has(cacheKey)) return folderPathCache.get(cacheKey)!;

  const segments: string[] = [];
  let currentId: string | undefined = folderId;
  for (let depth = 0; depth < 12 && currentId; depth++) {
    const folder = await getFolder(folderType, currentId) as { name?: string; parentFolderId?: string | null };
    if (!folder.name) break;
    segments.unshift(folder.name);
    currentId = folder.parentFolderId ?? undefined;
  }

  const path = segments.join('/');
  folderPathCache.set(cacheKey, path);
  return path;
}

// ── Tag categories (read-only) ────────────────────────────────────────────────
// Category mutation (create/update/delete) is admin-only upstream and is NOT
// exposed by this server — see src/tools/tags.ts — so only the read endpoints
// have client functions here.
export const listTagCategories = (params: TagListParams = {}) =>
  utRequest('get', '/unifiedtags/tagCategory', { params: tagListParams(params) });

export const getTagCategory = (tagCategoryId: string) =>
  utRequest('get', `/unifiedtags/tagCategory/${enc(tagCategoryId)}`);

// ── Tags ──────────────────────────────────────────────────────────────────────
export const listTags = (params: TagListParams = {}) =>
  utRequest('get', '/unifiedtags/tags', { params: tagListParams(params) });

export const createTag = (body: { name: string; tagCategoryId?: string }) =>
  utRequest('post', '/unifiedtags/tags', { data: body, withBody: true });

export const getTag = (tagId: string) =>
  utRequest('get', `/unifiedtags/tags/${enc(tagId)}`);

export interface TagPatchOp { op: string; path: string; value: string; from?: string }

// updateTag sends a BARE JSON-Patch operations array — op "replace", string `value`,
// paths name/archived/tagCategoryId with NO leading slash. The backend DTO expects an
// UpdateRequest { patchRequestList: [...] } envelope, but the experience.adobe.io
// gateway adds that envelope itself for this route, so we must NOT pre-wrap. (Verified
// on the wire: pre-wrapping produced a double-nested { patchRequestList: {
// patchRequestList: [...] } } at the backend — a single wrap left this process yet AJO
// echoed a double wrap in its deserialization error, proving the gateway adds the +1.)
// We still normalize an accidentally-enveloped input back to a bare array so the
// wrapper can never be re-introduced here. See handleUpdateTag.
export const updateTag = (tagId: string, patchOps: TagPatchOp[] | { patchRequestList: TagPatchOp[] }) => {
  const ops = Array.isArray(patchOps) ? patchOps : patchOps?.patchRequestList ?? [];
  return utRequest('patch', `/unifiedtags/tags/${enc(tagId)}`, { data: ops, withBody: true });
};

export const deleteTag = (tagId: string) =>
  utRequest('delete', `/unifiedtags/tags/${enc(tagId)}`);

export const validateTags = (body: { ids: string[]; entity?: string }) =>
  utRequest('post', '/unifiedtags/tags/validate', { data: body, withBody: true });
