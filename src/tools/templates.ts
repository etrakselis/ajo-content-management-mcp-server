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

// ─── Shared input-schema fragments ──────────────────────────────────────────
// Unlike fragments (an exhaustive 2-shape union), a template's content shape
// varies across 8 channels and several are free-form (code/directMail/shared),
// so a strict oneOf would reject valid provider-defined payloads. Instead we
// document every known content key with descriptions and keep the object open
// (additionalProperties: true). That gives the model concrete field names per
// channel without falsely constraining the free-form ones. Reused by create_
// and update_ so the two never drift.
const TEMPLATE_CONTENT_SCHEMA = {
  type: 'object' as const,
  description: 'Template content. The shape depends on channel + templateType (per the AJO Content API spec). ' +
    'Extra keys are allowed (additionalProperties:true) so provider-defined channels are not falsely rejected, ' +
    'but use these exact shapes:\n' +
    '• email, templateType "content" (DEFAULT for new email) → { subject (required), html: { body: "<html>..." } (required), text?: { body, syncFromHtml? }, "x-amp-html"?: { body }, headers?, editorContext? }  ← carries the SUBJECT LINE; body is still drag-and-drop editable\n' +
    '• email, templateType "html" (legacy/existing design templates) → { html: "<html>...", editorContext? }  (html is a STRING; subject is NOT carried here)\n' +
    '• landingpage → { html: "<html>...", editorContext? }  (html is a STRING)\n' +
    '• push → { pushType?: "message"|"silent", title?, message?, ios?: {...}, android?: {...} }  (deep links go in ios/android interaction.uri — there is no top-level "deeplink")\n' +
    '• sms → { text (required), messageType?: "sms"|"mms", title?: "mms subject", mediaUri? }  (the body field is "text", NOT "body")\n' +
    '• inapp → { body: { html: "<html>..." } (required, an OBJECT), mobileParameters?, editorContext? }\n' +
    '• directMail → { fileName (required), appendTimeStamp?, notes?, notesPosition?: "header"|"footer", sortBy?, attributes?: [{ label, data }] }\n' +
    '• code / shared → free-form (provider-defined).',
  properties: {
    // email (templateType "content" → email-variant-detail)
    subject: { type: 'string', description: 'Email subject line. REQUIRED for email content templates (templateType "content", channel "email") — the recommended default for new email templates. Not used by the legacy templateType "html".' },
    headers: { type: 'object', description: 'Custom email headers (key-value), email content variant.' },
    editorContext: { type: 'object', description: 'Opaque editor metadata (key-value). Optional for email/landingpage/inapp.' },
    // shared: html is a STRING for templateType "html"/landingpage, but an OBJECT { body } for the email-variant-detail and in-app shapes — see the per-channel guide above.
    html: { description: 'HTML content. A STRING for templateType "html" and landingpage. An OBJECT { body: "<html>" } for the email "content" variant.' },
    // push (push-variant-detail)
    pushType: { type: 'string', enum: ['message', 'silent'], description: 'Push type (push channel). Default "message".' },
    title: { type: 'string', description: 'Push notification title, or — for sms with messageType "mms" — the mms subject/title.' },
    message: { type: 'string', description: 'Push notification message body.' },
    ios: { type: 'object', description: 'iOS-specific push properties (interaction{type,uri}, media, badge, soundName, actions, etc.). Deep links go in ios.interaction.uri.' },
    android: { type: 'object', description: 'Android-specific push properties (interaction{type,uri}, channelId, visibility, priority, actions, etc.). Deep links go in android.interaction.uri.' },
    // sms (sms-variant-detail) — also the email content variant's plain-text part
    text: { description: 'SMS: the message text STRING (REQUIRED for sms; the field is "text", NOT "body"). Email content variant: the plain-text MIME part as an OBJECT { body, syncFromHtml? }.' },
    messageType: { type: 'string', enum: ['sms', 'mms'], description: 'SMS message type. Default "sms".' },
    mediaUri: { type: 'string', description: 'Media URL for mms messages (sms channel).' },
    // inapp (in-app-variant-detail)
    body: { type: 'object', description: 'In-app body, an OBJECT: { html: "<html>" }. REQUIRED for inapp templates.' },
    mobileParameters: { type: 'object', description: 'In-app message settings (key-value), optional.' },
    // directMail (direct-mail-variant-detail)
    fileName: { type: 'string', description: 'Direct-mail export file name. REQUIRED for directMail templates.' },
    appendTimeStamp: { type: 'boolean', description: 'Whether to append a timestamp to the directMail file name.' },
    notes: { type: 'string', description: 'Notes/instructions for print partners (directMail).' },
    notesPosition: { type: 'string', enum: ['header', 'footer'], description: 'Where to include directMail notes.' },
    sortBy: { type: 'string', description: 'Label to sort directMail data by.' },
    attributes: { type: 'array', description: 'DirectMail content rows: [{ label, data }].', items: { type: 'object' } }
  },
  additionalProperties: true
};

