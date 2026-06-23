import { buildError, isClientConfigured } from '../adobe/client.js';
import {
  createFolder, getFolder, updateFolder, deleteFolder, getSubfolders, validateFolder
} from '../adobe/unified-tags-client.js';
import {
  CreateFolderSchema, GetFolderSchema, UpdateFolderSchema,
  DeleteFolderSchema, ListSubfoldersSchema, ValidateFolderSchema, EnsureFolderPathSchema
} from '../validation/schemas.js';
import { notConfiguredError, validationError, withTelemetry, buildOutputSchema, DATA_OBJECT } from './utils.js';

// Shared note appended to every folder tool description. Folders are an Experience
// Platform-wide organization primitive, addressed by (folderType, folderId): the
// folderType selects which object family the folder holds. Surfaced on each tool so
// the model never omits folderType (the most common mistake — it's required on
// every folder call).
// The folder-type noun is an ONBOARDED enum (environment-specific), not free-form,
// and the AJO content nouns are asymmetric: fragments use "fragment" (NOT
// "content-fragment"), templates use "content-template". Both are confirmed against
// the live platform. There is no API to enumerate onboarded nouns, so we document
// the known content nouns and enrich the upstream "not onboarded" 422 with them.
const KNOWN_CONTENT_FOLDER_NOUNS = '"fragment" (for content fragments) and "content-template" (for content templates)';

const FOLDER_HINT =
  `Folders organize content into a navigable tree and are addressed by BOTH a folderType (an ONBOARDED ` +
  `object-family noun — NOT free-form) AND a folderId. folderType is REQUIRED on every folder call. ` +
  `For AJO content the onboarded nouns are ${KNOWN_CONTENT_FOLDER_NOUNS}; note the asymmetry — the fragment noun ` +
  `is "fragment", NOT "content-fragment". These are NOT "dataset"/"segment" (other Experience Platform families); ` +
  `any non-onboarded noun is rejected with a 422 "not onboarded". File content into a folder by passing the ` +
  `folder id as parentFolderId on create_content_fragment / create_content_template (or via patch_content_*). ` +
  `Requires the Unified Tags/Folders API to be enabled on the credential's Developer Console project (else 403).`;

const FOLDER_TYPE_PROP = { type: 'string' as const, description: 'The onboarded object-family noun the folder holds (NOT free-form). For AJO content: "fragment" (content fragments) or "content-template" (content templates) — note the fragment noun is "fragment", not "content-fragment". Unknown nouns return 422 "not onboarded". Required.' };
const FOLDER_ID_PROP = { type: 'string' as const, description: 'The folder ID (UUID). The virtual id "root" addresses the top-level folder of a folderType (e.g. for list_subfolders).' };

// Deleting a parent right after a child can 422 "Children for this folder already
// exist" because the child delete hasn't propagated yet (folder deletes are
// eventually consistent). This matches that specific upstream message.
const CHILDREN_EXIST_RE = /children for this folder already exist/i;

// Enrich opaque upstream folder errors with actionable guidance.
function folderError(err: unknown) {
  const e = buildError(err);
  if (/not onboarded/i.test(e.message)) {
    // A not-onboarded folderType ("Noun: [X] not onboarded to onto folders"). Name the
    // valid AJO content nouns, and call out the most common mistake explicitly.
    e.message += ` For AJO content, valid folderType nouns are ${KNOWN_CONTENT_FOLDER_NOUNS}.`;
    if (/content[-_]?fragment/i.test(e.message)) {
      e.message += ` Did you mean folderType "fragment"? (The content-fragment folder noun is just "fragment".)`;
    }
  }
  // If a children-exist 422 still surfaces after the internal retries below, the lag
  // didn't clear in time (or the folder really isn't empty) — tell the caller to retry.
  if (CHILDREN_EXIST_RE.test(e.message)) {
    e.message += ` If you just deleted a child folder, this is usually a propagation lag rather than a real ` +
      `blocker — wait a moment and retry the parent delete.`;
  }
  return e;
}

