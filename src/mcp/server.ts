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
import { isClientConfigured, getConfiguredSandboxName, getConfiguredOrgName, getConfiguredTenantId, getConfiguredAuthorEmail, listFragments, listTemplates, getFragment, getTemplate, buildError } from '../adobe/client.js';
import { recordClient, removeClient, TransportKind } from './connected-clients.js';
import { getWritesAllowed, onWriteAccessChanged } from './access-policy.js';
import { ALL_PROMPTS, getPromptMessages } from './prompts.js';
import { RESOURCE_URIS, RESOURCE_DESCRIPTORS, RESOURCE_TEMPLATE_URIS, RESOURCE_TEMPLATE_DESCRIPTORS, parseFragmentUri, parseTemplateUri, CHANNEL_REFERENCE_TEXT, ERROR_CODES_TEXT, VISUAL_DESIGNER_REQUIREMENTS_TEXT } from './resources.js';
import { logger } from '../telemetry/index.js';
import { recordAudit } from '../telemetry/audit.js';

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

// Server context — read-only; reports who/what this server is operating as
import { getServerContextDefinition, handleGetServerContext, setToolCatalog } from '../tools/context.js';
import { getVisualDesignerRequirementsDefinition, handleGetVisualDesignerRequirements } from '../tools/visual-designer.js';
import { getPersonalizationSyntaxDefinition, handleGetPersonalizationSyntax } from '../tools/personalization.js';
import { buildToolCatalog, formatToolCatalog } from './tool-catalog.js';

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
  // Server context — read-only
  getServerContextDefinition,
  // Visual Email Designer HTML spec — read-only reference
  getVisualDesignerRequirementsDefinition,
  // AJO personalization syntax library — read-only reference
  getPersonalizationSyntaxDefinition
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
  'publish_content_fragment', 'archive_content_fragment'
]);

const isWriteTool = (name: string): boolean => WRITE_TOOLS.has(name);

// Page cap for the ajo://fragments / ajo://templates directory reads. At 100
// items/page this bounds a directory read to 5,000 objects so a very large
// sandbox can't make a single resource read unbounded; beyond it the result is
// flagged truncated with a resume cursor.
const MAX_DIRECTORY_PAGES = 50;

// Writes with no undo. These are always re-confirmed with the user (never cached)
// when the client supports elicitation. The AJO API has no delete for fragments,
// so archive is the permanent equivalent.
const DESTRUCTIVE_TOOLS = new Set<string>(['delete_content_template', 'archive_content_fragment']);
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
const CONFIRM_PROP = {
  type: 'boolean' as const,
  description: 'Confirmation gate for clients without MCP elicitation support. Leave this unset on the ' +
    'first call — the server will hold the write and return a WRITE_CONFIRMATION_REQUIRED message naming ' +
    'the target (org, tenant, sandbox). Only after the user has explicitly confirmed that target, re-invoke ' +
    'the same tool with the same arguments plus confirmWrite: true. Never set this without the user’s confirmation.'
};

// Append the runtime-gate note to a write tool's description and declare the
// confirmWrite flag on its input schema. Returns a shallow copy so the shared
// ALL_TOOLS definitions are never mutated.
function augmentWriteTool<T extends { description: string; inputSchema: unknown }>(tool: T): T {
  const schema = (tool.inputSchema ?? {}) as { properties?: Record<string, unknown> };
  return {
    ...tool,
    description: tool.description + WRITE_TOOL_NOTE,
    inputSchema: {
      ...schema,
      properties: { ...(schema.properties ?? {}), [CONFIRM_ARG]: CONFIRM_PROP }
    }
  };
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
  return {
    content: [{ type: 'text' as const, text: textPrefix + JSON.stringify(result, null, 2) }],
    structuredContent: (result ?? {}) as Record<string, unknown>,
    ...(isError ? { isError: true } : {})
  };
}

