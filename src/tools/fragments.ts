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
import { notConfiguredError, validationError, withTelemetry, buildOutputSchema, ETAG_FIELD, FRAGMENT_OBJECT, FRAGMENT_LIST } from './utils.js';

// ─── Shared input-schema fragments ──────────────────────────────────────────
// The content payload is a discriminated union on `type`: html fragments carry
// { content }, expression fragments carry { expression }. Declaring it as oneOf
// surfaces the required shape to the model/client up front instead of leaving
// `fragment` an opaque object it has to infer from the description prose. Reused
// verbatim by both create_ and update_ so the two never drift.
const FRAGMENT_CONTENT_SCHEMA = {
  type: 'object' as const,
  description: 'Content payload. Shape depends on `type`: html → { "content": "<html>...", editorContext? }; expression → { "expression": "..." }.',
  oneOf: [
    {
      title: 'HTML fragment content',
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'HTML markup. Required when type is "html".' },
        editorContext: { type: 'object', description: 'Opaque editor metadata (key-value). Optional.' }
      }
    },
    {
      title: 'Expression fragment content',
      required: ['expression'],
      properties: { expression: { type: 'string', description: 'Personalization expression. Required when type is "expression".' } }
    }
  ]
};

const FRAGMENT_CHANNELS_SCHEMA = {
  type: 'array' as const,
  items: { type: 'string' as const, enum: ['email', 'shared'] },
  minItems: 1,
  maxItems: 1,
  description: 'Target channel (exactly 1). html → ["email"]; expression → ["shared"].'
};

const FRAGMENT_SUBTYPE_SCHEMA = {
  type: 'string' as const,
  enum: ['TEXT', 'HTML', 'JSON'],
  description: 'Sub-type for expression fragments (TEXT | HTML | JSON). REQUIRED when type is "expression"; not used for html fragments.'
};

// Conditional requirement: AJO mandates subType for expression fragments. Declared
// as a JSON-Schema if/then so a schema-aware client enforces it before the call.
// Adds only to `required` (no new property), so it composes cleanly with the
// top-level additionalProperties:false and the confirmWrite flag injected later.
const EXPRESSION_REQUIRES_SUBTYPE = [
  { if: { properties: { type: { const: 'expression' } }, required: ['type'] }, then: { required: ['subType'] } }
];

// ─── list_content_fragments ───────────────────────────────────────────────────

export const listContentFragmentsDefinition = {
  name: 'list_content_fragments',
  title: 'List Content Fragments',
  outputSchema: buildOutputSchema({ data: FRAGMENT_LIST }),
  description: `Browse or list existing content fragments in the configured Adobe Journey Optimizer sandbox.
Returns a paginated list, with optional filtering by status or type and sorting by date.

Example usage:
- List all fragments: {}
- Filter by status: { property: ["status==PUBLISHED"] }
- Filter by type: { property: ["type==html"] }

Returns: { _page: { count, next }, items: [{ id, name, type, status, channels, ... }] }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
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
  title: 'Create Content Fragment',
  outputSchema: buildOutputSchema({
    id: { type: 'string', description: 'UUID of the newly created fragment.' },
    location: { type: 'string', description: 'Relative path of the new fragment, e.g. /fragments/<uuid>.' }
  }),
  description: `Create a new content fragment in Adobe Journey Optimizer.
Fragments are reusable content blocks that can be embedded in campaigns and journeys.

⚠ VISUAL EMAIL DESIGNER REQUIREMENT (type "html", channel "email"):
  The HTML content must use AJO's native serialization format (acr-* class
  namespace, structure/component catalog, required <head> with content-version
  meta tag). Generic HTML will force the designer into Compatibility mode,
  locking the user out of drag-and-drop editing. Call the
  get_visual_designer_requirements tool to get the full mandatory spec BEFORE
  constructing any HTML for this fragment type (it returns the exact
  structure/component catalog and required <head> you must reproduce).

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
Note: _yourtenant is a placeholder — use the 'discover-personalization-paths' prompt for a guided lookup, or call list_xdm_field_groups directly, to find the real attribute PATHS. For the AJO-native expression/function SYNTAX (conditionals, loops, date/string/array helpers, datasetLookup, etc.), call get_personalization_syntax (no arg for the index, then a category). Do both before inserting any personalization, and use only real AJO constructs — never JavaScript/Liquid/Jinja or invented function names.

