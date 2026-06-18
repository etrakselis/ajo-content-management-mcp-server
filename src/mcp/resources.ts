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
  personalizationSyntax: 'ajo://personalization-syntax',
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
    uri: RESOURCE_URIS.personalizationSyntax,
    title: 'AJO Personalization Syntax Library',
    description: 'AJO-native personalization syntax to embed in template/fragment bodies: expression language, helper functions, operators, contextual-data iteration, dataset lookup. Served by category to keep responses small.',
    access: 'Call the get_personalization_syntax tool (no argument for the index + category menu, then a "category" for each section). This is SYNTAX only — get real attribute paths via the discover-personalization-paths prompt or list_xdm_field_groups / get_xdm_union_schema.'
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

export const VISUAL_DESIGNER_REQUIREMENTS_TEXT = `AJO Visual Email Designer — HTML Authoring Requirements
=========================================================

You generate HTML email content for the Adobe Journey Optimizer Visual Email Message Designer.
Your output must import into the designer in full drag-and-drop mode and must NEVER fall back
to Compatibility mode. If any required marker is missing, malformed, or unrecognized, the
import drops to Compatibility mode and the user loses drag-and-drop editing.

The HTML is AJO's own native serialization format, not generic email HTML. Treat every rule
below as mandatory.

━━━ NON-NEGOTIABLE RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. The outermost layer of <body> must be <div class="acr-container">, NEVER a <table>.
2. Preserve the acr- class namespace exactly: acr-container, acr-structure, acr-fragment,
   acr-component, acr-grid, acr-grid-table, acr-grid-column, acr-preheader, acr-body.
3. Every layout row is .acr-structure and must carry both data-structure-id and
   data-structure-name using a matching pair from the structure catalog below.
4. Every content block is .acr-fragment.acr-component and must carry a data-component-id
   from the component catalog, plus its matching typed inner container. Use the
   data-component-id value EXACTLY as written, including any version suffix (e.g. button:2).
5. The nesting chain is fixed and may not be shortened or reordered.
6. Include the content-version meta tag and all named <style data-name="..."> blocks
   verbatim (provided below). Copy the entire <head> as-is.
7. Editability flags are required: the component shell gets data-contenteditable="false";
   the actual editable region inside gets data-contenteditable="true".
8. Empty columns and empty components carry the is-empty class
   (e.g. <th class="colspan1 is-empty">, <div class="acr-fragment acr-component is-empty" ...>).
9. Components that draw chrome (image, button, divider, social, container) require their MSO
   conditional comment wrapper and data-has-int-mso-hack="true".
10. Use inline styles for custom styling, keep custom CSS minimal, output a single complete
    well-formed HTML document with no stray commentary (only required MSO comments).

━━━ FIXED NESTING CHAIN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

body#acr-body
└─ div.acr-container
   └─ div.acr-structure[data-structure-id][data-structure-name]
      └─ table.structure__table (align="center" cellpadding="0" cellspacing="0" border="0" width="750")
         └─ tbody
            └─ tr[role="presentation"]
               └─ th.colspanN  (one <th> per column; add "is-empty" if the column is empty)
                  └─ div.acr-fragment.acr-component[data-component-id][data-contenteditable="false"]
                     └─ typed inner container (matches the component-id)

- width="750" is the desktop content width. Keep it.
- Structure columns use <th class="colspanN">. Grid cells use <td class="acr-grid-column">.
- Stack multiple rows as sibling .acr-structure divs inside the single .acr-container.

━━━ STRUCTURE CATALOG (9 layouts — use ONLY these values) ━━━━━━━━━━━━━━━━━━

Layout              | data-structure-id    | data-structure-name                  | <th> classes (in order)      | Widths
1 column            | 1-1-column           | richtext.structure_1_1_column        | colspan1                     | 100%
2 col, narrow-left  | 1-2-column-left      | richtext.structure_1_2_column_left   | colspan33 + colspan66        | 33/66
2 col, wide-left    | 2-1-column-right     | richtext.structure_2_1_column_right  | colspan66 + colspan33        | 66/33
2 col, narrow-left2 | 1-3-column-left      | richtext.structure_1_3_column_left   | colspan4 + colspan3          | 25/75
2 col, wide-left2   | 3-1-column-right     | richtext.structure_3_1_column_right  | colspan3 + colspan4          | 75/25
2 col, equal        | 2-2-column           | richtext.structure_2_2_column        | colspan2 + colspan2          | 50/50
3 col, equal        | 3-3-column           | richtext.structure_3_3_column        | colspan33 ×3                 | 33/33/33
4 col, equal        | 4-4-column           | richtext.structure_4_4_column        | colspan4 ×4                  | 25×4
N col, custom equal | n-n-column           | richtext.structure_n_n_column        | colspan-n ×N                 | equal split

Column widths from stylesheet: colspan1=100%, colspan2=50%, colspan3=75%, colspan4=25%,
colspan33=33%, colspan66=66%, colspan-n=variable equal-width.

Structure skeleton (example: equal two-column):
<div class="acr-structure" data-structure-id="2-2-column" data-structure-name="richtext.structure_2_2_column">
  <table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="750"><tbody>
    <tr role="presentation">
      <th class="colspan2"><!-- component(s) or class="colspan2 is-empty" --></th>
      <th class="colspan2"><!-- component(s) --></th>
    </tr>
  </tbody></table>
</div>

━━━ EMBEDDING FRAGMENTS IN TEMPLATES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Fragments are reusable blocks of .acr-structure rows. When a fragment is
referenced inside a template, its rows must be inlined as DIRECT children of
.acr-container — the same level as any other .acr-structure row.

Two mandatory rules:
1. No wrapper div. Do NOT wrap fragment rows in any container element
   (e.g. <div data-fragment="...">...</div>). The fixed nesting chain requires
   .acr-structure divs to be direct children of .acr-container; any intervening
   element breaks the chain and forces Compatibility mode.
2. data-fragment goes on each .acr-structure row. Place the
   data-fragment="ajo:<uuid>" attribute directly on every .acr-structure div
   that belongs to the fragment — never on a wrapper.

Publication is NOT required to embed a fragment. A DRAFT fragment embeds and
renders correctly in the designer. Publishing a fragment is only needed to use
it in a live AJO campaign or journey — which is outside the scope of this MCP
server — so do NOT publish a fragment merely to embed it in a template. (And
note: publishing is irreversible — AJO has no way to unpublish.)

Correct pattern (data-fragment on each row; template-owned rows have none):
<div class="acr-container">
  <div class="acr-structure" data-structure-id="1-1-column" data-structure-name="richtext.structure_1_1_column" data-fragment="ajo:b8c78fe7-7ca3-47b4-9782-e50fd3534cb9">
    <table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="750">...</table>
  </div>
  <div class="acr-structure" data-structure-id="1-1-column" data-structure-name="richtext.structure_1_1_column" data-fragment="ajo:b8c78fe7-7ca3-47b4-9782-e50fd3534cb9">
    <table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="750">...</table>
  </div>
  <div class="acr-structure" data-structure-id="1-1-column" data-structure-name="richtext.structure_1_1_column">
    <table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="750">...</table>
  </div>
</div>

WRONG — a wrapper div around fragment rows forces Compatibility mode:
<div class="acr-container">
  <div data-fragment="ajo:b8c78fe7-...">   <!-- DO NOT DO THIS -->
    <div class="acr-structure" ...>...</div>
    <div class="acr-structure" ...>...</div>
  </div>
</div>

Fragment URI syntax — the data-fragment value MUST use one of these prefixes:
- ajo:<uuid>       — fragment created natively in AJO
- aem:<uuid>       — fragment sourced from AEM
- external:<uuid>  — fragment from an external source
A bare UUID (no prefix) is invalid and produces "Forbidden: fragment URI syntax
is incorrect". A DRAFT (unpublished) fragment with a correct URI embeds fine.

━━━ COMPONENT CATALOG (9 content types — use ONLY these values) ━━━━━━━━━━━━

Component      | data-component-id | MSO wrapper
Text           | text              | No
Image          | image             | Yes
Button         | button:2          | Yes (VML roundrect)
Divider        | divider           | Yes (nested tables)
Social         | social            | Yes
Grid           | grid              | No
Container      | container         | Yes
HTML (custom)  | html              | No
Offer decision | offer-decision    | No

Text:
<div class="acr-fragment acr-component" data-component-id="text" data-contenteditable="false">
  <div class="text-container" data-contenteditable="true"><p>Please type your text here.</p></div>
</div>

Image:
<div class="acr-fragment acr-component image-container" data-component-id="image" style="width:100%;text-align:center;" data-has-int-mso-hack="true" data-contenteditable="false">
  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="text-align: center;" ><![endif]-->
  <img class width="750" height="auto" data-medialibrary-id="urn:aaid:aem:REPLACE" data-mediarepo-id="REPLACE" data-medialibrary-source="aem" style="height:auto;width:100%;" src="images/REPLACE.jpeg">
  <!--[if mso]></td></tr></table><![endif]-->
</div>

Button (note versioned id button:2; <a> carries class="arc-link"):
<div class="acr-fragment acr-component" data-component-id="button:2" style="width:100%;text-align:center;" data-has-int-mso-hack="true" data-contenteditable="false"><!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="140"><tr><td style="text-align: center;" ><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" style="height:24pt; width:108pt; v-text-anchor:middle;" arcsize="47%" fillcolor="none" strokeweight="1.5pt" strokecolor="rgb(39, 39, 39)"><v:stroke dashstyle="solid" /><v:textbox inset="0,0,0,0"><center style="color:rgb(39, 39, 39); font-family:sans-serif; font-size:16px; text-align:center;"><![endif]--><a href="#" class="arc-link" style="text-decoration:none;">
    <div class="button-container" style="max-width:100%;display:inline-block;width:140px;text-align:center;margin:auto;border:2px solid rgb(39, 39, 39);border-radius:15px;height:28px;line-height:28px;" data-contenteditable="true">
      <span style="line-height:28px;color:rgb(39, 39, 39);" data-contenteditable="true">Button</span>
    </div>
  </a><!--[if mso]></center></v:textbox></v:stroke></v:roundrect></td></tr></table><![endif]--></div>

Divider:
<div class="acr-fragment acr-component divider-container" data-component-id="divider" style="text-align:center;" data-has-int-mso-hack="true" data-contenteditable="false"><!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td valign="top" style="padding: 5px 0px;" ><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="height: 1px; background-color: rgb(9, 90, 186); text-align: center;" ><![endif]--><div class="divider-mso-hidden" style="border-top-width:1px;border-top-style:solid;border-top-color:#095ABA;width:100%;display:inline-block;height:0px;line-height:0px;font-size:0px;"> </div><!--[if mso]></td></tr></table></td></tr></table><![endif]--></div>

Social:
<div class="acr-fragment acr-component" data-component-id="social" data-social-theme="color" style="width:100%;text-align:center;" data-has-int-mso-hack="true" data-contenteditable="false"><!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="text-align: center;" ><![endif]-->
  <table style="width:auto;display:inline-block;"><tbody>
    <tr class="component-social-container">
      <td style="padding:5px;"><a style="text-decoration:none;" href="https://www.facebook.com" data-component-social-icon-id="facebook"><img width="25" style="height:25px;width:25px;" alt="Facebook" data-medialibrary-id="urn:aaid:aem:..." data-mediarepo-id="..." data-medialibrary-source="aem"></a></td>
    </tr>
  </tbody></table>
<!--[if mso]></td></tr></table><![endif]--></div>

Grid:
<div class="acr-fragment acr-component acr-grid" data-component-id="grid" data-contenteditable="false">
  <table class="acr-grid-table"><tbody>
    <tr><td class="acr-grid-column is-empty"></td><td class="acr-grid-column is-empty"></td></tr>
  </tbody></table>
</div>

Container:
<div class="acr-fragment acr-component" data-component-id="container" style="padding:10px;" data-contenteditable="false"><!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding: 10px;"><![endif]--><div class="container-wrapper is-empty">
  </div><!--[if mso]></td></tr></table><![endif]--></div>

HTML custom code (empty shell):
<div class="acr-fragment acr-component is-empty" data-component-id="html" data-contenteditable="false"></div>

Offer decision (empty shell):
<div class="acr-fragment acr-component is-empty" data-component-id="offer-decision" data-contenteditable="false"></div>

━━━ REQUIRED <head> (copy verbatim) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<head>
<meta charset="utf-8"><meta name="content-version" content="3.3.59"><meta name="x-apple-disable-message-reformatting"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style data-name="default" type="text/css">body{font-family:sans-serif;margin:0 !important;padding:0 !important;background:#FFFFFF;min-width:750px;}td,th{padding:0;}th{font-weight:normal;text-align:left;}.acr-fragment,.acr-component{padding:0;}.acr-fragment img,.acr-component img{vertical-align:middle;}.divider-container{padding:5px 0;font-size:0;}.text-container p{margin:0;}.text-container ul,.text-container ol{padding-left:40px;}.image-container{line-height:0;}.image-container img{height:auto;}.button-container a{text-decoration:none;color:inherit;}.acr-structure{background-size:auto;background-repeat:no-repeat;}.structure__table{table-layout:fixed;margin:0 auto;border-spacing:0;background-size:auto;background-repeat:no-repeat;}.colspan1,.colspan2,.colspan3,.colspan4,.colspan33,.colspan66,.colspan-n{background-size:auto;background-repeat:no-repeat;box-sizing:border-box;}.colspan1{width:100%;}.colspan2{width:50%;}.colspan3{width:75%;}.colspan4{width:25%;}.colspan33{width:33%;}.colspan66{width:66%;}.acr-grid-column{box-sizing:border-box;}.component-social-container{width:100%;text-align:center;}span.preheader{display:none !important;visibility:hidden;opacity:0;}.ExternalClass{width:100%;}.ExternalClass,.ExternalClass p,.ExternalClass span,.ExternalClass font,.ExternalClass td,.ExternalClass div{line-height:100%;}h1,h2,h3,h4,h5{display:block;font-weight:bold;}h1{font-size:24px;margin:19px 0;}h2{font-size:24px;margin:20px 0;}h3{font-size:19px;margin:19px 0;}h4{font-size:16px;margin:21px 0;}h5{font-size:13px;margin:22px 0;}h6{font-size:11px;margin:25px 0;}.text-container p,.text-container li,.text-container div{font-size:16px;}@media (min-width:500px){.is-desktop-hidden,.is-mobile-visible{display:none !important;}.is-desktop-visible{display:block !important;}th.is-desktop-visible{display:table-cell !important;}}.acr-dark-img{display:none;}</style><style data-name="grid" type="text/css">.acr-grid-table{width:100%;table-layout:fixed;border-spacing:0;}.acr-grid-column,.acr-repeat-grid-column{box-sizing:border-box;}@media screen and (max-width: 500px){.acr-grid-table td{display:block;min-width:100%;}}</style><style data-name="media-default-max-width-500px" type="text/css">@media screen and (max-width: 500px){body,#acr-body{width:100%!important;min-width:0!important;}.structure__table{width:100%!important;}.colspan1,.colspan2,.colspan3,.colspan4,.colspan33,.colspan66,.colspan-n{display:block!important;min-width:100%;}.is-mobile-hidden,.is-desktop-visible{display:none!important;}.is-mobile-visible{display:block!important;}}</style><style data-name="media-custom-prefers-color-scheme-dark" type="text/css">@media (prefers-color-scheme: dark){.acr-dark-img{display:inline-block!important;}.acr-light-img{display:none!important;}}</style><!--[if gte mso 9]><style acrite-mso-css="true">.image-container div {  display: block;}.structure__table td {  padding: 0;  border: none;}.button-container {  border: none !important;  padding: 0 !important;  margin: 0 !important;  line-height: normal !important;}.acr-structure {  margin: 0 !important;}.acr-component, .acr-tmp-component {  margin: 0 !important;  border: none !important;}.acr-fragment {  margin: 0 !important;  border: none !important;}.colspan1, .colspan2, .colspan3, .colspan4, .colspan33, .colspan66, .colspan-n {  box-sizing: border-box !important;}.acr-grid-column {  box-sizing: border-box !important;}.divider-mso-hidden {  border: none !important;}.structure__table {  mso-table-lspace: 0pt !important;  mso-table-rspace: 0pt !important;}span.preheader {  mso-hide: all;}.mso-is-desktop-hidden,.mso-is-desktop-hidden table {  mso-hide: all;}</style><![endif]-->
</head>

━━━ DOCUMENT SHELL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<!DOCTYPE html>
<html class><head>
<!-- the full required <head> from above -->
</head><body class id="acr-body"><span style="display:none !important;visibility:hidden;mso-hide:all;opacity:0;" class="acr-preheader">preheader goes here</span><div class="acr-container">
  <!-- one or more .acr-structure blocks here -->
</div></body></html>

━━━ MINIMAL KNOWN-GOOD TEMPLATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<!DOCTYPE html>
<html class><head>
<!-- full required <head> -->
</head><body class id="acr-body"><span style="display:none !important;visibility:hidden;mso-hide:all;opacity:0;" class="acr-preheader">preheader goes here</span><div class="acr-container"><div class="acr-structure" data-structure-id="1-1-column" data-structure-name="richtext.structure_1_1_column"><table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="750"><tbody><tr role="presentation"><th class="colspan1"><div class="acr-fragment acr-component" data-component-id="text" data-contenteditable="false"><div class="text-container" data-contenteditable="true"><p>Please type your text here.</p></div></div></th></tr></tbody></table></div></div></body></html>

━━━ PRE-OUTPUT CHECKLIST ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- <!DOCTYPE html> present; full required <head> copied verbatim (incl. content-version meta + all 4 named style blocks + MSO conditional style).
- <body class id="acr-body">; first child is <div class="acr-container"> (never a table).
- Every row is .acr-structure with a matching data-structure-id + data-structure-name pair from the catalog.
- Column <th> colspan classes match the chosen structure's defined columns, in order.
- Every content block is .acr-fragment.acr-component with a catalog data-component-id (exact, incl. button:2) and its matching inner container.
- MSO conditional wrappers + data-has-int-mso-hack="true" present on image, button, divider, social, container.
- Component shells data-contenteditable="false"; editable regions data-contenteditable="true".
- Empty columns/components carry is-empty; populated ones do not.
- Only catalog values used — no invented structure or component identifiers.
- Single well-formed HTML document, minimal custom CSS, no stray inline commentary.`;

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
