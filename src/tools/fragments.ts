import {
  listFragments, createFragment, getFragment,
  updateFragment, patchFragment, publishFragment,
  getLiveFragment, getLastPublicationStatus, archiveFragment,
  buildError, isClientConfigured
} from '../adobe/client.js';
import {
  ListFragmentsSchema, CreateFragmentSchema, GetFragmentSchema,
  UpdateFragmentSchema, PatchFragmentSchema, PublishFragmentSchema,
  GetLiveFragmentSchema, GetPublicationStatusSchema, ArchiveFragmentSchema
} from '../validation/schemas.js';
import { notConfiguredError, validationError, withTelemetry } from './utils.js';

// ─── list_content_fragments ───────────────────────────────────────────────────

export const listContentFragmentsDefinition = {
  name: 'list_content_fragments',
  description: `List content fragments from Adobe Journey Optimizer.
Returns a paginated list of all content fragments in the configured sandbox.

Example usage:
- List all fragments: {}
- Filter by status: { property: ["status==PUBLISHED"] }
- Filter by type: { property: ["type==html"] }

Returns: { _page: { count, next }, items: [{ id, name, type, status, channels, ... }] }`,
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      limit: { type: 'number', description: 'Max items to return (1-1000, default 20)' },
      start: { type: 'string', description: 'Pagination cursor from previous _page.next' },
      orderBy: { type: 'string', description: 'Sort field with +/- prefix. E.g. "-modifiedAt"' },
      property: { type: 'array', items: { type: 'string' }, description: 'FIQL filter expressions. Operators: == (equals), != (not equals), ~^ (starts with), ~ (contains). E.g. ["status==PUBLISHED", "type==html"]' }
    }
  }
};

export async function handleListContentFragments(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('list_content_fragments', async () => {
    const parsed = ListFragmentsSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await listFragments(parsed.data);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── create_content_fragment ──────────────────────────────────────────────────

export const createContentFragmentDefinition = {
  name: 'create_content_fragment',
  description: `Create a new content fragment in Adobe Journey Optimizer.
Fragments are reusable content blocks that can be embedded in campaigns and journeys.

Example usage (HTML fragment):
{
  "name": "Header Banner",
  "type": "html",
  "channels": ["email"],
  "fragment": {
    "content": "<div>Hi {{_yourtenant.person.firstName}}, great deals await!</div>"
  }
}

Example usage (Expression fragment):
{
  "name": "Greeting Expression",
  "type": "expression",
  "channels": ["shared"],
  "fragment": {
    "expression": "Hi {{_yourtenant.person.firstName}}!"
  },
  "subType": "TEXT"
}
Note: _yourtenant is a placeholder — use the 'discover-personalization-paths' prompt for a guided lookup, or call list_xdm_field_groups directly, to find the real attribute paths before inserting any personalization.

Returns: { success: true, id: "<uuid>", location: "/fragments/<uuid>" }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['name', 'type', 'channels', 'fragment'],
    properties: {
      name: { type: 'string', description: 'Fragment name (required)' },
      description: { type: 'string', description: 'Optional description' },
      type: { type: 'string', enum: ['html', 'expression'], description: 'Fragment type' },
      channels: { type: 'array', items: { type: 'string', enum: ['email', 'shared'] }, minItems: 1, maxItems: 1, description: 'Target channel (exactly 1). html→email, expression→shared' },
      fragment: { type: 'object', description: 'Fragment content. For html: { content: "<html>..." }. For expression: { expression: "..." }' },
      subType: { type: 'string', enum: ['TEXT', 'HTML', 'JSON'], description: 'Sub-type for expression fragments' },
      parentFolderId: { type: 'string', format: 'uuid', description: 'UUID of parent folder' },
      source: { type: 'object', description: 'Source metadata { origin: "ajo"|"external" }' }
    }
  }
};

export async function handleCreateContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('create_content_fragment', async () => {
    const parsed = CreateFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const payload = { ...parsed.data, source: parsed.data.source ?? { origin: 'ajo' as const } };
      const result = await createFragment(payload);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── get_content_fragment ─────────────────────────────────────────────────────

export const getContentFragmentDefinition = {
  name: 'get_content_fragment',
  description: `Fetch a single content fragment by ID from Adobe Journey Optimizer.

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { id, name, type, status, channels, fragment, createdAt, ... }, etag: "..." }
The etag is required for update/patch operations.`,
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to fetch' }
    }
  }
};

export async function handleGetContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_content_fragment', async () => {
    const parsed = GetFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const result = await getFragment(parsed.data.fragmentId);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── update_content_fragment ──────────────────────────────────────────────────

export const updateContentFragmentDefinition = {
  name: 'update_content_fragment',
  description: `Replace a content fragment entirely (PUT). Use this when changing fragment content, type, or channels. To rename or move a fragment without touching its content, patch_content_fragment is lighter-weight.

Workflow:
1. Call get_content_fragment to get current data + etag
2. Modify the data
3. Call update_content_fragment with all fields + etag

Example usage:
{
  "fragmentId": "b6d70a45-...",
  "etag": "\\"abc123\\"",
  "name": "Updated Header Banner",
  "type": "html",
  "channels": ["email"],
  "fragment": { "content": "<div>Updated content</div>" }
}

Returns: { success: true }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId', 'etag', 'name', 'type', 'channels', 'fragment'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to update' },
      etag: { type: 'string', description: 'ETag from get_content_fragment' },
      name: { type: 'string', description: 'Fragment name' },
      description: { type: 'string', description: 'Optional description' },
      type: { type: 'string', enum: ['html', 'expression'], description: 'Fragment type: html → email channel; expression → shared channel' },
      channels: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 1, description: 'Target channel (exactly 1). html fragments use ["email"]; expression fragments use ["shared"]' },
      fragment: { type: 'object', description: 'Full replacement content. For html: { content: "<html>..." }. For expression: { expression: "..." }' },
      parentFolderId: { type: 'string', format: 'uuid', description: 'UUID of parent folder' },
      source: { type: 'object', description: 'Source metadata { origin: "ajo"|"external" }' }
    }
  }
};