// Backoff schedule for the eventual-consistency retry on folder delete. The lag is
// typically sub-second, so one retry usually suffices; a genuinely non-empty folder
// still fails after exhausting these (a few seconds later).
const FOLDER_DELETE_RETRY_BACKOFFS_MS = [500, 1000, 2000];
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const isChildrenExistLag = (err: unknown): boolean => CHILDREN_EXIST_RE.test(buildError(err).message);

// ─── create_folder ─────────────────────────────────────────────────────────────

export const createFolderDefinition = {
  name: 'create_folder',
  title: 'Create Folder',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Create a folder to organize content. ${FOLDER_HINT}

Pass parentFolderId to nest the new folder under an existing one; omit it to create a top-level folder.

Example usage:
- Top-level fragment folder: { "folderType": "fragment", "name": "Campaign Assets" }
- Nested template folder: { "folderType": "content-template", "name": "Q3", "parentFolderId": "6a5e0927-1527-4abc-9993-376fd7067ca5" }

Returns: { success: true, data: { id, name, noun, parentFolderId, status, ... } }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['folderType', 'name'],
    properties: {
      folderType: FOLDER_TYPE_PROP,
      name: { type: 'string', description: 'The name of the folder to create.' },
      parentFolderId: { type: 'string', description: 'Optional parent folder ID to nest under. Omit for a top-level folder (sent as parentFolderId: null).' }
    }
  }
};

export async function handleCreateFolder(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('create_folder', async () => {
    const parsed = CreateFolderSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const { folderType, name, parentFolderId } = parsed.data;
      // The API expects parentFolderId (NOT parentId, despite the OpenAPI spec) and
      // the UI sends it explicitly as null for a top-level folder — mirror that.
      const data = await createFolder(folderType, { name, parentFolderId: parentFolderId ?? null });
      return { success: true, data };
    } catch (err) {
      return { success: false, error: folderError(err) };
    }
  });
}

// ─── get_folder ────────────────────────────────────────────────────────────────

export const getFolderDefinition = {
  name: 'get_folder',
  title: 'Get Folder',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Retrieve a single folder by folderType + folderId. ${FOLDER_HINT}

Example usage: { "folderType": "content-template", "folderId": "83f8287c-767b-4106-b271-257282fd170e" }

Returns: { success: true, data: { id, name, noun, status, createdAt, ... } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['folderType', 'folderId'],
    properties: { folderType: FOLDER_TYPE_PROP, folderId: FOLDER_ID_PROP }
  }
};

export async function handleGetFolder(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_folder', async () => {
    const parsed = GetFolderSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await getFolder(parsed.data.folderType, parsed.data.folderId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: folderError(err) };
    }
  });
}

// ─── update_folder ─────────────────────────────────────────────────────────────

export const updateFolderDefinition = {
  name: 'update_folder',
  title: 'Rename Folder',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Rename a folder. The Unified Folders API only supports changing a folder's name (it is the only patchable field), so this tool takes the new name and applies it. ${FOLDER_HINT}

Example usage: { "folderType": "content-template", "folderId": "83f8287c-...", "name": "Renamed Folder" }

Returns: { success: true, data: { id, name, ... } }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['folderType', 'folderId', 'name'],
    properties: {
      folderType: FOLDER_TYPE_PROP,
      folderId: FOLDER_ID_PROP,
      name: { type: 'string', description: 'The new folder name.' }
    }
  }
};

export async function handleUpdateFolder(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('update_folder', async () => {
    const parsed = UpdateFolderSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const { folderType, folderId, name } = parsed.data;
      // The API accepts a JSON-Patch array and supports only `replace /name`.
      const data = await updateFolder(folderType, folderId, [{ op: 'replace', path: '/name', value: name }]);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: folderError(err) };
    }
  });
}

// ─── delete_folder ─────────────────────────────────────────────────────────────

