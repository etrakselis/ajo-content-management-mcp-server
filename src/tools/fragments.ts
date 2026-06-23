import {
  listFragments, createFragment, getFragment,
  updateFragment, patchFragment, publishFragment,
  getLiveFragment, getLastPublicationStatus, archiveFragment,
  buildError, isClientConfigured
} from '../adobe/client.js';
import {
  ListFragmentsSchema, CreateFragmentSchema, GetFragmentSchema,
  UpdateFragmentSchema, PatchFragmentSchema, PublishFragmentSchema,
  GetLiveFragmentSchema, GetPublicationStatusSchema, ArchiveFragmentSchema
} from '../validation/schemas.js';
import { notConfiguredError, validationError, withTelemetry, buildOutputSchema, ETAG_FIELD, WARNINGS_FIELD, compatibilityModeWarning, malformedFragmentWarnings, scanSelfFragmentIds, normalizeMetadataPatches, FRAGMENT_OBJECT, FRAGMENT_LIST } from './utils.js';

// Non-fatal advisories for a fragment write that still succeeds: Compatibility-mode
// HTML (email html fragments) plus any prefix-less {{ fragment }} helper embeds in the body.
// Which field carries the Visual Designer document for the compliance check. In
// the dual-field shape the full document lives in editorContext["wysiwyg-content"];
// fragment.content is intentionally a lightweight render snippet with NO
// <head>/content-version, so checking it would false-positive on a valid fragment.
// Prefer wysiwyg-content when present; fall back to content for single-field fragments.
function visualDesignerHtmlOf(fragment?: Record<string, unknown>): unknown {
  const editorContext = fragment?.editorContext as Record<string, unknown> | undefined;
  const wysiwyg = editorContext?.['wysiwyg-content'];
  if (typeof wysiwyg === 'string' && wysiwyg.trim()) return wysiwyg;
  return fragment?.content;
}

// The two fields of an html fragment hold structurally DIFFERENT HTML, and mixing
// them up is accepted by the API but breaks silently (fails to embed, or opens in
// Compatibility mode). These non-blocking advisories catch the unambiguous mistakes
// at write time. (The missing-content-version case on wysiwyg-content is already
// covered by compatibilityModeWarning via visualDesignerHtmlOf.) Matched literally:
// \bacr-component\b does NOT match acr-tmp-component, so the two classes are distinct.

// Strip <style> blocks and HTML comments before scanning for component/shell class
// names. The mandated Visual Designer CSS — copied verbatim into BOTH fields (the
// named <head> <style> blocks in wysiwyg-content, and the MSO `acrite-mso-css`
// <style> inside an `<!--[if mso]>` comment in fragment.content) — contains
// selectors like `.acr-structure`, `.acr-component, .acr-tmp-component`. Scanning the
// raw HTML therefore false-positives on the required CSS itself rather than on the
// actual component markup. Inspecting only live markup avoids that.
function liveMarkupOnly(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')                  // HTML/MSO conditional comments (the acrite-mso-css <style> lives here)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');  // named <head> <style> blocks
}

// Count non-overlapping matches of a global regex. Used for component-parity and
// doubled-shell checks below.
function countMatches(html: string, re: RegExp): number {
  return (html.match(re) ?? []).length;
}

function dualFieldShapeWarnings(fragment?: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const content = typeof fragment?.content === 'string' ? fragment.content : '';
  const ec = fragment?.editorContext as Record<string, unknown> | undefined;
  const wysiwyg = typeof ec?.['wysiwyg-content'] === 'string' ? ec['wysiwyg-content'] as string : '';
  const contentMarkup = liveMarkupOnly(content);
  const wysiwygMarkup = liveMarkupOnly(wysiwyg);

  // fragment.content must be the LIGHTWEIGHT render snippet: acr-tmp-component, no
  // full-document shell. Full-doc markers or a standalone acr-component class mean
  // the wrong (wysiwyg) shape was placed here.
  if (content) {
    if (/<!doctype|<head[\s>]|<html[\s>]|acr-container|acr-structure/i.test(contentMarkup)) {
      warnings.push(
        'fragment.content looks like a FULL Visual Designer document (it contains <!DOCTYPE>/<head>/<html>/acr-container/acr-structure). ' +
        'It must be the LIGHTWEIGHT render snippet (acr-fragment is-locked has-html-params wrapper + acr-tmp-component, no document shell); ' +
        'put the full document in editorContext["wysiwyg-content"] instead. See get_visual_designer_requirements.');
    }
    if (/\bacr-component\b/.test(contentMarkup)) {
      warnings.push(
        'fragment.content uses the class "acr-component" — the lightweight render snippet must use "acr-tmp-component". ' +
        'Using acr-component here makes the fragment fail to embed in templates. See get_visual_designer_requirements.');
    }
  }
  // editorContext["wysiwyg-content"] is the FULL document and must use acr-component.
  if (wysiwyg && /\bacr-tmp-component\b/.test(wysiwygMarkup)) {
    warnings.push(
      'editorContext["wysiwyg-content"] uses "acr-tmp-component" — the full Visual Designer document must use "acr-component" ' +
      '(acr-tmp-component belongs only in the lightweight fragment.content snippet). See get_visual_designer_requirements.');
  }

  // ── Cross-field consistency (catches the "stub in wysiwyg-content" footgun) ──
  // When fragment.content is a real component snippet, editorContext["wysiwyg-content"]
  // must be the matching full Visual Designer document. A missing/stubbed/parity-
  // mismatched wysiwyg-content saves but silently degrades to Compatibility mode, so
  // flag the specific cause (the generic compat warning alone doesn't explain it).
  const contentComponents = countMatches(contentMarkup, /data-tmp-component-id/gi);
  const contentIsRealSnippet = contentComponents > 0 || /\bacr-tmp-component\b/.test(contentMarkup);
  if (contentIsRealSnippet) {
    const wysiwygComponents = countMatches(wysiwygMarkup, /data-component-id(?!\w)/gi);
    if (!wysiwyg.trim()) {
      warnings.push(
        `fragment.content defines ${contentComponents || 'one or more'} component(s) but editorContext["wysiwyg-content"] is empty/absent. ` +
        'The full Visual Designer document is what the drag-and-drop editor opens — without it this fragment falls back to Compatibility mode. ' +
        'Supply the full native document (<!DOCTYPE> … <head> with the content-version meta … acr-component nesting) in editorContext["wysiwyg-content"]. See get_visual_designer_requirements.');
    } else if (!/\bacr-/.test(wysiwygMarkup) || !/content-version/i.test(wysiwyg)) {
      warnings.push(
        'editorContext["wysiwyg-content"] does not look like a real Visual Designer document (no acr-* components and/or no content-version meta tag) — it appears to be a placeholder/stub. ' +
        'It will save but open in Compatibility mode. Put the full native document there. See get_visual_designer_requirements.');
    } else if (wysiwygComponents !== contentComponents) {
      warnings.push(
        `Component-count mismatch between the two fields: fragment.content has ${contentComponents} (data-tmp-component-id) but editorContext["wysiwyg-content"] has ${wysiwygComponents} (data-component-id). ` +
        'They should describe the same content — a mismatch usually means one field is stale or was rebuilt independently. Regenerate both from the same source. See get_visual_designer_requirements.');
    }
  }

  // ── Doubled document shell ──
  // Prepending the standard <head>/shell to a wysiwyg-content that already begins
  // with one yields two <!DOCTYPE>/<html> openings — a silently-malformed document.
  const doctypeCount = countMatches(wysiwygMarkup, /<!doctype/gi);
  const htmlOpenCount = countMatches(wysiwygMarkup, /<html[\s>]/gi);
  if (doctypeCount > 1 || htmlOpenCount > 1) {
    warnings.push(
      `editorContext["wysiwyg-content"] contains a DOUBLED document shell (${doctypeCount} <!DOCTYPE> and ${htmlOpenCount} <html> openings). ` +
      'This happens when the standard <head>/shell is prepended to a document that already includes one. The document must have exactly one shell — ' +
      'the required <head> block is a complete shell prefix, do not re-wrap it. See get_visual_designer_requirements.');
  }
  return warnings;
}

