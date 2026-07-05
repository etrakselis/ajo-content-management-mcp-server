/**
 * Regression test: update_content_fragment is a full-replace PUT, so metadata the caller
 * omits (description, subType, tagIds, labels) used to be silently WIPED. The handler must
 * backfill omitted sticky-metadata from the current fragment, while letting an explicit
 * value (including "" / [] to clear) override. Covers the reported "description gets blanked
 * on update" bug; the shared helper is also unit-tested directly (templates use the same one).
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: () => true,
  buildError: (err: unknown) => ({ code: 'API_ERROR', message: String(err), details: {} }),
  getFragment: jest.fn(),
  updateFragment: jest.fn(),
  patchFragment: jest.fn()
}));

import { handleUpdateContentFragment } from '../../src/tools/fragments';
import { backfillOmittedMetadata, UPDATE_STICKY_METADATA_KEYS } from '../../src/tools/utils';
import * as client from '../../src/adobe/client';

const mock = client as jest.Mocked<typeof client>;
beforeEach(() => jest.clearAllMocks());

const CURRENT = {
  data: { name: 'Hero', description: 'Keep me', subType: 'HTML', tagIds: ['tag-1'], labels: ['Lbl'] },
  etag: '"e"'
};
const putPayload = () => (mock.updateFragment as jest.Mock).mock.calls[0][1] as Record<string, unknown>;

describe('update_content_fragment preserves omitted metadata', () => {
  test('omitted description/subType/tagIds/labels are backfilled from the current fragment', async () => {
    mock.getFragment.mockResolvedValue(CURRENT as never);
    mock.updateFragment.mockResolvedValue({ success: true, etag: '"e2"' } as never);
    const result = await handleUpdateContentFragment({
      fragmentId: '11111111-1111-1111-1111-111111111111', etag: '"e"', name: 'Hero', type: 'html', channels: ['email'],
      fragment: { content: '<div>new content</div>' }
    }) as { success: boolean };
    expect(result.success).toBe(true);
    expect(putPayload()).toMatchObject({
      description: 'Keep me', subType: 'HTML', tagIds: ['tag-1'], labels: ['Lbl']
    });
  });

  test('an explicit description is NOT overwritten by the current one', async () => {
    mock.getFragment.mockResolvedValue(CURRENT as never);
    mock.updateFragment.mockResolvedValue({ success: true } as never);
    await handleUpdateContentFragment({
      fragmentId: '11111111-1111-1111-1111-111111111111', etag: '"e"', name: 'Hero', description: 'Brand new', type: 'html',
      channels: ['email'], fragment: { content: '<div>x</div>' }
    });
    expect(putPayload().description).toBe('Brand new');
  });

  test('an explicit empty description clears it (not backfilled)', async () => {
    mock.getFragment.mockResolvedValue(CURRENT as never);
    mock.updateFragment.mockResolvedValue({ success: true } as never);
    await handleUpdateContentFragment({
      fragmentId: '11111111-1111-1111-1111-111111111111', etag: '"e"', name: 'Hero', description: '', type: 'html',
      channels: ['email'], fragment: { content: '<div>x</div>' }
    });
    expect(putPayload().description).toBe('');
  });
});

describe('backfillOmittedMetadata (shared by fragment + template updates)', () => {
  test('fills only omitted keys from current, never overrides provided ones', () => {
    const rest: Record<string, unknown> = { name: 'Given', description: undefined, tagIds: ['keep'] };
    backfillOmittedMetadata(rest, { name: 'Current', description: 'from-current', tagIds: ['other'], labels: ['L'] });
    expect(rest.name).toBe('Given');            // provided → kept
    expect(rest.description).toBe('from-current'); // omitted → backfilled
    expect(rest.tagIds).toEqual(['keep']);       // provided → kept
    expect(rest.labels).toEqual(['L']);          // omitted → backfilled
  });

  test('does not fabricate a value when current lacks it', () => {
    const rest: Record<string, unknown> = {};
    backfillOmittedMetadata(rest, { name: 'OnlyName' });
    expect(rest.name).toBe('OnlyName');
    expect('description' in rest).toBe(false);
    expect(UPDATE_STICKY_METADATA_KEYS).toContain('description');
  });
});