const TEMPLATE_CHANNELS_SCHEMA = {
  type: 'array' as const,
  items: { type: 'string' as const, enum: ['email', 'push', 'inapp', 'sms', 'code', 'directMail', 'landingpage', 'shared'] },
  minItems: 1,
  maxItems: 1,
  description: 'Target channel (exactly 1 value required).'
};

// Conditional requirement: AJO mandates subType for code-channel templates.
// Declared as a JSON-Schema if/then so a schema-aware client enforces it before
// the call. Adds only to `required` (no new property), so it composes cleanly
// with the top-level additionalProperties:false and the injected confirmWrite flag.
const CODE_CHANNEL_REQUIRES_SUBTYPE = [
  { if: { properties: { channels: { contains: { const: 'code' } } }, required: ['channels'] }, then: { required: ['subType'] } }
];

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

CHOOSING templateType — "html" vs "content" (they select entirely different content shapes, not two flavors of the same thing):
  • "content" → a channel-aware container whose shape is selected by "channels". It is the ONLY option for push/sms/inapp/directMail,
                and for email it is the "structured" form that holds the subject line plus the HTML body and text/x-amp-html/headers parts.
                The email HTML body still uses the Visual Email Designer (drag-and-drop) — content is a superset of "html" plus a subject,
                so PREFER "content" for NEW email templates.
  • "html"    → a raw EMAIL design body only: { html: "<string>" } with NO subject/text/headers (subject is set on the message/campaign).
                Mainly here to read and edit EXISTING design templates of this type; not the recommended choice for new email templates.
                Only valid for the email channel.
  • "html_primary_page" / "html_sub_page" → landing-page bodies ({ html: "<string>" }); separate from both of the above.
  Decision guide:
    - email (NEW)      → "content" (default — gives you a subject line; HTML body still drag-and-drop editable).
    - email (existing) → match whatever templateType the fetched template already uses ("html" or "content") — don't switch it on a plain edit.
    - push / sms / inapp / directMail → must use "content".
    - landingpage → "html_primary_page" (or "html_sub_page" for confirmation pages).
    - code → "content" + subType.

Channel → templateType → template shape (channels must have exactly 1 value):
  "email"       → "content"            → { "subject": "...", "html": { "body": "<html>..." } }  ← DEFAULT for new email (subject + html.body both REQUIRED)
  "email"       → "html"               → { "html": "<html>..." }  (legacy/existing design templates only; html is a STRING, NO subject)
  "push"        → "content"            → { "title": "...", "message": "...", "pushType"?: "message"|"silent", "ios"?: {...}, "android"?: {...} }  (deep links go in ios/android interaction.uri)
  "sms"         → "content"            → { "text": "..." }  (field is "text", not "body"; optional: messageType, title, mediaUri)
  "inapp"       → "content"            → { "body": { "html": "<html>..." } }  (body is an OBJECT; optional: mobileParameters, editorContext)
  "code"        → "content" + subType  → { ... }  subType: "HTML" or "JSON"
  "directMail"  → "content"            → { "fileName": "...", ... }  (fileName REQUIRED; optional: appendTimeStamp, notes, notesPosition, sortBy, attributes)
  "landingpage" → "html_primary_page"  → { "html": "<html>..." }  (or "html_sub_page" for confirmation pages)
  "shared"      → "content"            → { ... }  (provider-defined)

⚠ EMAIL SUBJECT LINE: For new email templates use templateType "content", channel "email" (the email-variant-detail shape) —
  "subject" is required and "html" is an object { body: "..." }, and the body is still drag-and-drop editable in the Visual Email
  Designer. The older templateType "html" carries NO subject (it's set on the message/campaign); only use it when editing an
  existing "html" template.

⚠ VISUAL EMAIL DESIGNER REQUIREMENT (channel "email", both templateType "content" html.body and templateType "html"):
  The HTML must use AJO's native serialization format (acr-* class namespace,
  structure/component catalog, required <head> with content-version meta tag).
  Generic email HTML will force the designer into Compatibility mode, locking
  the user out of drag-and-drop editing. Call the get_visual_designer_requirements
  tool to get the full mandatory spec BEFORE constructing any HTML for this
  template type (it returns the exact structure/component catalog and required
  <head> you must reproduce).

Example usage (email template — DEFAULT, with subject line):
{
  "name": "Welcome Email",
  "templateType": "content",
  "channels": ["email"],
  "template": { "subject": "Welcome to Adobe!", "html": { "body": "<html>Hello {{_yourtenant.person.firstName}}</html>" } }
}