function fragmentWarnings(data: { type?: string; fragment?: Record<string, unknown> }): string[] {
  const warnings: string[] = [];
  const compat = data.type === 'html' ? compatibilityModeWarning(visualDesignerHtmlOf(data.fragment)) : null;
  if (compat) warnings.push(compat);
  warnings.push(...malformedFragmentWarnings(data.fragment));
  if (data.type === 'html') warnings.push(...dualFieldShapeWarnings(data.fragment));
  return warnings;
}

// A fragment's render snippet must self-reference the fragment's OWN id via
// data-fragment-id="ajo:<uuid>". Since that UUID isn't known until after create, a
// caller authors the sentinel data-fragment-id="ajo:SELF" and the server rewrites
// it to the real ref here. Only the explicit sentinel is rewritten (any other wrong
// value is surfaced as a warning, never silently changed). Returns a new fragment
// object plus whether a rewrite occurred. Targets the two string fields that carry
// the wrapper: fragment.content and editorContext["wysiwyg-content"].
function applySelfReference(
  fragment: Record<string, unknown> | undefined,
  ref: string
): { fragment: Record<string, unknown>; changed: boolean } {
  const frag: Record<string, unknown> = { ...(fragment ?? {}) };
  let changed = false;
  const rewrite = (v: unknown): unknown => {
    if (typeof v !== 'string' || !v.includes('data-fragment-id="ajo:SELF"')) return v;
    changed = true;
    return v.replace(/data-fragment-id="ajo:SELF"/g, `data-fragment-id="${ref}"`);
  };
  if (typeof frag.content === 'string') frag.content = rewrite(frag.content);
  const ec = frag.editorContext as Record<string, unknown> | undefined;
  if (ec && typeof ec['wysiwyg-content'] === 'string') {
    const next = rewrite(ec['wysiwyg-content']);
    if (next !== ec['wysiwyg-content']) frag.editorContext = { ...ec, 'wysiwyg-content': next };
  }
  return { fragment: frag, changed };
}

// Warn about any data-fragment-id self-reference that doesn't match this fragment's
// own ref (and isn't the auto-rewritten sentinel). Such a fragment renders but fails
// to resolve in the Visual Email Designer ("id does not exist" when the block is
// clicked). Scans the post-rewrite fragment, so a correctly-used sentinel is silent.
function selfReferenceWarnings(fragment: Record<string, unknown> | undefined, ref: string): string[] {
  return scanSelfFragmentIds(fragment)
    .filter(v => v !== ref)
    .map(v =>
      `fragment.content declares data-fragment-id="${v}" but this fragment's id is "${ref}". It renders but will ` +
      `NOT resolve in the Visual Email Designer (clicking the block shows "id does not exist"). Set ` +
      `data-fragment-id="${ref}" — or, on create, use the sentinel data-fragment-id="ajo:SELF" and the server sets it for you.`);
}

