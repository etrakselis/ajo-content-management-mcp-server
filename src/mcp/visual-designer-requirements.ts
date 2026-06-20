// Loader for the AJO Visual Email Designer HTML authoring spec.
//
// Like the personalization syntax library and the naming-convention governance
// rules, this large reference body is shipped as a Markdown asset (src/reference →
// copied to dist/reference by the build) and read once at first use, then cached —
// rather than embedded as a TS template literal. As a literal it had to escape the
// backticks and `${...}` sequences in its examples; as an asset there's no escaping
// at all, and the spec is editable/reviewable as plain markdown.
//
// It is delivered to the model through the get_visual_designer_requirements tool
// (clients like Claude Desktop can't read MCP resources directly), and also backs
// the ajo://visual-designer-requirements resource and the create-content prompt's
// embedded resource. Because those consumers can't all cleanly handle a thrown
// error mid-request, a read failure degrades to a clear fallback string instead of
// throwing — the asset is copied by the build, so this should never trigger.

import { readFileSync } from 'fs';
import { join } from 'path';

// Compiled location is dist/mcp; the build copies src/reference → dist/reference,
// so the asset sits one level up in a sibling reference/ directory.
const SPEC_PATH = join(__dirname, '..', 'reference', 'ajo-visual-designer-requirements.md');

const FALLBACK =
  'The AJO Visual Email Designer requirements could not be read on the server. ' +
  'Check that dist/reference/ajo-visual-designer-requirements.md shipped with the build.';

let cache: string | null = null;

// The full Visual Email Designer HTML spec, or a clear fallback message if the
// asset can't be read (a missing asset must never break a tool/resource/prompt).
export function getVisualDesignerRequirements(): string {
  if (cache !== null) return cache;
  try {
    cache = readFileSync(SPEC_PATH, 'utf8');
  } catch {
    cache = FALLBACK;
  }
  return cache;
}
