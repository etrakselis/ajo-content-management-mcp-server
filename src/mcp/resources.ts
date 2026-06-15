// Shared definitions for the server's static resources.
//
// The text bodies live here (rather than inline in the ReadResource handler) so
// that prompts can embed the same canonical content directly as resource blocks
// — the model then has the reference inline when running a prompt instead of
// having to decide to fetch it separately. server.ts owns the dynamic
// ajo://server/status body (it reads live auth/config), so only its descriptor
// lives here, not its text.

export const RESOURCE_URIS = {
  serverStatus: 'ajo://server/status',
  channelReference: 'ajo://sandbox/channel-reference',
  errorCodes: 'ajo://error-codes',
  // Browsable collections: name→id directories so a human/client can find a
  // specific object by name, then drill into ajo://fragment/{id} or
  // ajo://template/{id}. Solves the discovery half that the templated
  // resolve-by-id resources can't (nobody knows a fragment's UUID by heart).
  fragments: 'ajo://fragments',
  templates: 'ajo://templates'
} as const;

// Descriptors advertised by ListResources. `title` is the human-friendly display
// name (2025-06-18 spec); `name` stays the stable programmatic identifier.
export const RESOURCE_DESCRIPTORS = [
  {
    uri: RESOURCE_URIS.serverStatus,
    name: 'server-status',
    title: 'Server Status & Authentication',
    description: 'Current configuration and authentication status',
    mimeType: 'application/json'
  },
  {
    uri: RESOURCE_URIS.channelReference,
    name: 'channel-reference',
    title: 'Channel & Content-Type Reference',
    description: 'Maps AJO channels to valid templateType values, required template/fragment content shapes, and subType options. Read this before constructing create or update payloads.',
    mimeType: 'text/plain'
  },
  {
    uri: RESOURCE_URIS.errorCodes,
    name: 'error-codes',
    title: 'Error Code Reference',
    description: 'All error codes this server can return, with their cause and the correct recovery action for each.',
    mimeType: 'text/plain'
  },
  {
    uri: RESOURCE_URIS.fragments,
    name: 'content-fragments',
    title: 'Content Fragments (Directory)',
    description: 'Browsable directory of content fragments in the sandbox (name, id, type, status, and a ajo://fragment/{id} resource link for each). Use this to find a fragment by name before reading it. Results cap at 5,000 items; if truncated, the response includes truncated: true and a next cursor you can pass to list_content_fragments to retrieve more.',
    mimeType: 'application/json'
  },
  {
    uri: RESOURCE_URIS.templates,
    name: 'content-templates',
    title: 'Content Templates (Directory)',
    description: 'Browsable directory of content templates in the sandbox (name, id, templateType, channels, and a ajo://template/{id} resource link for each). Use this to find a template by name before reading it. Results cap at 5,000 items; if truncated, the response includes truncated: true and a next cursor you can pass to list_content_templates to retrieve more.',
    mimeType: 'application/json'
  }
] as const;

// ─── Dynamic (templated) resources ──────────────────────────────────────────
// Individual content objects addressable by UUID, so a client/user can attach a
// specific fragment or template as context (e.g. via @-mention) instead of going
// through a tool round-trip. The {id} variable is the object's UUID. Advertised
// by ListResourceTemplates; resolved in the ReadResource handler. The body is the
// same { data, etag } shape the get_* tools return, so the etag is available for a
// follow-up update/patch without a separate fetch.

export const RESOURCE_TEMPLATE_URIS = {
  fragment: 'ajo://fragment/{id}',
  template: 'ajo://template/{id}'
} as const;

export const RESOURCE_TEMPLATE_DESCRIPTORS = [
  {
    uriTemplate: RESOURCE_TEMPLATE_URIS.fragment,
    name: 'content-fragment',
    title: 'Content Fragment by ID',
    description: 'A single content fragment by its UUID, as JSON ({ data, etag }). Use list_content_fragments to discover IDs. The etag is required for update/patch.',
    mimeType: 'application/json'
  },
  {
    uriTemplate: RESOURCE_TEMPLATE_URIS.template,
    name: 'content-template',
    title: 'Content Template by ID',
    description: 'A single content template by its UUID, as JSON ({ data, etag }). Use list_content_templates to discover IDs. The etag is required for update/patch.',
    mimeType: 'application/json'
  }
] as const;

const FRAGMENT_URI_RE = /^ajo:\/\/fragment\/([^/]+)$/;
const TEMPLATE_URI_RE = /^ajo:\/\/template\/([^/]+)$/;

// Extract the UUID from a templated resource URI, or null if the URI is not of
// that kind. The id is URI-decoded so percent-encoded values resolve correctly.
export function parseFragmentUri(uri: string): string | null {
  const m = FRAGMENT_URI_RE.exec(uri);
  return m ? decodeURIComponent(m[1]) : null;
}

export function parseTemplateUri(uri: string): string | null {
  const m = TEMPLATE_URI_RE.exec(uri);
  return m ? decodeURIComponent(m[1]) : null;
}

