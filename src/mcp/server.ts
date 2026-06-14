import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { tokenManager } from '../auth/token-manager.js';
import { isClientConfigured, getConfiguredSandboxName, getConfiguredOrgName, getConfiguredTenantId } from '../adobe/client.js';
import { recordClient, removeClient, TransportKind } from './connected-clients.js';
import { getWritesAllowed } from './access-policy.js';
import { logger } from '../telemetry/index.js';

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
  publishFragmentDefinition,
  getLiveFragmentDefinition, handleGetLiveFragment,
  getFragmentPublicationStatusDefinition, handleGetFragmentPublicationStatus,
  archiveContentFragmentDefinition, handleArchiveContentFragment
} from '../tools/fragments.js';

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
  publishFragmentDefinition,
  getLiveFragmentDefinition,
  getFragmentPublicationStatusDefinition,
  archiveContentFragmentDefinition
];

// Tools that modify content. When the server is in read-only mode these are
// hidden from tool discovery and rejected if called anyway.
const WRITE_TOOLS = new Set<string>([
  'create_content_template', 'update_content_template', 'patch_content_template', 'delete_content_template',
  'create_content_fragment', 'update_content_fragment', 'patch_content_fragment',
  'publish_content_fragment', 'publish_fragment', 'archive_content_fragment'
]);

const isWriteTool = (name: string): boolean => WRITE_TOOLS.has(name);

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
  publish_fragment: handlePublishContentFragment,
  get_live_fragment: handleGetLiveFragment,
  get_fragment_publication_status: handleGetFragmentPublicationStatus,
  archive_content_fragment: handleArchiveContentFragment
};

export function createMcpServer(transport: TransportKind = 'http'): Server {
  const sandbox = getConfiguredSandboxName();
  const orgName = getConfiguredOrgName();
  const tenantId = getConfiguredTenantId();
  const tenantNamespace = tenantId ? `_${tenantId}` : null;

  let tenantDesc: string | null = null;
  if (sandbox) {
    const parts: string[] = [];
    if (orgName) parts.push(`org "${orgName}"`);
    if (tenantNamespace) parts.push(`tenant namespace "${tenantNamespace}"`);
    parts.push(`sandbox "${sandbox}"`);
    tenantDesc = parts.join(', ');
  }

  // All tools are always advertised; write access is gated at execution time.
  // Describe the current state AND the dynamic recovery path so the LLM attempts
  // writes when asked and handles a READ_ONLY_MODE rejection gracefully (rather
  // than refusing up front, which would go stale the moment the toggle flips).
  const writeNote = getWritesAllowed()
    ? ` Write access is currently ENABLED, so create/update/delete/publish/archive tools will run.`
    : ` Write access is currently DISABLED (read-only). All tools are still listed, but create/update/` +
      `delete/publish/archive calls will be rejected with a READ_ONLY_MODE error.`;
  const dynamicNote = ` Write access can be toggled at runtime, so always attempt the operation the user ` +
    `asks for; if a write is rejected with READ_ONLY_MODE, tell the user they can enable write access ` +
    `at http://localhost:3000 and then retry — do not abandon the request.`;

  const instructions = (tenantDesc
    ? `You are connected to Adobe Journey Optimizer for ${tenantDesc}. ` +
      `Always display the tenant namespace and sandbox name when discussing content operations. ` +
      `Before creating, updating, or deleting any content, confirm with the user that ` +
      `sandbox "${sandbox}"${tenantNamespace ? ` (tenant: ${tenantNamespace})` : ''} is the intended target.`
    : `You are connected to an AJO Content MCP server. ` +
      `No sandbox has been configured yet — ask the user to open http://localhost:3000 and complete setup before making any content changes.`)
    + writeNote + dynamicNote;

  const server = new Server(
    {
      name: 'et-ajo-content-mgmt',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {}
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

  // ─── Tool Discovery ────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Always advertise the full tool set — many clients cache this list at connect
    // and ignore tools/list_changed, so hiding write tools would strand them in
    // read-only even after the toggle is flipped on. Write enforcement happens in
    // CallTool instead. A note on each write tool flags the runtime gate.
    const tools = ALL_TOOLS.map(t =>
      isWriteTool(t.name)
        ? { ...t, description: t.description + WRITE_TOOL_NOTE }
        : t
    );
    return { tools };
  });

  // ─── Tool Execution ────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = TOOL_HANDLERS[name];

    // Enforce read-only mode at execution time (defense in depth — independent of
    // whether the tool was advertised). Read live so it applies to existing sessions.
    if (!getWritesAllowed() && isWriteTool(name)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'READ_ONLY_MODE',
              message: `Write operations are disabled. The server is in read-only mode, so "${name}" is not permitted. Ask the user to enable write access on the setup page (http://localhost:3000) if this is intended.`,
              details: {}
            }
          })
        }],
        isError: true
      };
    }

    if (!handler) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'TOOL_NOT_FOUND',
              message: `Unknown tool: ${name}. Available tools: ${Object.keys(TOOL_HANDLERS).join(', ')}`,
              details: {}
            }
          })
        }],
        isError: true
      };
    }

    try {
      const result = await handler(args);
      const activeSandbox = getConfiguredSandboxName();
      const activeOrg = getConfiguredOrgName();
      const activeTenantId = getConfiguredTenantId();
      const parts: string[] = [];
      if (activeOrg) parts.push(`org: ${activeOrg}`);
      if (activeTenantId) parts.push(`tenant: _${activeTenantId}`);
      if (activeSandbox) parts.push(`sandbox: ${activeSandbox}`);
      const prefix = parts.length > 0 ? `[${parts.join(' | ')}]\n` : '';
      return {
        content: [{
          type: 'text',
          text: prefix + JSON.stringify(result, null, 2)
        }]
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Unhandled tool error', { tool: name, error: msg });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: msg, details: {} }
          })
        }],
        isError: true
      };
    }
  });

  // ─── Resources ────────────────────────────────────────────────────────────

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'ajo://server/status',
          name: 'Server Status',
          description: 'Current configuration and authentication status',
          mimeType: 'application/json'
        },
        {
          uri: 'ajo://tools/overview',
          name: 'Available Tools Overview',
          description: 'Summary of all available tools and their purposes',
          mimeType: 'text/plain'
        }
      ]
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'ajo://server/status') {
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
            availableTools: Object.keys(TOOL_HANDLERS).length
          }, null, 2)
        }]
      };
    }

    if (uri === 'ajo://tools/overview') {
      const overview = ALL_TOOLS.map(t => `• ${t.name}: ${t.description.split('\n')[0]}`).join('\n');
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: `AJO Content MCP Server — Available Tools\n\nTemplates:\n${
            ALL_TOOLS.filter(t => t.name.includes('template')).map(t => `• ${t.name}`).join('\n')
          }\n\nFragments:\n${
            ALL_TOOLS.filter(t => t.name.includes('fragment') || t.name === 'publish_fragment').map(t => `• ${t.name}`).join('\n')
          }\n\n${overview}`
        }]
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}

// ─── STDIO Transport ──────────────────────────────────────────────────────────

export async function startStdioServer(): Promise<void> {
  const server = createMcpServer('stdio');
  const transport = new StdioServerTransport();

  transport.onclose = () => {
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
