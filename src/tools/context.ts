import {
  isClientConfigured, getConfiguredSandboxName, getConfiguredOrgName,
  getConfiguredTenantId, getConfiguredAuthorEmail, getConfiguredNamingConvention,
  getConfiguredGitHubIntegration
} from '../adobe/client.js';
import { getWritesAllowed } from '../mcp/access-policy.js';
import type { ToolCatalogGroup } from '../mcp/tool-catalog.js';
import { RESOURCE_ACCESS_CATALOG } from '../mcp/resources.js';
import { getLastGitHubAuditStatus } from '../mcp/github-audit-status.js';
import { notConfiguredError, withTelemetry, buildOutputSchema } from './utils.js';

// The full tool catalog, injected once at server startup (server.ts derives it
// from the live tool list and calls setToolCatalog). Surfacing it in this tool's
// output gives the model a reliable, high-salience index of every capability —
// so it can select tools by exact name instead of relying on fuzzy tool search.
let toolCatalog: ToolCatalogGroup[] = [];
export function setToolCatalog(catalog: ToolCatalogGroup[]): void {
  toolCatalog = catalog;
}

// Whether the current sandbox write-confirmation gate has been cleared this session.
// Injected by createMcpServer() after the confirmedSandboxes set is established, so
// get_server_context can report it without coupling context.ts to server internals.
let writeConfirmedGetter: (() => boolean) | null = null;
export function setWriteConfirmedGetter(fn: () => boolean): void {
  writeConfirmedGetter = fn;
}

// ─── get_server_context ────────────────────────────────────────────────────
// A reliable, on-demand way for the LLM to report who/what this server is
// operating as. The server `instructions` aren't surfaced to the model by every
// client, but tools always are — so identity questions ("who is this running on
// behalf of?", "which sandbox am I on?") resolve to an explicit tool call here.

export const getServerContextDefinition = {
  name: 'get_server_context',
  title: 'Get Server Context (Identity & Config)',
  outputSchema: buildOutputSchema({
    data: {
      type: 'object',
      properties: {
        authorEmail: { type: ['string', 'null'], description: 'Self-declared author email (not verified); null if unset.' },
        sandbox: { type: ['string', 'null'], description: 'Configured AJO sandbox name.' },
        tenantNamespace: { type: ['string', 'null'], description: 'Tenant namespace (e.g. _acme); null if unknown.' },
        orgName: { type: 'string', description: 'Adobe org name (optional). Omitted entirely when not configured — absence means no org name was set, not an error.' },
        writeAccess: { type: 'boolean', description: 'Whether write operations are currently enabled.' },
        writeConfirmed: { type: 'boolean', description: 'Whether the write-confirmation gate has already been cleared for the current sandbox this session. True means subsequent non-destructive writes proceed without a WRITE_CONFIRMATION_REQUIRED hold.' },
        configured: { type: 'boolean', description: 'Whether credentials and sandbox are configured.' },
        tools: {
          type: 'array',
          description: 'Catalog of every tool this server exposes, grouped by domain. Call any tool by its exact "name". Use this to discover all capabilities in one call rather than searching.',
          items: {
            type: 'object',
            properties: {
              group: { type: 'string', description: 'Domain grouping, e.g. "Content fragments".' },
              tools: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Exact tool name to call.' },
                    title: { type: 'string', description: 'Human-friendly title.' }
                  }
                }
              }
            }
          }
        },
        resources: {
          type: 'array',
          description: 'Catalog of every resource this server exposes, each with how to actually obtain it. Many clients (e.g. Claude Desktop) do not let the model read MCP resources directly, so use the "access" hint — it names the tool to call or says where the content already lives.',
          items: {
            type: 'object',
            properties: {
              uri: { type: 'string', description: 'Resource URI (e.g. ajo://error-codes).' },
              title: { type: 'string', description: 'Human-friendly title.' },
              description: { type: 'string', description: 'What the resource contains.' },
              access: { type: 'string', description: 'How the model can obtain this content (a tool to call, or where it already appears).' }
            }
          }
        },
        githubIntegration: {
          type: 'object',
          description: 'Present only when GitHub integration is configured. Reports the active write mode without exposing the token.',
          properties: {
            enabled: { type: 'boolean' },
            owner: { type: 'string' },
            repo: { type: 'string' },
            mode: { type: 'string', description: '"approval-gate" (writes become PRs for human review) or "audit-trail" (writes apply to AJO, then commit).' },
            defaultBranch: { type: 'string' },
            lastAuditSync: {
              type: 'object',
              description: 'Audit-trail mode only: outcome of the most recent fire-and-forget commit. ok: false means the AJO write succeeded but was NOT recorded in GitHub — tell the user. Absent until the first audit-trail write of the session.',
              properties: {
                at: { type: 'string', description: 'ISO-8601 timestamp of the commit attempt.' },
                tool: { type: 'string', description: 'The write tool whose change was being recorded.' },
                ok: { type: 'boolean', description: 'true if the commit succeeded.' },
                error: { type: 'string', description: 'Short reason when ok is false.' }
              }
            }
          }
        }
      }
    }
  }),
  description: `Return the identity, configuration, and full tool inventory for this MCP server. Call this to list all available tools, enumerate capabilities, discover what this server can do, or find a tool by name — it returns the complete catalog grouped by domain so you can select any tool by its exact name without relying on keyword search.

Also returns: the author identity, AJO sandbox, tenant namespace, org name, whether write access is enabled, whether the write-confirmation gate has already been cleared for this sandbox (writeConfirmed: true means non-destructive writes proceed immediately without a WRITE_CONFIRMATION_REQUIRED hold), and — when GitHub integration is configured — its write mode plus, in audit-trail mode, the outcome of the last commit (githubIntegration.lastAuditSync; ok: false means an AJO write succeeded but was NOT recorded in GitHub).

Use this to answer: "list all tools", "what tools are available?", "enumerate capabilities", "find a tool for X", "who is this server running as?", "which sandbox / tenant am I on?", "is write access on?", "has a write been confirmed yet?", "did the last GitHub sync succeed?", "what resources are available and how do I read them?".

Example usage: {}

Returns: { success: true, data: { authorEmail, sandbox, tenantNamespace, orgName, writeAccess, configured, tools: [{ group, tools: [{ name, title }] }], resources: [{ uri, title, description, access }] } }`,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {}
  }
};

