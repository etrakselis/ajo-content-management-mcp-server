import {
  listTemplates, createTemplate, getTemplate,
  updateTemplate, patchTemplate, deleteTemplate,
  buildError, isClientConfigured
} from '../adobe/client.js';
import {
  ListTemplatesSchema, CreateTemplateSchema, GetTemplateSchema,
  UpdateTemplateSchema, PatchTemplateSchema, DeleteTemplateSchema
} from '../validation/schemas.js';
import { notConfiguredError, validationError, withTelemetry, buildOutputSchema, oversizeError, ETAG_FIELD, WARNINGS_FIELD, compatibilityModeWarning, scanFragmentEmbeds, malformedFragmentWarnings, normalizeMetadataPatches, TEMPLATE_OBJECT, TEMPLATE_LIST } from './utils.js';

// Pull the email HTML out of a template payload for the native-format check. The
// "content" shape carries it at template.html.body (an object); the legacy "html"
// shape carries it at template.html (a string). Returns null for non-email or
// other shapes, so the warning only fires where Compatibility mode is a risk.
function emailHtmlOf(data: { channels?: string[]; templateType?: string; template?: Record<string, unknown> }): unknown {
  if (data.channels?.[0] !== 'email') return null;
  const t = data.template;
  if (!t) return null;
  if (data.templateType === 'content') {
    const html = t.html as Record<string, unknown> | undefined;
    return html?.body;
  }
  return t.html;
}