export const deleteFolderDefinition = {
  name: 'delete_folder',
  title: 'Delete Folder',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Delete a folder. ⚠ Irreversible — confirm with the user first. The folder must be empty/eligible for deletion (use validate_folder to check). ${FOLDER_HINT}

EVENTUAL CONSISTENCY: folder deletes are applied asynchronously. Deleting a parent immediately after deleting its child can return 422 "Children for this folder already exist" simply because the child deletion hasn't propagated yet — wait a moment and retry (the parent delete then succeeds). Delete children before parents.

⚠ STALE REFERENCES: deleting a folder does NOT clear the parentFolderId of assets (fragments/templates) that lived in it. Any such asset will then FAIL every subsequent patch (the server re-validates the now-missing folder on every write, even patches unrelated to folders). Before deleting a folder, either move its contents elsewhere or patch /parentFolderId off those assets. If you hit it after the fact, add { "op": "remove", "path": "/parentFolderId" } to the asset's patch.

Example usage: { "folderType": "content-template", "folderId": "83f8287c-..." }

Returns: { success: true, data: { message: "delete request accepted successfully" } }`,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['folderType', 'folderId'],
    properties: { folderType: FOLDER_TYPE_PROP, folderId: FOLDER_ID_PROP }
  }
};

export async function handleDeleteFolder(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('delete_folder', async () => {
    const parsed = DeleteFolderSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    // Folder deletes are eventually consistent: deleting a parent right after its
    // children can 422 "Children for this folder already exist" purely because the
    // child deletes haven't propagated. The lag is typically sub-second, so retry
    // that specific error with short backoff to absorb it — a leaf→root teardown
    // then works in one pass. Any other error fails immediately (no retry).
    let lastErr: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        const data = await deleteFolder(parsed.data.folderType, parsed.data.folderId);
        // Coerce an empty/non-object body (an empty-body 200 surfaces as "") to {} so the
        // result matches the object-typed outputSchema — see handleDeleteTag.
        return { success: true, data: data && typeof data === 'object' ? data : {} };
      } catch (err) {
        lastErr = err;
        if (attempt < FOLDER_DELETE_RETRY_BACKOFFS_MS.length && isChildrenExistLag(err)) {
          await sleep(FOLDER_DELETE_RETRY_BACKOFFS_MS[attempt]);
          continue;
        }
        return { success: false, error: folderError(lastErr) };
      }
    }
  });
}

// ─── list_subfolders ─────────────────────────────────────────────────────────

export const listSubfoldersDefinition = {
  name: 'list_subfolders',
  title: 'List Subfolders',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Retrieve the subfolders (children) of a folder, so you can walk the folder tree. ${FOLDER_HINT}

Example usage: { "folderType": "content-template", "folderId": "c626b4f7-223b-4486-8900-00c266e31dd1" }

Returns: { success: true, data: { id, name, folders: [ { id, name, parentFolderId }, ... ] } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['folderType', 'folderId'],
    properties: { folderType: FOLDER_TYPE_PROP, folderId: FOLDER_ID_PROP }
  }
};

export async function handleListSubfolders(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('list_subfolders', async () => {
    const parsed = ListSubfoldersSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await getSubfolders(parsed.data.folderType, parsed.data.folderId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: folderError(err) };
    }
  });
}

// ─── validate_folder ─────────────────────────────────────────────────────────

export const validateFolderDefinition = {
  name: 'validate_folder',
  title: 'Validate Folder',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Validate whether a folder is eligible to have objects placed in it (e.g. before filing content into it). Read-only — performs no change. ${FOLDER_HINT}

Example usage: { "folderType": "content-template", "folderId": "83f8287c-..." }

Returns: { success: true, data: { id, name, status, ... } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['folderType', 'folderId'],
    properties: { folderType: FOLDER_TYPE_PROP, folderId: FOLDER_ID_PROP }
  }
};

export async function handleValidateFolder(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('validate_folder', async () => {
    const parsed = ValidateFolderSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await validateFolder(parsed.data.folderType, parsed.data.folderId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: folderError(err) };
    }
  });
}

// ─── ensure_folder_path ──────────────────────────────────────────────────────

export const ensureFolderPathDefinition = {
  name: 'ensure_folder_path',
  title: 'Ensure Folder Path',
  outputSchema: buildOutputSchema({
    leafFolderId: { type: 'string', description: 'The id of the deepest (leaf) folder in the path.' },
    path: { type: 'array', items: { type: 'object' }, description: 'Each level: { name, id, created }. created: true = new folder; false = existing folder reused.' }
  }),
  description: `Idempotently create a multi-level folder path, returning the leaf folder id. ${FOLDER_HINT}

Creates only the levels that do not already exist; existing folders at any level are detected and reused without error. Use this instead of calling create_folder level-by-level: it removes the create→duplicate-error→list-subfolders→retry loop that plain folder creation requires for nested paths.

Example usage:
- Create or find /NV/BIS/Wishlist for fragment folders:
  { "folderType": "fragment", "path": ["NV", "BIS", "Wishlist"] }
- Single top-level folder: { "folderType": "content-template", "path": ["Campaign Assets"] }

Returns: { success: true, leafFolderId: "<uuid>", path: [{ name, id, created }] }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['folderType', 'path'],
    properties: {
      folderType: FOLDER_TYPE_PROP,
      path: {
        type: 'array' as const,
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        description: 'Ordered list of folder names from root to leaf (e.g. ["NV", "BIS", "Wishlist"]). Each level is created if missing, or reused by name if it already exists.'
      }
    }
  }
};