export async function handleUpdateContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('update_content_fragment', async () => {
    const parsed = UpdateFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    const { fragmentId, etag, ...rest } = parsed.data;
    const payload = { ...rest, source: rest.source ?? { origin: 'ajo' as const } };
    try {
      const result = await updateFragment(fragmentId, payload, etag);
      return { ...result, success: true };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── patch_content_fragment ───────────────────────────────────────────────────

export const patchContentFragmentDefinition = {
  name: 'patch_content_fragment',
  description: `Rename or redescribe a content fragment — use this when changing only metadata (name, description, or parent folder), NOT content. For content, type, or channel changes, use update_content_fragment instead.

Only these paths are supported: /name, /description, /parentFolderId.

Example usage:
{
  "fragmentId": "b6d70a45-...",
  "etag": "\\"abc123\\"",
  "patches": [{ "op": "replace", "path": "/name", "value": "New Fragment Name" }]
}

Returns: { success: true }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId', 'etag', 'patches'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to patch' },
      etag: { type: 'string', description: 'ETag from get_content_fragment' },
      patches: {
        type: 'array',
        items: {
          type: 'object',
          required: ['op', 'path'],
          properties: {
            op: { type: 'string', enum: ['add', 'remove', 'replace'] },
            path: { type: 'string', description: 'Supported: /name, /description, /parentFolderId' },
            value: {}
          }
        }
      }
    }
  }
};

export async function handlePatchContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('patch_content_fragment', async () => {
    const parsed = PatchFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    const { fragmentId, etag, patches } = parsed.data;
    try {
      const result = await patchFragment(fragmentId, patches, etag);
      return { ...result, success: true };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── publish_content_fragment ────────────────────────────────────────────────

export const publishContentFragmentDefinition = {
  name: 'publish_content_fragment',
  description: `Publish a content fragment to make it available for use in campaigns and journeys.
Publishing freezes the fragment content. Required before activating a campaign/journey that uses this fragment.
Publication is asynchronous — after calling this tool, poll get_fragment_publication_status every 5 seconds until status is "complete" or "error". Publication typically finishes within 30 seconds; if still "inProgress" after 6 polls (~30 s), stop and tell the user it is taking longer than expected.

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, accepted: true, location: "...", retryAfter: 5 }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to publish' }
    }
  }
};

export async function handlePublishContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('publish_content_fragment', async () => {
    const parsed = PublishFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const result = await publishFragment(parsed.data.fragmentId);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── get_live_fragment ────────────────────────────────────────────────────────

export const getLiveFragmentDefinition = {
  name: 'get_live_fragment',
  description: `Fetch the content of a fragment's last successful publication.
Use this to retrieve the frozen/published version of a fragment that is live in campaigns.

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { type: "html", fragment: { content: "<div>...</div>" } } }`,
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment' }
    }
  }
};

export async function handleGetLiveFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_live_fragment', async () => {
    const parsed = GetLiveFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await getLiveFragment(parsed.data.fragmentId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── get_fragment_publication_status ─────────────────────────────────────────

export const getFragmentPublicationStatusDefinition = {
  name: 'get_fragment_publication_status',
  description: `Check the status of the last publication request for a content fragment.
Use this after publish_content_fragment to track the async publication process.

Status values:
- "inProgress": Publication is still processing
- "complete": Fragment is published and live
- "error": Publication failed (check errors array)

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { status: "complete"|"inProgress"|"error", errors: [] } }`,
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to check publication status for' }
    }
  }
};

export async function handleGetFragmentPublicationStatus(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_fragment_publication_status', async () => {
    const parsed = GetPublicationStatusSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await getLastPublicationStatus(parsed.data.fragmentId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── archive_content_fragment ─────────────────────────────────────────────────

export const archiveContentFragmentDefinition = {
  name: 'archive_content_fragment',
  description: `Archive a content fragment in Adobe Journey Optimizer.
Fragments cannot be deleted via the API — archiving is the permanent equivalent. An archived fragment
is removed from the active library and can no longer be used in new campaigns or journeys.

No etag is required. This operation bypasses optimistic locking (the internal GraphQL mutation
accepts an empty etag), so no concurrent-modification check is performed. Confirm the fragment ID
is correct before proceeding — there is no undo.

Note: this operation calls an internal AJO GraphQL API (not the public REST API).

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, id: "<uuid>", etag: "<new-etag>" }`,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to archive' }
    }
  }
};

export async function handleArchiveContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('archive_content_fragment', async () => {
    const parsed = ArchiveFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const result = await archiveFragment(parsed.data.fragmentId);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}
