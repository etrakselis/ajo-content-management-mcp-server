// Loader for the AJO Email Scenario FAQ & clarifying-question playbook.
//
// This is the "triage + conversation" layer for email work: given an arbitrary
// input HTML email (or a request to author a new one), it lets an agent (1)
// recognize which personalization scenarios the content contains, (2) recall
// roughly what the AJO solution for each looks like, and (3) — most importantly —
// know which clarifying questions to ask the user so the content fragments and
// content template end up configured for the user's actual use case. It sits ON
// TOP of the deeper references it points at:
//   • get_visual_designer_requirements — the native-HTML serialization spec (HOW to
//     structure the markup so it stays drag-and-drop editable)
//   • get_personalization_guidance / get_personalization_syntax — WHAT/WHEN and HOW
//     to personalize
//   • list_xdm_* / get_xdm_*        — WHICH real attribute paths exist in this sandbox
//
// Like the other reference bodies it's shipped as a Markdown asset (src/reference →
// copied to dist/reference by the build) and read once, then cached. Delivered to
// the model through the get_email_scenario_faq tool (clients like Claude Desktop
// can't read MCP resources directly) and backs the ajo://email-scenario-faq
// resource. A read failure degrades to a clear fallback string rather than
// throwing, so a missing asset can't break a request.

import { readFileSync } from 'fs';
import { join } from 'path';

// Compiled location is dist/mcp; the build copies src/reference → dist/reference,
// so the asset sits one level up in a sibling reference/ directory.
const FAQ_PATH = join(__dirname, '..', 'reference', 'ajo-email-scenario-faq.md');

const FALLBACK =
  'The AJO email scenario FAQ could not be read on the server. ' +
  'Check that dist/reference/ajo-email-scenario-faq.md shipped with the build.';

let cache: string | null = null;

// The full email scenario FAQ / clarifying-question playbook, or a clear fallback
// message if the asset can't be read (a missing asset must never break a tool/resource).
export function getEmailScenarioFaq(): string {
  if (cache !== null) return cache;
  try {
    cache = readFileSync(FAQ_PATH, 'utf8');
  } catch {
    cache = FALLBACK;
  }
  return cache;
}
