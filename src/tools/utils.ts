import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { toolCallCounter, toolCallDuration, createRequestLogger } from '../telemetry/index.js';

// Base URL for the server's config UI. Override with MCP_UI_BASE_URL in hosted
// deployments where the UI is not at localhost (e.g. a container with a proxy).
export const UI_BASE_URL = process.env.MCP_UI_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;

export function notConfiguredError() {
  return {
    success: false,
    error: {
      code: 'NOT_CONFIGURED',
      message: `MCP server is not configured. Open ${UI_BASE_URL} in your browser, upload your credentials JSON file, and enter your sandbox name to get started.`,
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
export const ETAG_FIELD = { type: 'string' as const, description: 'Current ETag — pass it back verbatim (including its surrounding double quotes) to a subsequent update/patch for optimistic locking.' };
export const WARNINGS_FIELD = {
  type: 'array' as const,
  items: { type: 'string' as const },
  description: 'Non-fatal advisories about a write that still succeeded — e.g. the email HTML is not in AJO native format and will open in Compatibility mode (drag-and-drop editing lost). Present only when there is something to flag.'
};

// Detect whether submitted email HTML uses AJO's native Visual Email Designer
// serialization. Generic HTML is legal but silently drops the user into
// Compatibility mode (no drag-and-drop) — a degradation the API never signals.
// We can't block the write (per spec), but we surface a warning so the model can
// recover. Markers: the required content-version <meta> tag and the acr-* class
// namespace the designer emits. Returns null when the HTML looks native (or there
// is no HTML to check).
export function compatibilityModeWarning(html: unknown): string | null {
  if (typeof html !== 'string' || !html.trim()) return null;
  const hasContentVersion = /content-version/i.test(html);
  const hasAcrClass = /\bacr-/.test(html);
  if (hasContentVersion && hasAcrClass) return null;
  const missing = [
    !hasContentVersion ? 'the content-version <meta> tag' : null,
    !hasAcrClass ? 'acr-* component classes' : null
  ].filter(Boolean).join(' and ');
  return `The email HTML is not in AJO's native Visual Email Designer format (missing ${missing}). ` +
    `It saved and will render, but the template opens in Compatibility mode and the user loses drag-and-drop editing. ` +
    `Call get_visual_designer_requirements for the required structure and reproduce it to keep the design editable.`;
}

// Estimate the on-the-wire byte size of the MCP tool result for a `{ success, ... }`
// envelope, modeling toToolResult (in mcp/server.ts): a pretty-printed text content
// block PLUS a compact structuredContent copy. The ~1 MB transport cap applies to
// THIS encoded result, not the raw resolved object — and when the whole result is
// JSON-encoded for transport, the pretty JSON inside the text block has its quotes
// and newlines escaped again, inflating it substantially. A size guard must compare
// against this number (and report it) so the cited size and the cited limit agree.
export function encodedToolResultSize(envelope: unknown): number {
  const toolResult = {
    content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope
  };
  return Buffer.byteLength(JSON.stringify(toolResult), 'utf8');
}

// Scan a serialized content payload for data-fragment="..." references and split
// them into well-formed embeds (a required ajo:/aem:/external: prefix + UUID) and
// malformed ones (e.g. a bare UUID with no prefix). AJO accepts a malformed embed
// at write time but it fails later at render ("Forbidden: fragment URI syntax is
// incorrect"), so the server flags it. Scanning the JSON form (quotes escaped as
// \") avoids having to know which per-channel field holds the HTML. De-duplicated;
// the source prefix is preserved.
const FRAGMENT_UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const DATA_FRAGMENT_VALUE_RE = /data-fragment=\\?"([^"\\]+)\\?"/g;
const VALID_FRAGMENT_REF_RE = new RegExp(`^(ajo|aem|external):(${FRAGMENT_UUID})$`);

export interface FragmentRef { reference: string; source: string; id: string; }

export function scanDataFragments(data: unknown): { embedded: FragmentRef[]; malformed: string[] } {
  let serialized: string;
  try {
    serialized = JSON.stringify(data) ?? '';
  } catch {
    return { embedded: [], malformed: [] };
  }
  const embedded: FragmentRef[] = [];
  const malformed: string[] = [];
  const seenEmbed = new Set<string>();
  const seenBad = new Set<string>();
  let m: RegExpExecArray | null;
  DATA_FRAGMENT_VALUE_RE.lastIndex = 0;
  while ((m = DATA_FRAGMENT_VALUE_RE.exec(serialized)) !== null) {
    const value = m[1];
    const valid = VALID_FRAGMENT_REF_RE.exec(value);
    if (valid) {
      if (!seenEmbed.has(value)) { seenEmbed.add(value); embedded.push({ reference: value, source: valid[1], id: valid[2] }); }
    } else if (!seenBad.has(value)) {
      seenBad.add(value);
      malformed.push(value);
    }
  }
  return { embedded, malformed };
}

// Build warnings[] entries for any malformed (prefix-less) data-fragment embeds.
export function malformedFragmentWarnings(data: unknown): string[] {
  return scanDataFragments(data).malformed.map(v =>
    `data-fragment value "${v}" is missing a required ajo:/aem:/external: prefix; this embed will fail at render ` +
    `(Forbidden: fragment URI syntax is incorrect). See get_visual_designer_requirements.`);
}

// JSON-Patch paths whose target member may not exist yet on a content object
// (a freshly created fragment/template has no parentFolderId, tagIds, or labels).
// Per RFC 6902 `replace` requires the member to already exist, so AJO rejects it
// with an opaque "Bad Patch request."; `add` creates-or-overwrites and always works.
const ADD_PREFERRED_PATHS = ['/parentFolderId', '/tagIds', '/labels'];

// Rewrite `replace` → `add` for the may-not-exist metadata paths above, so the
// patch_ tools are forgiving and deterministic regardless of which op the caller
// reached for (the reviewer hit "Bad Patch request." using replace on /parentFolderId).
// `add` on an existing member overwrites it, so this never changes the outcome for a
// member that does exist. Other ops/paths pass through untouched.
export function normalizeMetadataPatches<T extends { op?: string; path?: string }>(patches: T[]): T[] {
  return patches.map(p => {
    if (p.op === 'replace' && typeof p.path === 'string' &&
        ADD_PREFERRED_PATHS.some(pre => p.path === pre || p.path!.startsWith(pre + '/'))) {
      return { ...p, op: 'add' };
    }
    return p;
  });
}

// Standard pagination envelope, shared by every list result.
const PAGE_PROPS = {
  type: 'object' as const,
  // count/next come straight from the API; tolerate null (some endpoints
  // express "no next page" as next: null rather than by omission).
  properties: { count: { type: ['number', 'null'] }, next: { type: ['string', 'number', 'null'], description: 'Cursor for the next page; pass as `start`. Content APIs return a base64 string; XDM/Schema Registry returns a number. Null or absent on the last page.' } }
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
