import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CompleteRequestSchema,
  McpError,
  ErrorCode
} from '@modelcontextprotocol/sdk/types.js';
import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import { tokenManager } from '../auth/token-manager.js';
import { isClientConfigured, getConfiguredSandboxName, getConfiguredOrgName, getConfiguredTenantId, getConfiguredAuthorEmail, getConfiguredNamingConvention, getConfiguredGitHubIntegration, listFragments, listTemplates, getFragment, getTemplate, buildError } from '../adobe/client.js';
import { commitAuditTrail, createApprovalPR } from '../github/sync.js';
import { resolveAjoFolderPath, getTag, getFolder } from '../adobe/unified-tags-client.js';
import { recordClient, removeClient, TransportKind } from './connected-clients.js';
import { getWritesAllowed, onWriteAccessChanged } from './access-policy.js';
import { onSandboxChanged } from './sandbox-change.js';
import { recordGitHubAuditStatus } from './github-audit-status.js';
import { ALL_PROMPTS, getPromptMessages } from './prompts.js';
import { RESOURCE_URIS, RESOURCE_DESCRIPTORS, RESOURCE_TEMPLATE_URIS, RESOURCE_TEMPLATE_DESCRIPTORS, parseFragmentUri, parseTemplateUri, CHANNEL_REFERENCE_TEXT, ERROR_CODES_TEXT } from './resources.js';
import { getVisualDesignerRequirements } from './visual-designer-requirements.js';
import { getAemImageEmbedInstructions } from './aem-asset-instructions.js';
import { getPersonalizationGuidance } from './personalization-guidance.js';
import { logger } from '../telemetry/index.js';
import { recordAudit } from '../telemetry/audit.js';
import { UI_BASE_URL, RESPONSE_BYTE_CAP } from '../tools/utils.js';

// Template tools
import {
  listContentTemplatesDefinition, handleListContentTemplates,
  createContentTemplateDefinition, handleCreateContentTemplate,
  getContentTemplateDefinition, handleGetContentTemplate,
  updateContentTemplateDefinition, handleUpdateContentTemplate,
  patchContentTemplateDefinition, handlePatchContentTemplate,
  deleteContentTemplateDefinition, handleDeleteContentTemplate
} from '../tools/templates.js';

// Fragment tools
import {
  listContentFragmentsDefinition, handleListContentFragments,
  createContentFragmentDefinition, handleCreateContentFragment,
  getContentFragmentDefinition, handleGetContentFragment,
  updateContentFragmentDefinition, handleUpdateContentFragment,
  patchContentFragmentDefinition, handlePatchContentFragment,
  publishContentFragmentDefinition, handlePublishContentFragment,
  getLiveFragmentDefinition, handleGetLiveFragment,
  getFragmentPublicationStatusDefinition, handleGetFragmentPublicationStatus,
  archiveContentFragmentDefinition, handleArchiveContentFragment
} from '../tools/fragments.js';

// Schema Registry (XDM) tools — read-only; for discovering real personalization attribute paths
import {
  listXdmSchemasDefinition, handleListXdmSchemas,
  getXdmSchemaDefinition, handleGetXdmSchema,
  listXdmFieldGroupsDefinition, handleListXdmFieldGroups,
  getXdmFieldGroupDefinition, handleGetXdmFieldGroup,
  listXdmUnionSchemasDefinition, handleListXdmUnionSchemas,
  getXdmUnionSchemaDefinition, handleGetXdmUnionSchema
} from '../tools/schema-registry.js';

// Folder tools — organize content into a navigable tree (Unified Folders API)
import {
  createFolderDefinition, handleCreateFolder,
  getFolderDefinition, handleGetFolder,
  updateFolderDefinition, handleUpdateFolder,
  deleteFolderDefinition, handleDeleteFolder,
  listSubfoldersDefinition, handleListSubfolders,
  validateFolderDefinition, handleValidateFolder,
  ensureFolderPathDefinition, handleEnsureFolderPath
} from '../tools/folders.js';

// Tag + tag-category tools — classify content for discovery (Unified Tags API)
import {
  listTagCategoriesDefinition, handleListTagCategories,
  getTagCategoryDefinition, handleGetTagCategory,
  listTagsDefinition, handleListTags,
  createTagDefinition, handleCreateTag,
  getTagDefinition, handleGetTag,
  updateTagDefinition, handleUpdateTag,
  deleteTagDefinition, handleDeleteTag,
  validateTagsDefinition, handleValidateTags
} from '../tools/tags.js';

// Server context — read-only; reports who/what this server is operating as
import { getServerContextDefinition, handleGetServerContext, setToolCatalog, setWriteConfirmedGetter, getNamingConventionDefinition, handleGetNamingConvention } from '../tools/context.js';
import { getVisualDesignerRequirementsDefinition, handleGetVisualDesignerRequirements } from '../tools/visual-designer.js';
import { getAemImageEmbedInstructionsDefinition, handleGetAemImageEmbedInstructions } from '../tools/aem-assets.js';
import { getPersonalizationSyntaxDefinition, handleGetPersonalizationSyntax, getPersonalizationGuidanceDefinition, handleGetPersonalizationGuidance } from '../tools/personalization.js';
// GitHub integration tools
import { checkPRStatusDefinition, handleCheckPRStatus, deployMergedChangesDefinition, handleDeployMergedChanges } from '../tools/github.js';
// Cross-sandbox content promotion (plan + phased executor) and same-sandbox repo deploy
import { planPromotionDefinition, handlePlanPromotion, promoteAssetsDefinition, handlePromoteAssets, listRepoAssetsDefinition, handleListRepoAssets, deployRepoAssetsDefinition, handleDeployRepoAssets } from '../tools/promotion.js';
import { buildToolCatalog, formatToolCatalog } from './tool-catalog.js';
import {
  CreateTemplateSchema, UpdateTemplateSchema, PatchTemplateSchema, DeleteTemplateSchema,
  CreateFragmentSchema, UpdateFragmentSchema, PatchFragmentSchema,
  PublishFragmentSchema, ArchiveFragmentSchema,
  CreateFolderSchema, UpdateFolderSchema, DeleteFolderSchema, EnsureFolderPathSchema,
  CreateTagSchema, UpdateTagSchema, DeleteTagSchema
} from '../validation/schemas.js';
import type { ZodTypeAny } from 'zod';

const ALL_TOOLS = [
  listContentTemplatesDefinition,
  createContentTemplateDefinition,
  getContentTemplateDefinition,
  updateContentTemplateDefinition,
  patchContentTemplateDefinition,
  deleteContentTemplateDefinition,
  listContentFragmentsDefinition,
  createContentFragmentDefinition,
  getContentFragmentDefinition,
  updateContentFragmentDefinition,
  patchContentFragmentDefinition,
  publishContentFragmentDefinition,
  getLiveFragmentDefinition,
  getFragmentPublicationStatusDefinition,
  archiveContentFragmentDefinition,
  // Schema Registry (XDM) — read-only
  listXdmSchemasDefinition,
  getXdmSchemaDefinition,
  listXdmFieldGroupsDefinition,
  getXdmFieldGroupDefinition,
  listXdmUnionSchemasDefinition,
  getXdmUnionSchemaDefinition,
  // Folders — organize content into a navigable tree
  createFolderDefinition,
  getFolderDefinition,
  updateFolderDefinition,
  deleteFolderDefinition,
  listSubfoldersDefinition,
  validateFolderDefinition,
  ensureFolderPathDefinition,
  // Tags & tag categories — classify content for discovery
  // (tag-category mutation is admin-only upstream and intentionally not exposed)
  listTagCategoriesDefinition,
  getTagCategoryDefinition,
  listTagsDefinition,
  createTagDefinition,
  getTagDefinition,
  updateTagDefinition,
  deleteTagDefinition,
  validateTagsDefinition,
  // Server context — read-only
  getServerContextDefinition,
  // Naming convention — read-only; returns the full enforced rules
  getNamingConventionDefinition,
  // Visual Email Designer HTML spec — read-only reference
  getVisualDesignerRequirementsDefinition,
  // AEM image embed-attribute retrieval guide — read-only reference
  getAemImageEmbedInstructionsDefinition,
  // AJO personalization syntax library — read-only reference
  getPersonalizationSyntaxDefinition,
  // AJO personalization scenarios/strategy guidance — read-only reference
  getPersonalizationGuidanceDefinition,
  // GitHub integration — check PR status, deploy merged PR to AJO
  checkPRStatusDefinition,
  deployMergedChangesDefinition,
  // Cross-sandbox promotion — read-only planner + phased executor
  planPromotionDefinition,
  promoteAssetsDefinition,
  // Repo → active sandbox — enumerate a subtree + same-sandbox direct deploy
  listRepoAssetsDefinition,
  deployRepoAssetsDefinition
];

// Catalog derived from the live tool list (so it never drifts). Registered into
// the get_server_context handler and also rendered into the server instructions —
// two independent discovery channels so the model can find every tool by exact
// name even when the client defers tools and a fuzzy search misses one.
const TOOL_CATALOG = buildToolCatalog(ALL_TOOLS);
const TOOL_CATALOG_TEXT = formatToolCatalog(TOOL_CATALOG);
setToolCatalog(TOOL_CATALOG);