// Non-fatal advisories for a template write that still succeeds: Compatibility-mode
// HTML (email) plus any prefix-less {{ fragment }} helper embeds anywhere in the body.
function templateWarnings(data: { channels?: string[]; templateType?: string; template?: Record<string, unknown> }): string[] {
  const warnings: string[] = [];
  const compat = compatibilityModeWarning(emailHtmlOf(data));
  if (compat) warnings.push(compat);
  warnings.push(...malformedFragmentWarnings(data.template));
  return warnings;
}

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
    '• code → { html: "<string>" } | { expression: "<string>" } | { condition: "<string>" }  (exactly one; pick per subType — HTML→html, JSON→expression/condition. NOTE: the key is one of html/expression/condition, NOT "content")\n' +
    '• shared → free-form (provider-defined).',
  properties: {
    // email (templateType "content" → email-variant-detail)
    subject: { type: 'string', description: 'Email subject line. REQUIRED for email content templates (templateType "content", channel "email") — the recommended default for new email templates. Not used by the legacy templateType "html".' },
    headers: { type: 'object', description: 'Custom email headers (key-value), email content variant.' },
    editorContext: { type: 'object', description: 'Opaque editor metadata (key-value). Optional for email/landingpage/inapp.' },
    // shared: html is a STRING for templateType "html"/landingpage, but an OBJECT { body } for the email-variant-detail and in-app shapes — see the per-channel guide above.
    html: { description: 'HTML content. A STRING for templateType "html" and landingpage. An OBJECT { body: "<html>" } for the email "content" variant. EMAIL ONLY: this HTML imports into the Visual Email Designer — to stay drag-and-drop editable (NOT Compatibility mode) it MUST be in native Visual Designer format: a <head> carrying the content-version meta tag, acr-* component classes, and the required structure/component nesting. Call get_visual_designer_requirements FIRST and reproduce that exact structure — do not write generic email HTML (generic HTML still saves but opens in Compatibility mode and locks the user out of the visual editor). (Landing-page HTML has no such requirement.)' },
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

// NOTE: two conditional requirements apply to template writes —
//   (1) code-channel templates require `subType`, and
//   (2) email templates must match their shape (templateType "content" →
//       template { subject, html: { body } }; templateType "html" → template
//       { html: "<string>" }).
// These were once declared here as JSON-Schema allOf/if-then rules so a
// schema-aware client could pre-validate. That is REMOVED on purpose: Anthropic's
// tool input_schema rejects allOf/anyOf/oneOf (and if/then) at the top level, and
// a tool whose schema contains them is silently dropped by the client during
// MCP→API conversion — it vanishes from tool discovery and returns "tool not
// found" when called. The authoritative enforcement is the Zod superRefine in
// validation/schemas.ts (CreateTemplateSchema/UpdateTemplateSchema), which runs
// server-side on every call; the requirements are also documented in the tool and
// property descriptions. Do NOT reintroduce allOf/if-then on the input schema.

// Embed-by-reference guidance, surfaced on both create_ and update_ template
// descriptions (the point where the model authors the body). Without it, models
// tend to paste a fragment's HTML inline, which silently breaks the live link:
// an inlined copy is a static snapshot, so later edits to the fragment never
// propagate to the template. Kept in one place so the two descriptions never drift.
const FRAGMENT_EMBED_NOTE =
  '⚠ EMBED FRAGMENTS BY REFERENCE — NEVER INLINE THEIR CONTENT: To include a content fragment in this template, reference ' +
  'it with the fragment helper tag — {{ fragment id="ajo:<fragmentId>" name="<fragmentName>" mode="inline" }} — placed in ' +
  'the <th> of the structure row that should hold it (call get_visual_designer_requirements for the exact nesting; get the ' +
  'id/name from list_content_fragments / get_content_fragment). Do NOT copy or paste the fragment\'s HTML into the template ' +
  'body — an inlined copy is a STATIC SNAPSHOT that breaks the live link, so later edits to the fragment will NOT propagate. ' +
  'Do NOT use a data-fragment="..." attribute on .acr-structure — AJO STRIPS it on save and the reference is lost. Only the ' +
  '{{ fragment }} helper creates a live, propagating reference; a name-based {{fragmentName}} is a personalization ' +
  'expression, not a fragment embed.';

// Organization fields shared by create_ and update_ (see the fragment tools for the
// same pattern). tagIds/labels are real runtime write-model fields the published
// spec omits; parentFolderId is advertised but NOT accepted in the AJO write body.
const TAG_IDS_SCHEMA = {
  type: 'array' as const,
  items: { type: 'string' as const },
  description: 'Tag IDs (UUIDs) to bind to this template. Find/create them with the Unified Tags tools (list_tags / create_tag) and validate with validate_tags first. This SETS the whole array (not an append) — to add to existing tags, read the current tagIds (get_content_template) and resend the full list.'
};
const LABELS_SCHEMA = {
  type: 'array' as const,
  items: { type: 'string' as const },
  description: 'OLAC (object-level access-control) label strings to attach to this template. Optional; sets the whole array.'
};
const PARENT_FOLDER_CREATE_PROP = {
  type: 'string' as const, format: 'uuid',
  description: 'UUID of the folder to file this template into. The AJO create body itself does NOT accept this; the server applies it via an automatic follow-up PATCH after the template is created. Omit to leave it unfiled. (If only the folder step fails, the create still succeeds and a warning explains how to retry.)'
};
const PARENT_FOLDER_UPDATE_PROP = {
  type: 'string' as const, format: 'uuid',
  description: 'Optional. Files/moves the template into this folder. The AJO PUT body does not accept it, so the server applies it via an automatic follow-up PATCH (same as create); if only that step fails the update still succeeds and the folder failure is returned as a warning. Omit to leave the current folder placement unchanged (it is preserved across a content replace).'
};

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
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      limit: { type: 'number', description: 'Max items to return (1-1000, default 20)' },
      start: { type: 'string', description: 'Pagination cursor from previous response _page.next' },
      orderBy: { type: 'string', description: 'Sort field. Prefix with + (asc) or - (desc). E.g. "-modifiedAt"' },
      property: { type: 'array', items: { type: 'string' }, description: 'FIQL filter expressions. Operators: == (equals), != (not equals), ~^ (start-anchored regex / starts-with, case-insensitive), ~ (contains, case-insensitive). ==/!= are NOT supported on "name" (AJO returns CJMMAS-1051) — use ~^ or ~ for name; an EXACT name match is "name~^<name>$" (the trailing $ end-anchors the regex). E.g. ["name~^Test$", "channels==email", "templateType==html"]' }
    }
  }
};

export async function handleListContentTemplates(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('list_content_templates', async () => {
    // `args ?? {}`: the MCP `arguments` field is optional, so a no-filter "list
    // everything" call arrives as undefined on clients that omit it. ListTemplatesSchema
    // is a z.object (all fields optional) and rejects undefined, which would turn the
    // most basic list call into a spurious VALIDATION_ERROR. Matches the sibling list
    // handlers (list_tags, list_xdm_*), which all guard the same way.
    const parsed = ListTemplatesSchema.safeParse(args ?? {});
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await listTemplates(parsed.data);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  }, args);
}

