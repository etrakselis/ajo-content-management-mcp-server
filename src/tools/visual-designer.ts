import { VISUAL_DESIGNER_REQUIREMENTS_TEXT } from '../mcp/resources.js';
import { withTelemetry, buildOutputSchema } from './utils.js';

// ─── get_visual_designer_requirements ─────────────────────────────────────────
// Delivers the full AJO Visual Email Designer HTML serialization spec through a
// channel the model can reach on its own: a tool. The spec also lives as the
// ajo://visual-designer-requirements resource, but in clients like Claude Desktop
// the model cannot enumerate or read MCP resources itself (resources are
// user-attach-only there), so a "read that resource" pointer is a dead end for
// the model. The four write tools' descriptions instruct the model to call THIS
// tool before constructing any "visual"-type HTML, so it always has the exact
// structure/component catalog and verbatim <head> it needs to produce markup the
// AJO designer keeps in drag-and-drop mode. No config required — pure reference.

export const getVisualDesignerRequirementsDefinition = {
  name: 'get_visual_designer_requirements',
  title: 'Get AJO Visual Email Designer HTML Requirements',
  outputSchema: buildOutputSchema({
    requirements: {
      type: 'string',
      description: 'The complete AJO Visual Email Designer HTML authoring spec (rules, structure/component catalog, required <head>, examples, checklist).'
    }
  }),
  description: `Return the COMPLETE, mandatory HTML authoring spec for the Adobe Journey Optimizer Visual Email Message Designer.

Call this BEFORE constructing the HTML for any "visual"-type email content via create_content_template, update_content_template, create_content_fragment, or update_content_fragment (templateType "html" / fragment type "html", channel "email"). Generic email HTML imports into the designer in Compatibility mode, which locks the user out of the drag-and-drop editor; only markup that follows this spec stays in full visual mode.

The returned spec contains everything needed to produce compliant markup: the non-negotiable rules, the fixed nesting chain, the complete structure catalog (exact data-structure-id / data-structure-name values), the complete component catalog (exact data-component-id values incl. version suffixes like button:2), the verbatim required <head> (with the content-version meta tag and named <style> blocks), the document shell, a known-good minimal template, and a pre-output checklist.

This is the same content as the ajo://visual-designer-requirements resource, exposed as a tool so the model can fetch it directly (clients such as Claude Desktop do not let the model read MCP resources on its own).

Example usage: {}

Returns: { success: true, requirements: "<full spec text>" }`,
  annotations: { title: 'Get AJO Visual Email Designer HTML Requirements', readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {}
  }
};

export async function handleGetVisualDesignerRequirements(_args?: unknown) {
  return withTelemetry('get_visual_designer_requirements', async () => {
    return { success: true, requirements: VISUAL_DESIGNER_REQUIREMENTS_TEXT };
  });
}