// Tools that modify content. When the server is in read-only mode these are
// hidden from tool discovery and rejected if called anyway.
const WRITE_TOOLS = new Set<string>([
  'create_content_template', 'update_content_template', 'patch_content_template', 'delete_content_template',
  'create_content_fragment', 'update_content_fragment', 'patch_content_fragment',
  'publish_content_fragment', 'archive_content_fragment',
  // Folders & tags (organization) — validate_* and list_/get_ stay read-only.
  // (Tag-category mutation is admin-only upstream and not exposed by this server.)
  'create_folder', 'update_folder', 'delete_folder', 'ensure_folder_path',
  'create_tag', 'update_tag', 'delete_tag',
  // GitHub integration — deploy_merged_changes writes to AJO, so it is a write tool.
  'deploy_merged_changes'
]);

const isWriteTool = (name: string): boolean => WRITE_TOOLS.has(name);

// Tools that bypass the GitHub PR approval gate AND the audit-trail commit — they apply
// straight to AJO and never produce a repo file. deploy_merged_changes IS the deployment
// step (intercepting it would be circular); check_pr_status is read-only. The folder
// tools (create/update/delete/ensure_folder_path) are STRUCTURAL: the repo never stores
// folders as their own files because the folder hierarchy is already implicit in where
// the content files live (e.g. content-fragments/LM/PD/X/foo.json). A dedicated
// folders/*.json record is redundant — nothing reads it back (promotion derives the
// target folder path from the content file's repo path) — so folder ops apply directly to
// AJO, still subject to the runtime write-access toggle and the write-confirmation gate.
//
// Tag writes (create/update/delete_tag) bypass for the SAME reasons, plus one that is
// specific to them: tags are ORG-GLOBAL organization metadata, and the tag→content
// association that actually matters is recorded on the CONTENT file itself (its tagIds +
// _meta.tagNames). Cross-sandbox promotion resolves tags by NAME from _meta.tagNames
// (findOrCreateTag in promotion/engine.ts), so a standalone tags/<name>.json record is
// never read back either. Critically, routing create_tag through the approval-gate PR
// returns only a prUrl with NO tag id — so a brand-new governance tag could not be created
// AND attached to a fragment/template in one pass (you'd have to merge+deploy the tag PR
// first just to learn its id). Applying tag writes directly returns the real id
// immediately, removing that chicken-and-egg. Tag CRUD is still captured in the LOCAL
// audit log (recordAudit, which this set does NOT gate) and still passes through the
// read-only toggle and the write-confirmation gate (delete_tag re-confirms every call).
const GITHUB_BYPASS_TOOLS = new Set<string>([
  'deploy_merged_changes', 'check_pr_status',
  'create_folder', 'update_folder', 'delete_folder', 'ensure_folder_path',
  'create_tag', 'update_tag', 'delete_tag'
]);

// Determine the AJO folderType for a tool so we can resolve folder names.
function ajoFolderTypeFor(toolName: string): string | undefined {
  if (toolName.includes('template')) return 'content-template';
  if (toolName.includes('fragment')) return 'fragment';
  return undefined;
}

// Extract parentFolderId from wherever it may live in a write operation's args/result:
// - args.parentFolderId (create/update operations)
// - args.patches[].value where path === "/parentFolderId" (patch operations)
// - result.data.parentFolderId or result.parentFolderId (echoed back from AJO)
function extractParentFolderId(args: unknown, result?: unknown): string | undefined {
  const a = args as Record<string, unknown> | null | undefined;
  const r = result as Record<string, unknown> | null | undefined;

  if (typeof a?.parentFolderId === 'string') return a.parentFolderId;

  if (Array.isArray(a?.patches)) {
    const op = (a!.patches as Array<Record<string, unknown>>).find(
      p => (p.path === '/parentFolderId' || p.path === 'parentFolderId') && typeof p.value === 'string'
    );
    if (op) return op.value as string;
  }

  const data = r?.data as Record<string, unknown> | undefined;
  if (typeof data?.parentFolderId === 'string') return data.parentFolderId;
  if (typeof r?.parentFolderId === 'string') return r.parentFolderId;

  return undefined;
}

// Resolve the AJO folder path from tool args/result for use as the GitHub directory.
// Non-fatal: returns undefined on error so commits fall back to the asset-type-based path.
async function resolveGitHubFolderPath(
  toolName: string, args: unknown, result?: unknown
): Promise<string | undefined> {
  const parentFolderId = extractParentFolderId(args, result);
  if (!parentFolderId) return undefined;
  const folderType = ajoFolderTypeFor(toolName);
  if (!folderType) return undefined;
  try {
    return await resolveAjoFolderPath(folderType, parentFolderId) || undefined;
  } catch (err) {
    logger.warn('GitHub sync: folder path resolution failed (non-fatal)', {
      tool: toolName, folderType, parentFolderId,
      error: err instanceof Error ? err.message : String(err)
    });
    return undefined;
  }
}

const asStr = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

// Resolve an asset's canonical NAME (+ parentFolderId) for metadata ops — patch_/
// archive_/delete_, which are addressed by id and carry no `name` in their args. The
// GitHub commit then lands on the asset's canonical <sandbox>/<type>/<folder>/<name>.json
// path instead of an orphan id-named file at the type-dir root. Read BEFORE the AJO
// write because a hard delete makes the asset un-gettable afterward (audit-trail mode
// commits post-write). create_/update_ already carry `name`, so this returns {} for
// them (a no-op — their existing path resolution is unchanged). Best-effort: any failure
// returns {} and the commit falls back to the previous id-based path.
async function resolveCanonicalNaming(
  toolName: string, args: unknown
): Promise<{ name?: string; parentFolderId?: string }> {
  const a = (args ?? {}) as Record<string, unknown>;
  if (asStr(a.name)) return {}; // create/update already carry the name
  try {
    if (asStr(a.fragmentId)) {
      const r = await getFragment(a.fragmentId as string) as { data?: Record<string, unknown> };
      return { name: asStr(r.data?.name), parentFolderId: asStr(r.data?.parentFolderId) };
    }
    if (asStr(a.templateId)) {
      const r = await getTemplate(a.templateId as string) as { data?: Record<string, unknown> };
      return { name: asStr(r.data?.name), parentFolderId: asStr(r.data?.parentFolderId) };
    }
    if (asStr(a.tagId)) {
      const t = await getTag(a.tagId as string) as Record<string, unknown>;
      return { name: asStr(t?.name) };
    }
    if (asStr(a.folderId) && asStr(a.folderType)) {
      const f = await getFolder(a.folderType as string, a.folderId as string) as Record<string, unknown>;
      return { name: asStr(f?.name) };
    }
  } catch (err) {
    logger.warn('Canonical naming resolution failed (non-fatal); commit falls back to the id-based path', {
      tool: toolName, error: err instanceof Error ? err.message : String(err)
    });
  }
  return {};
}

// Create tools that accept a validateOnly flag (dry-run: validate + return warnings
// without persisting). A dry-run performs no write, so it is treated as a non-write
// in CallTool — it bypasses the read-only gate and the write-confirmation prompt.
const VALIDATE_ONLY_TOOLS = new Set<string>(['create_content_template', 'create_content_fragment']);
const isDryRunCreate = (name: string, args: unknown): boolean =>
  VALIDATE_ONLY_TOOLS.has(name) &&
  !!(args && typeof args === 'object' && (args as { validateOnly?: unknown }).validateOnly === true);

// Zod schemas for every write tool, used to pre-validate args BEFORE the
// write-confirmation gate. This way a malformed payload is rejected on the
// first call — before the user is ever asked to confirm — rather than after
// the user has already confirmed and the handler finally sees the args.
const WRITE_TOOL_SCHEMAS: Record<string, ZodTypeAny> = {
  create_content_template: CreateTemplateSchema,
  update_content_template: UpdateTemplateSchema,
  patch_content_template: PatchTemplateSchema,
  delete_content_template: DeleteTemplateSchema,
  create_content_fragment: CreateFragmentSchema,
  update_content_fragment: UpdateFragmentSchema,
  patch_content_fragment: PatchFragmentSchema,
  publish_content_fragment: PublishFragmentSchema,
  archive_content_fragment: ArchiveFragmentSchema,
  create_folder: CreateFolderSchema,
  update_folder: UpdateFolderSchema,
  delete_folder: DeleteFolderSchema,
  ensure_folder_path: EnsureFolderPathSchema,
  create_tag: CreateTagSchema,
  update_tag: UpdateTagSchema,
  delete_tag: DeleteTagSchema
  // deploy_merged_changes: validated inline (prUrl only; no Zod schema needed)
};

// Page cap for the ajo://fragments / ajo://templates directory reads. At 100
// items/page this bounds a directory read to 5,000 objects so a very large
// sandbox can't make a single resource read unbounded; beyond it the result is
// flagged truncated with a resume cursor.
const MAX_DIRECTORY_PAGES = 50;

