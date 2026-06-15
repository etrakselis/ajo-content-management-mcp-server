import {
  listTemplates, createTemplate, getTemplate,
  updateTemplate, patchTemplate, deleteTemplate,
  buildError, isClientConfigured
} from '../adobe/client.js';
import {
  ListTemplatesSchema, CreateTemplateSchema, GetTemplateSchema,
  UpdateTemplateSchema, PatchTemplateSchema, DeleteTemplateSchema
} from '../validation/schemas.js';
import { notConfiguredError, validationError, withTelemetry, buildOutputSchema, ETAG_FIELD, TEMPLATE_OBJECT, TEMPLATE_LIST } from './utils.js';

// ─── list_content_templates ───────────────────────────────────────────────────

export const listContentTemplatesDefinition = {
  name: 'list_content_templates',
  title: 'List Content Templates',
  outputSchema: buildOutputSchema({ data: TEMPLATE_LIST }),
  description: `Browse or list existing content templates in the configured Adobe Journey Optimizer sandbox.
Returns a paginated list, with optional filtering by name, channel, or templateType and sorting by date.

Example usage:
- List all templates: {}
- Paginated: { limit: 10 }
- Filter by name: { property: ["name~^MyTemplate"] }
- Sort ascending: { orderBy: "+modifiedAt" }

Returns: { _page: { count, next }, items: [{ id, name, templateType, channels, ... }] }`,
  annotations: { title: 'List Content Templates', readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      limit: { type: 'number', description: 'Max items to return (1-1000, default 20)' },
      start: { type: 'string', description: 'Pagination cursor from previous response _page.next' },
      orderBy: { type: 'string', description: 'Sort field. Prefix with + (asc) or - (desc). E.g. "-modifiedAt"' },
      property: { type: 'array', items: { type: 'string' }, description: 'FIQL filter expressions. Operators: == (equals), != (not equals), ~^ (starts with), ~ (contains). E.g. ["name~^Test", "channels==email", "templateType==html"]' }
    }
  }
};

