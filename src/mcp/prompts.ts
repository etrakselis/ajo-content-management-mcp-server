import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  RESOURCE_URIS,
  CHANNEL_REFERENCE_TEXT,
  ERROR_CODES_TEXT
} from './resources.js';
import { getVisualDesignerRequirements } from './visual-designer-requirements.js';
import { UI_BASE_URL } from '../tools/utils.js';

export interface PromptDefinition {
  name: string;
  title?: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
}

// A prompt message carries either plain text or an embedded resource. Embedding
// the canonical reference resources (channel shapes, error codes) directly in
// the prompt means the model has them inline while executing the workflow,
// instead of having to decide to fetch them — one fewer failure point.
type PromptContent =
  | { type: 'text'; text: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; text: string } };

type PromptMessage = { role: 'user' | 'assistant'; content: PromptContent };

// Build an embedded-resource message block from a static resource's canonical text.
function embeddedResource(uri: string, text: string, mimeType = 'text/plain'): PromptMessage {
  return { role: 'user', content: { type: 'resource', resource: { uri, mimeType, text } } };
}

export const ALL_PROMPTS: PromptDefinition[] = [
  {
    name: 'discover-personalization-paths',
    title: 'Discover Personalization Paths',
    description:
      'Look up the real XDM attribute paths available for personalization in this sandbox ' +
      'before inserting {{...}} expressions into templates or fragments. ' +
      'Prevents guessing standard XDM paths that may not exist in this customer\'s schema.',
    arguments: [
      {
        name: 'use_case',
        description: 'What you want to personalize, e.g. "greet by first name", "display loyalty tier", "show account balance"',
        required: false
      }
    ]
  },
  {
    name: 'publish-fragment',
    title: 'Publish Fragment (Async Workflow)',
    description:
      'Walk through the complete async publish-and-verify workflow for a content fragment: ' +
      'check current state, trigger publication, then poll until it completes or fails. ' +
      'Use this any time you need to make a fragment available for use in campaigns or journeys.',
    arguments: [
      {
        name: 'fragment_id',
        description: 'UUID of the fragment to publish',
        required: true
      }
    ]
  },
  {
    name: 'audit-content-library',
    title: 'Audit Content Library',
    description:
      'Survey all content templates and fragments in the sandbox, report counts by status, ' +
      'and surface any drafts that have never been published or fragments blocked from use in campaigns.',
    arguments: [
      {
        name: 'content_type',
        description: 'What to audit: "templates", "fragments", or "both" (default: "both")',
        required: false
      }
    ]
  },
  {
    name: 'create-content',
    title: 'Create Template or Fragment',
    description:
      'Walk through the full creation workflow for a content template or fragment: confirm the ' +
      'correct templateType and content shape for the target channel, look up real XDM personalization ' +
      'paths if the content addresses the recipient by name or references their data, confirm the ' +
      'complete payload with the user, then create the content.',
    arguments: [
      {
        name: 'channel',
        description: 'Target channel: email, push, sms, inapp, code, directMail, landingpage, or shared',
        required: true
      },
      {
        name: 'content_kind',
        description: '"template" (default) or "fragment". Fragments are only valid for email (html type) and shared (expression type) channels.',
        required: false
      },
      {
        name: 'name',
        description: 'Intended name for the new content item (will also be confirmed with the user during the workflow)',
        required: false
      },
      {
        name: 'use_case',
        description: 'What this content is for, e.g. "welcome email", "cart-abandon push notification", "loyalty tier greeting". Used to guide personalization lookup.',
        required: false
      }
    ]
  }
];