// ─── Shared input-schema fragments ──────────────────────────────────────────
// The content payload is a discriminated union on `type`: html fragments carry
// { content }, expression fragments carry { expression }. Declaring it as oneOf
// surfaces the required shape to the model/client up front instead of leaving
// `fragment` an opaque object it has to infer from the description prose. Reused
// verbatim by both create_ and update_ so the two never drift.
const FRAGMENT_CONTENT_SCHEMA = {
  type: 'object' as const,
  description: 'Content payload. Shape depends on `type`: html → { "content": "<html>...", editorContext? }; expression → { "expression": "..." }. For an email html fragment that must embed into templates AND stay drag-and-drop editable, use the DUAL-FIELD shape: "content" is the lightweight embeddable render snippet, and editorContext["wysiwyg-content"] is the FULL Visual Designer document. Call get_visual_designer_requirements for the exact shape of each field.',
  oneOf: [
    {
      title: 'HTML fragment content',
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'HTML markup. Required when type is "html". For an email html fragment this is the LIGHTWEIGHT render snippet, NOT a full document: a <div class="acr-fragment is-locked has-html-params" data-fragment-id="ajo:SELF"> wrapper using acr-tmp-component (NOT acr-component), with NO <!DOCTYPE>/<head>/acr-container/acr-structure. SELF-REFERENCE: data-fragment-id must be the fragment\'s OWN id, which does not exist until after creation — so set it to the literal sentinel "ajo:SELF" and the server rewrites it to the real id automatically on create/update. (A wrong value renders but fails to resolve in the Visual Email Designer — "id does not exist" — so the server warns if it isn\'t the assigned id.) The full Visual Designer document (with <head> + content-version meta) goes in editorContext["wysiwyg-content"], not here. Call get_visual_designer_requirements FIRST for the exact shape of both fields; do not paste generic email HTML.' },
        editorContext: { type: 'object', description: 'Editor metadata. For an email html fragment, put the FULL native Visual Designer document in editorContext["wysiwyg-content"] (the <!DOCTYPE html> … document with the verbatim <head>, <body … data-has-html-params>, and acr-component nesting). This is the field the drag-and-drop editor uses and the one the server checks for Visual Designer compliance — the top-level "content" stays the lightweight embeddable snippet. See get_visual_designer_requirements.' }
      }
    },
    {
      title: 'Expression fragment content',
      required: ['expression'],
      properties: { expression: { type: 'string', description: 'Personalization expression. Required when type is "expression".' } }
    }
  ]
};

const FRAGMENT_CHANNELS_SCHEMA = {
  type: 'array' as const,
  items: { type: 'string' as const, enum: ['email', 'shared'] },
  minItems: 1,
  maxItems: 1,
  description: 'Target channel (exactly 1). html → ["email"]; expression → ["shared"].'
};

const FRAGMENT_SUBTYPE_SCHEMA = {
  type: 'string' as const,
  enum: ['TEXT', 'HTML', 'JSON'],
  description: 'Sub-type for expression fragments (TEXT | HTML | JSON). REQUIRED when type is "expression"; not used for html fragments.'
};

// Conditional requirement: AJO mandates subType for expression fragments. Declared
// as a JSON-Schema if/then so a schema-aware client enforces it before the call.
// Adds only to `required` (no new property), so it composes cleanly with the
// top-level additionalProperties:false and the confirmWrite flag injected later.
const EXPRESSION_REQUIRES_SUBTYPE = [
  { if: { properties: { type: { const: 'expression' } }, required: ['type'] }, then: { required: ['subType'] } }
];

// Organization fields shared by create_ and update_. tagIds/labels are real runtime
// write-model fields (accepted in the body) even though the published spec omits
// them. parentFolderId is advertised but NOT accepted in the AJO write body — see the
// per-action descriptions below for how each tool actually applies it.
const TAG_IDS_SCHEMA = {
  type: 'array' as const,
  items: { type: 'string' as const },
  description: 'Tag IDs (UUIDs) to bind to this fragment. Find/create them with the Unified Tags tools (list_tags / create_tag) and validate with validate_tags first. This SETS the whole array (it is not an append) — to add to existing tags, read the current tagIds (get_content_fragment) and resend the full list.'
};
const LABELS_SCHEMA = {
  type: 'array' as const,
  items: { type: 'string' as const },
  description: 'OLAC (object-level access-control) label strings to attach to this fragment. Optional; sets the whole array.'
};
const PARENT_FOLDER_CREATE_PROP = {
  type: 'string' as const, format: 'uuid',
  description: 'UUID of the folder to file this fragment into. The AJO create body itself does NOT accept this; the server applies it for you via an automatic follow-up PATCH after the fragment is created. Omit to leave it unfiled. (If only the folder step fails, the create still succeeds and a warning explains how to retry.)'
};
const PARENT_FOLDER_UPDATE_PROP = {
  type: 'string' as const, format: 'uuid',
  description: 'Optional. Files/moves the fragment into this folder. The AJO PUT body does not accept it, so the server applies it via an automatic follow-up PATCH (same as create); if only that step fails the update still succeeds and the folder failure is returned as a warning. Omit to leave the current folder placement unchanged (it is preserved across a content replace).'
};

// ─── list_content_fragments ───────────────────────────────────────────────────

export const listContentFragmentsDefinition = {
  name: 'list_content_fragments',
  title: 'List Content Fragments',
  outputSchema: buildOutputSchema({
    data: FRAGMENT_LIST,
    truncated: { type: 'boolean', description: 'Present and true only for a status-filtered query whose bounded scan hit its page cap before exhausting the library — there may be more matches. Raise limit or narrow other filters.' }
  }),
  description: `Browse or list existing content fragments in the configured Adobe Journey Optimizer sandbox.
Returns a paginated list, with optional filtering and sorting by date.

FILTERING (property, FIQL):
- Server-filterable fields (passed to AJO): id, name, type, channels, createdAt, createdBy.
  Operators: == (equals), != (not equals), ~^ (starts with), ~ (contains). NOTE: ~^ and ~ are CASE-INSENSITIVE.
- status (e.g. DRAFT, PUBLISHED) is NOT server-filterable — but the server applies it for you: it scans fragments
  and returns up to "limit" matches. A status-filtered result is NOT cursor-paginated (no resumable next): raise
  "limit" to get more matches. For very large libraries the scan is bounded; "truncated": true flags that the cap
  was hit before the library was exhausted.

Example usage:
- List all fragments: {}
- Filter by status (handled server-side): { property: ["status==PUBLISHED"] }
- Filter by type: { property: ["type==html"] }
- Combine: { property: ["type==html", "status==PUBLISHED"] }

Returns: { _page: { count, next }, items: [{ id, name, type, status, channels, ... }] }  (plus top-level truncated? for capped status scans)`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      limit: { type: 'number', description: 'Max items to return (1-1000, default 20). For a status filter this is the max number of matches returned from the scan.' },
      start: { type: 'string', description: 'Pagination cursor from previous _page.next. Ignored for status-filtered queries (those scan from the beginning and are not cursor-paginated).' },
      orderBy: { type: 'string', description: 'Sort field with +/- prefix. E.g. "-modifiedAt"' },
      property: { type: 'array', items: { type: 'string' }, description: 'FIQL filter expressions. Server fields: id, name, type, channels, createdAt, createdBy. Operators: == (equals), != (not equals), ~^ (starts with, case-insensitive), ~ (contains, case-insensitive). status==/!=/~^/~ is supported too but applied client-side (see description). E.g. ["type==html", "status==PUBLISHED"]' }
    }
  }
};