export async function handleListContentTemplates(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('list_content_templates', async () => {
    const parsed = ListTemplatesSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await listTemplates(parsed.data);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── create_content_template ──────────────────────────────────────────────────

export const createContentTemplateDefinition = {
  name: 'create_content_template',
  title: 'Create Content Template',
  outputSchema: buildOutputSchema({
    id: { type: 'string', description: 'UUID of the newly created template.' },
    location: { type: 'string', description: 'Relative path of the new template, e.g. /templates/<uuid>.' }
  }),
  description: `Create a new content template in Adobe Journey Optimizer.

Channel → templateType → template shape (channels must have exactly 1 value):
  "email"       → "html"               → { "html": "<html>..." }
  "push"        → "content"            → { "title": "...", "message": "...", "deeplink": "..." }
  "sms"         → "content"            → { "body": "..." }
  "inapp"       → "content"            → { "header": "...", "body": "...", "buttonText": "...", "buttonLink": "..." }
  "code"        → "content" + subType  → { ... }  subType: "HTML" or "JSON"
  "directMail"  → "content"            → { ... }  (shape is provider-defined)
  "landingpage" → "html_primary_page"  → { "html": "<html>..." }  (or "html_sub_page" for confirmation pages)
  "shared"      → "content"            → { ... }

Example usage (HTML email template):
{
  "name": "Welcome Email",
  "templateType": "html",
  "channels": ["email"],
  "template": { "html": "<html>Hello {{_yourtenant.person.firstName}}</html>" }
}
Note: _yourtenant is a placeholder — use the 'discover-personalization-paths' prompt for a guided lookup, or call list_xdm_field_groups directly, to find the real attribute paths before inserting any personalization.

Example usage (push notification template):
{
  "name": "Sale Push",
  "templateType": "content",
  "channels": ["push"],
  "template": { "title": "Big Sale!", "message": "50% off today only" }
}

Returns: { success: true, id: "<uuid>", location: "/templates/<uuid>" }`,
  annotations: { title: 'Create Content Template', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['name', 'templateType', 'channels'],
    properties: {
      name: { type: 'string', description: 'Template name (required)' },
      description: { type: 'string', description: 'Optional description' },
      templateType: { type: 'string', enum: ['html', 'html_primary_page', 'html_sub_page', 'content'], description: 'Template type' },
      channels: { type: 'array', items: { type: 'string', enum: ['email', 'push', 'inapp', 'sms', 'code', 'directMail', 'landingpage', 'shared'] }, minItems: 1, maxItems: 1, description: 'Target channel (exactly 1 value required)' },
      template: { type: 'object', description: 'Template content object. Shape depends on templateType/channel.' },
      subType: { type: 'string', enum: ['HTML', 'JSON'], description: 'Sub-type for code channel templates' },
      parentFolderId: { type: 'string', format: 'uuid', description: 'UUID of parent folder (optional)' },
      source: { type: 'object', description: 'Source/origin metadata { origin: "ajo"|"aem"|"external" }' }
    }
  }
};

export async function handleCreateContentTemplate(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('create_content_template', async () => {
    const parsed = CreateTemplateSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const result = await createTemplate(parsed.data);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── get_content_template ─────────────────────────────────────────────────────

export const getContentTemplateDefinition = {
  name: 'get_content_template',
  title: 'Get Content Template',
  outputSchema: buildOutputSchema({ data: TEMPLATE_OBJECT, etag: ETAG_FIELD }),
  description: `Fetch a single content template by ID from Adobe Journey Optimizer.

Example usage: { "templateId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { id, name, templateType, channels, template, createdAt, modifiedAt, ... }, etag: "..." }
The etag is required for update (PUT/PATCH) operations.`,
  annotations: { title: 'Get Content Template', readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['templateId'],
    properties: {
      templateId: { type: 'string', format: 'uuid', description: 'UUID of the template to fetch' }
    }
  }
};

export async function handleGetContentTemplate(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_content_template', async () => {
    const parsed = GetTemplateSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const result = await getTemplate(parsed.data.templateId);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── update_content_template ──────────────────────────────────────────────────

export const updateContentTemplateDefinition = {
  name: 'update_content_template',
  title: 'Update Content Template (Replace)',
  outputSchema: buildOutputSchema({ etag: ETAG_FIELD }),
  description: `Replace a content template entirely (PUT). Use this when changing template content, type, or channels. To rename or move a template without touching its content, patch_content_template is lighter-weight.

Channel → templateType → template shape (channels must have exactly 1 value):
  "email"       → "html"               → { "html": "<html>..." }
  "push"        → "content"            → { "title": "...", "message": "...", "deeplink": "..." }
  "sms"         → "content"            → { "body": "..." }
  "inapp"       → "content"            → { "header": "...", "body": "...", "buttonText": "...", "buttonLink": "..." }
  "code"        → "content" + subType  → { ... }  subType: "HTML" or "JSON"
  "directMail"  → "content"            → { ... }
  "landingpage" → "html_primary_page"  → { "html": "<html>..." }  (or "html_sub_page")
  "shared"      → "content"            → { ... }

Workflow:
1. Call get_content_template to get current data + etag
2. Modify the data
3. Call update_content_template with all fields + etag

Example usage:
{
  "templateId": "b6d70a45-...",
  "etag": "\\"abc123\\"",
  "name": "Updated Template Name",
  "templateType": "html",
  "channels": ["email"],
  "template": { "html": "<html>Updated content</html>" }
}

Returns: { success: true }`,
  annotations: { title: 'Update Content Template (Replace)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['templateId', 'etag', 'name', 'templateType', 'channels'],
    properties: {
      templateId: { type: 'string', format: 'uuid', description: 'UUID of the template to update' },
      etag: { type: 'string', description: 'ETag from get_content_template (required for optimistic locking)' },
      name: { type: 'string', description: 'Template name' },
      description: { type: 'string', description: 'Optional description' },
      templateType: { type: 'string', enum: ['html', 'html_primary_page', 'html_sub_page', 'content'], description: 'Template type — must match the channel (email→html, push/sms/inapp/code→content, landingpage→html_primary_page or html_sub_page)' },
      channels: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 1, description: 'Target channel (exactly 1 value required)' },
      template: { type: 'object', description: 'Full replacement template content. Shape depends on channel: email→{html}, push→{title,message}, sms→{body}, inapp→{header,body}, code→{}+subType' },
      subType: { type: 'string', enum: ['HTML', 'JSON'], description: 'Sub-type for code channel templates' },
      parentFolderId: { type: 'string', format: 'uuid', description: 'UUID of parent folder' },
      source: { type: 'object', description: 'Source/origin metadata { origin: "ajo"|"aem"|"external" }' }
    }
  }
};

export async function handleUpdateContentTemplate(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('update_content_template', async () => {
    const parsed = UpdateTemplateSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    const { templateId, etag, ...payload } = parsed.data;
    try {
      const result = await updateTemplate(templateId, payload, etag);
      return { ...result, success: true };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── patch_content_template ───────────────────────────────────────────────────

export const patchContentTemplateDefinition = {
  name: 'patch_content_template',
  title: 'Rename or Move Content Template',
  outputSchema: buildOutputSchema({ data: TEMPLATE_OBJECT, etag: ETAG_FIELD }),
  description: `Rename or redescribe a content template — use this when changing only metadata (name, description, or parent folder), NOT content. For content, type, or channel changes, use update_content_template instead.

Only these paths are supported: /name, /description, /parentFolderId.

Example usage:
{
  "templateId": "b6d70a45-...",
  "etag": "\\"abc123\\"",
  "patches": [
    { "op": "replace", "path": "/name", "value": "New Name" },
    { "op": "replace", "path": "/description", "value": "Updated description" }
  ]
}

Returns: { success: true, data: { updated template }, etag: "new-etag" }`,
  annotations: { title: 'Rename or Move Content Template', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['templateId', 'etag', 'patches'],
    properties: {
      templateId: { type: 'string', format: 'uuid', description: 'UUID of the template to patch' },
      etag: { type: 'string', description: 'ETag from get_content_template' },
      patches: {
        type: 'array',
        description: 'Array of JSON Patch operations',
        items: {
          type: 'object',
          required: ['op', 'path'],
          properties: {
            op: { type: 'string', enum: ['add', 'remove', 'replace'] },
            path: { type: 'string', description: 'Supported: /name, /description, /parentFolderId' },
            value: { description: 'New value (required for add/replace)' }
          }
        }
      }
    }
  }
};

export async function handlePatchContentTemplate(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('patch_content_template', async () => {
    const parsed = PatchTemplateSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    const { templateId, etag, patches } = parsed.data;
    try {
      const result = await patchTemplate(templateId, patches, etag);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── delete_content_template ──────────────────────────────────────────────────

export const deleteContentTemplateDefinition = {
  name: 'delete_content_template',
  title: 'Delete Content Template',
  outputSchema: buildOutputSchema(),
  description: `Delete a content template permanently by ID.

⚠️ This action is irreversible.

Example usage: { "templateId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true }`,
  annotations: { title: 'Delete Content Template', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['templateId'],
    properties: {
      templateId: { type: 'string', format: 'uuid', description: 'UUID of the template to delete' }
    }
  }
};

export async function handleDeleteContentTemplate(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('delete_content_template', async () => {
    const parsed = DeleteTemplateSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const result = await deleteTemplate(parsed.data.templateId);
      return { ...result, success: true };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}
