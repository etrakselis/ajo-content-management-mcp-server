/**
 * Unit tests for the append-only audit trail. fs.promises.appendFile is mocked so
 * the async write is exercised without touching disk: assert the JSONL line shape,
 * that the call is non-blocking (returns a promise / uses the async API), and that a
 * write failure is swallowed — recordAudit must never reject or throw.
 */

const appendFile = jest.fn().mockResolvedValue(undefined);
jest.mock('fs', () => ({
  __esModule: true,
  default: { promises: { appendFile: (...a: unknown[]) => appendFile(...a) } },
  promises: { appendFile: (...a: unknown[]) => appendFile(...a) }
}));

const warn = jest.fn();
jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: (...a: unknown[]) => warn(...a) }
}));

import { recordAudit, AuditEntry } from '../../src/telemetry/audit';

const entry: AuditEntry = {
  action: 'create_content_fragment',
  authorEmail: 'a@b.co',
  resourceType: 'fragment',
  resourceId: 'frag-1',
  resourceName: 'Welcome',
  sandbox: 'sb',
  tenantNamespace: '_acme',
  success: true
};

beforeEach(() => {
  appendFile.mockClear();
  appendFile.mockResolvedValue(undefined);
  warn.mockClear();
});

test('appends exactly one JSONL line carrying a timestamp + the entry fields', async () => {
  await recordAudit(entry);
  expect(appendFile).toHaveBeenCalledTimes(1);

  const [pathArg, lineArg] = appendFile.mock.calls[0] as [string, string];
  expect(String(pathArg)).toMatch(/audit-log\.jsonl$/);
  expect(lineArg.endsWith('\n')).toBe(true);

  const parsed = JSON.parse(lineArg.trimEnd());
  expect(parsed).toMatchObject({
    action: 'create_content_fragment',
    authorEmail: 'a@b.co',
    resourceType: 'fragment',
    resourceId: 'frag-1',
    success: true
  });
  expect(typeof parsed.timestamp).toBe('string');
});

test('write is non-blocking — recordAudit returns a promise (async appendFile, not Sync)', () => {
  const ret = recordAudit(entry);
  expect(typeof (ret as Promise<void>).then).toBe('function');
  return ret; // settle it so no dangling promise leaks into the next test
});

test('a write failure is swallowed: the promise resolves, a warning is logged, nothing throws', async () => {
  appendFile.mockRejectedValueOnce(new Error('ENOSPC: disk full'));
  await expect(recordAudit(entry)).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith(
    'Failed to write audit log file',
    expect.objectContaining({ error: expect.stringContaining('ENOSPC') })
  );
});