// Appended to write-tool descriptions so the client/LLM knows the call is gated by
// the server's runtime write-access setting (rather than always available).
const WRITE_TOOL_NOTE =
  '\n\n[Write operation] Requires write access. If the server is in read-only mode this call is ' +
  'rejected with a READ_ONLY_MODE error; the user can enable write access at http://localhost:3000.';

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
  // Server context — read-only
  get_server_context: handleGetServerContext,
  // Visual Email Designer HTML spec — read-only reference
  get_visual_designer_requirements: handleGetVisualDesignerRequirements,
  // AJO personalization syntax library — read-only reference
  get_personalization_syntax: handleGetPersonalizationSyntax
};

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
    `at http://localhost:3000 and then retry — do not abandon the request.`;

  const personalizationNote = ` When inserting personalization fields into a template or fragment, do NOT assume ` +
    `default XDM paths like {{profile.person.firstName}}. Most customers define custom field groups under their ` +
    `tenant namespace, so first look up the real attribute paths with the XDM schema tools ` +
    `(list_xdm_field_groups / get_xdm_field_group, or get_xdm_union_schema for the full merged Profile view), ` +
    `then build personalization expressions from the actual attribute locations you find.`;

  const resourceNote = ` This server also exposes reference resources, but many clients (e.g. Claude ` +
    `Desktop) do not let the model read MCP resources directly — so call get_server_context for the resource ` +
    `catalog, which lists every resource with an "access" hint for how to actually obtain its content. In ` +
    `particular: the channel→templateType→content-shape mapping is already in the create_/update_ tool ` +
    `descriptions; the full Visual Email Designer HTML spec is returned by the get_visual_designer_requirements ` +
    `tool; server status is in get_server_context; and to find an object by name call list_content_fragments / ` +
    `list_content_templates, then get_content_fragment / get_content_template by id for the full object plus etag.`;

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

  const instructions = (tenantDesc
    ? `You are connected to Adobe Journey Optimizer for ${tenantDesc}. ` +
      `Always display the tenant namespace and sandbox name when discussing content operations. ` +
      `Before creating, updating, or deleting any content, confirm with the user that ` +
      `sandbox "${sandbox}"${tenantNamespace ? ` (tenant: ${tenantNamespace})` : ''} is the intended target.`
    : `You are connected to an AJO Content MCP server. ` +
      `No sandbox has been configured yet — ask the user to open http://localhost:3000 and complete setup before making any content changes.`)
    + authorNote + dynamicNote + personalizationNote + resourceNote + promptNote + toolIndexNote;

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

    // ── Clients without elicitation: confirm-and-retry gate ──
    // We can't show a dialog, so require the model to confirm the target with the
    // user out-of-band and re-invoke the same tool with confirmWrite: true.
    if (!server.getClientCapabilities()?.elicitation) {
      const confirmed = !!args && typeof args === 'object' &&
        (args as Record<string, unknown>)[CONFIRM_ARG] === true;
      if (confirmed) {
        if (!alwaysConfirm) confirmedSandboxes.add(targetKey);
        emitLog('info', `✓ ${toolName}: write confirmed for ${targetKey} (confirm-and-retry)`, sessionId);
        return { proceed: true };
      }
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
          `Do not retry unless the user explicitly asks for it again.`
      };
    } catch (err) {
      // Capability advertised but the elicitation failed — don't block the user.
      logger.warn('Elicitation failed; proceeding without confirmation', { tool: toolName, error: err instanceof Error ? err.message : String(err) });
      return { proceed: true };
    }
  }

  // ─── Tool Discovery ────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Always advertise the full tool set — many clients cache this list at connect
    // and ignore tools/list_changed, so hiding write tools would strand them in
    // read-only even after the toggle is flipped on. Write enforcement happens in
    // CallTool instead. Write tools get the runtime-gate note and the confirmWrite
    // flag (see augmentWriteTool).
    const tools = ALL_TOOLS.map(t => (isWriteTool(t.name) ? augmentWriteTool(t) : t));
    return { tools };
  });

  // ─── Tool Execution ────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const handler = TOOL_HANDLERS[name];
    const sessionId = extra.sessionId;

    emitLog('debug', `→ ${name}`, sessionId);

    // Enforce read-only mode at execution time (defense in depth — independent of
    // whether the tool was advertised). Read live so it applies to existing sessions.
    if (!getWritesAllowed() && isWriteTool(name)) {
      emitLog('warning', `✗ ${name}: READ_ONLY_MODE`, sessionId);
      return toToolResult({
        success: false,
        error: {
          code: 'READ_ONLY_MODE',
          message: `Write operations are disabled. The server is in read-only mode, so "${name}" is not permitted. Ask the user to enable write access on the setup page (http://localhost:3000) if this is intended.`,
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

    // Confirm the write target with the user before performing it (elicitation).
    // No-op for reads and for clients without elicitation support.
    if (isWriteTool(name)) {
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

      // Audit trail: attribute every content write to the self-declared author.
      // Only writes reach here in non-read-only mode (read-only writes are
      // rejected above). Captures both successful and handler-rejected attempts.
      if (isWriteTool(name)) {
        const callArgs = (args ?? {}) as Record<string, unknown>;
        const argId = typeof callArgs.fragmentId === 'string'
          ? callArgs.fragmentId
          : (typeof callArgs.templateId === 'string' ? callArgs.templateId : undefined);
        recordAudit({
          action: name,
          authorEmail: getConfiguredAuthorEmail() ?? 'unknown',
          resourceType: name.includes('fragment') ? 'fragment' : name.includes('template') ? 'template' : 'unknown',
          resourceId: argId ?? resultObj?.id,
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
          'NOT_CONFIGURED: the server has no sandbox configured yet. Ask the user to complete setup at http://localhost:3000.');
      }
      try {
        const result = fragmentId !== null
          ? await getFragment(fragmentId)
          : await getTemplate(templateId as string);
        return {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result, null, 2) }]
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
        contents: [{ uri, mimeType: 'text/plain', text: VISUAL_DESIGNER_REQUIREMENTS_TEXT }]
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
          'NOT_CONFIGURED: the server has no sandbox configured yet. Ask the user to complete setup at http://localhost:3000.');
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

  const unsubWriteAccess = onWriteAccessChanged(() => {
    server.notification({ method: 'notifications/tools/list_changed' }).catch(() => {});
    server.notification({ method: 'notifications/resources/list_changed' }).catch(() => {});
  });

  transport.onclose = () => {
    unsubWriteAccess();
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
