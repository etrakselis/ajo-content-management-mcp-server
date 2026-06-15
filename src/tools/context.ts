import {
  isClientConfigured, getConfiguredSandboxName, getConfiguredOrgName,
  getConfiguredTenantId, getConfiguredAuthorEmail
} from '../adobe/client.js';
import { getWritesAllowed } from '../mcp/access-policy.js';
import { notConfiguredError, withTelemetry } from './utils.js';

// ─── get_server_context ────────────────────────────────────────────────────
// A reliable, on-demand way for the LLM to report who/what this server is
// operating as. The server `instructions` aren't surfaced to the model by every
// client, but tools always are — so identity questions ("who is this running on
// behalf of?", "which sandbox am I on?") resolve to an explicit tool call here.

export const getServerContextDefinition = {
  name: 'get_server_context',
  description: `Return the identity and configuration this MCP server is currently operating as: the author it is acting on behalf of (a self-declared email captured at setup — not verified), the AJO sandbox, the tenant namespace, the org name, and whether write access is enabled.

Use this to answer questions like "who is this server running on behalf of?", "which sandbox / tenant am I connected to?", or "can I make changes (is write access on)?".

Example usage: {}

Returns: { success: true, data: { authorEmail, sandbox, tenantNamespace, orgName, writeAccess, configured } }`,
  annotations: { readOnlyHint: true },
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
    return {
      success: true,
      data: {
        authorEmail: getConfiguredAuthorEmail(),
        sandbox: getConfiguredSandboxName(),
        tenantNamespace: tenantId ? `_${tenantId}` : null,
        orgName: getConfiguredOrgName(),
        writeAccess: getWritesAllowed(),
        configured: true
      }
    };
  });
}