// ─── create_content_template ──────────────────────────────────────────────────

export const createContentTemplateDefinition = {
  name: 'create_content_template',
  title: 'Create Content Template',
  outputSchema: buildOutputSchema({
    id: { type: 'string', description: 'UUID of the newly created template. Absent on a validateOnly dry run (nothing was created).' },
    location: { type: 'string', description: 'Relative path of the new template, e.g. /templates/<uuid>. Absent on a validateOnly dry run.' },
    etag: ETAG_FIELD,
    validated: { type: 'boolean', description: 'Present and true only for a validateOnly dry run — confirms validation ran and nothing was persisted.' },
    warnings: WARNINGS_FIELD
  }),
  description: `Create a new content template in Adobe Journey Optimizer.

templateType — "content" vs "html" (they select different content shapes, not two flavors of one):
  • "content" → channel-aware container. REQUIRED for push/sms/inapp/directMail/code; for email it carries the subject line plus an html.body that stays drag-and-drop editable. DEFAULT — prefer it for new templates.
  • "html" → raw EMAIL body only ({ html: "<string>" }, NO subject). Use only to edit an existing "html" design template. Email channel only.
  • "html_primary_page" / "html_sub_page" → landing-page bodies.
  Decision: email (new) → "content"; email (existing) → keep the fetched type; push/sms/inapp/directMail → "content"; code → "content" + subType; landingpage → "html_primary_page" (or "html_sub_page" for confirmation pages).

The per-channel "template" shape (which keys each channel needs) is documented in full on the "template" parameter below — follow it exactly (e.g. email "content" → { subject, html: { body } }; sms uses "text" not "body"; inapp body is an OBJECT; code's key is html/expression/condition, not "content").

⚠ NEW EMAIL OR HTML→AJO CONVERSION (email channel): when you are asked to create a new AJO email or convert a user-provided HTML email into an AJO-compatible one, call get_email_scenario_faq FIRST — it triages which personalization scenarios the content contains and lists the clarifying questions to ask the user so this template (and any content fragments) end up configured for their actual use case, not guessed defaults. Do that triage before writing any markup.

⚠ EMAIL HTML → VISUAL EMAIL DESIGNER: email HTML (templateType "content" html.body, or templateType "html") MUST be in AJO's native serialization format, or it opens in Compatibility mode and locks the user out of drag-and-drop editing. Call get_visual_designer_requirements BEFORE writing any email HTML and reproduce that exact structure. (Landing-page HTML has no such requirement.)

⚠ EMBEDDING AEM IMAGES: if the content includes an image hosted in Adobe Experience Manager (AEM), its <img> must carry the AJO media-library attributes data-medialibrary-id, data-mediarepo-id, and data-medialibrary-source ("aem") or it will not resolve from the media library. This server does NOT look those up — call get_aem_image_embed_instructions for the step-by-step procedure to resolve them via the separate AEM MCP server (by image name + folder) BEFORE writing the <img> tag.

${FRAGMENT_EMBED_NOTE}

PERSONALIZATION: use the 'discover-personalization-paths' prompt / get_personalization_guidance for WHAT & WHEN, the XDM tools (list_xdm_field_groups / get_xdm_union_schema) for WHICH real attribute paths exist — never guess paths like {{profile.person.firstName}}; tenant-custom attributes live under "profile._tenantId." — and get_personalization_syntax for HOW. Use only real AJO constructs (never JavaScript/Liquid/Jinja or invented functions).

DUPLICATE CHECK (before creating): check by name with ONE server-side filtered list call. On the name field, the operator ~^ is a START-ANCHORED REGEX, so an EXACT match is list_content_templates({ property: ["name~^<exact name>$"] }) — the trailing $ end-anchors it (e.g. ["name~^NV_BIS_Restock$"]). Omit the $ to match a whole family (prefix). NOTE: the equality operator name== is NOT supported by the AJO content API (CJMMAS-1051 "Operator not supported on the specified field") — always use ~^ for name; == works on type/channels/templateType.

ORGANIZATION: tagIds tags the template (goes in the create body); parentFolderId files it (applied via an automatic follow-up PATCH — the create body doesn't accept it; folderType "content-template", create one with create_folder). If folder placement fails the create still succeeds (see warnings) and can be retried with patch_content_template.

Example usage (email template — DEFAULT, with subject line):
{
  "name": "Welcome Email",
  "templateType": "content",
  "channels": ["email"],
  "template": { "subject": "Welcome, {{profile.person.name.firstName}}!", "html": { "body": "<html>Hello {{profile.person.name.firstName}}</html>" } }
}

Returns: { success: true, id: "<uuid>", location: "/templates/<uuid>", etag: "<etag>", warnings?: [...] }
The returned etag is immediately reusable for a follow-up update_content_template / patch_content_template — no need to re-fetch right after creating. A "warnings" entry (email templates) means the HTML is not in AJO native format and will open in Compatibility mode.`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['name', 'templateType', 'channels'],
    properties: {
      name: { type: 'string', description: 'Template name (required)' },
      description: { type: 'string', description: 'Optional description' },
      templateType: { type: 'string', enum: ['html', 'html_primary_page', 'html_sub_page', 'content'], description: 'Template type' },
      channels: TEMPLATE_CHANNELS_SCHEMA,
      template: TEMPLATE_CONTENT_SCHEMA,
      subType: { type: 'string', enum: ['HTML', 'JSON'], description: 'Sub-type for code channel templates (HTML | JSON). REQUIRED when channel is "code"; not used for other channels.' },
      parentFolderId: PARENT_FOLDER_CREATE_PROP,
      tagIds: TAG_IDS_SCHEMA,
      labels: LABELS_SCHEMA,
      source: { type: 'object', description: 'Source/origin metadata { origin: "ajo"|"aem"|"external" }' },
      validateOnly: { type: 'boolean', description: 'Dry run. If true, the server runs all input + Visual-Designer validation and returns the warnings WITHOUT creating the template (nothing is persisted). Use this to catch issues before committing.' }
    }
  }
};

