// Loader + category splitter for the AJO personalization syntax library.
//
// The library is a large (~38K-token) Markdown reference covering AJO's native
// personalization language (Handlebars-style expressions, helper functions,
// operators, contextual-data iteration, dataset lookup). Unlike the other
// reference bodies in resources.ts, this one CANNOT be embedded as a TS template
// literal: it contains 900+ backticks and several `${...}`-style sequences (e.g.
// `${%= sum(...) %}`) that would be parsed as template interpolation. So it lives
// as a shipped asset (src/reference → copied to dist/reference by the build) and
// is read + parsed once at first use, then cached.
//
// It is delivered to the model through the get_personalization_syntax tool
// (clients like Claude Desktop can't read MCP resources directly, so a tool is the
// only reliable channel — same rationale as get_visual_designer_requirements).
// The tool serves one category at a time so a typical request pulls a few hundred
// lines instead of the whole library.

import { readFileSync } from 'fs';
import { join } from 'path';

const LIBRARY_PATH = join(__dirname, '..', 'reference', 'ajo-personalization-syntax-library.md');

// Each top-level section of the library begins with a header of the form
// "# Adobe Journey Optimizer (AJO) <something> (Reference|Guide|Specification) for LLMs".
const SECTION_HEADER_RE = /^# Adobe Journey Optimizer \(AJO\) .+ (?:Reference|Guide|Specification) for LLMs\s*$/;

// Stable category slugs the tool exposes, in a sensible reading order. `keyword`
// is a distinctive substring of the section header used to attach the parsed body
// to the slug; `title`/`description` are model-facing and drive the index. Slugs
// are static (not derived from the file) so the tool's input enum is fixed even if
// the file fails to load.
export interface PersonalizationCategory {
  slug: string;
  keyword: string;
  title: string;
  description: string;
}

export const PERSONALIZATION_CATEGORIES: PersonalizationCategory[] = [
  { slug: 'core', keyword: 'Language Specification', title: 'Core Syntax & Language Spec',
    description: 'Start here. Attribute refs {{...}}, expression eval {%= ... %}, variables {% let %}, if/else, {{#each}} loops, fallbacks, and the output rules (never emit JS/Liquid/Jinja).' },
  { slug: 'helpers', keyword: 'Helper Functions', title: 'Helper Functions (overview + url / datasetLookup / encrypt / executionMetadata)',
    description: 'Cross-cutting helper overview plus the block helpers: url (tracked links/deep links), datasetLookup, executionMetadata, encrypt.' },
  { slug: 'operators', keyword: 'Operators', title: 'Operators',
    description: 'Boolean (and, or) and comparison (=, !=, >, >=, <, <=) operators for conditions and segmentation.' },
  { slug: 'strings', keyword: 'String Functions', title: 'String Functions',
    description: 'concat, upper/lowerCase, contains/startsWith/endsWith, equals/equalsIgnoreCase, like/matches, mask, md5, formatCurrency, extractEmailDomain, URL parsing.' },
  { slug: 'dates', keyword: 'Date & Time Functions', title: 'Date & Time Functions',
    description: 'getCurrentZonedDateTime, formatDate, dateDiff, addDays/Months/Years, age, compareDates, timezone conversion, date components.' },
  { slug: 'arrays', keyword: 'Arrays & List Functions', title: 'Arrays & List Functions',
    description: 'topN/bottomN, distinct, in/notIn/includes, intersects/subsetOf/supersetOf, head, count variants, and {{#each}} rendering.' },
  { slug: 'aggregation', keyword: 'Aggregation Functions', title: 'Aggregation Functions',
    description: 'average, count, sum, max, min over arrays (lifetime spend, order counts, VIP thresholds).' },
  { slug: 'arithmetic', keyword: 'Arithmetic Functions', title: 'Arithmetic Operators',
    description: 'Inline +, -, *, /, % math within expressions, with divide-by-zero guidance.' },
  { slug: 'objects', keyword: 'Object Functions', title: 'Object Functions',
    description: 'isNull / isNotNull existence checks before accessing optional nested profile objects.' },
  { slug: 'maps', keyword: 'Maps Functions', title: 'Map Functions',
    description: 'get / keys / values for reading map data such as identityMap.' },
  { slug: 'context-iteration', keyword: 'Contextual Data Iteration', title: 'Contextual Data Iteration',
    description: 'Iterating journey event data (context.journey.events), custom action responses, dataset-lookup results, and nested arrays. Covers numeric event-ID backtick escaping.' },
  { slug: 'dataset-lookup', keyword: 'Dataset Lookup', title: 'Dataset Lookup',
    description: 'The datasetLookup helper for pulling reference data (catalogs, pricing, flights) not stored on the profile, with required/fallback patterns.' }
];

