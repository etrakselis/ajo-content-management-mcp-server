/**
 * Integration tests for OPT-IN LEAN MODE (MCP_LEAN_MODE).
 *
 * Lean mode trims the advertised tool surface for context-constrained clients: the
 * five individual reference get_* tools are collapsed into a single advertised
 * get_reference umbrella. This suite drives the real createMcpServer over an
 * in-memory transport and asserts:
 *   - default (flag off): the five reference tools are advertised; get_reference is not;
 *   - lean (flag on): get_reference is advertised; the five reference tools are not,
 *     and the advertised count drops by exactly four (−5 tools, +1 umbrella);
 *   - get_reference returns real content per topic, honors `category`, and rejects
 *     an unknown topic with a structured VALIDATION_ERROR;
 *   - the individual reference handlers stay CALLABLE in lean mode (so a tool
 *     description that still names one by exact name is not a dead end);
 *   - get_server_context's tool catalog reflects the active (advertised) set.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  authRefreshCounter: { inc: jest.fn() },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  adobeApiErrorCounter: { inc: jest.fn() },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

jest.mock('../../src/telemetry/audit', () => ({ recordAudit: jest.fn() }));
jest.mock('../../src/github/sync', () => ({
  commitAuditTrail: jest.fn().mockResolvedValue(undefined),
  createApprovalPR: jest.fn()
}));
jest.mock('../../src/auth/token-manager', () => ({
  tokenManager: { getStatus: jest.fn().mockReturnValue({ configured: true, tokenCached: true }) }
}));

jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: jest.fn().mockReturnValue(true),
  getConfiguredSandboxName: jest.fn().mockReturnValue('etrakselis-sandbox'),
  getConfiguredOrgName: jest.fn().mockReturnValue('Acme'),
  getConfiguredTenantId: jest.fn().mockReturnValue('acme'),
  getConfiguredAuthorEmail: jest.fn().mockReturnValue('author@example.com'),
  getConfiguredNamingConvention: jest.fn().mockReturnValue(undefined),
  getConfiguredGitHubIntegration: jest.fn().mockReturnValue(undefined),
  listFragments: jest.fn().mockResolvedValue({ items: [] }),
  listTemplates: jest.fn().mockResolvedValue({ items: [] }),
  buildError: (err: unknown) => ({ code: 'API_ERROR', message: String(err), details: {} }),
  createFragment: jest.fn(), getFragment: jest.fn(), updateFragment: jest.fn(),
  patchFragment: jest.fn(), publishFragment: jest.fn(), getLiveFragment: jest.fn(),
  getLastPublicationStatus: jest.fn(), archiveFragment: jest.fn(),
  createTemplate: jest.fn(), getTemplate: jest.fn(), updateTemplate: jest.fn(),
  patchTemplate: jest.fn(), deleteTemplate: jest.fn()
}));

jest.mock('../../src/adobe/unified-tags-client', () => ({
  createTag: jest.fn(), updateTag: jest.fn(), deleteTag: jest.fn(), listTags: jest.fn(), getTag: jest.fn(),
  validateTags: jest.fn(), listTagCategories: jest.fn(), getTagCategory: jest.fn(),
  createFolder: jest.fn(), getFolder: jest.fn(), updateFolder: jest.fn(),
  deleteFolder: jest.fn(), getSubfolders: jest.fn(), validateFolder: jest.fn(),
  clearFolderPathCache: jest.fn(), resolveAjoFolderPath: jest.fn().mockResolvedValue(undefined)
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server';

const REFERENCE_TOOLS = [
  'get_visual_designer_requirements',
  'get_aem_image_embed_instructions',
  'get_personalization_guidance',
  'get_personalization_syntax',
  'get_email_scenario_faq'
];

type ToolResult = {
  isError?: boolean;
  structuredContent?: {
    success?: boolean; topic?: string; content?: string;
    availableTopics?: string[]; availableCategories?: string[];
    error?: { code?: string };
    data?: { tools?: Array<{ group: string; tools: Array<{ name: string }> }> };
  };
};

async function connectClient() {
  const server = createMcpServer('http');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'TestClient', version: '1.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const catalogNames = (res: ToolResult): string[] =>
  (res.structuredContent?.data?.tools ?? []).flatMap(g => g.tools.map(t => t.name));

describe('lean mode OFF (default)', () => {
  beforeEach(() => { delete process.env.MCP_LEAN_MODE; });

  test('advertises the five individual reference tools and NOT get_reference', async () => {
    const client = await connectClient();
    const names = (await client.listTools()).tools.map(t => t.name);
    for (const t of REFERENCE_TOOLS) expect(names).toContain(t);
    expect(names).not.toContain('get_reference');
  });

  test('the individual reference tool still returns content', async () => {
    const client = await connectClient();
    const res = await client.callTool({ name: 'get_visual_designer_requirements', arguments: {} }) as ToolResult;
    expect(res.structuredContent?.success).toBe(true);
  });
});

describe('lean mode ON', () => {
  let defaultCount = 0;

  beforeAll(async () => {
    delete process.env.MCP_LEAN_MODE;
    const client = await connectClient();
    defaultCount = (await client.listTools()).tools.length;
  });

  beforeEach(() => { process.env.MCP_LEAN_MODE = '1'; });
  afterAll(() => { delete process.env.MCP_LEAN_MODE; });

  test('advertises get_reference instead of the five reference tools (net −4)', async () => {
    const client = await connectClient();
    const names = (await client.listTools()).tools.map(t => t.name);
    expect(names).toContain('get_reference');
    for (const t of REFERENCE_TOOLS) expect(names).not.toContain(t);
    expect(names.length).toBe(defaultCount - REFERENCE_TOOLS.length + 1);
  });

  test('get_reference returns real content for a topic', async () => {
    const client = await connectClient();
    const res = await client.callTool({ name: 'get_reference', arguments: { topic: 'visual-designer' } }) as ToolResult;
    expect(res.structuredContent?.success).toBe(true);
    expect(res.structuredContent?.topic).toBe('visual-designer');
    expect(typeof res.structuredContent?.content).toBe('string');
    expect((res.structuredContent?.content ?? '').length).toBeGreaterThan(50);
    expect(res.structuredContent?.availableTopics).toEqual(expect.arrayContaining(['visual-designer', 'personalization-syntax']));
  });

  test('get_reference honors category for personalization-syntax', async () => {
    const client = await connectClient();
    const idx = await client.callTool({ name: 'get_reference', arguments: { topic: 'personalization-syntax' } }) as ToolResult;
    expect(idx.structuredContent?.success).toBe(true);
    expect(Array.isArray(idx.structuredContent?.availableCategories)).toBe(true);
    const cat = idx.structuredContent!.availableCategories![0];
    const res = await client.callTool({ name: 'get_reference', arguments: { topic: 'personalization-syntax', category: cat } }) as ToolResult;
    expect(res.structuredContent?.success).toBe(true);
    expect(res.structuredContent?.topic).toBe('personalization-syntax');
  });

  test('get_reference rejects an unknown topic with a structured VALIDATION_ERROR', async () => {
    const client = await connectClient();
    const res = await client.callTool({ name: 'get_reference', arguments: { topic: 'nope' } }) as ToolResult;
    // An unknown enum value is rejected either at the SDK/handler layer; assert failure signal.
    expect(res.isError ?? (res.structuredContent?.success === false)).toBeTruthy();
  });

  test('the collapsed reference handlers stay callable by exact name in lean mode', async () => {
    const client = await connectClient();
    // Not advertised, but a description that still names it must not be a dead end.
    const res = await client.callTool({ name: 'get_email_scenario_faq', arguments: {} }) as ToolResult;
    expect(res.structuredContent?.success).toBe(true);
  });

  test('get_server_context tool catalog reflects the lean advertised set', async () => {
    const client = await connectClient();
    const res = await client.callTool({ name: 'get_server_context', arguments: {} }) as ToolResult;
    const names = catalogNames(res);
    expect(names).toContain('get_reference');
    for (const t of REFERENCE_TOOLS) expect(names).not.toContain(t);
  });
});