export async function handleCreateContentTemplate(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('create_content_template', async () => {
    const parsed = CreateTemplateSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    // Dry run: report the warnings the write would produce, without persisting.
    if (parsed.data.validateOnly) {
      return { success: true, validated: true, warnings: templateWarnings(parsed.data) };
    }
    try {
      // parentFolderId is advertised on create (per the OpenAPI spec) but rejected by
      // the runtime model in the create body, so strip it and apply it via a follow-up
      // PATCH below. tagIds/labels stay in the body (the runtime accepts them).
      // validateOnly is a control flag, not part of the payload — stripped here too.
      const { parentFolderId, validateOnly: _validateOnly, ...payload } = parsed.data;
      const result = await createTemplate(payload) as { id: string; location?: string; etag?: string };
      const warnings = templateWarnings(parsed.data);
      if (parentFolderId != null) {
        // The create already committed; a failed folder step only adds a warning.
        try {
          let etag = result.etag;
          if (!etag) etag = (await getTemplate(result.id)).etag;
          if (!etag) throw new Error('could not resolve the post-create etag');
          const patched = await patchTemplate(result.id, [{ op: 'add', path: '/parentFolderId', value: parentFolderId }], etag) as { etag?: string };
          if (patched.etag) result.etag = patched.etag; // keep the returned etag chainable
        } catch (err) {
          warnings.push(
            `Template created (id ${result.id}) but filing it into folder ${parentFolderId} failed: ${buildError(err).message} ` +
            `Retry with patch_content_template: { "op": "add", "path": "/parentFolderId", "value": "${parentFolderId}" }.`
          );
        }
      }
      return { success: true, ...result, ...(warnings.length ? { warnings } : {}) };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  }, args);
}

// ─── get_content_template ─────────────────────────────────────────────────────

export const getContentTemplateDefinition = {
  name: 'get_content_template',
  title: 'Get Content Template',
  outputSchema: buildOutputSchema({
    data: TEMPLATE_OBJECT,
    etag: ETAG_FIELD,
    embeddedFragments: {
      type: 'array',
      description: 'Fragments embedded in the template body via the {{ fragment id="(ajo|aem|external):<uuid>" ... }} helper, derived by the server. This reflects helper embeds that the upstream data.referencedFragments array does NOT capture — use this to confirm what a template references. Empty when none are embedded.',
      items: {
        type: 'object',
        properties: {
          reference: { type: 'string', description: 'Full reference, e.g. "ajo:b6d70a45-...".' },
          source: { type: 'string', description: 'Reference source: ajo | aem | external.' },
          id: { type: 'string', description: 'Fragment UUID.' }
        }
      }
    },
    invalidFragmentReferences: {
      type: 'array',
      items: { type: 'string' },
      description: 'Present only when the body contains {{ fragment }} helper ids missing a required ajo:/aem:/external: prefix (e.g. a bare UUID). These are broken embeds that will fail at render — fix them by adding the prefix. Absent when all embeds are well-formed.'
    }
  }),
  description: `Fetch a single content template by ID from Adobe Journey Optimizer.

Example usage: { "templateId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { id, name, templateType, channels, template, createdAt, modifiedAt, ... }, etag: "...", embeddedFragments: [{ reference, source, id }], invalidFragmentReferences?: ["<bad value>"] }
The etag is required for update (PUT/PATCH) operations.
NOTE on fragment references: the upstream data.referencedFragments only lists formally-registered references and is empty for {{ fragment }} helper embeds. The server-derived embeddedFragments array DOES capture those helper embeds — use it (not referencedFragments) to confirm what a template embeds. If invalidFragmentReferences is present, the body has {{ fragment }} helper ids missing the required ajo:/aem:/external: prefix; those embeds are broken and will fail at render.
ONLY {{ fragment id="(ajo|aem|external):<uuid>" ... }} helper embeds are trackable (and are the live, propagating reference mechanism). A data-fragment="..." attribute on .acr-structure is NOT a live reference — AJO strips it on save — and a name-based {{fragmentName}} is a personalization expression, not a fragment embed; neither is reflected in embeddedFragments/referencedFragments. To embed a fragment in a verifiable, propagating way, use the {{ fragment id="ajo:<uuid>" name="..." mode="inline" }} helper.`,
  annotations: { readOnlyHint: true, openWorldHint: true },
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
      const { embedded, malformed } = scanFragmentEmbeds(result.data);
      // A full Visual Designer html body can exceed the ~1 MB transport cap; return a
      // structured RESPONSE_TOO_LARGE rather than letting the SDK reject the whole
      // result with a bare, un-branchable "too large".
      const envelope = {
        success: true as const,
        ...result,
        embeddedFragments: embedded,
        ...(malformed.length ? { invalidFragmentReferences: malformed } : {})
      };
      const tooBig = oversizeError(envelope,
        'This is usually an oversized html template body. Open the template directly in Adobe Journey Optimizer; list_content_templates still returns its metadata.');
      if (tooBig) return tooBig;
      return envelope;
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  }, args);
}

