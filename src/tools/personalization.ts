import {
  getPersonalizationIndex, getPersonalizationCategory,
  PERSONALIZATION_CATEGORY_SLUGS, PERSONALIZATION_CATEGORIES
} from '../mcp/personalization-syntax.js';
import { withTelemetry, buildOutputSchema } from './utils.js';

// ─── get_personalization_syntax ───────────────────────────────────────────────
// Delivers the AJO personalization syntax library (native expression language,
// helper functions, operators, contextual iteration, dataset lookup) to the model
// through a tool — the only channel clients like Claude Desktop can reach on their
// own (same rationale as get_visual_designer_requirements). The library is large,
// so it is served one category at a time: no argument returns the index + a syntax
// primer + the category menu; a `category` returns that full section; "all" returns
// everything. The create_/update_ content tools and the create-content /
// discover-personalization-paths prompts point the model here before it writes any
// {{ }} / {%= %} expressions into a template or fragment body.

const categoryMenu = PERSONALIZATION_CATEGORIES
  .map(c => `  - ${c.slug}: ${c.title}`)
  .join('\n');

export const getPersonalizationSyntaxDefinition = {
  name: 'get_personalization_syntax',
  title: 'Get AJO Personalization Syntax',
  outputSchema: buildOutputSchema({
    category: { type: 'string', description: 'The category returned ("index" when no category was requested).' },
    syntax: { type: 'string', description: 'The requested personalization-syntax reference text.' },
    availableCategories: { type: 'array', items: { type: 'string' }, description: 'All category slugs that can be requested.' }
  }),
  description: `Return AJO-native personalization SYNTAX for embedding dynamic content (expressions, helper functions, conditionals, loops) inside a content template or fragment body.

Call this BEFORE writing any {{ }} or {%= %} personalization into create_content_template, update_content_template, create_content_fragment, or update_content_fragment, so you use only real AJO constructs (never JavaScript / Liquid / Jinja / generic Handlebars, and never invented function names).

The library is large, so it is served one category at a time:
- Call with NO argument first to get the index: a syntax primer plus the menu of categories.
- Then call again with a "category" to get that full section. Categories:
${categoryMenu}
- Pass category "all" to retrieve the entire library at once (large).

This covers SYNTAX only. The real attribute PATHS for this sandbox are a separate lookup — use the discover-personalization-paths prompt or list_xdm_field_groups / get_xdm_union_schema, and do NOT guess paths like {{profile.person.firstName}}.

Example usage: {}  (returns the index)
Example usage: { "category": "dates" }
Example usage: { "category": "dataset-lookup" }

Returns: { success: true, category: "...", syntax: "<reference text>", availableCategories: [...] }`,
  annotations: { title: 'Get AJO Personalization Syntax', readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      category: {
        type: 'string',
        enum: [...PERSONALIZATION_CATEGORY_SLUGS, 'all'],
        description: 'Which section to return. Omit to get the index + category menu. Use "all" for the entire library.'
      }
    }
  }
};

export async function handleGetPersonalizationSyntax(args?: unknown) {
  return withTelemetry('get_personalization_syntax', async () => {
    const category = (args as { category?: string } | undefined)?.category;
    if (!category) {
      return { success: true, category: 'index', syntax: getPersonalizationIndex(), availableCategories: PERSONALIZATION_CATEGORY_SLUGS };
    }
    try {
      const syntax = getPersonalizationCategory(category);
      if (syntax === null) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Unknown personalization syntax category "${category}". Valid categories: ${[...PERSONALIZATION_CATEGORY_SLUGS, 'all'].join(', ')}. Call with no argument for the index.`
          }
        };
      }
      return { success: true, category, syntax, availableCategories: PERSONALIZATION_CATEGORY_SLUGS };
    } catch {
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The personalization syntax library asset could not be read on the server. Check that dist/reference/ajo-personalization-syntax-library.md shipped with the build.'
        }
      };
    }
  });
}