interface ParsedLibrary {
  full: string;
  sections: Map<string, string>; // slug -> section body (including its header)
}

let cache: ParsedLibrary | null = null;

// Read the library once and split it into the known categories. Throws if the
// asset is missing (the tool handler turns that into a clean error result).
function loadLibrary(): ParsedLibrary {
  if (cache) return cache;

  const full = readFileSync(LIBRARY_PATH, 'utf8');
  const lines = full.split('\n');

  // Find each section header line and the slug it belongs to.
  const boundaries: Array<{ slug: string; start: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!SECTION_HEADER_RE.test(lines[i])) continue;
    const header = lines[i];
    const category = PERSONALIZATION_CATEGORIES.find(c => header.includes(c.keyword));
    if (category) boundaries.push({ slug: category.slug, start: i });
  }

  const sections = new Map<string, string>();
  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b].start;
    const end = b + 1 < boundaries.length ? boundaries[b + 1].start : lines.length;
    sections.set(boundaries[b].slug, lines.slice(start, end).join('\n').trim());
  }

  cache = { full, sections };
  return cache;
}

// Model-facing index: an overview plus the category menu and how to fetch each.
export function getPersonalizationIndex(): string {
  const menu = PERSONALIZATION_CATEGORIES
    .map(c => `• ${c.slug} — ${c.title}\n    ${c.description}`)
    .join('\n');
  return `Adobe Journey Optimizer (AJO) Personalization Syntax Library — Index
=====================================================================
This library teaches you to generate VALID AJO-native personalization syntax to embed inside
content template / fragment bodies. Always prefer AJO-native syntax; never emit JavaScript,
Python, Liquid, Jinja, Velocity, or generic Handlebars when an AJO construct exists. Never
invent function or attribute names.

Quick syntax primer:
  {{path.to.attribute}}        output an attribute        e.g. {{profile.person.name.firstName}}
  {%= expression %}            evaluate a function/expr   e.g. {%= upperCase(profile.person.name.firstName) %}
  {% let v = expression %}     declare a variable
  {%#if cond%}...{%else%}...{%/if%}   conditional
  {{#each array as |item|}}...{{/each}}   iteration

This library is delivered one category at a time to keep responses small. Call
get_personalization_syntax again with a "category" argument to retrieve a full section:

${menu}

You can also pass category "all" to retrieve the entire library at once (large).

IMPORTANT — attribute PATHS are separate from SYNTAX: this library gives you the functions and
constructs, but NOT the real attribute paths for this sandbox. Do not guess paths like
{{profile.person.firstName}}. Use the discover-personalization-paths prompt (or list_xdm_field_groups /
get_xdm_union_schema) to find the actual tenant-namespaced paths, then build expressions with them.`;
}

export function getPersonalizationCategory(slug: string): string | null {
  const lib = loadLibrary();
  if (slug === 'all') return lib.full;
  return lib.sections.get(slug) ?? null;
}

export const PERSONALIZATION_CATEGORY_SLUGS = PERSONALIZATION_CATEGORIES.map(c => c.slug);
