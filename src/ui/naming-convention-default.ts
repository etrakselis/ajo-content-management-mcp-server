// Loader for the default content naming-convention / governance rules.
//
// Like the personalization syntax library, this is shipped as a Markdown asset
// (src/reference → copied to dist/reference by the build) rather than embedded in
// a TS template literal: it contains backticks (code spans) that would break the
// landing-page template string. It is read once and cached.
//
// The content pre-fills the naming-convention editor on the setup page, so an
// operator who simply toggles enforcement on (without editing) ships these rules
// to the connected LLM. They can also edit it or drop in their own .md file.

import { readFileSync } from 'fs';
import { join } from 'path';

// Compiled location is dist/ui, and the build copies src/reference → dist/reference,
// so the asset sits one level up in a sibling reference/ directory.
const DEFAULT_PATH = join(__dirname, '..', 'reference', 'ajo_content_asset_governance_rules.md');

let cache: string | null = null;

// The default naming-convention markdown, or '' if the asset can't be read (the
// editor then falls back to its placeholder — a missing default must never break
// the setup page).
export function getDefaultNamingConvention(): string {
  if (cache !== null) return cache;
  try {
    cache = readFileSync(DEFAULT_PATH, 'utf8');
  } catch {
    cache = '';
  }
  return cache;
}