export function getPromptMessages(
  name: string,
  args: Record<string, string> | undefined,
  tenantNamespace: string | null
): PromptMessage[] {
  const tenantExample = tenantNamespace ?? '_yourtenant';

  switch (name) {
    case 'discover-personalization-paths': {
      const useCase = args?.use_case ?? 'general personalization';
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Discover the real XDM personalization attribute paths available in this sandbox for: "${useCase}"

Do NOT assume or invent attribute paths like {{profile.person.firstName}}. Every customer configures custom field groups under their own tenant namespace, so the actual paths must be looked up. Here is the correct lookup sequence:

Step 0 — Decide WHAT/WHEN to personalize:
  Call get_personalization_guidance first. It gives the strategy for this content — identifying every dynamic value, resolving each value's data source (profile vs. journey context vs. event payload vs. dataset lookup), detecting collections that require iteration, and a coverage checklist. Use it to build the list of attributes you then need to find paths for below.

Step 1 — Find custom field groups:
  Call list_xdm_field_groups with container "tenant" to list all customer-defined field groups. These are where non-standard personalization attributes live.

Step 2 — Inspect relevant field groups:
  For each field group title that looks relevant to the use case, call get_xdm_field_group with full=true to see its complete attribute tree. Custom attributes will be nested under the tenant namespace key (e.g. "${tenantExample}") inside the "properties" tree.

Step 3 (optional shortcut) — Get the complete Profile union:
  If you need the full merged view of every attribute available for Profile personalization, call list_xdm_union_schemas, identify the Profile union, then call get_xdm_union_schema with full=true. This gives the complete attribute set in one response.

Step 4 — Report findings:
  List the attribute paths you found with their correct personalization expression format, e.g. {{${tenantExample}.person.firstName}}. Explain what each attribute represents. If no relevant attributes were found, say so clearly so the user knows to check their schema configuration.

Step 5 — Get the expression SYNTAX (when the use case needs more than a bare attribute):
  Paths alone are not enough for conditionals, loops, formatting, fallbacks, or helper functions. For the AJO-native syntax, call get_personalization_syntax (no argument first for the index + category menu, then a category such as "core", "dates", "strings", "arrays", or "dataset-lookup"). Build expressions using ONLY the real paths from above and real AJO constructs — never JavaScript/Liquid/Jinja, and never invented function names.

The attached channel & content-type reference shows where these personalization expressions belong inside each template/fragment content shape.`
          }
        },
        embeddedResource(RESOURCE_URIS.channelReference, CHANNEL_REFERENCE_TEXT)
      ];
    }

    case 'publish-fragment': {
      const fragmentId = args?.fragment_id;
      if (!fragmentId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required argument: fragment_id (UUID of the fragment to publish)');
      }
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Publish content fragment ${fragmentId} and verify the publication completes successfully.

Publication in AJO is asynchronous — the API accepts the request immediately but the actual publication runs in the background. You must poll to confirm it succeeded.

Step 1 — Check current state:
  Call get_content_fragment with fragmentId "${fragmentId}". Confirm the fragment exists and note its current status. If it is already PUBLISHED and has no pending changes, tell the user it is already live and stop.

Step 2 — Trigger publication:
  Call publish_content_fragment with fragmentId "${fragmentId}". A successful response returns accepted: true with a retryAfter value (typically 5 seconds).

Step 3 — Poll for completion:
  Wait approximately 5 seconds, then call get_fragment_publication_status with fragmentId "${fragmentId}".
  - If status is "inProgress": wait another 5 seconds and check again. Repeat up to 6 times (30 seconds total).
  - If status is "complete": the fragment is now live. Confirm this to the user.
  - If status is "error": report the full errors array to the user. Do not retry automatically — let the user decide how to resolve the error.

Step 4 — Report outcome:
  Tell the user whether publication succeeded or failed, and what the fragment's new status is.

If any tool call returns an error, consult the attached error-code reference for its cause and the correct recovery action before deciding what to do next.`
          }
        },
        embeddedResource(RESOURCE_URIS.errorCodes, ERROR_CODES_TEXT)
      ];
    }

    case 'audit-content-library': {
      const rawContentType = args?.content_type ?? 'both';
      const contentType = (['templates', 'fragments', 'both'] as const).includes(rawContentType as 'templates' | 'fragments' | 'both')
        ? rawContentType as 'templates' | 'fragments' | 'both'
        : 'both';
      const doTemplates = contentType === 'templates' || contentType === 'both';
      const doFragments = contentType === 'fragments' || contentType === 'both';

      const sections: string[] = [];

      if (doTemplates) {
        sections.push(`Templates audit:
  a. Call list_content_templates with limit 100 to retrieve the first page of templates.
     If the response contains a _page.next cursor, call list_content_templates again with
     start: <_page.next value> and merge the results. Repeat until _page.next is absent.
  b. Group the accumulated results by templateType (html, content, etc.) and by channel (email, push, sms, etc.).
  c. Note the modifiedAt timestamp for each — flag any templates not modified in over 90 days as potentially stale.
  d. Report total count, breakdown by type/channel, and any stale items.`);
      }

      if (doFragments) {
        sections.push(`Fragments audit:
  a. Call list_content_fragments with limit 100 to retrieve the first page of fragments.
     If the response contains a _page.next cursor, call list_content_fragments again with
     start: <_page.next value> and merge the results. Repeat until _page.next is absent.
  b. Group the accumulated results by status: PUBLISHED, DRAFT, ARCHIVED.
  c. For each DRAFT fragment, call get_fragment_publication_status to check whether a publication has ever been attempted and whether any previous attempt errored.
  d. Flag the following as action items:
     - DRAFT fragments with no publication history → cannot be used in campaigns; must be published first.
     - DRAFT fragments with publication status "error" → publication previously failed; user needs to investigate.
     - DRAFT fragments with publication status "inProgress" → a publication is already running.`);
      }

      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Audit the AJO content library in this sandbox and produce a structured status report.

${sections.join('\n\n')}

Output format:
  Produce a concise summary with counts and a clearly labelled action-items section.

Use the attached channel & content-type reference as the canonical list of valid templateType and channel values when grouping results.`
          }
        },
        embeddedResource(RESOURCE_URIS.channelReference, CHANNEL_REFERENCE_TEXT)
      ];
    }

    case 'create-content': {
      const channel = args?.channel;
      if (!channel) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required argument: channel');
      }
      const contentKind = args?.content_kind ?? 'template';
      const isFragment = contentKind === 'fragment';
      const name = args?.name;
      const useCase = args?.use_case ?? 'general purpose';

      if (isFragment && channel !== 'email' && channel !== 'shared') {
        throw new McpError(ErrorCode.InvalidParams,
          `Fragments are only supported for "email" (html) and "shared" (expression) channels. ` +
          `Channel "${channel}" only supports templates. Set content_kind to "template" or change the channel.`
        );
      }

      const channelToTemplateType: Record<string, string> = {
        // New email templates default to "content" — it carries the subject line
        // and its html.body is still drag-and-drop editable. (templateType "html"
        // is the legacy, subject-less form, only for editing existing designs.)
        email: 'content',
        push: 'content',
        sms: 'content',
        inapp: 'content',
        code: 'content',
        directMail: 'content',
        landingpage: 'html_primary_page',
        shared: 'content'
      };
      const templateType = channelToTemplateType[channel] ?? 'content';
      const fragmentType = channel === 'shared' ? 'expression' : 'html';
      const fragmentChannels = channel === 'shared' ? ['shared'] : ['email'];

      const createTool = isFragment ? 'create_content_fragment' : 'create_content_template';
      const nameHint = name ? `"${name}"` : '<name confirmed with user>';

      const typeAndShapeHint = isFragment
        ? `type "${fragmentType}", channels: ${JSON.stringify(fragmentChannels)}${fragmentType === 'expression' ? ', subType: "TEXT" | "HTML" | "JSON" (required for expression fragments)' : ''}, fragment: { ... }`
        : `templateType "${templateType}", channels: ["${channel}"]${channel === 'code' ? ', subType: "HTML" | "JSON" (required for code)' : ''}, template: { ... }`;

      const isVisualEmail = channel === 'email';
      const visualEmailStep = isVisualEmail ? `
Step 1b — Read the Visual Email Designer requirements (MANDATORY for this channel):
  The HTML you produce must use AJO's native serialization format. Generic email HTML
  will force the designer into Compatibility mode and lock the user out of drag-and-drop
  editing. The attached visual-designer-requirements resource (below) contains all
  mandatory rules, the complete structure and component catalogs, and the required <head>
  block. Read it in full before constructing any HTML content.
` : '';

      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create a new ${isFragment ? 'content fragment' : 'content template'} for the ${channel} channel${name ? ` named "${name}"` : ''} (use case: ${useCase}).

Use the attached channel & content-type reference to confirm the correct shape before constructing any payload.

Step 1 — Confirm the content shape:
  Look up "${channel}" in the reference. The correct shape is:
    ${typeAndShapeHint}
  Confirm with the user what the actual body content should be.
${channel === 'landingpage' ? '  Note: use "html_primary_page" for the main page and "html_sub_page" for confirmation/thank-you pages.\n' : ''}${visualEmailStep}
Step 2 — Look up personalization paths and syntax (skip if the content has no personalization):
  a. PATHS: If the content will address the recipient by name or reference their data, call list_xdm_field_groups with container "tenant" to list all customer-defined field groups. For any group whose title is relevant to "${useCase}", call get_xdm_field_group with full=true. Custom attributes are nested under the tenant namespace key (e.g. "${tenantExample}") in the "properties" tree. Do NOT guess paths like {{profile.person.firstName}} — use only what you find.
  b. SYNTAX: For anything beyond a bare attribute (conditionals, loops, date/string/number formatting, fallbacks, helpers, dataset lookup), call get_personalization_syntax (no argument for the index + category menu, then the relevant category). Use only real AJO-native constructs — never JavaScript/Liquid/Jinja or invented function names.

Step 3 — Confirm the complete payload with the user:
  Before creating anything, show the user the full JSON payload you plan to send and ask them to confirm or adjust it. Include the name, type/channel, and all content fields.

Step 4 — Create the content:
  Once the user confirms, call ${createTool} with:
    { "name": ${nameHint}, ${typeAndShapeHint} }
  Write access must be enabled. If you receive READ_ONLY_MODE, tell the user to enable write access at ${UI_BASE_URL}, then retry.

Step 5 — Report outcome:
  On success, tell the user the new ${isFragment ? 'fragment' : 'template'} ID and confirm it was created.${isFragment ? '\n  Remind the user that a fragment must be published before it can be used in campaigns — use the "publish-fragment" prompt for the full async publication workflow.' : ''}`
          }
        },
        embeddedResource(RESOURCE_URIS.channelReference, CHANNEL_REFERENCE_TEXT),
        ...(isVisualEmail ? [embeddedResource(RESOURCE_URIS.visualDesignerRequirements, getVisualDesignerRequirements())] : [])
      ];
    }

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
