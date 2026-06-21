// Loader for the AJO personalization scenarios/strategy guidance.
//
// This is the "when/what to personalize" layer — the judgment rules an agent
// applies while authoring content (discovery process, data-source resolution order,
// collection/iteration detection, URL/image/date handling, coverage review). It
// complements the two other personalization references:
//   • get_personalization_syntax — HOW to write an expression (the syntax library)
//   • list_xdm_* / get_xdm_*      — WHICH real attribute paths exist in this sandbox
//
// Like the other reference bodies it's shipped as a Markdown asset (src/reference →
// copied to dist/reference by the build) and read once, then cached. Delivered to
// the model through the get_personalization_guidance tool (clients like Claude
// Desktop can't read MCP resources directly) and backs the
// ajo://personalization-guidance resource. A read failure degrades to a clear
// fallback string rather than throwing, so a missing asset can't break a request.

import { readFileSync } from 'fs';
import { join } from 'path';

// Compiled location is dist/mcp; the build copies src/reference → dist/reference,
// so the asset sits one level up in a sibling reference/ directory.
const GUIDANCE_PATH = join(__dirname, '..', 'reference', 'ajo-personalization-scenarios-guidance.md');

const FALLBACK =
  'The AJO personalization guidance could not be read on the server. ' +
  'Check that dist/reference/ajo-personalization-scenarios-guidance.md shipped with the build.';

let cache: string | null = null;

// The full personalization scenarios/strategy guidance, or a clear fallback message
// if the asset can't be read (a missing asset must never break a tool/resource).
export function getPersonalizationGuidance(): string {
  if (cache !== null) return cache;
  try {
    cache = readFileSync(GUIDANCE_PATH, 'utf8');
  } catch {
    cache = FALLBACK;
  }
  return cache;
}