// ─── update_content_template ──────────────────────────────────────────────────

export const updateContentTemplateDefinition = {
  name: 'update_content_template',
  title: 'Update Content Template (Replace)',
  outputSchema: buildOutputSchema({ etag: ETAG_FIELD, warnings: WARNINGS_FIELD }),
  description: `Replace a content template entirely (PUT). Use this to change content, type, or channels. To only rename, move, or tag a template, patch_content_template is lighter-weight.

templateType — same meanings as create_content_template: "content" (channel-aware container w/ subject; preferred), "html" (raw email body, no subject), "html_primary_page"/"html_sub_page" (landing pages). ON UPDATE, PRESERVE the existing type — call get_content_template first and reuse whatever it already has; do NOT flip "html"↔"content" unless the user explicitly asks, since that changes the required shape.

The per-channel "template" shape is documented in full on the "template" parameter below — follow it exactly.

⚠ EMAIL HTML → VISUAL EMAIL DESIGNER: email HTML must be in AJO's native serialization format or it opens in Compatibility mode (drag-and-drop editing lost). Call get_visual_designer_requirements BEFORE writing any email HTML. When you are converting a user-provided HTML email into AJO (or authoring a new one), call get_email_scenario_faq FIRST to triage scenarios and gather the clarifying questions to ask.

⚠ EMBEDDING AEM IMAGES: an AEM-hosted <img> needs the data-medialibrary-id / data-mediarepo-id / data-medialibrary-source ("aem") attributes or it won't resolve — call get_aem_image_embed_instructions BEFORE adding or changing one (see create_content_template for the full procedure). Preserve any existing AEM image attributes verbatim when round-tripping content you are not changing.

${FRAGMENT_EMBED_NOTE}

PERSONALIZATION: when adding/changing {{ }} / {%= %} expressions, use get_personalization_syntax for the AJO-native syntax and discover-personalization-paths / list_xdm_field_groups for the real attribute paths — never invent functions or use JavaScript/Liquid/Jinja.

⚠ FULL REPLACE — NO FIELD-LEVEL UPDATE. AJO cannot patch a single content field (subject, html, body, …); PATCH only does /name, /description, /parentFolderId. To change even ONE field you must resend the ENTIRE template, so fetch-then-mutate (never rebuild content from memory):
1. Call get_content_template FIRST for the complete current template + etag — required every time you edit an existing template, even a tiny change; it is the source of truth for the fields you are NOT changing. (Exception: right after create_content_template you already hold the full object + a valid etag.)
2. Modify ONLY the field(s) requested; copy the existing html/body and every other field through EXACTLY as returned.
3. Call update_content_template with the full object (changed + untouched fields) + the etag.
❌ DO NOT regenerate or reconstruct the HTML/body from scratch for a single-field change — regenerated HTML loses the user's design, personalization, and Visual Email Designer serialization. ALWAYS round-trip the exact content from step 1; if you don't have it in hand, call get_content_template before updating.

Example usage (email — keep the fetched templateType; "content" shown; if it is "html", send template { "html": "<html>..." } instead — no subject):
{
  "templateId": "b6d70a45-...",
  "etag": "\\"abc123\\"",
  "name": "Updated Template Name",
  "templateType": "content",
  "channels": ["email"],
  "template": { "subject": "Updated Subject", "html": { "body": "<html>Updated content</html>" } }
}

Returns: { success: true, etag?: "<new-etag>", warnings?: [...] }  (a "warnings" entry means the email html is not in AJO native format and will open in Compatibility mode)`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['templateId', 'etag', 'templateType', 'channels'],
    properties: {
      templateId: { type: 'string', format: 'uuid', description: 'UUID of the template to update' },
      etag: { type: 'string', description: 'ETag from get_content_template (or the etag returned by create_content_template), required for optimistic locking. Pass it back exactly as received, including its surrounding double-quote characters — do not strip them.' },
      name: { type: 'string', description: 'Template name. Optional: if omitted the server backfills the template\'s current name (the AJO PUT requires a name). Always pass it when renaming.' },
      description: { type: 'string', description: 'Optional description' },
      templateType: { type: 'string', enum: ['html', 'html_primary_page', 'html_sub_page', 'content'], description: 'Template type — must match the channel (email→html, push/sms/inapp/code→content, landingpage→html_primary_page or html_sub_page)' },
      channels: TEMPLATE_CHANNELS_SCHEMA,
      template: TEMPLATE_CONTENT_SCHEMA,
      subType: { type: 'string', enum: ['HTML', 'JSON'], description: 'Sub-type for code channel templates (HTML | JSON). REQUIRED when channel is "code"; not used for other channels.' },
      parentFolderId: PARENT_FOLDER_UPDATE_PROP,
      tagIds: TAG_IDS_SCHEMA,
      labels: LABELS_SCHEMA,
      source: { type: 'object', description: 'Source/origin metadata { origin: "ajo"|"aem"|"external" }' }
    }
  }
};