const DUPLICATE_FOLDER_RE = /duplicate folder name/i;

// Find a direct child of the given parent by name. Returns the child's id, or null
// if not found. parentId null means the root level of the folder tree.
//
// The unified-folders subfolders endpoint returns the children under a `folders`
// array (NOT `children`); reading the wrong key made every duplicate-reuse lookup
// come up empty and abort with a self-contradictory FOLDER_NOT_FOUND. We read
// `folders` and also tolerate `children`/`items` defensively. Names are matched
// trimmed + case-insensitively so a folder the server flagged as a duplicate (its
// duplicate check is case-insensitive) is always re-findable here.
async function findChildByName(folderType: string, parentId: string | null, name: string): Promise<string | null> {
  const folderId = parentId ?? 'root';
  const data = await getSubfolders(folderType, folderId) as {
    folders?: Array<{ id: string; name: string }>;
    children?: Array<{ id: string; name: string }>;
    items?: Array<{ id: string; name: string }>;
  };
  const list = data.folders ?? data.children ?? data.items ?? [];
  const target = name.trim().toLowerCase();
  const child = list.find(c => typeof c?.name === 'string' && c.name.trim().toLowerCase() === target);
  return child?.id ?? null;
}

export async function handleEnsureFolderPath(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('ensure_folder_path', async () => {
    const parsed = EnsureFolderPathSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    const { folderType, path } = parsed.data;

    const levels: Array<{ name: string; id: string; created: boolean }> = [];
    let parentId: string | null = null;

    for (const name of path) {
      try {
        const data = await createFolder(folderType, { name, parentFolderId: parentId }) as { id: string };
        parentId = data.id;
        levels.push({ name, id: data.id, created: true });
      } catch (err) {
        const e = buildError(err);
        if (!DUPLICATE_FOLDER_RE.test(e.message)) {
          return { success: false, error: folderError(err) };
        }
        // Folder already exists — find it by name among the parent's children.
        try {
          const existingId = await findChildByName(folderType, parentId, name);
          if (!existingId) {
            return {
              success: false,
              error: {
                code: 'FOLDER_NOT_FOUND',
                message: `Folder "${name}" was reported as a duplicate but could not be found under ` +
                  `${parentId ? `folder ${parentId}` : 'root'}. Try list_subfolders to inspect the tree.`
              }
            };
          }
          parentId = existingId;
          levels.push({ name, id: existingId, created: false });
        } catch (innerErr) {
          return { success: false, error: folderError(innerErr) };
        }
      }
    }

    return { success: true, leafFolderId: parentId!, path: levels };
  });
}