Example usage (legacy "html" email design template — no subject; use only when editing an existing one):
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
    allOf: CODE_CHANNEL_REQUIRES_SUBTYPE,
    properties: {
      name: { type: 'string', description: 'Template name (required)' },
      description: { type: 'string', description: 'Optional description' },
      templateType: { type: 'string', enum: ['html', 'html_primary_page', 'html_sub_page', 'content'], description: 'Template type' },
      channels: TEMPLATE_CHANNELS_SCHEMA,
      template: TEMPLATE_CONTENT_SCHEMA,
      subType: { type: 'string', enum: ['HTML', 'JSON'], description: 'Sub-type for code channel templates (HTML | JSON). REQUIRED when channel is "code"; not used for other channels.' },
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

CHOOSING templateType — "html" vs "content" (they select entirely different content shapes, not two flavors of the same thing):
  • "content" → a channel-aware container whose shape is selected by "channels". The ONLY option for push/sms/inapp/directMail, and for
                email the "structured" form that holds the subject line plus the HTML body and text/x-amp-html/headers parts (body is still
                drag-and-drop editable). It is a superset of "html" plus a subject — the recommended type for new email templates.
  • "html"    → a raw EMAIL design body only: { html: "<string>" } with NO subject/text/headers (subject is set on the message/campaign).
                Mainly for editing EXISTING design templates of this type. Only valid for the email channel.
  • "html_primary_page" / "html_sub_page" → landing-page bodies; separate from both.
  ON UPDATE, PRESERVE the existing templateType: call get_content_template first and reuse whatever type it already has — do NOT flip an
  existing "html" email to "content" (or vice-versa) unless the user explicitly asks, since that changes the required template shape.
  Decision guide: push/sms/inapp/directMail → "content"; landingpage → "html_primary_page"|"html_sub_page"; code → "content" + subType;
  email → keep the fetched type ("content" or "html"); for a brand-new email prefer "content" (subject line + drag-and-drop body).

Channel → templateType → template shape (channels must have exactly 1 value):
  "email"       → "content"            → { "subject": "...", "html": { "body": "<html>..." } }  ← preferred for email (carries a SUBJECT LINE)
  "email"       → "html"               → { "html": "<html>..." }  (legacy/existing design templates; html is a STRING, NO subject)
  "push"        → "content"            → { "title": "...", "message": "...", "pushType"?: "message"|"silent", "ios"?: {...}, "android"?: {...} }
  "sms"         → "content"            → { "text": "..." }  (field is "text", not "body"; optional: messageType, title, mediaUri)
  "inapp"       → "content"            → { "body": { "html": "<html>..." } }  (body is an OBJECT)
  "code"        → "content" + subType  → { ... }  subType: "HTML" or "JSON"
  "directMail"  → "content"            → { "fileName": "...", ... }  (fileName REQUIRED)
  "landingpage" → "html_primary_page"  → { "html": "<html>..." }  (or "html_sub_page")
  "shared"      → "content"            → { ... }

⚠ VISUAL EMAIL DESIGNER REQUIREMENT (channel "email", both templateType "content" html.body and templateType "html"):
  The HTML must use AJO's native serialization format (acr-* class namespace,
  structure/component catalog, required <head> with content-version meta tag).
  Generic email HTML will force the designer into Compatibility mode, locking
  the user out of drag-and-drop editing. Call the get_visual_designer_requirements
  tool to get the full mandatory spec BEFORE constructing any HTML for this
  template type (it returns the exact structure/component catalog and required
  <head> you must reproduce).

Workflow:
1. Call get_content_template to get current data + etag
2. Modify the data
3. Call update_content_template with all fields + etag

Example usage (email template — preserve the fetched templateType; "content" shown here):
{
  "templateId": "b6d70a45-...",
  "etag": "\\"abc123\\"",
  "name": "Updated Template Name",
  "templateType": "content",
  "channels": ["email"],
  "template": { "subject": "Updated Subject", "html": { "body": "<html>Updated content</html>" } }
}
(If the fetched template is templateType "html", keep it "html" and send template { "html": "<html>..." } — that shape has no subject.)

Returns: { success: true }`,
  annotations: { title: 'Update Content Template (Replace)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['templateId', 'etag', 'name', 'templateType', 'channels'],
    allOf: CODE_CHANNEL_REQUIRES_SUBTYPE,
    properties: {
      templateId: { type: 'string', format: 'uuid', description: 'UUID of the template to update' },
      etag: { type: 'string', description: 'ETag from get_content_template (required for optimistic locking)' },
      name: { type: 'string', description: 'Template name' },
      description: { type: 'string', description: 'Optional description' },
      templateType: { type: 'string', enum: ['html', 'html_primary_page', 'html_sub_page', 'content'], description: 'Template type — must match the channel (email→html, push/sms/inapp/code→content, landingpage→html_primary_page or html_sub_page)' },
      channels: TEMPLATE_CHANNELS_SCHEMA,
      template: TEMPLATE_CONTENT_SCHEMA,
      subType: { type: 'string', enum: ['HTML', 'JSON'], description: 'Sub-type for code channel templates (HTML | JSON). REQUIRED when channel is "code"; not used for other channels.' },
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
