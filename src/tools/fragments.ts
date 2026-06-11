import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  listFragments, createFragment, getFragment,
  updateFragment, patchFragment, publishFragment,
  getLiveFragment, getLastPublicationStatus,
  buildError, isClientConfigured
} from '../adobe/client.js';
import {
  ListFragmentsSchema, CreateFragmentSchema, GetFragmentSchema,
  UpdateFragmentSchema, PatchFragmentSchema, PublishFragmentSchema,
  GetLiveFragmentSchema, GetPublicationStatusSchema
} from '../validation/schemas.js';
import { toolCallCounter, toolCallDuration, createRequestLogger } from '../telemetry/index.js';

function notConfiguredError() {
  return {
    success: false,
    error: {
      code: 'NOT_CONFIGURED',
      message: 'MCP server is not configured. Please upload credentials and select a sandbox first.',
      details: {}
    }
  };
}

function validationError(err: z.ZodError) {
  return {
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input parameters',
      details: err.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
    }
  };
}

async function withTelemetry<T>(toolName: string, fn: () => Promise<T>) {
  const requestId = uuidv4();
  const log = createRequestLogger(requestId, toolName);
  const end = toolCallDuration.startTimer({ tool: toolName });
  log.info(`Tool called: ${toolName}`);
  try {
    const result = await fn();
    toolCallCounter.inc({ tool: toolName, status: 'success' });
    log.info(`Tool succeeded: ${toolName}`);
    return result;
  } catch (err) {
    toolCallCounter.inc({ tool: toolName, status: 'error' });
    log.error(`Tool failed: ${toolName}`, { error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    end();
  }
}

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
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: { type: 'number', description: 'Max items to return (1-1000, default 20)' },
      start: { type: 'string', description: 'Pagination cursor from previous _page.next' },
      orderBy: { type: 'string', description: 'Sort field with +/- prefix. E.g. "-modifiedAt"' },
      property: { type: 'array', items: { type: 'string' }, description: 'Filter expressions, e.g. ["status==PUBLISHED"]' }
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
    "content": "<div>Hi {{profile.person.name}}, great deals await!</div>"
  }
}

Example usage (Expression fragment):
{
  "name": "Greeting Expression",
  "type": "expression",
  "channels": ["shared"],
  "fragment": {
    "expression": "Hi {{profile.person.name}}!"
  },
  "subType": "TEXT"
}

Returns: { success: true, id: "<uuid>", location: "/fragments/<uuid>" }`,
  inputSchema: {
    type: 'object' as const,
    required: ['name', 'type', 'channels', 'fragment'],
    properties: {
      name: { type: 'string', description: 'Fragment name (required)' },
      description: { type: 'string', description: 'Optional description' },
      type: { type: 'string', enum: ['html', 'expression'], description: 'Fragment type' },
      channels: { type: 'array', items: { type: 'string', enum: ['email', 'shared'] }, description: 'Target channel (exactly 1). html→email, expression→shared' },
      fragment: { type: 'object', description: 'Fragment content. For html: { content: "<html>..." }. For expression: { expression: "..." }' },
      subType: { type: 'string', enum: ['TEXT', 'HTML', 'JSON'], description: 'Sub-type for expression fragments' },
      parentFolderId: { type: 'string', description: 'UUID of parent folder' },
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
      const result = await createFragment(parsed.data);
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
  inputSchema: {
    type: 'object' as const,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', description: 'UUID of the fragment to fetch' }
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
  description: `Replace a content fragment entirely (PUT). Requires the current etag from get_content_fragment.

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
  inputSchema: {
    type: 'object' as const,
    required: ['fragmentId', 'etag', 'name', 'type', 'channels', 'fragment'],
    properties: {
      fragmentId: { type: 'string', description: 'UUID of the fragment to update' },
      etag: { type: 'string', description: 'ETag from get_content_fragment' },
      name: { type: 'string' },
      description: { type: 'string' },
      type: { type: 'string', enum: ['html', 'expression'] },
      channels: { type: 'array', items: { type: 'string' } },
      fragment: { type: 'object' },
      parentFolderId: { type: 'string' },
      source: { type: 'object' }
    }
  }
};

export async function handleUpdateContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('update_content_fragment', async () => {
    const parsed = UpdateFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    const { fragmentId, etag, ...payload } = parsed.data;
    try {
      const result = await updateFragment(fragmentId, payload, etag);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── patch_content_fragment ───────────────────────────────────────────────────

export const patchContentFragmentDefinition = {
  name: 'patch_content_fragment',
  description: `Partially update a content fragment using JSON Patch (RFC 6902). Supported paths: /name, /description, /parentFolderId.

Example usage:
{
  "fragmentId": "b6d70a45-...",
  "etag": "\\"abc123\\"",
  "patches": [{ "op": "replace", "path": "/name", "value": "New Fragment Name" }]
}

Returns: { success: true }`,
  inputSchema: {
    type: 'object' as const,
    required: ['fragmentId', 'etag', 'patches'],
    properties: {
      fragmentId: { type: 'string', description: 'UUID of the fragment to patch' },
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
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── publish_content_fragment / publish_fragment (alias) ─────────────────────

export const publishContentFragmentDefinition = {
  name: 'publish_content_fragment',
  description: `Publish a content fragment to make it available for use in campaigns and journeys.
Publishing freezes the fragment content. Required before activating a campaign/journey that uses this fragment.
Publication is asynchronous — use get_fragment_publication_status to check progress.

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, accepted: true, location: "...", retryAfter: 5 }`,
  inputSchema: {
    type: 'object' as const,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', description: 'UUID of the fragment to publish' }
    }
  }
};

// Alias
export const publishFragmentDefinition = {
  ...publishContentFragmentDefinition,
  name: 'publish_fragment'
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
  inputSchema: {
    type: 'object' as const,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', description: 'UUID of the fragment' }
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
  inputSchema: {
    type: 'object' as const,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', description: 'UUID of the fragment to check publication status for' }
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