// Writes with no undo. These are always re-confirmed with the user (never cached)
// when the client supports elicitation. The AJO API has no delete for fragments,
// so archive is the permanent equivalent.
const DESTRUCTIVE_TOOLS = new Set<string>([
  'delete_content_template', 'archive_content_fragment',
  'delete_folder', 'delete_tag'
]);
const isDestructiveTool = (name: string): boolean => DESTRUCTIVE_TOOLS.has(name);

// Irreversible (but NON-destructive) writes: they don't delete or overwrite
// anything, but they can't be undone either, so — like destructive writes — they
// are re-confirmed with the user every time (never cached). Publishing a fragment
// cannot be reversed: AJO has no way to unpublish. Publication is also unnecessary
// for embedding a fragment in a template (only for live campaign/journey use,
// which is out of scope here), so the model must never publish on a hunch.
const IRREVERSIBLE_TOOLS = new Set<string>(['publish_content_fragment']);
const isIrreversibleTool = (name: string): boolean => IRREVERSIBLE_TOOLS.has(name);

// Synthetic argument the model supplies to re-invoke a write after it has
// confirmed the target with the user, on clients that don't support elicitation
// (the confirm-and-retry fallback). Never forwarded to the tool handler.
const CONFIRM_ARG = 'confirmWrite';
const stripConfirmFlag = (args: unknown): unknown => {
  if (args && typeof args === 'object' && CONFIRM_ARG in args) {
    const { [CONFIRM_ARG]: _omit, ...rest } = args as Record<string, unknown>;
    return rest;
  }
  return args;
};

// The confirmWrite flag must be declared in each write tool's input schema, not
// just referenced in the fallback message: strict clients (e.g. Claude Desktop)
// validate arguments against the schema and drop any property that isn't there,
// so an undeclared flag never reaches the server and the gate can't be cleared.
// Injected into write tools in ListTools (below) so it lives in one place.
// The confirmWrite description is tool-specific so it accurately predicts that
// tool's first-call behavior (see confirmWriteTarget): destructive/irreversible
// writes re-confirm on EVERY call; ordinary writes are held only the first time a
// target is written to in a session, then proceed without a hold.
function confirmPropFor(toolName: string) {
  const always = isDestructiveTool(toolName) || isIrreversibleTool(toolName);
  const description = always
    ? 'Out-of-band write confirmation (used when no elicitation dialog can be shown or answered). This operation is ' +
      'destructive/irreversible, so it is re-confirmed on EVERY call. Leave this unset on the first call — ' +
      'the server holds the write and returns a WRITE_CONFIRMATION_REQUIRED message naming the target ' +
      '(org, tenant, sandbox). Only after the user has explicitly confirmed, re-invoke the same tool with the ' +
      'same arguments plus confirmWrite: true. Never set this without the user’s confirmation.'
    : 'Out-of-band write confirmation (used when no elicitation dialog can be shown or answered). The FIRST write to a given target ' +
      '(sandbox) in a session is held: leave this unset and the server returns a WRITE_CONFIRMATION_REQUIRED ' +
      'message naming the target (org, tenant, sandbox); after the user confirms, re-invoke the same tool with ' +
      'the same arguments plus confirmWrite: true. Once that target has been confirmed in the session, later ' +
      'non-destructive writes proceed immediately (no hold, no confirmWrite needed). Never set this without the ' +
      'user’s confirmation.';
  return { type: 'boolean' as const, description };
}

// Append the runtime-gate note to a write tool's description and declare the
// confirmWrite flag on its input schema. Returns a shallow copy so the shared
// ALL_TOOLS definitions are never mutated.
function augmentWriteTool<T extends { name: string; description: string; inputSchema: unknown }>(tool: T): T {
  const schema = (tool.inputSchema ?? {}) as { properties?: Record<string, unknown> };
  return {
    ...tool,
    description: tool.description + WRITE_TOOL_NOTE,
    inputSchema: {
      ...schema,
      properties: { ...(schema.properties ?? {}), [CONFIRM_ARG]: confirmPropFor(tool.name) }
    }
  };
}

// Tools that assign a brand-new name (create_*) vs. tools that can rename an
// existing object (update_* full-replace, patch_* via /name). When a naming
// convention is enforced, the former get the full rules inline and the latter a
// concise pointer — see the namingRulesBlock / namingPointer construction in
// createMcpServer. Surfacing the rules here, on the tool description, is the only
// discovery channel a model can't skip (unlike instructions or get_server_context).
const NAMING_CREATE_TOOLS = new Set<string>([
  'create_content_template', 'create_content_fragment',
  'create_folder', 'create_tag'
]);
const NAMING_RENAME_TOOLS = new Set<string>([
  'update_content_template', 'update_content_fragment',
  'patch_content_template', 'patch_content_fragment',
  'update_folder', 'update_tag'
]);

// Append the enforced naming convention to a tool's description: the full rules for
// create_* tools, a pointer for rename-capable tools, nothing otherwise. `rules`
// and `pointer` are empty strings when no convention is enabled, so this is a no-op
// then. Returns a shallow copy so the shared ALL_TOOLS definitions are never mutated.
function augmentNamingTool<T extends { name: string; description: string }>(tool: T, rules: string, pointer: string): T {
  if (rules && NAMING_CREATE_TOOLS.has(tool.name)) return { ...tool, description: tool.description + rules };
  if (pointer && NAMING_RENAME_TOOLS.has(tool.name)) return { ...tool, description: tool.description + pointer };
  return tool;
}

// The display title lives once on the top-level `title` field (the spec's
// canonical display name). Mirror it into annotations.title at serve time for
// clients that still read the older annotation field, so the source tool
// definitions don't repeat the same string in two places. Returns a shallow copy.
function withAnnotationTitle<T extends { title?: string; annotations?: Record<string, unknown> }>(tool: T): T {
  if (!tool.title || (tool.annotations && 'title' in tool.annotations)) return tool;
  return { ...tool, annotations: { ...(tool.annotations ?? {}), title: tool.title } };
}

// Anthropic's tool input_schema does NOT support the JSON-Schema composition
// keywords allOf/anyOf/oneOf (rejected at the top level) or the conditional
// if/then/else. A tool whose input_schema contains them is dropped by the client
// during MCP→API conversion: it silently disappears from tool discovery and
// returns "tool not found" when called by name. The tool definitions are kept free
// of these keywords on purpose (the real validation is the Zod layer in
// validation/schemas.ts, which runs server-side on every call) — this sanitizer is
// a defensive backstop so that if one is ever reintroduced, the tool still gets
// advertised rather than vanishing. `properties` / `patternProperties` / `$defs` /
// `definitions` are subschema MAPS: their child keys are field names, never schema
// keywords, so we recurse into their values without filtering their keys.
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'if', 'then', 'else']);
const SUBSCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', 'definitions', '$defs']);

function stripUnsupportedSchemaKeywords(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupportedSchemaKeywords);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) continue;
    if (SUBSCHEMA_MAP_KEYS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      const inner: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        inner[propName] = stripUnsupportedSchemaKeywords(propSchema);
      }
      out[key] = inner;
    } else {
      out[key] = stripUnsupportedSchemaKeywords(value);
    }
  }
  return out;
}

function sanitizeToolInputSchema<T extends { inputSchema?: unknown }>(tool: T): T {
  if (!tool.inputSchema || typeof tool.inputSchema !== 'object') return tool;
  return { ...tool, inputSchema: stripUnsupportedSchemaKeywords(tool.inputSchema) };
}

// Build a CallTool result from the standard `{ success, ... }` envelope our tool
// handlers return. Always attaches `structuredContent` (the parsed object) so
// clients on the 2025-06-18 spec get a schema-typed result matching each tool's
// declared outputSchema, while keeping a text block for backward compatibility.
// `isError` is set uniformly whenever success is false — so API/handler errors
// (404, 409, validation, …) signal failure the same way READ_ONLY_MODE does.
function toToolResult(result: unknown, textPrefix = '') {
  const obj = (result ?? {}) as { success?: boolean };
  const isError = obj.success === false;
  // Serialize defensively. The low-level SDK validates whatever we return against
  // CallToolResultSchema *after* this function — if structuredContent can't be
  // serialized (a circular ref or BigInt slipping in from a passthrough payload),
  // an unguarded JSON.stringify here would throw and the SDK would reject the whole
  // result with a bare "Invalid tools/call result" error. For a write that already
  // committed at AJO that is a false negative, which an agent answers by retrying
  // (duplicates on create). So never let serialization throw: fall back to a
  // minimal, always-valid structured result that preserves the success signal.
  let text: string;
  let structured: Record<string, unknown>;
  try {
    structured = JSON.parse(JSON.stringify(result ?? {}));
    text = textPrefix + JSON.stringify(result, null, 2);
  } catch {
    structured = {
      success: obj.success !== false,
      note: 'The result could not be fully serialized; the operation status above is authoritative.'
    };
    text = textPrefix + JSON.stringify(structured, null, 2);
  }
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: structured,
    ...(isError ? { isError: true } : {})
  };
}

