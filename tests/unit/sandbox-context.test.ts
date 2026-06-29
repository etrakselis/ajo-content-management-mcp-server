// Unit tests for the AsyncLocalStorage-backed per-call sandbox override that powers
// cross-sandbox promotion (read source / write target within one operation).

import { withSandbox, getActiveSandboxOverride } from '../../src/adobe/sandbox-context';

describe('sandbox-context override', () => {
  test('no override outside withSandbox', () => {
    expect(getActiveSandboxOverride()).toBeUndefined();
  });

  test('override is visible inside withSandbox and cleared after', async () => {
    let seen: string | undefined;
    await withSandbox('prod', async () => { seen = getActiveSandboxOverride(); });
    expect(seen).toBe('prod');
    expect(getActiveSandboxOverride()).toBeUndefined();
  });

  test('nested withSandbox shadows the outer override, then restores it', async () => {
    const trace: Array<string | undefined> = [];
    await withSandbox('source', async () => {
      trace.push(getActiveSandboxOverride());           // source
      await withSandbox('target', async () => {
        trace.push(getActiveSandboxOverride());          // target
      });
      trace.push(getActiveSandboxOverride());           // source again
    });
    expect(trace).toEqual(['source', 'target', 'source']);
  });

  test('concurrent withSandbox calls do not leak into each other', async () => {
    const results = await Promise.all([
      withSandbox('a', async () => { await new Promise(r => setTimeout(r, 5)); return getActiveSandboxOverride(); }),
      withSandbox('b', async () => { return getActiveSandboxOverride(); })
    ]);
    expect(results).toEqual(['a', 'b']);
  });

  test('propagates the return value', async () => {
    const v = await withSandbox('x', async () => 42);
    expect(v).toBe(42);
  });
});
