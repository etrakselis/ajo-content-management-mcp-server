// ─── get_reference (lean-mode umbrella) ───────────────────────────────────────
// A single dispatcher over the static reference documents this server ships. In
// lean mode (see isLeanMode) it REPLACES the individual reference get_* tools in
// the advertised tool list, so a context-constrained client sees one tool instead
// of five — while the underlying content is identical. The individual handlers stay
// registered even in lean mode (see TOOL_HANDLERS in mcp/server.ts), so any tool
// description that still names get_visual_designer_requirements etc. remains
// callable; get_reference is just the compact, discoverable entry point.
//
// Each topic maps 1:1 to one of the dedicated reference tools:
//   visual-designer          → get_visual_designer_requirements
//   aem-image-embed          → get_aem_image_embed_instructions
//   personalization-guidance → get_personalization_guidance
//   personalization-syntax   → get_personalization_syntax   (honors `category`)
//   email-scenario-faq       → get_email_scenario_faq

import { getVisualDesignerRequirements } from '../mcp/visual-designer-requirements.js';
import { getAemImageEmbedInstructions } from '../mcp/aem-asset-instructions.js';
import { getPersonalizationGuidance } from '../mcp/personalization-guidance.js';
import { getEmailScenarioFaq } from '../mcp/email-scenario-faq.js';
import {
  getPersonalizationIndex, getPersonalizationCategory,
  PERSONALIZATION_CATEGORY_SLUGS
} from '../mcp/personalization-syntax.js';
import { withTelemetry, buildOutputSchema } from './utils.js';

// topic slug → { the tool it stands in for, a one-line summary }. Order is display
// order in the tool description.
export const REFERENCE_TOPICS: Array<{ topic: string; equivalentTool: string; summary: string }> = [
  { topic: 'email-scenario-faq', equivalentTool: 'get_email_scenario_faq', summary: 'Triage checklist + clarifying-question playbook for creating/converting an AJO email. Start here.' },
  { topic: 'visual-designer', equivalentTool: 'get_visual_designer_requirements', summary: 'The complete native Visual Email Designer HTML authoring spec (structure/component catalog, required <head>).' },
  { topic: 'personalization-guidance', equivalentTool: 'get_personalization_guidance', summary: 'WHEN/WHAT to personalize: discovery process, data-source resolution, iteration, coverage review.' },
  { topic: 'personalization-syntax', equivalentTool: 'get_personalization_syntax', summary: 'HOW to write {{ }} / {%= %} expressions, helpers, conditionals, loops. Accepts a `category`.' },
  { topic: 'aem-image-embed', equivalentTool: 'get_aem_image_embed_instructions', summary: 'How to resolve an AEM DAM image\'s AJO embed attributes via the AEM MCP server.' }
];

export const REFERENCE_TOPIC_SLUGS = REFERENCE_TOPICS.map(t => t.topic);

const topicMenu = REFERENCE_TOPICS.map(t => `  - ${t.topic}: ${t.summary}`).join('\n');

export const getReferenceDefinition = {
  name: 'get_reference',
  title: 'Get AJO Reference Documentation',
  outputSchema: buildOutputSchema({
    topic: { type: 'string', description: 'The topic that was returned.' },
    content: { type: 'string', description: 'The full reference text for the requested topic.' },
    availableTopics: { type: 'array', items: { type: 'string' }, description: 'All topic slugs that can be requested.' },
    availableCategories: { type: 'array', items: { type: 'string' }, description: 'For topic "personalization-syntax": the syntax categories that can be passed as `category`.' }
  }),
  description: `Fetch an AJO reference document by topic. This is the single entry point for the server's built-in reference material — call it whenever a tool description tells you to "call get_<something>" for a spec, guide, or FAQ before authoring content.

Topics:
${topicMenu}

For topic "personalization-syntax" you may also pass a "category" (or "all"); omit it for the index + category menu. All other topics ignore "category".

Recommended email-authoring flow: get_reference topic=email-scenario-faq (triage) → topic=visual-designer (HTML format) → topic=personalization-guidance then topic=personalization-syntax (personalization) → the XDM schema tools for real attribute paths.

Example usage: { "topic": "visual-designer" }
Example usage: { "topic": "personalization-syntax", "category": "dates" }

Returns: { success: true, topic, content, availableTopics: [...], availableCategories?: [...] }`,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      topic: {
        type: 'string',
        enum: REFERENCE_TOPIC_SLUGS,
        description: 'Which reference document to return.'
      },
      category: {
        type: 'string',
        description: 'Only for topic "personalization-syntax": which syntax section to return (or "all"). Ignored for other topics.'
      }
    },
    required: ['topic']
  }
};

export async function handleGetReference(args?: unknown) {
  return withTelemetry('get_reference', async () => {
    const { topic, category } = (args ?? {}) as { topic?: string; category?: string };
    const base = { availableTopics: REFERENCE_TOPIC_SLUGS };

    switch (topic) {
      case 'visual-designer':
        return { success: true, topic, content: getVisualDesignerRequirements(), ...base };
      case 'aem-image-embed':
        return { success: true, topic, content: getAemImageEmbedInstructions(), ...base };
      case 'personalization-guidance':
        return { success: true, topic, content: getPersonalizationGuidance(), ...base };
      case 'email-scenario-faq':
        return { success: true, topic, content: getEmailScenarioFaq(), ...base };
      case 'personalization-syntax': {
        const availableCategories = PERSONALIZATION_CATEGORY_SLUGS;
        if (!category) {
          return { success: true, topic, content: getPersonalizationIndex(), availableCategories, ...base };
        }
        const content = getPersonalizationCategory(category);
        if (content === null) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Unknown personalization syntax category "${category}". Valid categories: ${[...availableCategories, 'all'].join(', ')}. Omit "category" for the index.`
            }
          };
        }
        return { success: true, topic, content, availableCategories, ...base };
      }
      default:
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Unknown reference topic "${topic ?? '(none)'}". Valid topics: ${REFERENCE_TOPIC_SLUGS.join(', ')}.`
          }
        };
    }
  }, args);
}
