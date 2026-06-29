/**
 * Integration tests for the Unified Folders + Tags tool handlers.
 * The Unified Tags/Folders HTTP client is mocked, so these verify the tool layer
 * end-to-end: input validation, the not-configured short-circuit, success-envelope
 * shaping, the JSON-Patch bodies built for the update tools, and API-error mapping.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

let configured = true;
jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: () => configured,
  buildError: (err: unknown) => ({ code: 'API_ERROR', message: String(err), details: {} })
}));

jest.mock('../../src/adobe/unified-tags-client', () => ({
  createFolder: jest.fn(), getFolder: jest.fn(), updateFolder: jest.fn(),
  deleteFolder: jest.fn(), getSubfolders: jest.fn(), validateFolder: jest.fn(),
  clearFolderPathCache: jest.fn(),
  listTagCategories: jest.fn(), getTagCategory: jest.fn(),
  listTags: jest.fn(), createTag: jest.fn(), getTag: jest.fn(),
  updateTag: jest.fn(), deleteTag: jest.fn(), validateTags: jest.fn()
}));

import {
  handleCreateFolder, handleGetFolder, handleUpdateFolder,
  handleDeleteFolder, handleListSubfolders, handleValidateFolder,
  handleEnsureFolderPath
} from '../../src/tools/folders';
import {
  handleListTagCategories, handleGetTagCategory,
  handleListTags, handleCreateTag, handleGetTag, handleUpdateTag, handleDeleteTag, handleValidateTags
} from '../../src/tools/tags';
import * as ut from '../../src/adobe/unified-tags-client';

const m = ut as jest.Mocked<typeof ut>;
const FOLDER_ID = '83f8287c-767b-4106-b271-257282fd170e';
const TAG_ID = '8af14b1e-f267-44ad-b94c-9ac70274e3d5';
const CAT_ID = 'e2b7c656-067b-4413-a366-adde0401df50';

type Envelope = { success: boolean; data?: unknown; error?: { code: string } };

beforeEach(() => { jest.clearAllMocks(); configured = true; });

// ─── Folders ────────────────────────────────────────────────────────────────

describe('folder tools', () => {
  test('create_folder forwards name + parentFolderId and wraps the result', async () => {
    m.createFolder.mockResolvedValue({ id: FOLDER_ID, name: 'Assets' });
    const res = await handleCreateFolder({ folderType: 'content-template', name: 'Assets', parentFolderId: 'p1' }) as Envelope;
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ id: FOLDER_ID, name: 'Assets' });
    expect(m.createFolder).toHaveBeenCalledWith('content-template', { name: 'Assets', parentFolderId: 'p1' });
  });

  test('create_folder sends parentFolderId: null for a top-level folder', async () => {
    m.createFolder.mockResolvedValue({ id: FOLDER_ID });
    await handleCreateFolder({ folderType: 'content-template', name: 'Top' });
    expect(m.createFolder).toHaveBeenCalledWith('content-template', { name: 'Top', parentFolderId: null });
  });

  test('create_folder rejects a missing folderType (validation)', async () => {
    const res = await handleCreateFolder({ name: 'Assets' }) as Envelope;
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
    expect(m.createFolder).not.toHaveBeenCalled();
  });

  test('get_folder returns NOT_CONFIGURED when the server is not set up', async () => {
    configured = false;
    const res = await handleGetFolder({ folderType: 'dataset', folderId: FOLDER_ID }) as Envelope;
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('NOT_CONFIGURED');
  });

  test('update_folder builds a replace /name JSON-Patch op', async () => {
    m.updateFolder.mockResolvedValue({ id: FOLDER_ID, name: 'Renamed' });
    const res = await handleUpdateFolder({ folderType: 'dataset', folderId: FOLDER_ID, name: 'Renamed' }) as Envelope;
    expect(res.success).toBe(true);
    expect(m.updateFolder).toHaveBeenCalledWith('dataset', FOLDER_ID, [{ op: 'replace', path: '/name', value: 'Renamed' }]);
  });

  test('update_folder invalidates the folder-path cache after a rename', async () => {
    m.updateFolder.mockResolvedValue({ id: FOLDER_ID, name: 'Renamed' });
    await handleUpdateFolder({ folderType: 'dataset', folderId: FOLDER_ID, name: 'Renamed' });
    expect(m.clearFolderPathCache).toHaveBeenCalledTimes(1);
  });

  test('update_folder does NOT invalidate the cache when the rename fails', async () => {
    m.updateFolder.mockRejectedValue(new Error('boom'));
    const res = await handleUpdateFolder({ folderType: 'dataset', folderId: FOLDER_ID, name: 'Renamed' }) as Envelope;
    expect(res.success).toBe(false);
    expect(m.clearFolderPathCache).not.toHaveBeenCalled();
  });

  test('delete_folder maps an upstream failure to an API_ERROR envelope', async () => {
    m.deleteFolder.mockRejectedValue(new Error('boom'));
    const res = await handleDeleteFolder({ folderType: 'dataset', folderId: FOLDER_ID }) as Envelope;
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('API_ERROR');
  });

  test('delete_folder invalidates the folder-path cache on success', async () => {
    m.deleteFolder.mockResolvedValue({});
    await handleDeleteFolder({ folderType: 'content-template', folderId: FOLDER_ID });
    expect(m.clearFolderPathCache).toHaveBeenCalledTimes(1);
  });

  test('delete_folder coerces an empty-string body to an object (Issue B)', async () => {
    m.deleteFolder.mockResolvedValue('' as unknown as Record<string, unknown>);
    const res = await handleDeleteFolder({ folderType: 'content-template', folderId: FOLDER_ID }) as Envelope;
    expect(res.success).toBe(true);
    expect(res.data).toEqual({});
  });

  test('create_folder enriches a "not onboarded" error with the known content nouns (Issue 4)', async () => {
    m.createFolder.mockRejectedValue(new Error('Noun: foo not onboarded to onto folders'));
    const res = await handleCreateFolder({ folderType: 'foo', name: 'X' }) as { success: boolean; error?: { message: string } };
    expect(res.success).toBe(false);
    expect(res.error?.message).toMatch(/valid folderType nouns are/);
    expect(res.error?.message).toMatch(/content-template/);
  });

  test('create_folder suggests "fragment" when "content-fragment" is rejected as not onboarded (Issue 2.6)', async () => {
    m.createFolder.mockRejectedValue(new Error('Noun: content-fragment not onboarded to onto folders'));
    const res = await handleCreateFolder({ folderType: 'content-fragment', name: 'X' }) as { success: boolean; error?: { message: string } };
    expect(res.success).toBe(false);
    expect(res.error?.message).toMatch(/Did you mean folderType "fragment"/);
  });

  test('delete_folder retries a children-exist 422 and succeeds once propagation catches up (Issue 2)', async () => {
    jest.useFakeTimers();
    try {
      m.deleteFolder
        .mockRejectedValueOnce(new Error('Children for this folder already exist'))
        .mockResolvedValueOnce({});
      const p = handleDeleteFolder({ folderType: 'content-template', folderId: FOLDER_ID }) as Promise<Envelope>;
      await jest.advanceTimersByTimeAsync(600); // clear the first (~500ms) backoff
      const res = await p;
      expect(res.success).toBe(true);
      expect(m.deleteFolder).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('delete_folder still fails with a propagation-lag hint after exhausting retries (Issue 2.2)', async () => {
    jest.useFakeTimers();
    try {
      m.deleteFolder.mockRejectedValue(new Error('Children for this folder already exist'));
      const p = handleDeleteFolder({ folderType: 'content-template', folderId: FOLDER_ID }) as Promise<{ success: boolean; error?: { message: string } }>;
      await jest.advanceTimersByTimeAsync(4000); // exhaust 500+1000+2000 backoffs
      const res = await p;
      expect(res.success).toBe(false);
      expect(res.error?.message).toMatch(/propagation lag|wait a moment and retry/i);
      // Initial attempt + 3 retries.
      expect(m.deleteFolder).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });

  test('list_subfolders and validate_folder pass through the upstream payload', async () => {
    m.getSubfolders.mockResolvedValue({ id: FOLDER_ID, folders: [] });
    m.validateFolder.mockResolvedValue({ id: FOLDER_ID, status: 'IN_USE' });
    const sub = await handleListSubfolders({ folderType: 'dataset', folderId: FOLDER_ID }) as Envelope;
    const val = await handleValidateFolder({ folderType: 'dataset', folderId: FOLDER_ID }) as Envelope;
    expect(sub.data).toEqual({ id: FOLDER_ID, folders: [] });
    expect(val.data).toEqual({ id: FOLDER_ID, status: 'IN_USE' });
  });
});

// ─── Tag categories (read-only; mutation is admin-only and not exposed) ─────────

describe('tag category tools', () => {
  test('list_tag_categories forwards the sort params', async () => {
    m.listTagCategories.mockResolvedValue({ tags: [] });
    const res = await handleListTagCategories({ sortBy: 'name', sortOrder: 'asc' }) as Envelope;
    expect(res.success).toBe(true);
    expect(m.listTagCategories).toHaveBeenCalledWith({ sortBy: 'name', sortOrder: 'asc' });
  });

  test('get_tag_category passes the id through', async () => {
    m.getTagCategory.mockResolvedValue({ id: CAT_ID });
    const res = await handleGetTagCategory({ tagCategoryId: CAT_ID }) as Envelope;
    expect(res.success).toBe(true);
    expect(m.getTagCategory).toHaveBeenCalledWith(CAT_ID);
  });
});

// ─── Tags ──────────────────────────────────────────────────────────────────────

describe('tag tools', () => {
  test('list_tags forwards a property filter', async () => {
    m.listTags.mockResolvedValue({ tags: [] });
    await handleListTags({ property: `tagCategoryId=${CAT_ID}` });
    expect(m.listTags).toHaveBeenCalledWith({ property: `tagCategoryId=${CAT_ID}` });
  });

  test('create_tag includes tagCategoryId when given', async () => {
    m.createTag.mockResolvedValue({ id: TAG_ID });
    await handleCreateTag({ name: 'summer-sale', tagCategoryId: CAT_ID });
    expect(m.createTag).toHaveBeenCalledWith({ name: 'summer-sale', tagCategoryId: CAT_ID });
  });

  test('create_tag omits tagCategoryId for an uncategorized tag', async () => {
    m.createTag.mockResolvedValue({ id: TAG_ID });
    await handleCreateTag({ name: 'summer-sale' });
    expect(m.createTag).toHaveBeenCalledWith({ name: 'summer-sale' });
  });

  test('get_tag passes the id through', async () => {
    m.getTag.mockResolvedValue({ id: TAG_ID });
    const res = await handleGetTag({ tagId: TAG_ID }) as Envelope;
    expect(res.success).toBe(true);
  });

  test('update_tag sends all fields in one call as an array of replace ops, no-slash paths, string values (Issue 6)', async () => {
    m.updateTag.mockResolvedValue({ id: TAG_ID });
    await handleUpdateTag({ tagId: TAG_ID, name: 'n', archived: true, tagCategoryId: CAT_ID });
    expect(m.updateTag).toHaveBeenCalledTimes(1);
    expect(m.updateTag).toHaveBeenCalledWith(TAG_ID, [
      { op: 'replace', path: 'name', value: 'n' },
      { op: 'replace', path: 'archived', value: 'true' },
      { op: 'replace', path: 'tagCategoryId', value: CAT_ID }
    ]);
  });

  test('update_tag archive-only sends a one-element array [{ op: replace, path: archived, value: "true" }] (Issue 6)', async () => {
    m.updateTag.mockResolvedValue({ id: TAG_ID });
    await handleUpdateTag({ tagId: TAG_ID, archived: true });
    expect(m.updateTag).toHaveBeenCalledTimes(1);
    expect(m.updateTag).toHaveBeenCalledWith(TAG_ID, [{ op: 'replace', path: 'archived', value: 'true' }]);
  });

  test('update_tag rejects an empty update', async () => {
    const res = await handleUpdateTag({ tagId: TAG_ID }) as Envelope;
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
    expect(m.updateTag).not.toHaveBeenCalled();
  });

  test('delete_tag returns a success envelope', async () => {
    m.deleteTag.mockResolvedValue({});
    const res = await handleDeleteTag({ tagId: TAG_ID }) as Envelope;
    expect(res.success).toBe(true);
  });

  test('delete_tag coerces an empty-string body (empty 200) to an object so it matches the outputSchema (Issue B)', async () => {
    m.deleteTag.mockResolvedValue('' as unknown as Record<string, unknown>);
    const res = await handleDeleteTag({ tagId: TAG_ID }) as Envelope;
    expect(res.success).toBe(true);
    expect(res.data).toEqual({});
  });

  test('delete_tag strips the content stale-etag bleed and adds an archive hint for "Tag is not archived" (Issue 7)', async () => {
    m.deleteTag.mockRejectedValue(new Error('Tag is not archived (Stale etag: Re-fetch it with get_content_template / get_content_fragment to obtain the current etag.)'));
    const res = await handleDeleteTag({ tagId: TAG_ID }) as { success: boolean; error?: { message: string } };
    expect(res.success).toBe(false);
    expect(res.error?.message).not.toMatch(/get_content_fragment/);
    expect(res.error?.message).toMatch(/update_tag with archived: true/);
  });

  test('delete_tag with an "Associated Tag Count" error hints to detach the tag from content first (Issue 7)', async () => {
    m.deleteTag.mockRejectedValue(new Error('Associated Tag Count is not Zero'));
    const res = await handleDeleteTag({ tagId: TAG_ID }) as { success: boolean; error?: { message: string } };
    expect(res.success).toBe(false);
    expect(res.error?.message).toMatch(/patch_content_fragment/);
  });

  test('validate_tags forwards ids and returns the valid/invalid split', async () => {
    m.validateTags.mockResolvedValue({ validTags: [{ id: TAG_ID }], invalidTags: [{ id: 'bad' }] });
    const res = await handleValidateTags({ ids: [TAG_ID, 'bad'] }) as Envelope;
    expect(res.success).toBe(true);
    expect(m.validateTags).toHaveBeenCalledWith({ ids: [TAG_ID, 'bad'] });
    expect(res.data).toEqual({ validTags: [{ id: TAG_ID }], invalidTags: [{ id: 'bad' }] });
  });

  test('validate_tags rejects an empty ids array', async () => {
    const res = await handleValidateTags({ ids: [] }) as Envelope;
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });
});

// ─── ensure_folder_path ─────────────────────────────────────────────────────

type PathEnvelope = { success: boolean; leafFolderId?: string; path?: Array<{ name: string; id: string; created: boolean }>; error?: { code: string; message?: string } };

const ID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ID_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('ensure_folder_path', () => {
  test('creates all levels when none exist', async () => {
    m.createFolder
      .mockResolvedValueOnce({ id: ID_A })
      .mockResolvedValueOnce({ id: ID_B })
      .mockResolvedValueOnce({ id: ID_C });

    const res = await handleEnsureFolderPath({ folderType: 'fragment', path: ['NV', 'BIS', 'Wishlist'] }) as PathEnvelope;
    expect(res.success).toBe(true);
    expect(res.leafFolderId).toBe(ID_C);
    expect(res.path).toEqual([
      { name: 'NV', id: ID_A, created: true },
      { name: 'BIS', id: ID_B, created: true },
      { name: 'Wishlist', id: ID_C, created: true }
    ]);
    expect(m.createFolder).toHaveBeenNthCalledWith(1, 'fragment', { name: 'NV', parentFolderId: null });
    expect(m.createFolder).toHaveBeenNthCalledWith(2, 'fragment', { name: 'BIS', parentFolderId: ID_A });
    expect(m.createFolder).toHaveBeenNthCalledWith(3, 'fragment', { name: 'Wishlist', parentFolderId: ID_B });
  });

  test('reuses an existing top-level folder on duplicate, then creates child', async () => {
    m.createFolder
      .mockRejectedValueOnce(new Error('Duplicate folder name'))
      .mockResolvedValueOnce({ id: ID_B });
    m.getSubfolders.mockResolvedValueOnce({ id: 'root', folders: [{ id: ID_A, name: 'NV' }] });

    const res = await handleEnsureFolderPath({ folderType: 'fragment', path: ['NV', 'BIS'] }) as PathEnvelope;
    expect(res.success).toBe(true);
    expect(res.leafFolderId).toBe(ID_B);
    expect(res.path).toEqual([
      { name: 'NV', id: ID_A, created: false },
      { name: 'BIS', id: ID_B, created: true }
    ]);
    expect(m.getSubfolders).toHaveBeenCalledWith('fragment', 'root');
  });

  test('reuses existing folders at every level', async () => {
    m.createFolder
      .mockRejectedValueOnce(new Error('Duplicate folder name'))
      .mockRejectedValueOnce(new Error('Duplicate folder name'));
    m.getSubfolders
      .mockResolvedValueOnce({ id: 'root', folders: [{ id: ID_A, name: 'NV' }] })
      .mockResolvedValueOnce({ id: ID_A, folders: [{ id: ID_B, name: 'BIS' }] });

    const res = await handleEnsureFolderPath({ folderType: 'fragment', path: ['NV', 'BIS'] }) as PathEnvelope;
    expect(res.success).toBe(true);
    expect(res.leafFolderId).toBe(ID_B);
    expect(res.path).toEqual([
      { name: 'NV', id: ID_A, created: false },
      { name: 'BIS', id: ID_B, created: false }
    ]);
  });

  test('bug-report regression: root segment exists (returned under the `folders` key) → reuse it and create the missing children', async () => {
    // The subfolders endpoint returns children under `folders`. Reading `children`
    // made this lookup miss and abort with a self-contradictory FOLDER_NOT_FOUND
    // whenever the root segment already existed (the reviewer's exact case).
    m.createFolder
      .mockRejectedValueOnce(new Error('Duplicate folder name')) // LM already exists
      .mockResolvedValueOnce({ id: ID_B })                        // UNIT created
      .mockResolvedValueOnce({ id: ID_C });                       // OrderConfirmation created
    m.getSubfolders.mockResolvedValueOnce({ id: 'root', folders: [{ id: ID_A, name: 'LM' }] });

    const res = await handleEnsureFolderPath({ folderType: 'fragment', path: ['LM', 'UNIT', 'OrderConfirmation'] }) as PathEnvelope;
    expect(res.success).toBe(true);
    expect(res.leafFolderId).toBe(ID_C);
    expect(res.path).toEqual([
      { name: 'LM', id: ID_A, created: false },
      { name: 'UNIT', id: ID_B, created: true },
      { name: 'OrderConfirmation', id: ID_C, created: true }
    ]);
    // The new children anchor to the REUSED LM id, then to the new UNIT id.
    expect(m.createFolder).toHaveBeenNthCalledWith(2, 'fragment', { name: 'UNIT', parentFolderId: ID_A });
    expect(m.createFolder).toHaveBeenNthCalledWith(3, 'fragment', { name: 'OrderConfirmation', parentFolderId: ID_B });
  });

  test('reuses an existing folder case-insensitively (existing "LM" matches a requested "lm")', async () => {
    m.createFolder.mockRejectedValueOnce(new Error('Duplicate folder name'));
    m.getSubfolders.mockResolvedValueOnce({ id: 'root', folders: [{ id: ID_A, name: 'LM' }] });

    const res = await handleEnsureFolderPath({ folderType: 'fragment', path: ['lm'] }) as PathEnvelope;
    expect(res.success).toBe(true);
    expect(res.leafFolderId).toBe(ID_A);
    expect(res.path).toEqual([{ name: 'lm', id: ID_A, created: false }]);
  });

  test('returns FOLDER_NOT_FOUND when duplicate is reported but name is missing from children', async () => {
    m.createFolder.mockRejectedValueOnce(new Error('Duplicate folder name'));
    m.getSubfolders.mockResolvedValueOnce({ id: 'root', folders: [{ id: ID_A, name: 'Other' }] });

    const res = await handleEnsureFolderPath({ folderType: 'fragment', path: ['NV'] }) as PathEnvelope;
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('FOLDER_NOT_FOUND');
  });

  test('propagates a non-duplicate API error immediately', async () => {
    m.createFolder.mockRejectedValueOnce(new Error('not onboarded'));
    const res = await handleEnsureFolderPath({ folderType: 'bad-type', path: ['X'] }) as PathEnvelope;
    expect(res.success).toBe(false);
    expect(res.error?.message).toMatch(/not onboarded/);
  });

  test('rejects an empty path (validation)', async () => {
    const res = await handleEnsureFolderPath({ folderType: 'fragment', path: [] }) as PathEnvelope;
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
    expect(m.createFolder).not.toHaveBeenCalled();
  });

  test('rejects a path deeper than 10 levels (validation)', async () => {
    const path = Array.from({ length: 11 }, (_, i) => `Level${i}`);
    const res = await handleEnsureFolderPath({ folderType: 'fragment', path }) as PathEnvelope;
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });

  test('returns NOT_CONFIGURED when the server is not set up', async () => {
    configured = false;
    const res = await handleEnsureFolderPath({ folderType: 'fragment', path: ['X'] }) as PathEnvelope;
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('NOT_CONFIGURED');
  });
});
