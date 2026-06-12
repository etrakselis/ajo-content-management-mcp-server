import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  listTemplates, createTemplate, getTemplate,
  updateTemplate, patchTemplate, deleteTemplate,
  buildError, isClientConfigured
} from '../adobe/client.js';
import {
  ListTemplatesSchema, CreateTemplateSchema, GetTemplateSchema,
  UpdateTemplateSchema, PatchTemplateSchema, DeleteTemplateSchema
} from '../validation/schemas.js';
import { toolCallCounter, toolCallDuration, createRequestLogger } from '../telemetry/index.js';

function notConfiguredError() {
  const port = process.env.PORT || '3000';
  return {
    success: false,
    error: {
      code: 'NOT_CONFIGURED',
      message: `MCP server is not configured. Open http://localhost:${port} in your browser, upload your credentials JSON file, and enter your sandbox name to get started.`,
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

// ─── list_content_templates ───────────────────────────────────────────────────

export const listContentTemplatesDefinition = {
  name: 'list_content_templates',
  description: `List content templates from Adobe Journey Optimizer.
Returns a paginated list of all content templates in the configured sandbox.

Example usage:
- List all templates: {}
- Paginated: { limit: 10 }
- Filter by name: { property: ["name~^MyTemplate"] }
- Sort ascending: { orderBy: "+modifiedAt" }

Returns: { _page: { count, next }, items: [{ id, name, templateType, channels, ... }] }`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: { type: 'number', description: 'Max items to return (1-1000, default 20)' },
      start: { type: 'string', description: 'Pagination cursor from previous response _page.next' },
      orderBy: { type: 'string', description: 'Sort field. Prefix with + (asc) or - (desc). E.g. "-modifiedAt"' },
      property: { type: 'array', items: { type: 'string' }, description: 'Filter expressions, e.g. ["name~^Test", "channels==email"]' }
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
  description: `Create a new content template in Adobe Journey Optimizer.

Example usage (HTML email template):
{
  "name": "Welcome Email",
  "templateType": "html",
  "channels": ["email"],
  "template": { "html": "<html>Hello {{profile.person.name}}</html>" }
}

Example usage (push notification template):
{
  "name": "Sale Push",
  "templateType": "content",
  "channels": ["push"],
  "template": { "title": "Big Sale!", "message": "50% off today only" }
}

Returns: { success: true, id: "<uuid>", location: "/templates/<uuid>" }`,
  inputSchema: {
    type: 'object' as const,
    required: ['name', 'templateType', 'channels'],
    properties: {
      name: { type: 'string', description: 'Template name (required)' },
      description: { type: 'string', description: 'Optional description' },
      templateType: { type: 'string', enum: ['html', 'html_primary_page', 'html_sub_page', 'content'], description: 'Template type' },
      channels: { type: 'array', items: { type: 'string', enum: ['email', 'push', 'inapp', 'sms', 'code', 'directMail', 'landingpage', 'shared'] }, description: 'Target channels (exactly 1)' },
      template: { type: 'object', description: 'Template content object. Shape depends on templateType/channel.' },
      subType: { type: 'string', enum: ['HTML', 'JSON'], description: 'Sub-type for code channel templates' },
      parentFolderId: { type: 'string', description: 'UUID of parent folder (optional)' },
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
  description: `Fetch a single content template by ID from Adobe Journey Optimizer.

Example usage: { "templateId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { id, name, templateType, channels, template, createdAt, modifiedAt, ... }, etag: "..." }
The etag is required for update (PUT/PATCH) operations.`,
  inputSchema: {
    type: 'object' as const,
    required: ['templateId'],
    properties: {
      templateId: { type: 'string', description: 'UUID of the template to fetch' }
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
  description: `Replace a content template entirely (PUT). Requires fetching the template first to get the etag.

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
  inputSchema: {
    type: 'object' as const,
    required: ['templateId', 'etag', 'name', 'templateType', 'channels'],
    properties: {
      templateId: { type: 'string', description: 'UUID of the template to update' },
      etag: { type: 'string', description: 'ETag from get_content_template (required for optimistic locking)' },
      name: { type: 'string', description: 'Template name' },
      description: { type: 'string' },
      templateType: { type: 'string', enum: ['html', 'html_primary_page', 'html_sub_page', 'content'] },
      channels: { type: 'array', items: { type: 'string' } },
      template: { type: 'object', description: 'Full template content' },
      subType: { type: 'string', enum: ['HTML', 'JSON'] },
      parentFolderId: { type: 'string' },
      source: { type: 'object' }
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
  description: `Partially update a content template using JSON Patch (RFC 6902). Only /name, /description, /parentFolderId are supported paths.

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
  inputSchema: {
    type: 'object' as const,
    required: ['templateId', 'etag', 'patches'],
    properties: {
      templateId: { type: 'string', description: 'UUID of the template to patch' },
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
  description: `Delete a content template permanently by ID.

⚠️ This action is irreversible.

Example usage: { "templateId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true }`,
  inputSchema: {
    type: 'object' as const,
    required: ['templateId'],
    properties: {
      templateId: { type: 'string', description: 'UUID of the template to delete' }
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
