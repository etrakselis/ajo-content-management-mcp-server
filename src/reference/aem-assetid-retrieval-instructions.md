# Retrieving AJO Media-Library Embed Attributes for an AEM Asset

This guide describes the exact steps for an LLM (connected through an AEM MCP
server exposing `read-api` and `lookup-api-spec`) to retrieve the three Adobe
Journey Optimizer (AJO) embed attributes for a specific image.

When an image is embedded into AJO via the asset picker, the resulting `<img>`
snippet carries three identifying attributes, for example:

```html
<img class="" width="750" height="auto" style="height: auto; width: 100%;"
  data-medialibrary-id="urn:aaid:aem:da3c9280-bd1a-46a7-9632-6dd93b505416"
  data-mediarepo-id="author-p69352-e612752.adobeaemcloud.com"
  data-medialibrary-source="aem">
```

**Input the user provides:** the image name and the folder it lives in.
**Output the LLM must produce:** `data-medialibrary-id`, `data-mediarepo-id`,
and `data-medialibrary-source` for that image.

---

## What each attribute is and where it comes from

| Attribute | Value | Source |
|---|---|---|
| `data-medialibrary-id` | `urn:aaid:aem:<jcr:uuid>` | The asset's JCR UUID, prefixed with `urn:aaid:aem:` |
| `data-mediarepo-id` | `author-pXXXXX-eXXXXXX.adobeaemcloud.com` | The AEM **author host** (the environment URL with the scheme stripped) |
| `data-medialibrary-source` | `aem` | Constant for any AEM-sourced asset |

Only the first one requires a repository lookup. The second is derived from the
environment URL you are already calling. The third is always the literal `aem`.

---

## Important caveat: do not rely on the search index

The DAM search endpoint
(`/adobe/experimental/aemmcpserver-expires-20991231/search-assets`) may return
**zero results even when assets exist** (empty/stale index, common in
sandboxes). A wildcard search returning nothing does **not** mean the folder or
asset is absent. **Always use the direct Sling Assets reads below** — they are
the source of truth.

---

## Step-by-step procedure

### Step 1 — Determine the environment (gives `data-mediarepo-id`)

Identify the target environment's author URL. If you do not already have it,
list available environments and pick the desired one's `authorUrl`, e.g.
`https://author-p69352-e612752.adobeaemcloud.com`.

Derive the attribute by stripping the scheme:

```
data-mediarepo-id = authorUrl without "https://"
                  = "author-p69352-e612752.adobeaemcloud.com"
```

Use this same `authorUrl` as the `aemUrl` for all reads below.

### Step 2 — Confirm the folder exists

List the DAM root and find the folder by exact name (names are case-sensitive
and may carry prefixes like `nd_`).

```js
// read-api
const r = await aem.get('/api/assets.json');
return { status: r.status, body: r.body };
```

In the Siren response, look in `entities[]` for objects with
`class: ["assets/folder"]` and match `properties.name`. If the folder is
nested, drill in by requesting the parent folder's `.json` until you find it.

> Sling Assets API paths are relative to `/content/dam`. The folder
> `/content/dam/nd_unitary_triggers` is addressed as
> `/api/assets/nd_unitary_triggers`.

### Step 3 — Confirm the image exists in the folder

List the folder contents and find the image by exact name.

```js
// read-api — for folder /content/dam/nd_unitary_triggers
const r = await aem.get('/api/assets/nd_unitary_triggers.json');
return { status: r.status, body: r.body };
```

In the response, `entities[]` with `class: ["assets/asset"]` are the images;
match `properties.name` (e.g. `000001.png`). Check
`properties["srn:paging"].total` — the default page size is 20, so if the
folder has more assets, follow the `next` link or append `?offset=20&limit=20`
(increasing the offset) until you find the image. URL-encode names with spaces.

### Step 4 — Read the UUID (gives `data-medialibrary-id`)

The Sling Assets API JSON view does **not** expose `jcr:uuid`. Read the asset
node directly from the JCR using the full DAM path with a depth-1 selector
(`.1.json`):

```js
// read-api — DAM path (not /api/assets) + the .1.json depth selector
const r = await aem.get('/content/dam/nd_unitary_triggers/000001.png.1.json');
return { uuid: r.body['jcr:uuid'] };
```

Then construct the attribute:

```
data-medialibrary-id = "urn:aaid:aem:" + jcr:uuid
                     = "urn:aaid:aem:da3c9280-bd1a-46a7-9632-6dd93b505416"
```

> Why `.1.json`? `.json` (depth 0) may omit `jcr:uuid`, and
> `jcr:content.json` returns only processing/rendition info. The `.1.json`
> selector returns the asset node itself — including `jcr:uuid` and
> `jcr:mixinTypes` (`mix:referenceable`) — plus its `jcr:content` child, in a
> single call.

### Step 5 — Assemble the three attributes

```
data-medialibrary-id   = urn:aaid:aem:<jcr:uuid>     (from Step 4)
data-mediarepo-id      = <author host>               (from Step 1)
data-medialibrary-source = aem                        (constant)
```

---

## Worked example

Input: image `000001.png` in folder `nd_unitary_triggers`,
environment `https://author-p69352-e612752.adobeaemcloud.com`.

1. `data-mediarepo-id` = `author-p69352-e612752.adobeaemcloud.com` (from the URL).
2. `GET /api/assets.json` → `nd_unitary_triggers` present as a folder.
3. `GET /api/assets/nd_unitary_triggers.json` → `000001.png` present (image/png).
4. `GET /content/dam/nd_unitary_triggers/000001.png.1.json` →
   `jcr:uuid` = `da3c9280-bd1a-46a7-9632-6dd93b505416`.
5. Result:
   - `data-medialibrary-id` = `urn:aaid:aem:da3c9280-bd1a-46a7-9632-6dd93b505416`
   - `data-mediarepo-id` = `author-p69352-e612752.adobeaemcloud.com`
   - `data-medialibrary-source` = `aem`

Final embed:

```html
<img data-medialibrary-id="urn:aaid:aem:da3c9280-bd1a-46a7-9632-6dd93b505416"
     data-mediarepo-id="author-p69352-e612752.adobeaemcloud.com"
     data-medialibrary-source="aem">
```

---

## Quick reference

| Goal | Call | Read |
|---|---|---|
| `data-mediarepo-id` | (none) | author URL minus `https://` |
| Confirm folder | `GET /api/assets.json` | `entities[]` class `assets/folder`, `properties.name` |
| Confirm image | `GET /api/assets/<folder>.json` | `entities[]` class `assets/asset`, `properties.name` |
| Page a large folder | append `?offset=N&limit=20` or follow `next` | `properties["srn:paging"]` |
| UUID for `data-medialibrary-id` | `GET /content/dam/<folder>/<image>.1.json` | `jcr:uuid` → prefix `urn:aaid:aem:` |
| `data-medialibrary-source` | (none) | constant `aem` |

## Notes and gotchas

- Use the **author tier** URL for both the reads and `data-mediarepo-id`.
- The `data-mediarepo-id` is the bare host — no scheme, no trailing slash, no path.
- Sling Assets API paths are relative to `/content/dam`; JCR reads use the full
  `/content/dam/...` path. Don't mix them up.
- Folder and image names are case-sensitive; preserve exact prefixes; URL-encode spaces.
- `data-medialibrary-source` is always `aem` for assets sourced from AEM.
- The UUID is stable across renames/moves, so the resulting
  `data-medialibrary-id` remains valid even if the asset's path changes.
- If `search-assets` returns nothing, treat it as inconclusive and use the
  direct Sling reads above.