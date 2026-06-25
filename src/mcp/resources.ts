// Shared definitions for the server's static resources.
//
// The text bodies live here (rather than inline in the ReadResource handler) so
// that prompts can embed the same canonical content directly as resource blocks
// — the model then has the reference inline when running a prompt instead of
// having to decide to fetch it separately. server.ts owns the dynamic
// ajo://server/status body (it reads live auth/config), so only its descriptor
// lives here, not its text.

import { UI_BASE_URL } from '../tools/utils.js';

export const RESOURCE_URIS = {
  serverStatus: 'ajo://server/status',
  channelReference: 'ajo://sandbox/channel-reference',
  errorCodes: 'ajo://error-codes',
  visualDesignerRequirements: 'ajo://visual-designer-requirements',
  aemImageEmbedInstructions: 'ajo://aem-image-embed-instructions',
  personalizationSyntax: 'ajo://personalization-syntax',
  personalizationGuidance: 'ajo://personalization-guidance',
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
  // ajo://visual-designer-requirements is intentionally not advertised here: it
  // stays readable by URI (ReadResource handler) and is embedded directly into
  // the create-content prompt + summarized in the four write tools' descriptions,
  // so the visual-designer rules reach the model without needing a picker entry.
  // (Listing it is optional and unrelated to the picker/SSE behavior — re-add a
  // descriptor here if human-attachable discovery is wanted.)
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

// Model-facing routing map of every resource this server exposes, plus HOW the
// model can actually obtain each. Surfaced through get_server_context because some
// clients (e.g. Claude Desktop) don't let the model enumerate or read MCP
// resources directly — so listing them in a tool result is the only reliable way
// to make the model aware of the full resource surface and route it to a callable
// path. Keep each `access` hint honest: name a tool the model can call, or say
// where the content already lives — never imply the model can read a resource it
// can't.
export interface ResourceAccessEntry {
  uri: string;
  title: string;
  description: string;
  access: string;
}

export const RESOURCE_ACCESS_CATALOG: ResourceAccessEntry[] = [
  {
    uri: RESOURCE_URIS.serverStatus,
    title: 'Server Status & Authentication',
    description: 'Current configuration and authentication status.',
    access: 'Already included in this get_server_context result. (Also the ajo://server/status resource, readable in clients that support resource reading.)'
  },
  {
    uri: RESOURCE_URIS.channelReference,
    title: 'Channel & Content-Type Reference',
    description: 'Maps each AJO channel to its valid templateType and required template/fragment content shape.',
    access: 'The core channel→templateType→shape mapping is already inlined in the create_/update_ content template/fragment tool descriptions. Full reference: the ajo://sandbox/channel-reference resource (readable in clients that support resource reading).'
  },
  {
    uri: RESOURCE_URIS.errorCodes,
    title: 'Error Code Reference',
    description: 'Every error code this server returns, with cause and recovery action.',
    access: 'Error responses already carry the code + message (+ details). This resource adds recovery guidance and is readable directly only in clients that support resource reading.'
  },
  {
    uri: RESOURCE_URIS.visualDesignerRequirements,
    title: 'AJO Visual Email Designer — HTML Requirements',
    description: 'The complete native-HTML serialization spec for the AJO Visual Email Designer (rules, structure/component catalog, required <head>).',
    access: 'Call the get_visual_designer_requirements tool to get the full spec.'
  },
  {
    uri: RESOURCE_URIS.aemImageEmbedInstructions,
    title: 'AEM Image Embed-Attribute Retrieval Instructions',
    description: 'Step-by-step procedure for resolving an AEM DAM asset\'s AJO embed attributes (data-medialibrary-id, data-mediarepo-id, data-medialibrary-source) via a separate AEM MCP server, so AEM images embed correctly into content fragments/templates.',
    access: 'Call the get_aem_image_embed_instructions tool to get the full procedure. The asset IDs themselves come from the separate AEM MCP server, following this procedure.'
  },
  {
    uri: RESOURCE_URIS.personalizationSyntax,
    title: 'AJO Personalization Syntax Library',
    description: 'AJO-native personalization syntax to embed in template/fragment bodies: expression language, helper functions, operators, contextual-data iteration, dataset lookup. Served by category to keep responses small.',
    access: 'Call the get_personalization_syntax tool (no argument for the index + category menu, then a "category" for each section). This is SYNTAX only — get real attribute paths via the discover-personalization-paths prompt or list_xdm_field_groups / get_xdm_union_schema.'
  },
  {
    uri: RESOURCE_URIS.personalizationGuidance,
    title: 'AJO Personalization Guidance (when & what to personalize)',
    description: 'Strategy guidance for personalizing content: discovery process, data-source resolution order, detecting collections that need iteration, what to personalize (fields, URLs, images, dates), conditional content, and a coverage/validation checklist. The "what/when" layer — pairs with the syntax library (how) and the XDM schema tools (which paths).',
    access: 'Call the get_personalization_guidance tool for the full guidance. Recommended flow: get_personalization_guidance (what/when) → discover paths (list_xdm_* / discover-personalization-paths) → get_personalization_syntax (how).'
  },
  {
    uri: RESOURCE_URIS.fragments,
    title: 'Content Fragments (Directory)',
    description: 'Browsable name→id directory of content fragments in the sandbox.',
    access: 'Call list_content_fragments.'
  },
  {
    uri: RESOURCE_URIS.templates,
    title: 'Content Templates (Directory)',
    description: 'Browsable name→id directory of content templates in the sandbox.',
    access: 'Call list_content_templates.'
  },
  {
    uri: RESOURCE_TEMPLATE_URIS.fragment,
    title: 'Content Fragment by ID',
    description: 'A single content fragment (with its etag) by UUID.',
    access: 'Call get_content_fragment with the fragmentId.'
  },
  {
    uri: RESOURCE_TEMPLATE_URIS.template,
    title: 'Content Template by ID',
    description: 'A single content template (with its etag) by UUID.',
    access: 'Call get_content_template with the templateId.'
  }
];

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

EMAIL — two shapes; prefer "content" for new email (it carries the subject line):

templateType "content" — Email with subject line  (DEFAULT for new email)
  channels:  ["email"]
  template:  { "subject": "...", "html": { "body": "<html>...</html>" } }
             (subject + html.body both REQUIRED; optional: "text": { "body", "syncFromHtml" },
              "x-amp-html": { "body" }, "headers", "editorContext")
  subType:   n/a
  ⚠ VISUAL DESIGNER FORMAT REQUIRED: the html.body markup must follow the AJO Visual Email
  Designer serialization format exactly, or the import falls back to Compatibility mode and the
  user loses drag-and-drop editing. Read ajo://visual-designer-requirements BEFORE writing it.

templateType "html" — Full HTML email body (legacy/existing design templates; no subject)
  channels:  ["email"]
  template:  { "html": "<html>...</html>" }  (html is a STRING; optional "editorContext".
             Subject is set on the message/campaign, not here.)
  subType:   n/a
  ⚠ VISUAL DESIGNER FORMAT REQUIRED (same as above). Read ajo://visual-designer-requirements first.

templateType "html_primary_page" — Landing page (main page)
  channels:  ["landingpage"]
  template:  { "html": "<html>...</html>" }  (optional "editorContext")
  subType:   n/a

templateType "html_sub_page" — Landing page (sub-page / confirmation)
  channels:  ["landingpage"]
  template:  { "html": "<html>...</html>" }  (optional "editorContext")
  subType:   n/a

templateType "content" — Structured content (non-email channels)
  Push notification:
    channels:  ["push"]
    template:  { "title": "...", "message": "...", "pushType"?: "message"|"silent",
                 "ios"?: { ... }, "android"?: { ... } }
               (deep links go in ios/android interaction.uri — there is no top-level "deeplink")
  SMS:
    channels:  ["sms"]
    template:  { "text": "..." }
               (the body field is "text", NOT "body"; optional: "messageType": "sms"|"mms",
                "title" (mms subject), "mediaUri")
  In-app message:
    channels:  ["inapp"]
    template:  { "body": { "html": "<html>...</html>" } }
               (body is an OBJECT; optional: "mobileParameters", "editorContext")
  Code-based experience:
    channels:  ["code"]
    template:  { ... }  (shape is app-defined)
    subType:   "HTML" | "JSON"
  Direct mail:
    channels:  ["directMail"]
    template:  { "fileName": "...", ... }
               (fileName REQUIRED; optional: "appendTimeStamp", "notes",
                "notesPosition": "header"|"footer", "sortBy", "attributes": [{ "label", "data" }])
  Shared (multi-channel):
    channels:  ["shared"]
    template:  { ... }  (provider-defined)

━━━ FRAGMENTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type "html" — Reusable HTML block embedded in email templates  ⚠ VISUAL DESIGNER FORMAT REQUIRED
  channels:  ["email"]
  fragment:  { "content": "<div>...</div>" }  (optional "editorContext")
  subType:   n/a
  IMPORTANT: The HTML content must follow the AJO Visual Email Designer
  serialization format exactly (acr-* class namespace, structure/component
  catalog, required <head>). Read ajo://visual-designer-requirements BEFORE
  constructing any HTML content for this fragment type.

type "expression" — Reusable expression / helper text
  channels:  ["shared"]
  fragment:  { "expression": "..." }
  subType:   "TEXT" | "HTML" | "JSON"

━━━ RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• channels must be an array with exactly 1 value.
• subType is only valid on templateType "content" + channel "code", and on fragment type "expression".
• Personalization expressions go inside the template/fragment content strings.
  Do NOT use guessed XDM paths. Use list_xdm_field_groups / get_xdm_union_schema to find
  real attribute PATHS for this sandbox, and call get_personalization_syntax for the AJO-native
  expression/function SYNTAX, before inserting {{ }} / {%= %} expressions. Use only real AJO
  constructs — never JavaScript/Liquid/Jinja or invented function names.`;

export const ERROR_CODES_TEXT = `AJO Content MCP — Error Code Reference
========================================

NOT_CONFIGURED
  Cause:    Server has no credentials or sandbox configured yet.
  Recovery: Ask the user to open ${UI_BASE_URL}, upload their credentials JSON,
            and enter the sandbox name. Do not retry the tool until they confirm setup is done.

READ_ONLY_MODE
  Cause:    A write operation was attempted while the server is in read-only mode.
  Recovery: Tell the user they can enable write access at ${UI_BASE_URL}, then
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
            credentials may be invalid. Ask the user to reconfigure at ${UI_BASE_URL}.

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

TIMEOUT
  Cause:    The upstream Adobe API did not respond within the request timeout. No result
            was returned (the call was neither accepted nor rejected on its merits).
  Recovery: Usually transient. Wait a few seconds and retry the same call.

RESPONSE_TOO_LARGE
  Cause:    A fully-resolved schema (get_xdm_union_schema / get_xdm_schema /
            get_xdm_field_group with full=true) exceeds the ~1 MB tool-result limit.
  Recovery: Re-run with full=false to get the field-group $refs, then call
            get_xdm_field_group (full=true) on each ref to retrieve attributes one
            group at a time.

CJMMAS-1079  (appears as VALIDATION_ERROR / HTTP 400 from the AJO API)
  Cause:    "The template body is not valid." The template's content payload does not
            match the shape AJO expects for the given channel + templateType. Most
            commonly seen on the "code" channel: the body key is validated client-side
            (must be html / expression / condition, not "content"), but AJO additionally
            requires a specific body STRUCTURE that a bare HTML/JSON string does not
            satisfy — so a doc-compliant "code" call can still be rejected here.
  Recovery: Re-check the channel→templateType→shape mapping in the create_/update_
            content_template tool description. For "code" specifically, a working body
            shape could not be determined from the public API spec; author code-channel
            templates in the AJO UI if this persists. CJMMAS is the Message Authoring
            Service prefix — the "message"/"details" carry AJO's own description.

INTERNAL_ERROR
  Cause:    An unexpected exception occurred inside the MCP server itself (not an API
            error). The "message" field has the raw exception message.
  Recovery: This is likely a bug. Tell the user what happened and suggest they check
            the server logs (docker logs <container>) for more detail.

TOOL_NOT_FOUND
  Cause:    The tool name in the request does not match any registered handler.
  Recovery: This should not occur in normal use. If it does, the client may be using a
            stale tool list — reconnect the MCP client to refresh.`;