// status is not an AJO-filterable field, but it is present on every returned item,
// so the handler filters by it in-process. Bound the scan so a very large library
// can't make one call unbounded; 100/page → up to 5,000 fragments scanned.
const MAX_STATUS_SCAN_PAGES = 50;

type StatusPredicate = { op: string; value: string };
const STATUS_PRED_RE = /^\s*status\s*(==|!=|~\^|~)\s*(.+?)\s*$/i;

function parseStatusPredicate(expr: string): StatusPredicate | null {
  const m = STATUS_PRED_RE.exec(expr);
  return m ? { op: m[1], value: m[2] } : null;
}

// Match a fragment's status against one predicate. ~^/~ are case-insensitive to
// mirror the upstream FIQL operators; ==/!= are compared case-insensitively too
// since AJO status values are a fixed uppercase set.
function matchStatus(status: unknown, { op, value }: StatusPredicate): boolean {
  const s = String(status ?? '').toUpperCase();
  const v = value.toUpperCase();
  switch (op) {
    case '==': return s === v;
    case '!=': return s !== v;
    case '~^': return s.startsWith(v);
    case '~': return s.includes(v);
    default: return false;
  }
}

export async function handleListContentFragments(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('list_content_fragments', async () => {
    const parsed = ListFragmentsSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);

    // Split out status predicates (AJO rejects `status` in the property filter with
    // CJMMAS-1052-400) from the predicates AJO can handle.
    const statusPreds: StatusPredicate[] = [];
    const upstreamProps: string[] = [];
    for (const expr of parsed.data.property ?? []) {
      const sp = parseStatusPredicate(expr);
      if (sp) statusPreds.push(sp); else upstreamProps.push(expr);
    }

    try {
      if (statusPreds.length === 0) {
        const data = await listFragments(parsed.data);
        return { success: true, data };
      }

      // Status filter present: scan upstream (without the status predicate) and
      // filter by item.status in-process, collecting up to `limit` matches from a
      // bounded scan. Not cursor-paginated — see the tool description.
      const limit = parsed.data.limit ?? 20;
      const items: Array<Record<string, unknown>> = [];
      let cursor: string | undefined;
      let truncated = false;
      for (let page = 0; page < MAX_STATUS_SCAN_PAGES; page++) {
        const data = await listFragments({
          ...parsed.data,
          property: upstreamProps.length ? upstreamProps : undefined,
          limit: 100,
          start: cursor
        }) as { _page?: { next?: string | null }; items?: Array<Record<string, unknown>> };
        for (const it of data.items ?? []) {
          if (statusPreds.every(sp => matchStatus(it.status, sp))) {
            items.push(it);
            if (items.length >= limit) break;
          }
        }
        if (items.length >= limit) break;
        cursor = data._page?.next ?? undefined;
        if (!cursor) break;
        if (page === MAX_STATUS_SCAN_PAGES - 1) truncated = true;
      }
      return {
        success: true,
        data: { _page: { count: items.length, next: null }, items },
        ...(truncated ? { truncated: true } : {})
      };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── create_content_fragment ──────────────────────────────────────────────────

export const createContentFragmentDefinition = {
  name: 'create_content_fragment',
  title: 'Create Content Fragment',
  outputSchema: buildOutputSchema({
    id: { type: 'string', description: 'UUID of the newly created fragment. Absent on a validateOnly dry run (nothing was created).' },
    location: { type: 'string', description: 'Relative path of the new fragment, e.g. /fragments/<uuid>. Absent on a validateOnly dry run.' },
    etag: ETAG_FIELD,
    validated: { type: 'boolean', description: 'Present and true only for a validateOnly dry run — confirms validation ran and nothing was persisted.' },
    warnings: WARNINGS_FIELD
  }),
  description: `Create a new content fragment in Adobe Journey Optimizer. Fragments are reusable content blocks that can be embedded in campaigns and journeys.

⚠ NO HARD DELETE — GET IT RIGHT ON THE FIRST WRITE: fragments have NO REST delete endpoint; the only removal is archive_content_fragment, which is terminal. A botched create (wrong name or content) cannot be cleanly undone — only archived and worked around — and archived names still collide with new ones. So validate before committing: you can DRY-RUN by calling this tool with validateOnly: true, which runs the same input validation + Visual-Designer/dual-field checks and returns the warnings WITHOUT persisting anything. Do not assume create/delete symmetry.

⚠ VISUAL EMAIL DESIGNER REQUIREMENT (type "html", channel "email"):
  The HTML content must use AJO's native serialization format (acr-* class
  namespace, structure/component catalog, required <head> with content-version
  meta tag). Generic HTML will force the designer into Compatibility mode,
  locking the user out of drag-and-drop editing. Call the
  get_visual_designer_requirements tool to get the full mandatory spec BEFORE
  constructing any HTML for this fragment type (it returns the exact
  structure/component catalog and required <head> you must reproduce).

Example usage (HTML fragment — standard XDM field):
{
  "name": "Header Banner",
  "type": "html",
  "channels": ["email"],
  "fragment": {
    "content": "<div>Hi {{profile.person.name.firstName}}, great deals await!</div>"
  }
}

Example usage (Expression fragment — tenant-custom field):
{
  "name": "Loyalty Tier Expression",
  "type": "expression",
  "channels": ["shared"],
  "fragment": {
    "expression": "Your tier: {{profile._acssandboxustwo.loyaltyTier}}"
  },
  "subType": "TEXT"
}

Personalization (3-step flow): (1) call get_personalization_guidance to decide WHAT/WHEN to personalize (find every dynamic value, resolve its data source, detect collections that need iteration, review coverage). (2) Find WHICH real attribute paths exist: standard XDM profile attributes use the "profile." prefix (e.g. {{profile.person.name.firstName}}); tenant-custom attributes sit under "profile._tenantId." (e.g. {{profile._acssandboxustwo.loyaltyTier}}). Do NOT root standard XDM fields (person, homeAddress, etc.) under the tenant namespace — only attributes your org added in a custom field group belong there. Use the 'discover-personalization-paths' prompt, or call list_xdm_union_schemas → get_xdm_union_schema (full=false) → get_xdm_field_group on each ref, to confirm real attribute paths. (3) For HOW to write it — the AJO-native expression SYNTAX (conditionals, loops, date/string/array helpers, datasetLookup, etc.) — call get_personalization_syntax (no arg for the index, then a category). Use only real AJO constructs — never JavaScript/Liquid/Jinja or invented function names.

DUPLICATE CHECK (before creating): to avoid a duplicate, check for an existing fragment by name with ONE server-side filtered list call — list_content_fragments({ property: ["name==<exact name>"] }) for an exact match, or ["name~^<prefix>"] to see whether any asset in a family already exists — rather than listing everything and scanning client-side (name, type, channels, createdAt, createdBy are server-filterable; ~^ is case-insensitive starts-with).

ORGANIZATION: pass tagIds to tag the new fragment and parentFolderId to file it into a folder. tagIds goes in the create body directly; parentFolderId is applied by the server via an automatic follow-up step (the AJO create body does not accept it). For a fragment folder the folderType is "fragment" (create one with create_folder). If folder placement fails the create still succeeds (see warnings) and can be retried with patch_content_fragment.

Returns: { success: true, id: "<uuid>", location: "/fragments/<uuid>", etag: "<etag>", warnings?: [...] }
The returned etag is immediately reusable for a follow-up update_content_fragment / patch_content_fragment — no need to re-fetch right after creating. A "warnings" entry (email html fragments) means the HTML is not in AJO native format and will open in Compatibility mode.`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['name', 'type', 'channels', 'fragment'],
    allOf: EXPRESSION_REQUIRES_SUBTYPE,
    properties: {
      name: { type: 'string', description: 'Fragment name (required)' },
      description: { type: 'string', description: 'Optional description' },
      type: { type: 'string', enum: ['html', 'expression'], description: 'Fragment type' },
      channels: FRAGMENT_CHANNELS_SCHEMA,
      fragment: FRAGMENT_CONTENT_SCHEMA,
      subType: FRAGMENT_SUBTYPE_SCHEMA,
      parentFolderId: PARENT_FOLDER_CREATE_PROP,
      tagIds: TAG_IDS_SCHEMA,
      labels: LABELS_SCHEMA,
      source: { type: 'object', description: 'Source metadata { origin: "ajo"|"external" }' },
      validateOnly: { type: 'boolean', description: 'Dry run. If true, the server runs all input + Visual-Designer/dual-field validation and returns the warnings WITHOUT creating the fragment (nothing is persisted). Use this to catch issues before committing — fragments have no hard delete.' }
    }
  }
};

export async function handleCreateContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('create_content_fragment', async () => {
    const parsed = CreateFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    // Dry run: report the warnings the write would produce, without persisting.
    // (Self-reference vs. assigned id can't be checked until an id exists; the
    // ajo:SELF sentinel handles that on the real create.)
    if (parsed.data.validateOnly) {
      return { success: true, validated: true, warnings: fragmentWarnings(parsed.data) };
    }
    try {
      // parentFolderId is advertised on create (the OpenAPI spec defines it) but the
      // runtime model rejects it in the create body, so strip it and apply it as a
      // follow-up PATCH below. tagIds/labels DO go in the create body (the runtime
      // accepts them) — they flow through ...rest. validateOnly is a control flag, not
      // part of the payload, so it's stripped here too.
      const { parentFolderId, validateOnly: _validateOnly, ...rest } = parsed.data;
      const payload = { ...rest, source: rest.source ?? { origin: 'ajo' as const } };
      const result = await createFragment(payload) as { id: string; location?: string; etag?: string };
      const warnings = fragmentWarnings(parsed.data);
      const assignedRef = `ajo:${result.id}`;

      // Self-reference: the fragment's own UUID is only known now, so a caller can
      // author data-fragment-id="ajo:SELF" and we rewrite it to the real ref via a
      // follow-up PUT (content isn't PATCHable). The create already committed, so a
      // failed rewrite degrades to a warning — never a false-negative on the create.
      const selfRef = applySelfReference(parsed.data.fragment as Record<string, unknown> | undefined, assignedRef);
      if (selfRef.changed) {
        try {
          let etag = result.etag;
          if (!etag) etag = (await getFragment(result.id)).etag;
          if (!etag) throw new Error('could not resolve the post-create etag');
          const corrected = await updateFragment(result.id, { ...payload, fragment: selfRef.fragment }, etag) as { etag?: string };
          if (corrected.etag) result.etag = corrected.etag;
        } catch (err) {
          warnings.push(
            `Fragment created (id ${result.id}) but rewriting data-fragment-id="ajo:SELF" to "${assignedRef}" failed: ${buildError(err).message} ` +
            `Retry with update_content_fragment, setting data-fragment-id="${assignedRef}" in fragment.content.`
          );
        }
      }
      // Flag any non-sentinel self-reference that doesn't match the assigned id.
      warnings.push(...selfReferenceWarnings(selfRef.fragment, assignedRef));

      if (parentFolderId != null) {
        // The create already committed; if only the folder step fails we still return
        // success (with a warning + retry hint) — never a false-negative on a write.
        try {
          let etag = result.etag;
          if (!etag) etag = (await getFragment(result.id)).etag;
          if (!etag) throw new Error('could not resolve the post-create etag');
          const patched = await patchFragment(result.id, [{ op: 'add', path: '/parentFolderId', value: parentFolderId }], etag) as { etag?: string };
          if (patched.etag) result.etag = patched.etag; // keep the returned etag chainable
        } catch (err) {
          warnings.push(
            `Fragment created (id ${result.id}) but filing it into folder ${parentFolderId} failed: ${buildError(err).message} ` +
            `Retry with patch_content_fragment: { "op": "add", "path": "/parentFolderId", "value": "${parentFolderId}" }.`
          );
        }
      }
      return { success: true, ...result, ...(warnings.length ? { warnings } : {}) };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── get_content_fragment ─────────────────────────────────────────────────────

export const getContentFragmentDefinition = {
  name: 'get_content_fragment',
  title: 'Get Content Fragment',
  outputSchema: buildOutputSchema({ data: FRAGMENT_OBJECT, etag: ETAG_FIELD }),
  description: `Fetch a single content fragment by ID from Adobe Journey Optimizer.
This returns the current/editable fragment (including unpublished draft changes) and its etag. For the frozen version actually live in campaigns, use get_live_fragment instead.

CONTENT SHAPE: for html fragments this returns the FULL document (<!DOCTYPE>/<html>/<head>/<body> shell). get_live_fragment returns only the INNER content (no shell) — so do not diff the two and conclude content was lost; the shell difference is expected (draft full-document vs published inner-content).

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { id, name, type, status, channels, fragment, createdAt, ... }, etag: "..." }
The etag is required for update/patch operations.`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to fetch' }
    }
  }
};

export async function handleGetContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_content_fragment', async () => {
    const parsed = GetFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const result = await getFragment(parsed.data.fragmentId);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── update_content_fragment ──────────────────────────────────────────────────

export const updateContentFragmentDefinition = {
  name: 'update_content_fragment',
  title: 'Update Content Fragment (Replace)',
  outputSchema: buildOutputSchema({ etag: ETAG_FIELD, warnings: WARNINGS_FIELD }),
  description: `Replace a content fragment entirely (PUT). Use this when changing fragment content, type, or channels. To rename or move a fragment without touching its content, patch_content_fragment is lighter-weight.

⚠ VISUAL EMAIL DESIGNER REQUIREMENT (type "html", channel "email"):
  The HTML content must use AJO's native serialization format (acr-* class
  namespace, structure/component catalog, required <head> with content-version
  meta tag). Generic HTML will force the designer into Compatibility mode,
  locking the user out of drag-and-drop editing. Call the
  get_visual_designer_requirements tool to get the full mandatory spec BEFORE
  constructing any HTML for this fragment type (it returns the exact
  structure/component catalog and required <head> you must reproduce).

PERSONALIZATION: if you are adding or changing {{ }} / {%= %} expressions, call get_personalization_syntax for the
  AJO-native syntax (and discover-personalization-paths / list_xdm_field_groups for the real attribute paths) — never
  invent functions or use JavaScript/Liquid/Jinja.

⚠ THIS IS A FULL REPLACE — THERE IS NO FIELD-LEVEL UPDATE. The AJO API has no way to patch a single content field
  (content, expression, …); PATCH only supports /name, /description, /parentFolderId. To change even ONE field you must
  resend the ENTIRE fragment. The only safe way to do that without losing data is to fetch-then-mutate:

MANDATORY WORKFLOW (do NOT skip step 1, and NEVER rebuild content from memory):
1. Call get_content_fragment FIRST to get the complete current fragment + etag. This is required every time you edit an
   EXISTING fragment, even for a tiny change — it is the source of truth for all the fields you are NOT changing. (Exception:
   immediately after create_content_fragment you already hold the full object and a valid etag, so you may update without re-fetching.)
2. Take that returned object and modify ONLY the field(s) the user asked to change. Leave the existing content/expression
   and every other field EXACTLY as returned — copy them through verbatim.
3. Call update_content_fragment with the full object (changed field + all untouched fields) + the etag.

❌ DO NOT regenerate, re-author, or reconstruct the HTML/content/expression from scratch when the user only asked to change
   one field. Re-generated content will differ from the original — losing the user's design, personalization, and Visual
   Email Designer serialization. ALWAYS round-trip the exact content you received in step 1.
   If you do not have the current fragment content in hand, you MUST call get_content_fragment before updating.

Example usage:
{
  "fragmentId": "b6d70a45-...",
  "etag": "\\"abc123\\"",
  "name": "Updated Header Banner",
  "type": "html",
  "channels": ["email"],
  "fragment": { "content": "<div>Updated content</div>" }
}

Returns: { success: true, etag?: "<new-etag>", warnings?: [...] }  (a "warnings" entry means the email html is not in AJO native format and will open in Compatibility mode)`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId', 'etag', 'type', 'channels', 'fragment'],
    allOf: EXPRESSION_REQUIRES_SUBTYPE,
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to update' },
      etag: { type: 'string', description: 'ETag from get_content_fragment (or the etag returned by create_content_fragment). Pass it back exactly as received, including its surrounding double-quote characters — do not strip them.' },
      name: { type: 'string', description: 'Fragment name. Optional: if omitted the server backfills the fragment\'s current name (the AJO PUT requires a name). Always pass it when renaming.' },
      description: { type: 'string', description: 'Optional description' },
      type: { type: 'string', enum: ['html', 'expression'], description: 'Fragment type: html → email channel; expression → shared channel' },
      channels: FRAGMENT_CHANNELS_SCHEMA,
      fragment: FRAGMENT_CONTENT_SCHEMA,
      subType: FRAGMENT_SUBTYPE_SCHEMA,
      parentFolderId: PARENT_FOLDER_UPDATE_PROP,
      tagIds: TAG_IDS_SCHEMA,
      labels: LABELS_SCHEMA,
      source: { type: 'object', description: 'Source metadata { origin: "ajo"|"external" }' }
    }
  }
};

export async function handleUpdateContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('update_content_fragment', async () => {
    const parsed = UpdateFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    // parentFolderId is NOT part of the runtime PUT body (rejected as an unrecognized
    // field), so strip it from the payload — but, like create, honor it via a
    // follow-up PATCH instead of silently ignoring it, so re-filing works the same
    // way everywhere. tagIds/labels stay in the body.
    const { fragmentId, etag, parentFolderId, ...rest } = parsed.data;
    // Backfill an omitted name from the current fragment so a content-only update
    // doesn't hard-fail with "name Required" — the AJO PUT replaces the whole object
    // and requires name, but callers routinely forget it when only changing content.
    // One cheap read; a clear error (not the opaque validation rejection) if it can't
    // be resolved. This is a convenience net, NOT a license to skip fetch-then-mutate
    // for the content itself (which the caller must still resend in full).
    let name = rest.name;
    if (name == null) {
      try {
        const current = await getFragment(fragmentId) as { data?: { name?: unknown } };
        if (typeof current.data?.name === 'string' && current.data.name) name = current.data.name;
      } catch (err) {
        return { success: false, error: buildError(err) };
      }
      if (name == null) {
        return { success: false, error: { code: 'VALIDATION_ERROR', message: 'name was omitted and could not be backfilled from the current fragment. Provide name explicitly.', details: {} } };
      }
    }
    // The fragment id is known here, so rewrite the data-fragment-id="ajo:SELF"
    // self-reference sentinel to the real ref in-place — this is already a PUT, so
    // no follow-up write is needed for that part (unlike create).
    const assignedRef = `ajo:${fragmentId}`;
    const selfRef = applySelfReference(rest.fragment as Record<string, unknown> | undefined, assignedRef);
    const payload = { ...rest, name, ...(selfRef.changed ? { fragment: selfRef.fragment } : {}), source: rest.source ?? { origin: 'ajo' as const } };
    try {
      const result = await updateFragment(fragmentId, payload, etag) as { success: boolean; etag?: string };
      const warnings = fragmentWarnings(parsed.data);
      warnings.push(...selfReferenceWarnings(selfRef.fragment, assignedRef));
      // Folder placement: applied via a follow-up PATCH (same as create). The content
      // replace already committed, so a failed move degrades to a warning + retry hint.
      if (parentFolderId != null) {
        try {
          let folderEtag = result.etag;
          if (!folderEtag) folderEtag = (await getFragment(fragmentId)).etag;
          if (!folderEtag) throw new Error('could not resolve the post-update etag');
          const patched = await patchFragment(fragmentId, [{ op: 'add', path: '/parentFolderId', value: parentFolderId }], folderEtag) as { etag?: string };
          if (patched.etag) result.etag = patched.etag;
        } catch (err) {
          warnings.push(
            `Fragment updated (id ${fragmentId}) but filing it into folder ${parentFolderId} failed: ${buildError(err).message} ` +
            `Retry with patch_content_fragment: { "op": "add", "path": "/parentFolderId", "value": "${parentFolderId}" }.`
          );
        }
      }
      return { ...result, success: true, ...(warnings.length ? { warnings } : {}) };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── patch_content_fragment ───────────────────────────────────────────────────

export const patchContentFragmentDefinition = {
  name: 'patch_content_fragment',
  title: 'Rename or Move Content Fragment',
  outputSchema: buildOutputSchema({ etag: ETAG_FIELD }),
  description: `Rename/redescribe a content fragment, file it into a folder, or bind tags/labels — use this for metadata changes, NOT content. For content, type, or channel changes, use update_content_fragment instead.

Supported paths: /name, /description, /parentFolderId, /tagIds, /labels.

⚠ op for /parentFolderId, /tagIds, /labels: use "add" (these members may not exist yet on the object). Per JSON Patch (RFC 6902) "replace" requires the target to already exist and AJO rejects it with an opaque "Bad Patch request." The server auto-translates "replace" → "add" for these three paths, so either works — but "add" is the correct choice. /tagIds and /labels SET the whole array (read-modify-write via get_content_fragment to append).

Example usage (file into a folder + tag, on a fragment that has neither yet):
{
  "fragmentId": "b6d70a45-...",
  "etag": "\\"abc123\\"",
  "patches": [
    { "op": "add", "path": "/parentFolderId", "value": "b45ee96b-..." },
    { "op": "add", "path": "/tagIds", "value": ["b0749baa-..."] }
  ]
}

Returns: { success: true, etag?: "<new-etag>" }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId', 'etag', 'patches'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to patch' },
      etag: { type: 'string', description: 'ETag from get_content_fragment (or the etag returned by create_content_fragment). Pass it back exactly as received, including its surrounding double-quote characters — do not strip them.' },
      patches: {
        type: 'array',
        items: {
          type: 'object',
          required: ['op', 'path'],
          properties: {
            op: { type: 'string', enum: ['add', 'remove', 'replace'], description: 'Use "add" for /parentFolderId, /tagIds, /labels (replace is auto-normalized to add for these).' },
            path: { type: 'string', description: 'Supported: /name, /description, /parentFolderId, /tagIds, /labels' },
            value: {}
          }
        }
      }
    }
  }
};

export async function handlePatchContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('patch_content_fragment', async () => {
    const parsed = PatchFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    const { fragmentId, etag, patches } = parsed.data;
    try {
      // Translate replace→add for /parentFolderId, /tagIds, /labels (members that may
      // not exist yet), so the call is forgiving regardless of the op the model chose.
      const result = await patchFragment(fragmentId, normalizeMetadataPatches(patches), etag);
      return { ...result, success: true };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── publish_content_fragment ────────────────────────────────────────────────

export const publishContentFragmentDefinition = {
  name: 'publish_content_fragment',
  title: 'Publish Content Fragment',
  outputSchema: buildOutputSchema({
    accepted: { type: 'boolean', description: 'true if the async publication request was accepted.' },
    location: { type: 'string', description: 'Status resource path for the publication request.' },
    retryAfter: { type: 'number', description: 'Suggested seconds to wait before polling get_fragment_publication_status.' }
  }),
  description: `Publish a content fragment to make it available for use in live campaigns and journeys.
Publishing freezes the fragment content. Required before activating a campaign/journey that uses this fragment.

⚠ IRREVERSIBLE — confirm with the user first. Publishing CANNOT be undone (AJO has no unpublish). Do NOT publish unless the user has explicitly asked to; in particular, publishing is NOT required to embed a fragment in a content template (a DRAFT fragment embeds and renders fine). The server enforces this: every publish call is re-confirmed with the user (via elicitation, or a WRITE_CONFIRMATION_REQUIRED confirm-and-retry gate on clients without it).

Publication is asynchronous — after calling this tool, poll get_fragment_publication_status every 5 seconds until status is "complete" or "error". Publication typically finishes within 30 seconds; if still "inProgress" after 6 polls (~30 s), stop and tell the user it is taking longer than expected.

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, accepted: true, location: "...", retryAfter: 5 }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to publish' }
    }
  }
};

export async function handlePublishContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('publish_content_fragment', async () => {
    const parsed = PublishFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const result = await publishFragment(parsed.data.fragmentId);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── get_live_fragment ────────────────────────────────────────────────────────

export const getLiveFragmentDefinition = {
  name: 'get_live_fragment',
  title: 'Get Live (Published) Fragment',
  outputSchema: buildOutputSchema({ data: FRAGMENT_OBJECT }),
  description: `Fetch the content of a fragment's last successful publication.
Use this to retrieve the frozen/published version of a fragment that is live in campaigns. This is NOT the current editable fragment — for that (including unpublished draft changes) and its etag, use get_content_fragment instead.

CONTENT SHAPE: this returns only the INNER content — no <!DOCTYPE>/<html>/<head>/<body> shell — whereas get_content_fragment returns the full document. That difference is expected (published inner-content vs draft full-document); it does not mean content was dropped.

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { type: "html", fragment: { content: "<div>...</div>" } } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment' }
    }
  }
};

export async function handleGetLiveFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_live_fragment', async () => {
    const parsed = GetLiveFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await getLiveFragment(parsed.data.fragmentId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── get_fragment_publication_status ─────────────────────────────────────────

export const getFragmentPublicationStatusDefinition = {
  name: 'get_fragment_publication_status',
  title: 'Get Fragment Publication Status',
  outputSchema: buildOutputSchema({
    data: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Current publication state — typically "inProgress", "complete", or "error" (passthrough of the AJO API value).' },
        errors: { type: 'array', description: 'Populated when status is "error".' }
      }
    }
  }),
  description: `Check the status of the last publication request for a content fragment.
Use this after publish_content_fragment to track the async publication process.

Status values:
- "inProgress": Publication is still processing
- "complete": Fragment is published and live
- "error": Publication failed (check errors array)

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, data: { status: "complete"|"inProgress"|"error", errors: [] } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to check publication status for' }
    }
  }
};

export async function handleGetFragmentPublicationStatus(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_fragment_publication_status', async () => {
    const parsed = GetPublicationStatusSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await getLastPublicationStatus(parsed.data.fragmentId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── archive_content_fragment ─────────────────────────────────────────────────

export const archiveContentFragmentDefinition = {
  name: 'archive_content_fragment',
  title: 'Archive Content Fragment',
  outputSchema: buildOutputSchema({
    id: { type: 'string', description: 'UUID of the archived fragment.' },
    etag: { type: 'string', description: 'New ETag after archival.' }
  }),
  description: `Archive (the permanent DELETE-equivalent for) a content fragment in Adobe Journey Optimizer.
Fragments have NO hard-delete / REST delete endpoint — archive is the ONLY way to permanently remove a fragment.
So if you are cleaning up or "deleting" fragments, use this tool. An archived fragment is removed from the
active library and can no longer be used in new campaigns or journeys.

⚠ Archiving does NOT clear the fragment's tag associations. An archived fragment still counts as an active
association for its tags, so delete_tag on any of those tags fails with 403 "Associated Tag Count is not Zero".
If you intend to delete the tags applied to this fragment, first patch the fragment to clear them
(patch_content_fragment with { "op": "replace"/"add", "path": "/tagIds", "value": [] }) — before or after archiving.

No etag is required. This operation bypasses optimistic locking (the internal GraphQL mutation
accepts an empty etag), so no concurrent-modification check is performed. Confirm the fragment ID
is correct before proceeding — there is no undo.

Note: this operation calls an internal AJO GraphQL API (not the public REST API).

Example usage: { "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }

Returns: { success: true, id: "<uuid>", etag: "<new-etag>" }`,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fragmentId'],
    properties: {
      fragmentId: { type: 'string', format: 'uuid', description: 'UUID of the fragment to archive' }
    }
  }
};

export async function handleArchiveContentFragment(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('archive_content_fragment', async () => {
    const parsed = ArchiveFragmentSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const result = await archiveFragment(parsed.data.fragmentId);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}