export async function handleUpdateContentTemplate(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('update_content_template', async () => {
    const parsed = UpdateTemplateSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    // parentFolderId is NOT part of the runtime PUT body (rejected as an unrecognized
    // field), so strip it from the payload — but, like create, honor it via a
    // follow-up PATCH instead of silently ignoring it, so re-filing works the same way
    // everywhere. tagIds/labels stay in the body.
    const { templateId, etag, parentFolderId, ...payload } = parsed.data;
    // Backfill an omitted name from the current template so a content-only update
    // doesn't hard-fail with "name Required" — the AJO PUT replaces the whole object
    // and requires name, but callers routinely forget it when only changing content.
    // One cheap read; a clear error (not the opaque validation rejection) if it can't
    // be resolved. A convenience net, NOT a license to skip fetch-then-mutate for the
    // content itself (which the caller must still resend in full).
    if (payload.name == null) {
      try {
        const current = await getTemplate(templateId) as { data?: { name?: unknown } };
        if (typeof current.data?.name === 'string' && current.data.name) payload.name = current.data.name;
      } catch (err) {
        return { success: false, error: buildError(err) };
      }
      if (payload.name == null) {
        return { success: false, error: { code: 'VALIDATION_ERROR', message: 'name was omitted and could not be backfilled from the current template. Provide name explicitly.', details: {} } };
      }
    }
    try {
      const result = await updateTemplate(templateId, payload, etag) as { success: boolean; etag?: string };
      const warnings = templateWarnings(parsed.data);
      // Folder placement: applied via a follow-up PATCH (same as create). The content
      // replace already committed, so a failed move degrades to a warning + retry hint.
      if (parentFolderId != null) {
        try {
          let folderEtag = result.etag;
          if (!folderEtag) folderEtag = (await getTemplate(templateId)).etag;
          if (!folderEtag) throw new Error('could not resolve the post-update etag');
          const patched = await patchTemplate(templateId, [{ op: 'add', path: '/parentFolderId', value: parentFolderId }], folderEtag) as { etag?: string };
          if (patched.etag) result.etag = patched.etag;
        } catch (err) {
          warnings.push(
            `Template updated (id ${templateId}) but filing it into folder ${parentFolderId} failed: ${buildError(err).message} ` +
            `Retry with patch_content_template: { "op": "add", "path": "/parentFolderId", "value": "${parentFolderId}" }.`
          );
        }
      }
      return { ...result, success: true, ...(warnings.length ? { warnings } : {}) };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  }, args);
}

// ─── patch_content_template ───────────────────────────────────────────────────

export const patchContentTemplateDefinition = {
  name: 'patch_content_template',
  title: 'Rename or Move Content Template',
  outputSchema: buildOutputSchema({ etag: ETAG_FIELD }),
  description: `Rename/redescribe a content template, file it into a folder, or bind tags/labels — use this for metadata changes, NOT content. For content, type, or channel changes, use update_content_template instead.

Supported paths: /name, /description, /parentFolderId, /tagIds, /labels.

⚠ op for /parentFolderId, /tagIds, /labels: use "add" (these members may not exist yet on the object). Per JSON Patch (RFC 6902) "replace" requires the target to already exist and AJO rejects it with an opaque "Bad Patch request." The server auto-translates "replace" → "add" for these three paths, so either works — but "add" is the correct choice. /tagIds and /labels SET the whole array (read-modify-write via get_content_template to append).

Example usage:
{
  "templateId": "b6d70a45-...",
  "etag": "\\"abc123\\"",
  "patches": [
    { "op": "replace", "path": "/name", "value": "New Name" },
    { "op": "add", "path": "/parentFolderId", "value": "0547... (content-template folder)" }
  ]
}

Returns: { success: true, etag?: "<new-etag>" }
(The new etag is returned when AJO provides it; reuse it directly for a follow-up write. To read back the full updated template, call get_content_template.)`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['templateId', 'etag', 'patches'],
    properties: {
      templateId: { type: 'string', format: 'uuid', description: 'UUID of the template to patch' },
      etag: { type: 'string', description: 'ETag from get_content_template (or the etag returned by create_content_template). Pass it back exactly as received, including its surrounding double-quote characters — do not strip them.' },
      patches: {
        type: 'array',
        description: 'Array of JSON Patch operations',
        items: {
          type: 'object',
          required: ['op', 'path'],
          properties: {
            op: { type: 'string', enum: ['add', 'remove', 'replace'], description: 'Use "add" for /parentFolderId, /tagIds, /labels (replace is auto-normalized to add for these).' },
            path: { type: 'string', description: 'Supported: /name, /description, /parentFolderId, /tagIds, /labels' },
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
      // Translate replace→add for /parentFolderId, /tagIds, /labels (members that may
      // not exist yet). patchTemplate already returns the { success, etag? } envelope.
      return await patchTemplate(templateId, normalizeMetadataPatches(patches), etag);
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  }, args);
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
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
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
  }, args);
}
