/**
 * Unit tests for the "promotion targets only the active sandbox" guard: promote_assets
 * and plan_promotion may only target the sandbox currently selected in the UI, so the
 * LLM is bounded by the UI selection in every scenario (CRUD and promotion alike).
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

jest.mock('../../src/mcp/access-policy', () => ({ getWritesAllowed: () => true }));

jest.mock('../../src/adobe/sandbox-context', () => ({
  withSandbox: (_s: string, fn: () => Promise<unknown>) => fn()
}));

// Engine is mocked so a target==active call gets past resolveInputs without doing real
// repo/AJO work — the guard under test lives entirely in the tool layer (resolveInputs).
jest.mock('../../src/promotion/engine', () => ({
  planPromotion: jest.fn(async () => ({ phases: [], assets: [], warnings: [], blockers: [] })),
  executePromotion: jest.fn(async () => ({ status: 'complete', openPrs: [], deployed: [], unchanged: [], idMap: {} })),
  PromotionError: class PromotionError extends Error {},
}));

jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: () => true,
  getConfiguredSandboxName: () => 'etrakselis-sandbox',
  getConfiguredGitHubIntegration: () => ({ owner: 'o', repo: 'r', token: 't', requireApproval: true, defaultBranch: 'main' }),
  getConfiguredOrgName: () => undefined,
  getConfiguredTenantId: () => 'acme',
  listFragments: jest.fn(async () => ({ items: [] }))
}));

import { handlePromoteAssets, handlePlanPromotion } from '../../src/tools/promotion';

type Res = { success: boolean; error?: { code: string; message: string } };

beforeEach(() => jest.clearAllMocks());

describe('promotion is restricted to the active sandbox', () => {
  test('promote_assets rejects a target that is not the active sandbox', async () => {
    const r = await handlePromoteAssets({ templateName: 'T', targetSandbox: 'prod', sourceSandbox: 'etrakselis-sandbox', confirmWrite: true }) as Res;
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('TARGET_SANDBOX_NOT_ACTIVE');
    expect(r.error?.message).toMatch(/etrakselis-sandbox/); // names the active sandbox
    expect(r.error?.message).toMatch(/reselect/i);          // tells the user how to proceed
  });

  test('plan_promotion is gated the same way', async () => {
    const r = await handlePlanPromotion({ templateName: 'T', targetSandbox: 'prod' }) as Res;
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('TARGET_SANDBOX_NOT_ACTIVE');
  });

  test('promote_assets proceeds past the guard when target IS the active sandbox', async () => {
    // target == active, source is a different repo subtree, no confirmWrite → the call
    // clears the active-sandbox guard and reaches the target-aware write-confirmation gate.
    const r = await handlePromoteAssets({ templateName: 'T', targetSandbox: 'etrakselis-sandbox', sourceSandbox: 'dev-subtree' }) as Res;
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('WRITE_CONFIRMATION_REQUIRED');
    expect(r.error?.code).not.toBe('TARGET_SANDBOX_NOT_ACTIVE');
  });

  test('plan_promotion runs when target IS the active sandbox', async () => {
    const r = await handlePlanPromotion({ templateName: 'T', targetSandbox: 'etrakselis-sandbox', sourceSandbox: 'dev-subtree' }) as Res & { plan?: unknown };
    expect(r.success).toBe(true);
  });
});