export const CHANNEL_REFERENCE_TEXT = `AJO Content Type & Channel Reference
======================================
Read this before constructing create or update payloads to avoid validation errors.

━━━ TEMPLATES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

templateType "html" — Full HTML email
  channels:  ["email"]
  template:  { "html": "<html>...</html>" }
  subType:   n/a

templateType "html_primary_page" — Landing page (main page)
  channels:  ["landingpage"]
  template:  { "html": "<html>...</html>" }
  subType:   n/a

templateType "html_sub_page" — Landing page (sub-page / confirmation)
  channels:  ["landingpage"]
  template:  { "html": "<html>...</html>" }
  subType:   n/a

templateType "content" — Structured content (all non-HTML channels)
  Push notification:
    channels:  ["push"]
    template:  { "title": "...", "message": "...", "deeplink": "..." }
  SMS:
    channels:  ["sms"]
    template:  { "body": "..." }
  In-app message:
    channels:  ["inapp"]
    template:  { "header": "...", "body": "...", "buttonText": "...", "buttonLink": "..." }
  Code-based experience:
    channels:  ["code"]
    template:  { ... }  (shape is app-defined)
    subType:   "HTML" | "JSON"
  Direct mail:
    channels:  ["directMail"]
    template:  { ... }  (shape is provider-defined)
  Shared (multi-channel):
    channels:  ["shared"]
    template:  { ... }

━━━ FRAGMENTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type "html" — Reusable HTML block embedded in email templates
  channels:  ["email"]
  fragment:  { "content": "<div>...</div>" }
  subType:   n/a

type "expression" — Reusable expression / helper text
  channels:  ["shared"]
  fragment:  { "expression": "..." }
  subType:   "TEXT" | "HTML" | "JSON"

━━━ RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• channels must be an array with exactly 1 value.
• subType is only valid on templateType "content" + channel "code", and on fragment type "expression".
• Personalization expressions go inside the template/fragment content strings.
  Do NOT use guessed XDM paths. Use list_xdm_field_groups / get_xdm_union_schema to find
  real attribute paths for this sandbox before inserting {{ }} expressions.`;

export const ERROR_CODES_TEXT = `AJO Content MCP — Error Code Reference
========================================

NOT_CONFIGURED
  Cause:    Server has no credentials or sandbox configured yet.
  Recovery: Ask the user to open http://localhost:3000, upload their credentials JSON,
            and enter the sandbox name. Do not retry the tool until they confirm setup is done.

READ_ONLY_MODE
  Cause:    A write operation was attempted while the server is in read-only mode.
  Recovery: Tell the user they can enable write access at http://localhost:3000, then
            retry the exact same operation once they confirm it is enabled. Do not abandon
            the request — just wait for the user to flip the toggle.

WRITE_CANCELLED
  Cause:    The server asked the user to confirm the write (its target sandbox/tenant)
            and the user declined or dismissed the confirmation prompt. The operation was
            NOT performed.
  Recovery: Do not retry the write. Acknowledge that the change was cancelled and ask the
            user how they would like to proceed (e.g. confirm the intended sandbox). Only
            attempt the operation again if the user explicitly asks for it.

VALIDATION_ERROR
  Cause:    Either (a) the tool was called with invalid/missing input parameters (Zod
            validation), or (b) the AJO API rejected the request body (HTTP 400).
  Recovery: For (a): check the "details" array — each entry has a "path" and "message"
            identifying which field is wrong. Fix the input and retry.
            For (b): check the "message" and "details" from the API response for specifics.

UNAUTHORIZED  (HTTP 401)
  Cause:    The IMS access token is missing, expired, or was rejected by the API.
  Recovery: The server auto-refreshes tokens; if this error persists, the stored
            credentials may be invalid. Ask the user to reconfigure at http://localhost:3000.

FORBIDDEN  (HTTP 403)
  Cause:    The API key or service account does not have permission for this operation
            on this sandbox, OR the AEP Schema Registry API is not added to the
            Developer Console project (common cause of 403 on XDM schema tools).
  Recovery: For content tools: ask the user to verify their API key has the correct
            product profiles in Adobe Developer Console.
            For XDM schema tools: ask the user to add the "Experience Platform API"
            to their Developer Console project and regenerate credentials.

NOT_FOUND  (HTTP 404)
  Cause:    The requested resource (template, fragment, schema) does not exist, or the
            ID is wrong, or it belongs to a different sandbox.
  Recovery: Verify the ID is correct. If listing first, check the current sandbox
            (shown in the [org | tenant | sandbox] prefix of every tool response).
            The user may need to switch sandboxes.

CONFLICT  (HTTP 409)
  Cause:    The ETag supplied to an update or patch operation is stale — another process
            modified the resource after you fetched it.
  Recovery: Re-fetch the resource with get_content_template or get_content_fragment to
            get the current data and a fresh ETag, then reapply the intended changes and
            retry the update. Do not reuse the old ETag.

API_ERROR  (any other HTTP error)
  Cause:    An unexpected HTTP status code was returned by the AJO API (e.g. 429, 500,
            503). The "message" field contains the API's own error description.
  Recovery: For 429 (rate limit): wait a moment and retry.
            For 5xx: the AJO service may be temporarily unavailable; retry once, then
            tell the user if it persists.

INTERNAL_ERROR
  Cause:    An unexpected exception occurred inside the MCP server itself (not an API
            error). The "message" field has the raw exception message.
  Recovery: This is likely a bug. Tell the user what happened and suggest they check
            the server logs (docker logs <container>) for more detail.

TOOL_NOT_FOUND
  Cause:    The tool name in the request does not match any registered handler.
  Recovery: This should not occur in normal use. If it does, the client may be using a
            stale tool list — reconnect the MCP client to refresh.`;