export async function handleGetServerContext(_args?: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_server_context', async () => {
    const tenantId = getConfiguredTenantId();
    // orgName is an optional landing-page field that is usually left blank. When
    // it's unset (or empty) omit the key entirely rather than surfacing a null —
    // a missing key reads cleanly to the LLM, whereas a null invites it to mention
    // a non-existent org.
    const orgName = getConfiguredOrgName()?.trim();
    const namingConvention = getConfiguredNamingConvention();
    const ghConfig = getConfiguredGitHubIntegration();
    // Audit-trail mode commits to GitHub fire-and-forget (after the write returns), so
    // surface the last commit outcome here — the reliable channel for the model to learn
    // a commit failed (the warning otherwise only goes out as an MCP logging message).
    const lastAuditSync = ghConfig && !ghConfig.requireApproval ? getLastGitHubAuditStatus() : null;
    return {
      success: true,
      data: {
        authorEmail: getConfiguredAuthorEmail(),
        sandbox: getConfiguredSandboxName(),
        tenantNamespace: tenantId ? `_${tenantId}` : null,
        ...(orgName ? { orgName } : {}),
        writeAccess: getWritesAllowed(),
        writeConfirmed: writeConfirmedGetter?.() ?? false,
        configured: true,
        // Only surface the convention when enforcement is ON — never expose rules the
        // operator chose not to enforce (defense-in-depth; disabled configs aren't stored).
        ...(namingConvention?.enabled ? { namingConvention } : {}),
        // Surface GitHub integration status so the LLM knows which write mode is active
        // (approval-gate vs audit-trail) without exposing the token.
        ...(ghConfig ? {
          githubIntegration: {
            enabled: true,
            owner: ghConfig.owner,
            repo: ghConfig.repo,
            mode: ghConfig.requireApproval ? 'approval-gate' : 'audit-trail',
            defaultBranch: ghConfig.defaultBranch,
            ...(lastAuditSync ? { lastAuditSync } : {})
          }
        } : {}),
        tools: toolCatalog,
        resources: RESOURCE_ACCESS_CATALOG
      }
    };
  });
}

// ─── get_naming_convention ────────────────────────────────────────────────────

export const getNamingConventionDefinition = {
  name: 'get_naming_convention',
  title: 'Get Naming Convention',
  outputSchema: buildOutputSchema({
    enabled: { type: 'boolean', description: 'Whether a naming convention is currently enforced.' },
    rules: { type: ['string', 'null'], description: 'The full naming convention rules in Markdown. null when no convention is configured.' }
  }),
  description: `Return the administrator-defined naming convention that this server enforces when creating or renaming content templates, fragments, folders, and tags. Call this before assigning any name to ensure compliance. Returns the full rules as Markdown.

When enabled, the create_* tools (create_content_template, create_content_fragment, create_folder, create_tag) and rename-capable tools require names to follow these rules — non-compliant names should be caught and corrected before submitting.

Example usage: {}

Returns: { success: true, enabled: true, rules: "# Naming Convention\\n..." } or { enabled: false, rules: null }`,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {}
  }
};

export async function handleGetNamingConvention(_args?: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_naming_convention', async () => {
    const convention = getConfiguredNamingConvention();
    if (!convention?.enabled || !convention.markdown.trim()) {
      return { success: true, enabled: false, rules: null };
    }
    return { success: true, enabled: true, rules: convention.markdown.trim() };
  });
}
