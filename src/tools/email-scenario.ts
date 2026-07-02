import { getEmailScenarioFaq } from '../mcp/email-scenario-faq.js';
import { withTelemetry, buildOutputSchema } from './utils.js';

// ─── get_email_scenario_faq ───────────────────────────────────────────────────
// Delivers the AJO Email Scenario FAQ & clarifying-question playbook — the
// triage/conversation layer an agent applies when it is asked to CREATE a new AJO
// email or CONVERT an arbitrary input HTML email into an AJO-compatible template.
// It maps the personalization scenarios found in real retail/transactional emails
// (structure re-serialization, global variables, reusable header/footer fragments,
// preheader, product-feed item modules, sorting/eligibility/counters, price and
// text transforms, ratings, tracking/deep links, images → media library,
// recommendation trays, conditional content, execution metadata, compliance links)
// to their AJO solution AND — the point of the file — to the exact clarifying
// questions to ask so the content fragments and template land configured for the
// user's actual use case instead of guessed defaults.
//
// Exposed as a tool because clients like Claude Desktop can't enumerate/read MCP
// resources on their own (same rationale as get_visual_designer_requirements); it
// also backs the ajo://email-scenario-faq resource and the create-content prompt's
// embedded resource. This FAQ is the triage layer that sits ON TOP of the deeper
// references — after triaging with it, use get_visual_designer_requirements for the
// HTML format, get_personalization_guidance/syntax for personalization, and the XDM
// tools for real attribute paths. Pure reference; no config required.

export const getEmailScenarioFaqDefinition = {
  name: 'get_email_scenario_faq',
  title: 'Get AJO Email Scenario FAQ & Clarifying-Question Playbook',
  outputSchema: buildOutputSchema({
    faq: {
      type: 'string',
      description: 'The complete AJO email scenario FAQ: a triage checklist, the ~17 common email personalization scenarios (S0–S17) with their AJO solution, and — for each — the clarifying questions to ask the user, plus a master question list.'
    }
  }),
  description: `Return the AJO Email Scenario FAQ & clarifying-question playbook — the triage/conversation layer for authoring AJO email content.

Call this FIRST, before writing any markup, whenever the user asks you to:
  • CREATE a new Adobe Journey Optimizer email (template and/or fragments), or
  • CONVERT an existing HTML email the user provides into an AJO-compatible email.

It is a scenario catalog, not a one-shot spec. Use it to (1) RECOGNIZE which personalization scenarios the input/request contains (structure re-serialization, global variables, reusable header/footer fragments, preheader, product-feed item modules, sorting, eligibility filtering, counters/limits, price handling, text transforms, star ratings, tracking/deep-link/UTM URLs, images → media library, recommendation trays, conditional content, execution metadata, compliance links, and — first — data-source resolution), (2) RECALL what the AJO solution for each looks like, and (3) — the main purpose — ASK THE USER THE RIGHT CLARIFYING QUESTIONS so the content fragments and content template are configured for their specific use case rather than guessed defaults (event- vs audience-triggered? which values are profile vs event payload vs journey context vs dataset lookup? do header/footer fragments already exist? UTM conventions? sort/eligibility rules? etc.). Do not guess IDs, schema paths, dataset/event IDs, or business rules — triage, then ask, then build.

This is the triage layer. After using it, defer to the deeper references it points at:
- get_visual_designer_requirements — the native Visual Email Designer HTML serialization spec (so the result stays drag-and-drop editable, not Compatibility mode).
- get_personalization_guidance (what/when) + get_personalization_syntax (how) + list_xdm_field_groups / get_xdm_union_schema (real attribute paths for this sandbox).
- get_aem_image_embed_instructions — for AEM-hosted images.

This is the same content as the ajo://email-scenario-faq resource, exposed as a tool so the model can fetch it directly (clients such as Claude Desktop do not let the model read MCP resources on its own).

Example usage: {}

Returns: { success: true, faq: "<full FAQ text>" }`,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {}
  }
};

export async function handleGetEmailScenarioFaq(_args?: unknown) {
  return withTelemetry('get_email_scenario_faq', async () => {
    return { success: true, faq: getEmailScenarioFaq() };
  }, _args);
}
