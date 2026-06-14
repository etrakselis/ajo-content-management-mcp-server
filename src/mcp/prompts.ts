import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export interface PromptDefinition {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
}

export const ALL_PROMPTS: PromptDefinition[] = [
  {
    name: 'discover-personalization-paths',
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
  }
];

export function getPromptMessages(
  name: string,
  args: Record<string, string> | undefined,
  tenantNamespace: string | null
): Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> {
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

Step 1 — Find custom field groups:
  Call list_xdm_field_groups with container "tenant" to list all customer-defined field groups. These are where non-standard personalization attributes live.

Step 2 — Inspect relevant field groups:
  For each field group title that looks relevant to the use case, call get_xdm_field_group with full=true to see its complete attribute tree. Custom attributes will be nested under the tenant namespace key (e.g. "${tenantExample}") inside the "properties" tree.

Step 3 (optional shortcut) — Get the complete Profile union:
  If you need the full merged view of every attribute available for Profile personalization, call list_xdm_union_schemas, identify the Profile union, then call get_xdm_union_schema with full=true. This gives the complete attribute set in one response.

Step 4 — Report findings:
  List the attribute paths you found with their correct personalization expression format, e.g. {{${tenantExample}.person.firstName}}. Explain what each attribute represents. If no relevant attributes were found, say so clearly so the user knows to check their schema configuration.`
          }
        }
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
  Tell the user whether publication succeeded or failed, and what the fragment's new status is.`
          }
        }
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
  Produce a concise summary with counts and a clearly labelled action-items section.`
          }
        }
      ];
    }

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