// Appended to write-tool descriptions so the client/LLM knows the call is gated by
// the server's runtime write-access setting (rather than always available).
const WRITE_TOOL_NOTE =
  '\n\n[Write operation] Requires write access. If the server is in read-only mode this call is ' +
  `rejected with a READ_ONLY_MODE error; the user can enable write access at ${UI_BASE_URL}.`;

const TOOL_HANDLERS: Record<string, (args: unknown) => Promise<unknown>> = {
  list_content_templates: handleListContentTemplates,
  create_content_template: handleCreateContentTemplate,
  get_content_template: handleGetContentTemplate,
  update_content_template: handleUpdateContentTemplate,
  patch_content_template: handlePatchContentTemplate,
  delete_content_template: handleDeleteContentTemplate,
  list_content_fragments: handleListContentFragments,
  create_content_fragment: handleCreateContentFragment,
  get_content_fragment: handleGetContentFragment,
  update_content_fragment: handleUpdateContentFragment,
  patch_content_fragment: handlePatchContentFragment,
  publish_content_fragment: handlePublishContentFragment,
  get_live_fragment: handleGetLiveFragment,
  get_fragment_publication_status: handleGetFragmentPublicationStatus,
  archive_content_fragment: handleArchiveContentFragment,
  // Schema Registry (XDM) — read-only
  list_xdm_schemas: handleListXdmSchemas,
  get_xdm_schema: handleGetXdmSchema,
  list_xdm_field_groups: handleListXdmFieldGroups,
  get_xdm_field_group: handleGetXdmFieldGroup,
  list_xdm_union_schemas: handleListXdmUnionSchemas,
  get_xdm_union_schema: handleGetXdmUnionSchema,
  // Folders — organize content into a navigable tree
  create_folder: handleCreateFolder,
  get_folder: handleGetFolder,
  update_folder: handleUpdateFolder,
  delete_folder: handleDeleteFolder,
  list_subfolders: handleListSubfolders,
  validate_folder: handleValidateFolder,
  ensure_folder_path: handleEnsureFolderPath,
  // Tags & tag categories — classify content for discovery
  list_tag_categories: handleListTagCategories,
  get_tag_category: handleGetTagCategory,
  list_tags: handleListTags,
  create_tag: handleCreateTag,
  get_tag: handleGetTag,
  update_tag: handleUpdateTag,
  delete_tag: handleDeleteTag,
  validate_tags: handleValidateTags,
  // Server context — read-only
  get_server_context: handleGetServerContext,
  get_naming_convention: handleGetNamingConvention,
  // Visual Email Designer HTML spec — read-only reference
  get_visual_designer_requirements: handleGetVisualDesignerRequirements,
  // AEM image embed-attribute retrieval guide — read-only reference
  get_aem_image_embed_instructions: handleGetAemImageEmbedInstructions,
  // AJO personalization syntax library — read-only reference
  get_personalization_syntax: handleGetPersonalizationSyntax,
  // AJO personalization scenarios/strategy guidance — read-only reference
  get_personalization_guidance: handleGetPersonalizationGuidance,
  // GitHub integration
  check_pr_status: handleCheckPRStatus,
  deploy_merged_changes: handleDeployMergedChanges,
  // Cross-sandbox promotion — plan (read-only) + phased executor.
  // NOT in WRITE_TOOLS: it writes to a per-call target sandbox, so it self-enforces
  // the read-only gate and a target-aware write confirmation (see tools/promotion.ts).
  plan_promotion: handlePlanPromotion,
  promote_assets: handlePromoteAssets,
  // Repo → active sandbox — list a subtree (read) + same-sandbox direct deploy.
  // deploy_repo_assets is NOT in WRITE_TOOLS either (it applies already-merged repo
  // content directly, like deploy_merged_changes); it self-enforces read-only + confirm.
  list_repo_assets: handleListRepoAssets,
  deploy_repo_assets: handleDeployRepoAssets
};

// Log the size of the advertised tool set + instructions ONCE per process, the first
// time a server is created (createMcpServer runs per HTTP session, so guard it). Uses
// the real post-augmentation payload so the number reflects what clients actually
// receive. Best-effort and self-contained — never let instrumentation break startup.
let toolSetSizeLogged = false;
function logAdvertisedToolSetSize(tools: ReadonlyArray<unknown>, instructions?: string): void {
  if (toolSetSizeLogged) return;
  toolSetSizeLogged = true;
  try {
    const toolsBytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
    const instructionsBytes = instructions ? Buffer.byteLength(instructions, 'utf8') : 0;
    const totalBytes = toolsBytes + instructionsBytes;
    const approxTokens = (bytes: number) => Math.round(bytes / 4);
    logger.info('Advertised MCP surface size (per-session context cost)', {
      toolCount: tools.length,
      toolsBytes,
      instructionsBytes,
      totalBytes,
      approxTokens: approxTokens(totalBytes),
      approxToolTokens: approxTokens(toolsBytes),
      note: 'approxTokens ≈ bytes/4; this payload is sent to the client on every connect'
    });
  } catch { /* instrumentation must never break server creation */ }
}

