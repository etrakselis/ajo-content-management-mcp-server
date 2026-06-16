import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { toolCallCounter, toolCallDuration, createRequestLogger } from '../telemetry/index.js';

export function notConfiguredError() {
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

export function validationError(err: z.ZodError) {
  return {
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input parameters',
      details: err.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
    }
  };
}

// ─── Output schemas (MCP structuredContent contract) ────────────────────────
// Every tool resolves to a common envelope: { success: boolean } plus either
// success fields or an `error` object. Declaring an outputSchema lets the host
// validate results and lets the model rely on a typed contract instead of
// inferring shape from the description prose. The central CallTool handler
// returns the same object as `structuredContent`, so these schemas describe it.

const ERROR_OUTPUT_SCHEMA = {
  type: 'object' as const,
  description: 'Present when success is false. The code + message describe the failure; for fuller recovery guidance per code see the Error Code Reference (listed, with how to read it, in get_server_context\'s resource catalog).',
  properties: {
    code: { type: 'string', description: 'Machine-readable error code (e.g. VALIDATION_ERROR, NOT_FOUND, CONFLICT, READ_ONLY_MODE)' },
    message: { type: 'string', description: 'Human-readable error description' },
    details: { description: 'Optional structured detail; for VALIDATION_ERROR this is an array of { path, message }' }
  },
  required: ['code', 'message']
};

/**
 * Build a tool outputSchema for the standard `{ success, ...fields, error }`
 * envelope. `successProps` describes the fields present on success; `error` is
 * always optional and `success` always required, so the schema is satisfied by
 * both the success and error branches.
 */
export function buildOutputSchema(successProps: Record<string, unknown> = {}) {
  return {
    type: 'object' as const,
    properties: {
      success: { type: 'boolean', description: 'true if the operation succeeded; false if `error` is populated' },
      ...successProps,
      error: ERROR_OUTPUT_SCHEMA
    },
    required: ['success']
  };
}

// Reusable success-field fragments.
export const DATA_OBJECT = { type: 'object' as const, description: 'Operation result payload (passthrough of the AJO API response).' };
export const ETAG_FIELD = { type: 'string' as const, description: 'Current ETag — pass to a subsequent update/patch for optimistic locking.' };

// Standard pagination envelope, shared by every list result.
const PAGE_PROPS = {
  type: 'object' as const,
  // count/next come straight from the API; tolerate null (some endpoints
  // express "no next page" as next: null rather than by omission).
  properties: { count: { type: ['number', 'null'] }, next: { type: ['string', 'null'], description: 'Cursor for the next page; pass as `start`. Null or absent on the last page.' } }
};

// Generic list result — used by the XDM/Schema-Registry tools whose item shapes
// vary by container and aren't worth enumerating. Content tools use the typed
// FRAGMENT_LIST / TEMPLATE_LIST below instead.
export const LIST_DATA = {
  type: 'object' as const,
  description: 'Paginated list result.',
  properties: { _page: PAGE_PROPS, items: { type: 'array', items: { type: 'object' } } }
};

// ─── Typed content-object schemas ───────────────────────────────────────────
// The known fields on a content fragment / template. These are a passthrough of
// the AJO API object, so MORE fields may be present — the schemas are kept loose
// on purpose: no `required`, no enums, no `additionalProperties: false`. That
// gives the model a typed contract for the fields it actually uses (id, name,
// status, channels, …) while guaranteeing the host's structuredContent
// validation never fails because the API added or omitted a field, or returned a
// status value outside an enum we hard-coded. Common values are documented in
// the field descriptions instead.

const FRAGMENT_PROPS = {
  id: { type: 'string', description: 'Fragment UUID.' },
  name: { type: 'string', description: 'Fragment name.' },
  type: { type: 'string', description: 'Fragment type: "html" or "expression".' },
  status: { type: 'string', description: 'Lifecycle status. Typical values: DRAFT, PUBLISHED, PUBLISHING, ARCHIVED.' },
  channels: { type: 'array', items: { type: 'string' }, description: 'Target channels (exactly one), e.g. ["email"] (html) or ["shared"] (expression).' },
  fragment: { type: 'object', description: 'Content payload. html: { content: "..." }; expression: { expression: "..." }.' },
  subType: { type: 'string', description: 'Sub-type for expression fragments: TEXT | HTML | JSON.' },
  description: { type: 'string', description: 'Optional description.' },
  createdAt: { type: 'string', description: 'ISO-8601 creation timestamp.' },
  modifiedAt: { type: 'string', description: 'ISO-8601 last-modified timestamp.' }
} as const;

const TEMPLATE_PROPS = {
  id: { type: 'string', description: 'Template UUID.' },
  name: { type: 'string', description: 'Template name.' },
  templateType: { type: 'string', description: 'Template type: html | html_primary_page | html_sub_page | content.' },
  channels: { type: 'array', items: { type: 'string' }, description: 'Target channels (exactly one), e.g. ["email"], ["push"], ["sms"].' },
  template: { type: 'object', description: 'Content payload; shape depends on channel/templateType (the channel→templateType→shape mapping is in the create_/update_content_template tool descriptions).' },
  subType: { type: 'string', description: 'Sub-type for code-based content templates: HTML | JSON.' },
  description: { type: 'string', description: 'Optional description.' },
  createdAt: { type: 'string', description: 'ISO-8601 creation timestamp.' },
  modifiedAt: { type: 'string', description: 'ISO-8601 last-modified timestamp.' }
} as const;

const listSchemaOf = (itemProps: Record<string, unknown>, label: string) => ({
  type: 'object' as const,
  description: `Paginated ${label} list result.`,
  properties: { _page: PAGE_PROPS, items: { type: 'array', items: { type: 'object', properties: itemProps } } }
});

export const FRAGMENT_OBJECT = {
  type: 'object' as const,
  description: 'A content fragment (passthrough of the AJO API object; may include additional fields).',
  properties: FRAGMENT_PROPS
};

export const TEMPLATE_OBJECT = {
  type: 'object' as const,
  description: 'A content template (passthrough of the AJO API object; may include additional fields).',
  properties: TEMPLATE_PROPS
};

export const FRAGMENT_LIST = listSchemaOf(FRAGMENT_PROPS, 'content fragment');
export const TEMPLATE_LIST = listSchemaOf(TEMPLATE_PROPS, 'content template');

export async function withTelemetry<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
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