Returns: { success: true, id: "<uuid>", location: "/fragments/<uuid>" }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['name', 'type', 'channels', 'fragment'],
    allOf: EXPRESSION_REQUIRES_SUBTYPE,
    properties: {
      name: { type: 'string', description: 'Fragment name (required)' },
      description: { type: 'string', description: 'Optional description' },
      type: { type: 'string', enum: ['html', 'expression'], description: 'Fragment type' },
      channels: FRAGMENT_CHANNELS_SCHEMA,
      fragment: FRAGMENT_CONTENT_SCHEMA,
      subType: FRAGMENT_SUBTYPE_SCHEMA,
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
  title: 'Get Content Fragment',
  outputSchema: buildOutputSchema({ data: FRAGMENT_OBJECT, etag: ETAG_FIELD }),
  description: `Fetch a single content fragment by ID from Adobe Journey Optimizer.
This returns the current/editable fragment (including unpublished draft changes) and its etag. For the frozen version actually live in campaigns, use get_live_fragment instead.

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { id, name, type, status, channels, fragment, createdAt, ... }, etag: "..." }
The etag is required for update/patch operations.`,
  annotations: { readOnlyHint: true, openWorldHint: true },
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
  title: 'Update Content Fragment (Replace)',
  outputSchema: buildOutputSchema({ etag: ETAG_FIELD }),
  description: `Replace a content fragment entirely (PUT). Use this when changing fragment content, type, or channels. To rename or move a fragment without touching its content, patch_content_fragment is lighter-weight.

⚠ VISUAL EMAIL DESIGNER REQUIREMENT (type "html", channel "email"):
  The HTML content must use AJO's native serialization format (acr-* class
  namespace, structure/component catalog, required <head> with content-version
  meta tag). Generic HTML will force the designer into Compatibility mode,
  locking the user out of drag-and-drop editing. Call the
  get_visual_designer_requirements tool to get the full mandatory spec BEFORE
  constructing any HTML for this fragment type (it returns the exact
  structure/component catalog and required <head> you must reproduce).

PERSONALIZATION: if you are adding or changing {{ }} / {%= %} expressions, call get_personalization_syntax for the
  AJO-native syntax (and discover-personalization-paths / list_xdm_field_groups for the real attribute paths) — never
  invent functions or use JavaScript/Liquid/Jinja.

⚠ THIS IS A FULL REPLACE — THERE IS NO FIELD-LEVEL UPDATE. The AJO API has no way to patch a single content field
  (content, expression, …); PATCH only supports /name, /description, /parentFolderId. To change even ONE field you must
  resend the ENTIRE fragment. The only safe way to do that without losing data is to fetch-then-mutate:

MANDATORY WORKFLOW (do NOT skip step 1, and NEVER rebuild content from memory):
1. Call get_content_fragment FIRST to get the complete current fragment + etag. This is required every time, even for a
   tiny change — it is the source of truth for all the fields you are NOT changing.
2. Take that returned object and modify ONLY the field(s) the user asked to change. Leave the existing content/expression
   and every other field EXACTLY as returned — copy them through verbatim.
3. Call update_content_fragment with the full object (changed field + all untouched fields) + the etag.

❌ DO NOT regenerate, re-author, or reconstruct the HTML/content/expression from scratch when the user only asked to change
   one field. Re-generated content will differ from the original — losing the user's design, personalization, and Visual
   Email Designer serialization. ALWAYS round-trip the exact content you received in step 1.
   If you do not have the current fragment content in hand, you MUST call get_content_fragment before updating.

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
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId', 'etag', 'name', 'type', 'channels', 'fragment'],
    allOf: EXPRESSION_REQUIRES_SUBTYPE,
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to update' },
      etag: { type: 'string', description: 'ETag from get_content_fragment' },
      name: { type: 'string', description: 'Fragment name' },
      description: { type: 'string', description: 'Optional description' },
      type: { type: 'string', enum: ['html', 'expression'], description: 'Fragment type: html → email channel; expression → shared channel' },
      channels: FRAGMENT_CHANNELS_SCHEMA,
      fragment: FRAGMENT_CONTENT_SCHEMA,
      subType: FRAGMENT_SUBTYPE_SCHEMA,
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
  title: 'Rename or Move Content Fragment',
  outputSchema: buildOutputSchema({ etag: ETAG_FIELD }),
  description: `Rename or redescribe a content fragment — use this when changing only metadata (name, description, or parent folder), NOT content. For content, type, or channel changes, use update_content_fragment instead.

Only these paths are supported: /name, /description, /parentFolderId.

Example usage:
{
  "fragmentId": "b6d70a45-...",
  "etag": "\\"abc123\\"",
  "patches": [{ "op": "replace", "path": "/name", "value": "New Fragment Name" }]
}

Returns: { success: true }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
  title: 'Publish Content Fragment',
  outputSchema: buildOutputSchema({
    accepted: { type: 'boolean', description: 'true if the async publication request was accepted.' },
    location: { type: 'string', description: 'Status resource path for the publication request.' },
    retryAfter: { type: 'number', description: 'Suggested seconds to wait before polling get_fragment_publication_status.' }
  }),
  description: `Publish a content fragment to make it available for use in live campaigns and journeys.
Publishing freezes the fragment content. Required before activating a campaign/journey that uses this fragment.

⚠ IRREVERSIBLE — confirm with the user first. Publishing CANNOT be undone (AJO has no unpublish). Do NOT publish unless the user has explicitly asked to; in particular, publishing is NOT required to embed a fragment in a content template (a DRAFT fragment embeds and renders fine). The server enforces this: every publish call is re-confirmed with the user (via elicitation, or a WRITE_CONFIRMATION_REQUIRED confirm-and-retry gate on clients without it).

Publication is asynchronous — after calling this tool, poll get_fragment_publication_status every 5 seconds until status is "complete" or "error". Publication typically finishes within 30 seconds; if still "inProgress" after 6 polls (~30 s), stop and tell the user it is taking longer than expected.

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, accepted: true, location: "...", retryAfter: 5 }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
  title: 'Get Live (Published) Fragment',
  outputSchema: buildOutputSchema({ data: FRAGMENT_OBJECT }),
  description: `Fetch the content of a fragment's last successful publication.
Use this to retrieve the frozen/published version of a fragment that is live in campaigns. This is NOT the current editable fragment — for that (including unpublished draft changes) and its etag, use get_content_fragment instead.

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { type: "html", fragment: { content: "<div>...</div>" } } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
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
  title: 'Get Fragment Publication Status',
  outputSchema: buildOutputSchema({
    data: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Current publication state — typically "inProgress", "complete", or "error" (passthrough of the AJO API value).' },
        errors: { type: 'array', description: 'Populated when status is "error".' }
      }
    }
  }),
  description: `Check the status of the last publication request for a content fragment.
Use this after publish_content_fragment to track the async publication process.

Status values:
- "inProgress": Publication is still processing
- "complete": Fragment is published and live
- "error": Publication failed (check errors array)

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { status: "complete"|"inProgress"|"error", errors: [] } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
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
  title: 'Archive Content Fragment',
  outputSchema: buildOutputSchema({
    id: { type: 'string', description: 'UUID of the archived fragment.' },
    etag: { type: 'string', description: 'New ETag after archival.' }
  }),
  description: `Archive a content fragment in Adobe Journey Optimizer.
Fragments cannot be deleted via the API — archiving is the permanent equivalent. An archived fragment
is removed from the active library and can no longer be used in new campaigns or journeys.

No etag is required. This operation bypasses optimistic locking (the internal GraphQL mutation
accepts an empty etag), so no concurrent-modification check is performed. Confirm the fragment ID
is correct before proceeding — there is no undo.

Note: this operation calls an internal AJO GraphQL API (not the public REST API).

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, id: "<uuid>", etag: "<new-etag>" }`,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
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
