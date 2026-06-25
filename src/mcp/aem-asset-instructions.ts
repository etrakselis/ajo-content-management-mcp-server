// Loader for the AEM asset → AJO media-library embed-attribute retrieval guide.
//
// Like the Visual Email Designer spec, the personalization syntax library, and the
// naming-convention governance rules, this reference body is shipped as a Markdown
// asset (src/reference → copied to dist/reference by the build) and read once at
// first use, then cached — rather than embedded as a TS template literal. As an
// asset there's no backtick/${...} escaping to maintain, and the guide stays
// editable/reviewable as plain markdown.
//
// It is delivered to the model through the get_aem_image_embed_instructions tool
// (clients like Claude Desktop can't read MCP resources directly), and also backs
// the ajo://aem-image-embed-instructions resource. Because those consumers can't
// all cleanly handle a thrown error mid-request, a read failure degrades to a clear
// fallback string instead of throwing — the asset is copied by the build, so this
// should never trigger.

import { readFileSync } from 'fs';
import { join } from 'path';

// Compiled location is dist/mcp; the build copies src/reference → dist/reference,
// so the asset sits one level up in a sibling reference/ directory.
const INSTRUCTIONS_PATH = join(__dirname, '..', 'reference', 'aem-assetid-retrieval-instructions.md');

const FALLBACK =
  'The AEM image embed-attribute retrieval instructions could not be read on the server. ' +
  'Check that dist/reference/aem-assetid-retrieval-instructions.md shipped with the build.';

let cache: string | null = null;

// The full AEM asset embed-attribute retrieval guide, or a clear fallback message
// if the asset can't be read (a missing asset must never break a tool/resource).
export function getAemImageEmbedInstructions(): string {
  if (cache !== null) return cache;
  try {
    cache = readFileSync(INSTRUCTIONS_PATH, 'utf8');
  } catch {
    cache = FALLBACK;
  }
  return cache;
}