export function createMcpServer(transport: TransportKind = 'http'): Server {
  const sandbox = getConfiguredSandboxName();
  const orgName = getConfiguredOrgName();
  const tenantId = getConfiguredTenantId();
  const tenantNamespace = tenantId ? `_${tenantId}` : null;
  const authorEmail = getConfiguredAuthorEmail();

  let tenantDesc: string | null = null;
  if (sandbox) {
    const parts: string[] = [];
    if (orgName) parts.push(`org "${orgName}"`);
    if (tenantNamespace) parts.push(`tenant namespace "${tenantNamespace}"`);
    parts.push(`sandbox "${sandbox}"`);
    tenantDesc = parts.join(', ');
  }

  // All tools are always advertised; write access is gated at execution time.
  // Instructions intentionally omit the current write-access state because that
  // value is captured once at session-init and goes stale when the toggle flips.
  // The per-call WRITE_TOOL_NOTE in ListTools and the dynamic enforcement in
  // CallTool are the authoritative signals — instructions only carry the pattern.
  const dynamicNote = ` Write access is toggled at runtime; always attempt the operation the user ` +
    `asks for; if a write is rejected with READ_ONLY_MODE, tell the user they can enable write access ` +
    `at ${UI_BASE_URL} and then retry — do not abandon the request.`;

  const personalizationNote = ` When creating content that may contain dynamic values, personalization is a ` +
    `three-step flow: (1) call get_personalization_guidance for WHEN/WHAT to personalize (scenarios, data-source ` +
    `resolution, when to iterate over collections, coverage review); (2) look up WHICH real attribute paths exist ` +
    `with the XDM schema tools (list_xdm_field_groups / get_xdm_field_group, or get_xdm_union_schema for the full ` +
    `merged Profile view) — do NOT assume default paths like {{profile.person.firstName}}, since most customers ` +
    `define custom field groups under their tenant namespace; (3) call get_personalization_syntax for HOW to write ` +
    `the expression. Build personalization expressions from the actual attribute locations you find.`;

  const resourceNote = ` This server also exposes reference resources, but many clients (e.g. Claude ` +
    `Desktop) do not let the model read MCP resources directly — so call get_server_context for the resource ` +
    `catalog, which lists every resource with an "access" hint for how to actually obtain its content. In ` +
    `particular: the channel→templateType→content-shape mapping is already in the create_/update_ tool ` +
    `descriptions; the full Visual Email Designer HTML spec is returned by the get_visual_designer_requirements ` +
    `tool; the procedure for resolving an AEM image's AJO embed attributes (via the separate AEM MCP server) is ` +
    `returned by the get_aem_image_embed_instructions tool; server status is in get_server_context; and to find an ` +
    `object by name call list_content_fragments / list_content_templates, then get_content_fragment / ` +
    `get_content_template by id for the full object plus etag.`;

  const promptNote = ` Use the 'discover-personalization-paths' prompt before inserting personalization ` +
    `expressions into any template or fragment. Use the 'publish-fragment' prompt for the full async publication ` +
    `workflow. Use 'audit-content-library' to survey all content in the sandbox.`;

  // Inline tool index so the model can select any tool by exact name even when
  // the client defers tools and a fuzzy search ranks one below the cutoff. The
  // get_server_context tool returns the same catalog as a high-salience fallback
  // for clients that don't surface these instructions.
  const toolIndexNote = ` This server exposes the following tools — call any by its exact name ` +
    `(or call get_server_context for the same catalog as structured data): ${TOOL_CATALOG_TEXT}.`;

  // Surface the self-declared author identity to the LLM. Captured at setup like
  // the tenant/sandbox above, so it shares their lifecycle (present once the user
  // has completed setup; omitted entirely if no email is configured).
  const authorNote = authorEmail
    ? ` You are acting on behalf of ${authorEmail}; this identity is recorded with every content change ` +
      `(create, update, delete, publish, archive) made through this server.`
    : '';

  // Naming convention rules set by the administrator on the config page. When a
  // convention is enabled the LLM MUST follow it when creating or renaming content.
  // It is surfaced through THREE redundant channels because no single one is
  // reliable: (1) here in `instructions` (many clients don't fetch them), (2) the
  // get_server_context tool (weaker models forget to call it), and (3) — the only
  // channel a model can't skip — inline on the description of every tool that
  // assigns a name (see augmentNamingTool / the ListTools handler below).
  const namingConvention = getConfiguredNamingConvention();
  const namingConventionMd = (namingConvention?.enabled && namingConvention.markdown.trim())
    ? namingConvention.markdown.trim()
    : '';
  const namingEnabled = namingConventionMd.length > 0;
  // The full rules are NOT inlined here — that copy would be ~5K tokens loaded into
  // every session's instructions, which many clients drop anyway. Instead point to
  // get_naming_convention (the authoritative full-rules tool). The convention stays
  // reachable through three channels: this pointer, get_server_context (returns the
  // markdown), and the inline pointer on every create_/rename tool description.
  const namingConventionNote = namingEnabled
    ? ` NAMING CONVENTIONS: The administrator has defined mandatory naming rules for content templates, content fragments, folders, and tags. You MUST follow them when creating or renaming content — call get_naming_convention to retrieve the full rules BEFORE assigning any name. If the user provides a non-compliant name, explain the rule and propose a compliant alternative rather than deviating.`
    : '';

  // Brief pointer appended to create_* tool descriptions when a naming convention is
  // enforced. The full rules are NOT inlined here: embedding a multi-page spec on
  // every create/update tool balloons context and skews semantic tool-search ranking
  // (dense write tools crowd out lean read tools that share the same nouns). Instead,
  // point to get_naming_convention, which returns the full rules on demand.
  const namingRulesBlock = namingEnabled
    ? `\n\n⚠ ENFORCED NAMING CONVENTION: An administrator-defined naming convention is active. ` +
      `Call get_naming_convention to retrieve the full rules BEFORE assigning a name. ` +
      `If the user provides a non-compliant name, explain the rule and propose a compliant alternative. ` +
      `The same rules apply to content templates, fragments, folders, and tags.`
    : '';

  // Concise pointer, appended to the rename-capable tools (update_*/patch_*). These
  // act on an existing object, so renaming is the less-common path; the notice
  // guarantees awareness at every naming entry point without duplicating the full
  // rules onto every tool. The full text lives on the create_* tools and in
  // get_server_context.
  const namingPointer = namingEnabled
    ? `\n\n[Enforced naming convention] This server enforces an administrator-defined naming convention. ` +
      `Any name you set or change with this tool MUST comply with it. The full rules are in the create_* tool ` +
      `descriptions (create_content_template, create_content_fragment, create_folder, create_tag) and from get_server_context.`
    : '';

  const instructions = (tenantDesc
    ? `You are connected to Adobe Journey Optimizer for ${tenantDesc}. ` +
      `Always display the tenant namespace and sandbox name when discussing content operations. ` +
      `Before creating, updating, or deleting any content, confirm with the user that ` +
      `sandbox "${sandbox}"${tenantNamespace ? ` (tenant: ${tenantNamespace})` : ''} is the intended target.`
    : `You are connected to an AJO Content MCP server. ` +
      `No sandbox has been configured yet — ask the user to open http://localhost:3000 and complete setup before making any content changes.`)
    + authorNote + dynamicNote + namingConventionNote + personalizationNote + resourceNote + promptNote + toolIndexNote;

  const server = new Server(
    {
      name: 'et-ajo-content-mgmt',
      version: '1.0.0'
    },
    {
      capabilities: {
        // listChanged is declared because startStdioServer emits
        // notifications/tools/list_changed and notifications/resources/list_changed
        // when write access is toggled. Spec-compliant clients ignore those
        // notifications unless the matching listChanged capability is advertised.
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: {},
        logging: {},
        completions: {}
      },
      instructions
    }
  );

  // Capture the connecting client's identity from the initialize handshake so
  // the landing page can show which client this server is serving. HTTP clients
  // are tracked per-session in app.ts (the stateful /mcp handler); here we only
  // handle STDIO, where one persistent server maps 1:1 to one client.
  if (transport === 'stdio') {
    server.oninitialized = () => {
      const info = server.getClientVersion();
      if (info?.name) {
        recordClient(info.name, info.version);
        logger.info('MCP client connected', { client: info.name, version: info.version, transport });
      }
    };
  }

  // ─── Logging ──────────────────────────────────────────────────────────────
  // sendLoggingMessage handles per-session level filtering (via the SDK's
  // built-in SetLevelRequestSchema handler registered when logging: {} is declared).

  const emitLog = (level: LoggingLevel, data: string, sessionId?: string) => {
    server.sendLoggingMessage({ level, data }, sessionId).catch(() => {});
  };

  // ─── Write confirmation (elicitation) ──────────────────────────────────────
  // Before performing a write, confirm the target sandbox with the user. This
  // turns the "confirm the sandbox before writing" instruction into a stronger
  // guarantee than relying on the model to ask. Non-destructive writes are
  // confirmed once per sandbox per session (then cached, since the target has
  // been acknowledged); destructive writes (delete/archive) are confirmed every
  // time. Two mechanisms, depending on what the client supports:
  //   • Elicitation (2025-06-18): prompt the user via elicitInput. If the request
  //     errors or times out we proceed, so a flaky prompt never blocks the user.
  //   • No elicitation (e.g. Claude Desktop): a confirm-and-retry gate — the
  //     write is held with WRITE_CONFIRMATION_REQUIRED until the model confirms
  //     the target with the user out-of-band and re-invokes with confirmWrite:true.
  // Note this is a target-confirmation step, not a permission gate; whether writes
  // are allowed at all is enforced independently by the read-only toggle in CallTool.
  const confirmedSandboxes = new Set<string>();

  // Expose confirmation state to get_server_context without coupling context.ts to
  // server internals. The getter is evaluated at call time so it reflects live state.
  setWriteConfirmedGetter(() => confirmedSandboxes.has(getConfiguredSandboxName() ?? '(unconfigured)'));

  async function confirmWriteTarget(
    toolName: string,
    args: unknown,
    sessionId?: string
  ): Promise<{ proceed: boolean; code?: string; message?: string }> {
    const sandbox = getConfiguredSandboxName();
    const tenantId = getConfiguredTenantId();
    const tenantNs = tenantId ? `_${tenantId}` : null;
    const org = getConfiguredOrgName();
    const author = getConfiguredAuthorEmail();
    const destructive = isDestructiveTool(toolName);
    const irreversible = isIrreversibleTool(toolName);
    // Both destructive and irreversible writes are re-confirmed every time (never
    // cached); only ordinary writes are confirmed once per target per session.
    const alwaysConfirm = destructive || irreversible;
    const targetKey = sandbox ?? '(unconfigured)';

    // Ordinary writes only need confirming once per target per session;
    // destructive/irreversible writes are re-confirmed every time. Both mechanisms.
    if (!alwaysConfirm && confirmedSandboxes.has(targetKey)) return { proceed: true };

    const targetParts = [
      org ? `org "${org}"` : null,
      tenantNs ? `tenant "${tenantNs}"` : null,
      `sandbox "${sandbox ?? 'unconfigured'}"`
    ].filter(Boolean).join(', ');
    const action = destructive
      ? `a DESTRUCTIVE operation (${toolName})`
      : irreversible
      ? `an IRREVERSIBLE operation (${toolName})`
      : `"${toolName}"`;
    const message = `Confirm ${action} against ${targetParts}` +
      (author ? `, acting on behalf of ${author}` : '') + '.' +
      (irreversible ? ' Publishing cannot be undone — AJO has no way to unpublish a fragment, and a fragment does NOT need to be published to be embedded in a template.' : '');

    // ── Out-of-band confirmation escape hatch (works for ALL clients) ──
    // confirmWrite: true means the model has already confirmed the target with the
    // user. Honor it REGARDLESS of whether the client advertises elicitation. Some
    // clients advertise the elicitation capability but cannot actually surface or
    // answer an elicitInput dialog — it silently resolves to "decline" — which would
    // otherwise leave destructive/irreversible ops (re-confirmed on EVERY call, so
    // never clearable by a cached confirmation) PERMANENTLY blocked with no fallback.
    // This check runs after pre-validation, so it never bypasses payload checks; the
    // schema-level "never set without the user's confirmation" instruction governs use.
    const confirmedFlag = !!args && typeof args === 'object' &&
      (args as Record<string, unknown>)[CONFIRM_ARG] === true;
    if (confirmedFlag) {
      if (!alwaysConfirm) confirmedSandboxes.add(targetKey);
      emitLog('info', `✓ ${toolName}: write confirmed for ${targetKey} (confirmWrite)`, sessionId);
      return { proceed: true };
    }

    // ── Clients without elicitation: confirm-and-retry gate ──
    // We can't show a dialog, so require the model to confirm the target with the
    // user out-of-band and re-invoke the same tool with confirmWrite: true (handled
    // by the escape hatch above).
    if (!server.getClientCapabilities()?.elicitation) {
      emitLog('info', `… ${toolName}: confirmation required for ${targetKey} (confirm-and-retry)`, sessionId);
      return {
        proceed: false,
        code: 'WRITE_CONFIRMATION_REQUIRED',
        message: `${message} This client cannot display a confirmation dialog. ` +
          `Confirm with the user that this is the intended target` +
          (destructive ? ' and that this irreversible operation should proceed' : '') +
          (irreversible ? ' and that this fragment should be published (it is irreversible and is NOT required for embedding)' : '') +
          `, then re-invoke "${toolName}" with the same arguments plus "${CONFIRM_ARG}": true. ` +
          `Do not set "${CONFIRM_ARG}" without the user's explicit confirmation.`
      };
    }

    // ── Clients with elicitation: prompt the user via elicitInput ──
    try {
      const result = await server.elicitInput({
        message,
        requestedSchema: {
          type: 'object',
          properties: {
            confirm: {
              type: 'boolean',
              title: destructive ? 'Confirm destructive change' : irreversible ? 'Confirm irreversible publish' : 'Confirm change',
              description: `Apply this change to sandbox "${sandbox ?? 'unconfigured'}"?` +
                (destructive ? ' This cannot be undone.' : '') +
                (irreversible ? ' Publishing cannot be undone (AJO has no unpublish), and is not required to embed the fragment in a template.' : ''),
              default: true
            }
          },
          required: ['confirm']
        }
      });

      if (result.action === 'accept' && result.content?.confirm === true) {
        if (!alwaysConfirm) confirmedSandboxes.add(targetKey);
        emitLog('info', `✓ ${toolName}: write confirmed for ${targetKey}`, sessionId);
        return { proceed: true };
      }

      const outcome = result.action === 'accept' ? 'not confirmed' : result.action; // decline | cancel
      emitLog('warning', `✗ ${toolName}: write ${outcome} by user`, sessionId);
      return {
        proceed: false,
        code: 'WRITE_CANCELLED',
        message: `The user did not confirm "${toolName}" against ${targetParts}. The operation was NOT performed. ` +
          `Do not retry unless the user explicitly asks for it again. If they do explicitly confirm — e.g. the ` +
          `confirmation dialog could not be displayed or was dismissed in error — re-invoke "${toolName}" with the ` +
          `same arguments plus "${CONFIRM_ARG}": true to proceed.`
      };
    } catch (err) {
      // Capability advertised but the elicitation failed — don't block the user.
      logger.warn('Elicitation failed; proceeding without confirmation', { tool: toolName, error: err instanceof Error ? err.message : String(err) });
      return { proceed: true };
    }
  }

  // ─── Tool Discovery ────────────────────────────────────────────────────────

  // Build the exact tool list advertised to the client. Always the full set — many
  // clients cache this list at connect and ignore tools/list_changed, so hiding write
  // tools would strand them in read-only even after the toggle is flipped on. Write
  // enforcement happens in CallTool instead. Write tools get the runtime-gate note and
  // the confirmWrite flag (see augmentWriteTool); name-assigning tools get the enforced
  // naming convention inline (see augmentNamingTool) so weaker models that skip
  // get_server_context still discover it. Shared by ListTools and the startup size log.
  const buildAdvertisedTools = () => ALL_TOOLS.map(t => {
    const augmented = isWriteTool(t.name) ? augmentWriteTool(t) : t;
    const named = withAnnotationTitle(augmentNamingTool(augmented, namingRulesBlock, namingPointer));
    // Final step: strip any JSON-Schema keywords Anthropic's input_schema rejects
    // (allOf/anyOf/oneOf/if/then/else) so a tool can never silently vanish from
    // discovery. A no-op for the current definitions, which avoid them by design.
    return sanitizeToolInputSchema(named);
  });

  // One-time visibility into how much context budget the advertised tool set spends.
  // The descriptions are intentionally dense (redundant discovery channels), so this
  // is a guardrail: a regression that balloons the payload — or skews semantic
  // tool-ranking on clients that embed every description — shows up in the logs. The
  // instructions block (also sent at connect) is included since it shares the budget.
  // ~4 chars/token is the usual rough estimate for English+JSON.
  logAdvertisedToolSetSize(buildAdvertisedTools(), instructions);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: buildAdvertisedTools() };
  });

  // ─── Tool Execution ────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const handler = TOOL_HANDLERS[name];
    const sessionId = extra.sessionId;

    emitLog('debug', `→ ${name}`, sessionId);

    // A validateOnly create is a dry run — it persists nothing, so it's treated as a
    // non-write: it skips the read-only gate and the write-confirmation prompt below.
    const dryRun = isDryRunCreate(name, args);

    // Enforce read-only mode at execution time (defense in depth — independent of
    // whether the tool was advertised). Read live so it applies to existing sessions.
    if (!getWritesAllowed() && isWriteTool(name) && !dryRun) {
      emitLog('warning', `✗ ${name}: READ_ONLY_MODE`, sessionId);
      return toToolResult({
        success: false,
        error: {
          code: 'READ_ONLY_MODE',
          message: `Write operations are disabled. The server is in read-only mode, so "${name}" is not permitted. Ask the user to enable write access on the setup page (${UI_BASE_URL}) if this is intended.`,
          details: {}
        }
      });
    }

    if (!handler) {
      emitLog('warning', `✗ ${name}: TOOL_NOT_FOUND`, sessionId);
      return toToolResult({
        success: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Unknown tool: ${name}. Available tools: ${Object.keys(TOOL_HANDLERS).join(', ')}`,
          details: {}
        }
      });
    }

    // Pre-validate write-tool args BEFORE the write-confirmation gate. This
    // surfaces schema errors on the first call so the user is never asked to
    // confirm a write that would fail validation anyway. Strip the synthetic
    // confirmWrite flag first — it's not part of any payload schema.
    if (isWriteTool(name)) {
      const schema = WRITE_TOOL_SCHEMAS[name];
      if (schema) {
        const parsed = schema.safeParse(stripConfirmFlag(args));
        if (!parsed.success) {
          emitLog('debug', `✗ ${name}: pre-validation failed`, sessionId);
          return toToolResult({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid input parameters',
              details: parsed.error.errors.map((e: { path: Array<string | number>; message: string }) => ({
                path: e.path.join('.'), message: e.message
              }))
            }
          });
        }
      }
    }

    // Confirm the write target with the user before performing it (elicitation).
    // No-op for reads, dry-runs, and clients without elicitation support.
    if (isWriteTool(name) && !dryRun) {
      const confirmation = await confirmWriteTarget(name, args, sessionId);
      if (!confirmation.proceed) {
        return toToolResult({
          success: false,
          error: {
            code: confirmation.code ?? 'WRITE_CANCELLED',
            message: confirmation.message ?? `The user did not confirm "${name}"; the operation was not performed.`,
            details: {}
          }
        });
      }
    }

    // ── GitHub approval gate ──────────────────────────────────────────────────
    // In PR Approval Gate mode, write tools create a GitHub PR instead of writing
    // to AJO. The LLM returns the PR URL to the user; a human reviews and merges it;
    // then the LLM calls deploy_merged_changes to apply the approved content to AJO.
    // deploy_merged_changes itself is exempt (it IS the deployment path).
    const githubConfig = getConfiguredGitHubIntegration();

    // Resolve the asset's canonical name (+ folder) up-front — before any AJO write,
    // since a hard delete makes the asset un-gettable afterward — so the GitHub commit
    // for a metadata op (patch_/archive_/delete_) lands on the canonical <name>.json
    // path instead of an orphan id-named file. No-op for create/update (they carry a
    // name). Shared by both the approval-gate PR and the audit-trail commit below.
    let canonicalName: string | undefined;
    let canonicalFolderPath: string | undefined;
    if (githubConfig && isWriteTool(name) && !dryRun && !GITHUB_BYPASS_TOOLS.has(name)) {
      const naming = await resolveCanonicalNaming(name, stripConfirmFlag(args));
      canonicalName = naming.name;
      if (naming.parentFolderId) {
        const ft = ajoFolderTypeFor(name);
        if (ft) {
          try { canonicalFolderPath = (await resolveAjoFolderPath(ft, naming.parentFolderId)) || undefined; }
          catch { /* fall back to the per-call folder resolution below */ }
        }
      }
    }

    if (githubConfig?.requireApproval && isWriteTool(name) && !dryRun && !GITHUB_BYPASS_TOOLS.has(name)) {
      const cleanArgs = (isWriteTool(name) ? stripConfirmFlag(args) : args) as Record<string, unknown>;
      const sandbox = getConfiguredSandboxName() ?? 'unknown';
      const author = getConfiguredAuthorEmail() ?? 'unknown';
      const prTenantId = getConfiguredTenantId();
      const prTenant = prTenantId ? `_${prTenantId}` : undefined;
      const ajoFolderPathPR = canonicalFolderPath ?? await resolveGitHubFolderPath(name, args, undefined);
      try {
        const { prNumber, prUrl, filePath } = await createApprovalPR(githubConfig, sandbox, name, cleanArgs, author, ajoFolderPathPR, prTenant, undefined, undefined, canonicalName);
        emitLog('info', `↗ ${name}: GitHub PR #${prNumber} created (approval gate)`, sessionId);
        return toToolResult({
          success: true,
          prCreated: true,
          prNumber,
          prUrl,
          filePath,
          message:
            `Write blocked by GitHub PR Approval Gate. Instead of writing directly to AJO, ` +
            `PR #${prNumber} has been created for human review: ${prUrl}\n\n` +
            `File staged: \`${filePath}\`\n\n` +
            `After a reviewer merges the PR on GitHub, call \`deploy_merged_changes\` with ` +
            `prUrl: "${prUrl}" to apply the change to AJO sandbox "${sandbox}".`
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitLog('error', `✗ ${name}: GitHub PR creation failed — ${msg}`, sessionId);
        return toToolResult({
          success: false,
          error: {
            code: 'GITHUB_PR_FAILED',
            message: `GitHub PR Approval Gate is enabled but the PR could not be created: ${msg}. ` +
              `Check your GitHub token and repository configuration on the setup page.`,
            details: {}
          }
        });
      }
    }

    try {
      // Drop the synthetic confirmWrite flag (confirm-and-retry fallback) so it
      // never reaches the tool handler or the AJO payload.
      const result = await handler(isWriteTool(name) ? stripConfirmFlag(args) : args);
      const activeSandbox = getConfiguredSandboxName();
      const activeOrg = getConfiguredOrgName();
      const activeTenantId = getConfiguredTenantId();
      const activeAuthor = getConfiguredAuthorEmail();
      const parts: string[] = [];
      if (activeOrg) parts.push(`org: ${activeOrg}`);
      if (activeTenantId) parts.push(`tenant: _${activeTenantId}`);
      if (activeSandbox) parts.push(`sandbox: ${activeSandbox}`);
      if (activeAuthor) parts.push(`author: ${activeAuthor}`);
      const prefix = parts.length > 0 ? `[${parts.join(' | ')}]\n` : '';
      const resultObj = result as { success?: boolean; error?: { code?: string }; id?: string };
      if (resultObj?.success === false) {
        emitLog('warning', `✗ ${name}: ${resultObj.error?.code ?? 'error'}`, sessionId);
      } else {
        emitLog('info', `✓ ${name}`, sessionId);
      }

      // GitHub audit trail: after a successful write in audit-trail mode, commit the
      // args + result metadata to GitHub. Fire-and-forget — a GitHub outage never
      // surfaces as a tool failure. Only runs when GitHub is configured without the
      // approval gate (approval-gate writes never reach this point; they return the
      // PR URL above). deploy_merged_changes has its own audit path.
      if (
        githubConfig && !githubConfig.requireApproval &&
        isWriteTool(name) && !dryRun && !GITHUB_BYPASS_TOOLS.has(name) &&
        resultObj?.success !== false
      ) {
        const ghSandbox = activeSandbox ?? 'unknown';
        const ghAuthor = activeAuthor ?? 'unknown';
        const ghTenant = activeTenantId ? `_${activeTenantId}` : undefined;
        emitLog('info', `↗ GitHub audit: committing "${name}" to ${githubConfig.owner}/${githubConfig.repo}`, sessionId);
        (canonicalFolderPath !== undefined
          ? Promise.resolve(canonicalFolderPath)
          : resolveGitHubFolderPath(name, args, resultObj)
        ).then(ajoFolderPath =>
        commitAuditTrail(
          githubConfig, ghSandbox, name,
          (isWriteTool(name) ? stripConfirmFlag(args) : args) as Record<string, unknown>,
          resultObj as Record<string, unknown>,
          ghAuthor,
          ajoFolderPath,
          ghTenant,
          canonicalName
        )).then((committed) => {
          // Record the outcome so get_server_context can surface a failure to the
          // model on demand. This is the reliable channel: the emitLog below is only an
          // MCP logging notification, which many clients never show the model — so a
          // failed commit (AJO write succeeded but was NOT recorded in GitHub) would
          // otherwise go unnoticed. committed === false means the try-catch inside
          // commitAuditTrail fired; see server logs for the underlying error.
          const ok = committed !== false;
          recordGitHubAuditStatus({
            at: new Date().toISOString(),
            tool: name,
            ok,
            ...(ok ? {} : { error: 'commit failed — see server logs (verify the repo is initialized and the PAT has Contents write access)' })
          });
          if (!ok) {
            emitLog('warning',
              `⚠ GitHub audit trail: failed to commit "${name}" to ` +
              `${githubConfig.owner}/${githubConfig.repo} — ` +
              `the AJO write succeeded but this change was not recorded in GitHub. ` +
              `Check server logs for details. You may need to manually verify the repository ` +
              `is initialized (has at least one commit) and the PAT has Contents write access.`,
              sessionId
            );
          }
        }).catch(() => {}); // commitAuditTrail always resolves; .catch is a safety net only
      }

      // Audit trail: attribute every content write to the self-declared author.
      // Only writes reach here in non-read-only mode (read-only writes are
      // rejected above). Captures both successful and handler-rejected attempts.
      // A validateOnly dry-run persists nothing, so it is NOT a content change and
      // must not pollute the audit trail with a phantom create.
      if (isWriteTool(name) && !dryRun) {
        const callArgs = (args ?? {}) as Record<string, unknown>;
        // The id arg varies by resource family; probe each known key in turn.
        const idKeys = ['fragmentId', 'templateId', 'folderId', 'tagCategoryId', 'tagId'];
        const argId = idKeys.map(k => callArgs[k]).find((v): v is string => typeof v === 'string');
        const resourceType = name.includes('fragment') ? 'fragment'
          : name.includes('template') ? 'template'
          : name.includes('folder') ? 'folder'
          : name.includes('tag') ? 'tag'
          : 'unknown';
        const resultData = (resultObj as { data?: { id?: unknown } })?.data;
        const resultId = resultObj?.id ?? (typeof resultData?.id === 'string' ? resultData.id : undefined);
        // Fire-and-forget: the audit append is async and self-contained (it never
        // rejects — see recordAudit), so we don't await it on the tool-response path.
        void recordAudit({
          action: name,
          authorEmail: getConfiguredAuthorEmail() ?? 'unknown',
          resourceType,
          resourceId: argId ?? resultId,
          resourceName: typeof callArgs.name === 'string' ? callArgs.name : undefined,
          sandbox: activeSandbox,
          tenantNamespace: activeTenantId ? `_${activeTenantId}` : null,
          success: resultObj?.success !== false
        });
      }
      return toToolResult(result, prefix);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Unhandled tool error', { tool: name, error: msg });
      emitLog('error', `✗ ${name}: ${msg}`, sessionId);
      return toToolResult({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: msg, details: {} }
      });
    }
  });

  // ─── Resources ────────────────────────────────────────────────────────────

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: RESOURCE_DESCRIPTORS.map(r => ({ ...r })) };
  });

  // Templated resources: individual fragments/templates addressable by UUID
  // (ajo://fragment/{id}, ajo://template/{id}). Resolved in ReadResource below.
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return { resourceTemplates: RESOURCE_TEMPLATE_DESCRIPTORS.map(r => ({ ...r })) };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    // ── Templated content resources ──
    // ajo://fragment/{id} and ajo://template/{id} resolve to the live object.
    // Errors are surfaced as McpError (NOT_CONFIGURED / NOT_FOUND / etc.) so the
    // client sees the same failure codes the get_* tools return.
    const fragmentId = parseFragmentUri(uri);
    const templateId = parseTemplateUri(uri);
    if (fragmentId !== null || templateId !== null) {
      if (!isClientConfigured()) {
        throw new McpError(ErrorCode.InvalidRequest,
          `NOT_CONFIGURED: the server has no sandbox configured yet. Ask the user to complete setup at ${UI_BASE_URL}.`);
      }
      try {
        const result = fragmentId !== null
          ? await getFragment(fragmentId)
          : await getTemplate(templateId as string);
        const text = JSON.stringify(result, null, 2);
        // Same ~1 MB transport cap as the get_* tools: a full Visual Designer document
        // would otherwise be rejected by the SDK with a bare "result too large". Surface
        // it as a clear McpError that names a smaller way to fetch the content.
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > RESPONSE_BYTE_CAP) {
          const kb = Math.round(bytes / 1024);
          throw new McpError(ErrorCode.InvalidParams,
            `RESPONSE_TOO_LARGE: this ${fragmentId !== null ? 'fragment' : 'template'} serializes to ~${kb} KB, over the ~1 MB MCP result limit. ` +
            (fragmentId !== null
              ? 'For an html fragment, the get_live_fragment tool returns only the published inner content (smaller); otherwise open it in Adobe Journey Optimizer.'
              : 'Open it directly in Adobe Journey Optimizer.'));
        }
        return {
          contents: [{ uri, mimeType: 'application/json', text }]
        };
      } catch (err) {
        const e = buildError(err);
        throw new McpError(ErrorCode.InvalidParams, `${e.code}: ${e.message}`);
      }
    }

    if (uri === RESOURCE_URIS.serverStatus) {
      const authStatus = tokenManager.getStatus();
      const configured = isClientConfigured();
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            serverName: 'et-ajo-content-mgmt',
            version: '1.0.0',
            configured,
            authentication: authStatus,
            writeAccess: getWritesAllowed(),
            availableTools: Object.keys(TOOL_HANDLERS).length
          }, null, 2)
        }]
      };
    }

    if (uri === RESOURCE_URIS.channelReference) {
      return {
        contents: [{ uri, mimeType: 'text/plain', text: CHANNEL_REFERENCE_TEXT }]
      };
    }

    if (uri === RESOURCE_URIS.errorCodes) {
      return {
        contents: [{ uri, mimeType: 'text/plain', text: ERROR_CODES_TEXT }]
      };
    }

    if (uri === RESOURCE_URIS.visualDesignerRequirements) {
      return {
        contents: [{ uri, mimeType: 'text/plain', text: getVisualDesignerRequirements() }]
      };
    }

    if (uri === RESOURCE_URIS.aemImageEmbedInstructions) {
      return {
        contents: [{ uri, mimeType: 'text/plain', text: getAemImageEmbedInstructions() }]
      };
    }

    if (uri === RESOURCE_URIS.personalizationGuidance) {
      return {
        contents: [{ uri, mimeType: 'text/plain', text: getPersonalizationGuidance() }]
      };
    }

    // ── Browsable collections ──
    // ajo://fragments and ajo://templates return a compact name→id directory plus
    // a per-item resource link, so a human/client can locate an object by name and
    // then read ajo://fragment/{id} or ajo://template/{id}. The directory follows
    // the _page.next cursor to accumulate every object across pages, bounded by a
    // safety cap so a huge sandbox can't make the read unbounded; if the cap is hit
    // the result is flagged truncated with the cursor to resume from.
    if (uri === RESOURCE_URIS.fragments || uri === RESOURCE_URIS.templates) {
      if (!isClientConfigured()) {
        throw new McpError(ErrorCode.InvalidRequest,
          `NOT_CONFIGURED: the server has no sandbox configured yet. Ask the user to complete setup at ${UI_BASE_URL}.`);
      }
      const isFragments = uri === RESOURCE_URIS.fragments;
      const lister = isFragments ? listFragments : listTemplates;
      try {
        const raw: Array<Record<string, unknown>> = [];
        let cursor: string | undefined;
        let truncated = false;
        // Bound the sweep: at 100/page this is up to 5,000 objects.
        for (let page = 0; page < MAX_DIRECTORY_PAGES; page++) {
          const data = await lister({ limit: 100, start: cursor }) as {
            _page?: { next?: string | null };
            items?: Array<Record<string, unknown>>;
          };
          raw.push(...(data.items ?? []));
          const next = data._page?.next;
          if (!next) { cursor = undefined; break; }
          cursor = next;
          if (page === MAX_DIRECTORY_PAGES - 1) truncated = true;
        }
        const items = raw.map(item => ({
          id: item.id,
          name: item.name,
          ...(isFragments
            ? { type: item.type, status: item.status }
            : { templateType: item.templateType }),
          channels: item.channels,
          modifiedAt: item.modifiedAt,
          resource: `ajo://${isFragments ? 'fragment' : 'template'}/${item.id}`
        }));
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              count: items.length,
              truncated,
              // Present only when truncated: resume cursor for the audit prompt / get_* tools.
              ...(truncated ? { next: cursor ?? null } : {}),
              items
            }, null, 2)
          }]
        };
      } catch (err) {
        const e = buildError(err);
        throw new McpError(ErrorCode.InvalidParams, `${e.code}: ${e.message}`);
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // ─── Completions ──────────────────────────────────────────────────────────
  // Provides argument completions for prompt arguments so clients (e.g. Claude
  // Desktop) can surface dropdowns or autocomplete as the user types.

  server.setRequestHandler(CompleteRequestSchema, async (request) => {
    const { ref, argument } = request.params;

    // Resource-template arg completion: suggest live fragment/template IDs for the
    // {id} variable of ajo://fragment/{id} and ajo://template/{id}.
    if (ref.type === 'ref/resource') {
      if (argument.name !== 'id' || !isClientConfigured()) {
        return { completion: { values: [] } };
      }
      const lister = ref.uri === RESOURCE_TEMPLATE_URIS.fragment
        ? listFragments
        : ref.uri === RESOURCE_TEMPLATE_URIS.template
          ? listTemplates
          : null;
      if (!lister) return { completion: { values: [] } };
      try {
        const data = await lister({ limit: 50 }) as { items?: Array<{ id: string }> };
        const values = (data.items ?? [])
          .map(item => item.id)
          .filter(id => id.startsWith(argument.value));
        return { completion: { values, hasMore: false } };
      } catch {
        return { completion: { values: [] } };
      }
    }

    // Tool argument completion: suggest live IDs for fragmentId / templateId parameters
    // across all tools that accept them (get, update, patch, delete, publish, archive).
    // Cast to string because the SDK type union only includes ref/resource and ref/prompt;
    // ref/tool is in the spec but not yet in the SDK's TypeScript definitions.
    if ((ref as { type: string }).type === 'ref/tool') {
      if (!isClientConfigured()) return { completion: { values: [] } };
      if (argument.name === 'fragmentId') {
        try {
          const data = await listFragments({ limit: 50 }) as { items?: Array<{ id: string }> };
          const values = (data.items ?? [])
            .map(f => f.id)
            .filter(id => id.startsWith(argument.value));
          return { completion: { values, hasMore: false } };
        } catch {
          return { completion: { values: [] } };
        }
      }
      if (argument.name === 'templateId') {
        try {
          const data = await listTemplates({ limit: 50 }) as { items?: Array<{ id: string }> };
          const values = (data.items ?? [])
            .map(t => t.id)
            .filter(id => id.startsWith(argument.value));
          return { completion: { values, hasMore: false } };
        } catch {
          return { completion: { values: [] } };
        }
      }
      return { completion: { values: [] } };
    }

    if (ref.type !== 'ref/prompt') {
      return { completion: { values: [] } };
    }

    // audit-content-library → content_type: static enum
    if (ref.name === 'audit-content-library' && argument.name === 'content_type') {
      const options = ['both', 'templates', 'fragments'];
      const values = options.filter(o => o.startsWith(argument.value));
      return { completion: { values, hasMore: false } };
    }

    // publish-fragment → fragment_id: live lookup from the sandbox
    if (ref.name === 'publish-fragment' && argument.name === 'fragment_id') {
      if (!isClientConfigured()) return { completion: { values: [] } };
      try {
        const data = await listFragments({ limit: 50 }) as { items?: Array<{ id: string; name: string }> };
        const items = data.items ?? [];
        const values = items
          .map(f => f.id)
          .filter(id => id.startsWith(argument.value));
        return { completion: { values, hasMore: false } };
      } catch {
        return { completion: { values: [] } };
      }
    }

    // create-content → channel: static enum
    if (ref.name === 'create-content' && argument.name === 'channel') {
      const channels = ['email', 'push', 'sms', 'inapp', 'code', 'directMail', 'landingpage', 'shared'];
      return { completion: { values: channels.filter(c => c.startsWith(argument.value)), hasMore: false } };
    }

    // create-content → content_kind: static enum
    if (ref.name === 'create-content' && argument.name === 'content_kind') {
      const kinds = ['template', 'fragment'];
      return { completion: { values: kinds.filter(k => k.startsWith(argument.value)), hasMore: false } };
    }

    return { completion: { values: [] } };
  });

  // ─── Prompts ──────────────────────────────────────────────────────────────

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: ALL_PROMPTS };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const prompt = ALL_PROMPTS.find(p => p.name === name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${name}. Available: ${ALL_PROMPTS.map(p => p.name).join(', ')}`);
    }
    // Read live — tenant may have been configured after this session initialized.
    const liveTenantId = getConfiguredTenantId();
    const liveTenantNamespace = liveTenantId ? `_${liveTenantId}` : null;
    let messages;
    try {
      messages = getPromptMessages(name, args as Record<string, string> | undefined, liveTenantNamespace);
    } catch (err) {
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, err instanceof Error ? err.message : String(err));
    }
    return { description: prompt.description, messages };
  });

  return server;
}

// ─── STDIO Transport ──────────────────────────────────────────────────────────

export async function startStdioServer(): Promise<void> {
  const server = createMcpServer('stdio');
  const transport = new StdioServerTransport();

  const notifyListsChanged = () => {
    server.notification({ method: 'notifications/tools/list_changed' }).catch(() => {});
    server.notification({ method: 'notifications/resources/list_changed' }).catch(() => {});
  };
  const unsubWriteAccess = onWriteAccessChanged(notifyListsChanged);
  const unsubSandbox = onSandboxChanged(notifyListsChanged);

  transport.onclose = () => {
    unsubWriteAccess();
    unsubSandbox();
    // A stdio server is 1:1 with a client; drop it from the connected list on close
    const info = server.getClientVersion();
    if (info?.name) removeClient(info.name);
    logger.info('STDIO transport closed (no client connected or client disconnected)');
  };

  await server.connect(transport);
  logger.info('MCP STDIO transport active');
}

// The HTTP (Streamable) transport is created per-session in the /mcp handler
// (src/server/app.ts), which owns the stateful session lifecycle.
