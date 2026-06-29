import { getAemImageEmbedInstructions } from '../mcp/aem-asset-instructions.js';
import { withTelemetry, buildOutputSchema } from './utils.js';

// ─── get_aem_image_embed_instructions ─────────────────────────────────────────
// Delivers the step-by-step procedure for resolving the three AJO media-library
// embed attributes (data-medialibrary-id / data-mediarepo-id /
// data-medialibrary-source) of an AEM DAM asset, using a SEPARATE AEM MCP server
// the model has access to alongside this one. Those attributes are what an AJO
// <img> needs so the image renders from (and stays linked to) AEM. The guide also
// lives as the ajo://aem-image-embed-instructions resource, but in clients like
// Claude Desktop the model cannot enumerate or read MCP resources itself
// (resources are user-attach-only there), so a "read that resource" pointer is a
// dead end. The create_/update_ content fragment and template tool descriptions
// instruct the model to call THIS tool whenever the content embeds an AEM image,
// so it always has the exact lookup procedure before writing the <img> tag. No
// config required — pure reference.

export const getAemImageEmbedInstructionsDefinition = {
  name: 'get_aem_image_embed_instructions',
  title: 'Get AEM Image Embed-Attribute Retrieval Instructions',
  outputSchema: buildOutputSchema({
    instructions: {
      type: 'string',
      description: 'The complete step-by-step guide for retrieving an AEM DAM asset\'s AJO embed attributes (data-medialibrary-id, data-mediarepo-id, data-medialibrary-source) via the AEM MCP server.'
    }
  }),
  description: `Return the COMPLETE step-by-step procedure for resolving the three AJO media-library embed attributes of an Adobe Experience Manager (AEM) DAM image.

Call this BEFORE embedding any AEM-hosted image into content you create or update with create_content_fragment, update_content_fragment, create_content_template, or update_content_template. An AJO <img> for an AEM asset carries three identifying attributes — data-medialibrary-id (urn:aaid:aem:<jcr:uuid>), data-mediarepo-id (the AEM author host), and data-medialibrary-source ("aem") — and without the correct values the image will not resolve from the media library.

This server does NOT fetch those values itself. The returned guide tells you how to obtain them through a SEPARATE AEM MCP server (one you have access to simultaneously, exposing AEM read/Sling Assets APIs): how to derive data-mediarepo-id from the environment author URL, confirm the folder and image exist, read the asset's jcr:uuid via the .1.json depth selector, and assemble the final <img> attributes — including the caveat that the DAM search index can return empty results and the direct Sling reads are the source of truth.

This is the same content as the ajo://aem-image-embed-instructions resource, exposed as a tool so the model can fetch it directly (clients such as Claude Desktop do not let the model read MCP resources on its own).

Example usage: {}

Returns: { success: true, instructions: "<full guide text>" }`,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {}
  }
};

export async function handleGetAemImageEmbedInstructions(_args?: unknown) {
  return withTelemetry('get_aem_image_embed_instructions', async () => {
    return { success: true, instructions: getAemImageEmbedInstructions() };
  }, _args);
}
