# AJO Content MCP Server

A production-grade **Model Context Protocol (MCP) server** that exposes Adobe Journey Optimizer Content Management APIs to LLM-powered clients. AI agents can create, retrieve, update, delete,   content templates and create, retrieve, update, archive and publish content fragments directly through natural language.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Example Prompts](#example-prompts)
4. [Prerequisites](#prerequisites)
5. [Run](#run)
6. [MCP Server Configuration](#mcp-server-configuration)
7. [GitHub Integration (optional)](#github-integration-optional)
8. [Client Connection Guide](#client-connection-guide)
9. [Available Tools — Detailed](#available-tools--detailed)
10. [MCP Resources](#mcp-resources)
11. [MCP Prompts](#mcp-prompts)
12. [Observability](#observability)
13. [Security](#security)
14. [Development](#development)
15. [Troubleshooting](#troubleshooting)
16. [Architecture](#architecture)
17. [License](#license)

---

## Overview

This MCP server bridges LLM clients (Claude, Cursor, Codex) with the Adobe Journey Optimizer Content Management REST API. It exposes 38 tools covering the full template and fragment lifecycle, folder and tag organization (the Unified Tags/Folders API), read-only Experience Platform Schema Registry (XDM) lookups, a server-context lookup, and read-only AJO authoring references (the Visual Email Designer HTML spec and the personalization syntax library), handles Adobe IMS authentication with token caching, and ships with enterprise-grade observability, security, and reliability features.

The Schema Registry tools let the LLM discover the **real personalization attribute paths** configured in a sandbox — most customers define custom field groups under their tenant namespace rather than using only default XDM fields — so generated content references attributes that actually exist instead of guessing `{{_yourtenant.profile.person.firstName}}`. Complementing them, the **authoring reference** tools teach the LLM the exact output formats AJO expects: `get_visual_designer_requirements` returns the native HTML serialization spec so generated email stays editable in the drag-and-drop designer, and `get_personalization_syntax` returns AJO's native personalization expression language (helper functions, conditionals, loops, dataset lookup) so expressions use real AJO constructs rather than generic Handlebars/Liquid.

---

## Features

### Content Templates
| Tool | Description |
|------|-------------|
| `list_content_templates` | Paginated listing with filtering and sorting |
| `create_content_template` | Create email, push, SMS, in-app, code, direct mail, and landing page templates |
| `get_content_template` | Fetch a single template by ID (returns etag for updates) |
| `update_content_template` | Full replacement (PUT) with optimistic locking |
| `patch_content_template` | Partial update via JSON Patch (RFC 6902) |
| `delete_content_template` | Permanent deletion |

### Content Fragments
| Tool | Description |
|------|-------------|
| `list_content_fragments` | Paginated listing with status and type filtering |
| `create_content_fragment` | Create HTML or expression fragments |
| `get_content_fragment` | Fetch a fragment by ID (returns etag) |
| `update_content_fragment` | Full replacement (PUT) |
| `patch_content_fragment` | Partial update via JSON Patch |
| `publish_content_fragment` | Publish/freeze fragment (async) |
| `get_live_fragment` | Get content from last successful publication |
| `get_fragment_publication_status` | Poll publication progress |
| `archive_content_fragment` | Archive a fragment (fragments cannot be deleted via the API) |

### Folders (organization)
Organize content into a navigable tree (Unified Folders API). A folder is addressed by both a `folderType` (the object family it holds) and a `folderId`; file content into one via `parentFolderId` on the create/patch content tools. Requires the Unified Tags/Folders API on the credential's Developer Console project.
| Tool | Description |
|------|-------------|
| `create_folder` | Create a top-level or nested folder *(write)* |
| `get_folder` | Fetch a single folder by folderType + folderId |
| `update_folder` | Rename a folder (only the name is patchable) *(write)* |
| `delete_folder` | Delete a folder — irreversible *(write, destructive)* |
| `list_subfolders` | List a folder's children to walk the tree |
| `validate_folder` | Check whether a folder is eligible to hold objects |

### Tags & tag categories (organization)
Classify content for discovery (Unified Tags API). A tag belongs to exactly one category (`Uncategorized` if unspecified). Requires the Unified Tags/Folders API on the credential's Developer Console project. **Tag categories are read-only here** — creating/updating/deleting them requires system/product administrator privileges the typical MCP principal lacks, so those operations are intentionally not exposed; create tags in `Uncategorized` (omit `tagCategoryId`) for the non-admin path.
| Tool | Description |
|------|-------------|
| `list_tag_categories` | List tag categories (sort/filter) |
| `get_tag_category` | Fetch a tag category by ID |
| `list_tags` | List/filter tags (e.g. by `tagCategoryId`) |
| `create_tag` | Create a tag, optionally in a category *(write)* |
| `get_tag` | Fetch a tag by ID |
| `update_tag` | Rename, archive/unarchive, or move a tag *(write)* |
| `delete_tag` | Delete a tag — irreversible *(write, destructive)* |
| `validate_tags` | Validate a set of tag IDs (valid/invalid split) |

### Schema Registry (XDM) — read-only
For discovering real personalization attribute paths. Requires the AEP Schema Registry API on the credential's Developer Console project.
| Tool | Description |
|------|-------------|
| `list_xdm_schemas` | List XDM schemas (tenant or global container) |
| `get_xdm_schema` | Retrieve a schema, fully resolved by default (all field groups inlined) |
| `list_xdm_field_groups` | List field groups — where custom attributes are defined |
| `get_xdm_field_group` | Retrieve a field group, fully resolved by default |
| `list_xdm_union_schemas` | List union schemas (merged per-class view, e.g. the full Profile) |
| `get_xdm_union_schema` | Retrieve a union schema — the complete attribute set for personalization |

### Authoring References — read-only
Reference content the LLM fetches to produce output in the exact format AJO expects. Delivered as tools (not just resources) so they work in clients that can't read MCP resources directly (e.g. Claude Desktop).
| Tool | Description |
|------|-------------|
| `get_visual_designer_requirements` | The complete native-HTML serialization spec for the AJO Visual Email Designer (rules, structure/component catalog, required `<head>`). Call before authoring email HTML so it stays in drag-and-drop mode. |
| `get_personalization_syntax` | The AJO-native personalization syntax library (expression language, helper functions, operators, contextual-data iteration, dataset lookup). Served one category at a time. Call before writing `{{ }}` / `{%= %}` expressions. |

### Server Context — read-only
| Tool | Description |
|------|-------------|
| `get_server_context` | Reports who/what the server is acting as (author, sandbox, tenant, org, write-access) plus the full grouped tool catalog. |

### GitHub Integration — optional
When a GitHub repository is configured (see [GitHub Integration](#github-integration-optional)), two additional tools are exposed.
| Tool | Description |
|------|-------------|
| `check_pr_status` | Check whether a GitHub pull request is open, merged, or closed, and get its merge commit SHA. |
| `deploy_merged_changes` | Read the payload from a merged PR and re-execute the AJO write operations it describes, applying approved changes to AJO. |

---

## Example Prompts

Once your LLM client is connected to this MCP server, you can talk to it in plain language. Below are ready-to-use prompts organised by what you're trying to do — copy them directly or use them as inspiration.

---

### 🧭 Orientation — start here

Before doing any real work, confirm *what* you're connected to and *what you can do*. These are the prompts to run first.

**Which server / tenant / sandbox am I on, and who am I acting as?**
> "Call get_server_context and tell me who this server is acting on behalf of, which sandbox and tenant it's on, and whether write access is enabled."

> "Before we start, confirm the Adobe Journey Optimizer environment: author email, tenant namespace, and sandbox name."

> "List one content template and tell me the org, tenant, sandbox, and author it came from." *(Every tool result is prefixed with `[tenant: … | sandbox: … | author: …]` — plus `org: …` if an org name was supplied during setup — so this is the most reliable way to see the exact target. The `get_server_context` tool returns the same details on demand, without performing any content operation.)*

**What can I do right now (read-only vs read-write)?**
> "Are you currently allowed to create or modify content through the ajo-content server, or is it read-only?"

> "Try to tell me whether write access is enabled. If it isn't, what do I need to do to turn it on?" *(If writes are off, write attempts return a `READ_ONLY_MODE` error pointing you to `http://localhost:3000`.)*

**What tools are available?**
> "Call get_server_context and list every tool this server exposes, grouped by domain." *(`get_server_context` returns the full tool catalog, so this works even if some tools didn't surface in an initial search.)*

> "What AJO content tools do you have access to? Group them into read vs. write operations."

> "Summarize what each ajo-content tool does, so I know what I can ask for."

---

### 🔍 Browsing & Discovery

**List everything**
> "Show me all the content templates in this sandbox."

> "List all content fragments, sorted by most recently modified."

> "How many content templates do we have? Give me a summary grouped by channel."

**Search and filter**
> "Find all email templates whose name starts with 'Cyber Monday'."

> "Show me all push notification templates created in the last 30 days."

> "List all content fragments that are currently in DRAFT status."

> "Find all fragments of type 'expression' on the shared channel."

> "Are there any templates that came from AEM? List them."

**Inspect a specific item**
> "Get the full details of template ID b6d70a45-a149-453b-85ba-809a5d40066d."

> "Show me the HTML content inside the 'Welcome Email' template."

> "Fetch fragment b6d70a45-a149-453b-85ba-809a5d40066d and tell me what channel it targets and what its current status is."

---

### 🧬 Personalization — use real attribute paths

These use the Schema Registry (XDM) tools to find the attributes that actually exist in your sandbox, so content references real paths instead of generic guesses. (Requires the AEP Schema Registry API on your Developer Console project.)

> "What custom field groups are defined in this sandbox? List them."

> "Show me the full Profile union schema and list the personalization attributes available, with their paths."

> "Find the loyalty-related attributes in our XDM schemas and tell me the exact paths I'd use for personalization."

> "Create a welcome email fragment, but first look up our actual profile attributes and use the real first-name and loyalty-tier paths instead of the default XDM ones."

> "Before personalizing this template, check our tenant field groups and map each placeholder I want (first name, city, points balance) to its real attribute path."

> "Show me the AJO personalization syntax for a loyalty-points expiry countdown with a fallback — use get_personalization_syntax, don't improvise Handlebars."

> "Build a conditional block that greets Gold-tier members differently from everyone else, using real AJO operator and if/else syntax."

---

### ✏️ Creating Content

**Templates**
> "Create an HTML email template called 'Summer Sale Header' with this HTML: `<div>Hi {{profile.person.name}}, our summer sale is live!</div>`"

> "Create a push notification template called 'Flash Sale Alert' with the title 'Limited time offer 🔥' and message 'Tap to see deals ending in 2 hours.'"

> "Create an SMS template called 'Order Shipped' with the text 'Hi {{profile.person.name}}, your order {{order.id}} has shipped and will arrive by {{order.estimatedDelivery}}.'"

> "Create a new in-app message template called 'Loyalty Milestone' with an HTML body that congratulates the user on reaching Gold status."

> "Create a direct mail template called 'Holiday Catalog 2025' with a fileName of 'holiday-catalog' and include fields for first name, last name, and postal address."

> "Create a code-based template called 'Hero Banner JSON' on the code channel with subType JSON."

**Fragments**
> "Create an HTML fragment called 'Global Footer' with this content: `<footer>© 2025 Acme Corp | <a href='/unsubscribe'>Unsubscribe</a></footer>`. It should target the email channel."

> "Create an expression fragment called 'Personalised Greeting' with the expression `Hello {{profile.person.firstName}}, welcome back!` on the shared channel."

> "Create a new draft HTML fragment called 'Promo Banner' for the email channel. The content should be a red banner div with the text 'Up to 50% off selected items'."

---

### 🔄 Updating Content

**Rename or re-describe**
> "Rename template b6d70a45-... to 'Black Friday Email — v2'."

> "Update the description of fragment b6d70a45-... to 'Used in all promotional campaigns Q4 2025'."

> "Move template b6d70a45-... into folder a49dbe03-..."

**Edit content**
> "Update the 'Welcome Email' template. Keep everything the same but change the HTML to include a new hero image tag: `<img src='https://cdn.acme.com/hero.jpg' />`."

> "The 'Order Shipped' SMS template needs updating. Change the text to also include a tracking URL: `Track here: {{order.trackingUrl}}`."

> "I need to update fragment b6d70a45-... — fetch it first, then replace its HTML content with `<div class='banner'>New Year Sale — 40% off everything!</div>`."

---

### 🚀 Publishing Fragments

> "Publish fragment b6d70a45-... so it's ready to use in campaigns."

> "Publish the 'Global Footer' fragment and then check whether the publication succeeded."

> "What is the publication status of fragment b6d70a45-...? Is it live yet?"

> "Publish fragment b6d70a45-... and keep checking the status every few seconds until it's complete, then confirm it's live."

> "Show me the live published content of fragment b6d70a45-... — what HTML is actually being served to campaigns right now?"

---

### 🗑️ Deleting & Archiving Content

> "Delete template b6d70a45-a149-453b-85ba-809a5d40066d."

> "I need to clean up. List all templates with 'test' or 'draft' in the name, then delete them."

> "Delete all email templates that haven't been modified since January 2024." *(The LLM will list first and confirm before deleting.)*

> "Archive fragment b6d70a45-... — I no longer need it in the active library."

> "Archive all fragments that are still in DRAFT status and haven't been modified since January 2024."

---

### 🔁 Multi-Step Workflows

These prompts ask the LLM to chain multiple tools together autonomously.

> "Create a complete email template called 'Abandoned Cart' with a subject of 'You left something behind…' and HTML body reminding the user of their cart items using `{{cart.items}}`. Then show me the ID so I can reference it."

> "I want to set up a reusable unsubscribe footer fragment. Create an HTML fragment called 'Unsubscribe Footer' for the email channel, publish it, and confirm it's live."

> "Clone the template at ID b6d70a45-... — fetch its full content, create a new template with the same content but named 'Copy of [original name]', and return the new ID."

> "Audit our fragment library: list all fragments, identify which ones are still in DRAFT status, and give me a summary of how many are PUBLISHED vs DRAFT vs PUBLISHING."

> "We're doing a Q4 cleanup. List all templates that have 'summer' in the name and delete each one. Walk me through what you're deleting before you do it."

> "Create three SMS templates for an onboarding sequence: 'Onboarding Day 1', 'Onboarding Day 3', and 'Onboarding Day 7'. Each should have personalised text referencing `{{profile.person.firstName}}` and a relevant message for that day of onboarding."

---

### 💡 Tips for Best Results

**Be specific about IDs when you have them.** If you know the template or fragment ID, include it — the LLM won't need to search first.

> ✅ "Get template b6d70a45-a149-453b-85ba-809a5d40066d"
> vs.
> ⚠️ "Get my welcome email template" *(requires a search step)*

**Mention the channel when creating.** The API requires exactly one channel per template or fragment.

> ✅ "Create an email template called…"
> ✅ "Create a push notification template called…"

**For updates, you don't need to fetch the etag yourself.** Just ask the LLM to update something — it will automatically fetch the current version and etag before making the change.

> ✅ "Update the description of template b6d70a45-... to 'New description'"

**Publishing is async.** After asking to publish a fragment, the LLM can poll `get_fragment_publication_status` for you — just ask it to confirm when publication is complete.

> ✅ "Publish fragment b6d70a45-... and tell me when it's done."

**Pagination is handled automatically.** If you ask to list all templates, the LLM can page through results on your behalf.

> ✅ "List all templates in this sandbox, even if there are more than 20."

---

## Prerequisites

Two things before you start:

1. **Adobe API credentials**, packaged as an environment file — this is what you upload in [Configuration](#configuration) Step 2, so set it up first.
2. **Docker Desktop**, to build and run the server. Dependencies are installed and the code is compiled inside the container, so you don't need Node.js installed on your machine.

The steps are the same whether you're on **macOS** or **Windows**.

### 1. Adobe API credentials (the environment file)

This step produces the environment file that [Configuration](#configuration) Step 2 expects. You set up the credentials in two places — the **Adobe Developer Console** (the API project) and **Adobe Journey Optimizer** (the matching user role) — and you do it **twice**, once for the non-production environments and once for an all-environments (including prod) set.

> **You need admin access to both** the Adobe Developer Console and the AJO platform to complete this step. If you don't have it, ask your Adobe org administrator to either grant it or perform these steps for you.

#### a. Create the API project (Adobe Developer Console)

In the [Adobe Developer Console](https://developer.adobe.com/console), create a new API project. Give it a **name** and **description** that clearly communicate (1) that the project is for **non-production** environments and (2) its **scope** — reading, creating, updating, and deleting AJO content templates, fragments, tags, and folders. The name and description are reference-only, so make them descriptive enough that anyone can tell what the project is for at a glance.

<a href="readme_images/create_api_project_step1.png"><img src="readme_images/create_api_project_step1.png" alt="Create the API project: name and description communicate non-prod environment and content-management scope" width="500"></a>

#### b. Add the two API services

Use **Add to Project → API** to add **two** services to the project: **Experience Platform API** and **Adobe Journey Optimizer**. Both should appear under **Products & services** when you're done.

<a href="readme_images/create_api_project_step2.png"><img src="readme_images/create_api_project_step2.png" alt="Add the Experience Platform API and Adobe Journey Optimizer services to the project" width="500"></a>

#### c. Name the credential to match the project

When you add the Adobe Journey Optimizer service, choose **OAuth Server-to-Server** authentication and set the **Credential name** to **match the name of the API project** (e.g. `NonProd AJO Content Management`). Keeping the names aligned makes the credential easy to find later under **Users → API Credentials**.

<a href="readme_images/create_api_project_step3.png"><img src="readme_images/create_api_project_step3.png" alt="Set the OAuth Server-to-Server credential name to match the API project name" width="500"></a>

#### d. Assign the product profile

When prompted to assign a product profile, select the default **AEP-Default-All-Users** profile.

<a href="readme_images/create_api_project_step4.png"><img src="readme_images/create_api_project_step4.png" alt="Select the AEP-Default-All-Users product profile" width="320"></a>

#### e. Download the environment file

From the project's overview page in the Developer Console, click the **Download** button at the top. This gives you the **Postman environment** JSON file — exactly what you upload in [Configuration](#configuration) Step 2 (its expected shape is documented there).

<a href="readme_images/create_api_project_step5.png"><img src="readme_images/create_api_project_step5.png" alt="Download the project's environment file from the Download button at the top of the project overview" width="500"></a>

> You only need this **single, project-wide** environment file — there's no need to download the Postman collection from each individual API service. Every service you added shares the project's one **OAuth Server-to-Server** credential, so the same environment file covers all of them.

Give the downloaded file a **meaningful name** so you can tell it apart from the other project's file later — e.g. label this one for the non-prod environments.

#### f. Create a second, all-environments project

Repeat steps **a–e** to create a **second** API project that is identical to the first, except that its **name and description** indicate it is intended for **all environments, including production**. The result is two projects: one scoped to the lower (non-prod) environments, and one that covers those same lower environments **and** production. Name its downloaded environment file accordingly (e.g. non-prod + prod) so the two files stay distinguishable.

#### g. Create the matching AJO user role

In **Adobe Journey Optimizer → Permissions**, create a user **role** that mirrors the API project. As with the project, start by giving the role a **name** and **description** that indicate which environments it's scoped for and which API capabilities it grants — keep them aligned with the matching API project's name and description.

<a href="readme_images/create_api_ajo_role_step1.png"><img src="readme_images/create_api_ajo_role_step1.png" alt="Create an AJO role with a name and description that match the API project" width="500"></a>

Then **edit the role** to assign the appropriate **sandbox environment(s)** and the AJO permissions the server needs — for example, *Journey Optimizer Library* (Manage Library Items, Publish Fragments, Simulate Content), *Data Modeling* (View Schemas), and *Sandbox Administration* (View Sandboxes).

<a href="readme_images/create_api_ajo_role_step2.png"><img src="readme_images/create_api_ajo_role_step2.png" alt="Edit the role to assign sandboxes and Journey Optimizer permissions" width="500"></a>

Finally, on the role's **API credentials** tab, assign the API credential you created in steps b–c (the one whose name matches the project).

<a href="readme_images/create_api_ajo_role_step3.png"><img src="readme_images/create_api_ajo_role_step3.png" alt="Assign the API credential to the role on the API credentials tab" width="500"></a>

> Create a matching role for **each** of the two API projects (non-prod and all-environments).

### 2. Docker Desktop
- **Download:** [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
  - macOS: pick the **Apple Silicon** build for M1/M2/M3+ Macs, or the **Intel chip** build for older Macs.
  - Windows: download **Docker Desktop for Windows** (requires Windows 10/11 64-bit; WSL 2 is enabled by the installer).
- **After installing, launch Docker Desktop and wait until the whale icon shows "Docker Desktop is running."** The commands below will fail if the Docker engine isn't started.
- **Verify** in a terminal (macOS) or PowerShell (Windows):
  ```bash
  docker --version
  ```

> **Only contributing to the code?** To run the test suite or type-check outside Docker (see [Development](#development)), you'll also need [Node.js 18+ (LTS)](https://nodejs.org/en/download). It is **not** required just to build and run the server.

---

## Run

You don't need to clone the repo or build anything — a **pre-built, multi-architecture image** (Apple Silicon and Intel/AMD) is published to the GitHub Container Registry. You only need the `docker-compose.yml` file and Docker Desktop running.

**1. Get `docker-compose.yml`.** Either download it from this repo, or create a file with that name containing:

```yaml
services:
  ajo-content-mcp:
    image: ghcr.io/etrakselis/ajo-content-mcp:latest
    container_name: ajo-content-mcp
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOST=0.0.0.0
      - LOG_LEVEL=info
      - AUDIT_LOG_PATH=/audit/audit-log.jsonl
    volumes:
      - ./audit:/audit
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
```

**2. Start it** from the folder that holds the file:

```bash
docker compose up -d
```

The first run **pulls** the image automatically (no `--build`); `-d` runs it detached so your terminal stays free. Docker picks the right build for your CPU architecture.

The setup UI is now available at **http://localhost:3000** — continue to [Configuration](#configuration).

> **Can't reach the page?** The server listens on the loopback interface only (it isn't exposed to your network by design). On systems where `localhost` resolves to IPv6 first, the browser normally falls back to IPv4 automatically — but if you hit a connection-refused error, use **http://127.0.0.1:3000** instead, or set `HOST=::1` in `docker-compose.yml` to bind the IPv6 loopback.

Common follow-up commands:

```bash
docker compose logs -f     # watch the server logs (Ctrl+C to stop watching)
docker compose pull        # fetch the latest published image
docker compose down        # stop and remove the container
docker compose up -d       # start it again later
```

> **Want to pin a version?** Replace `:latest` with a specific tag (e.g. `:1.0.0`) for reproducible deployments.

> **Building from source instead?** Contributors can build the image locally rather than pulling it — see [Development](#development).

> **Sharing with someone who won't touch the repo?** The [`distribution/`](distribution/) folder is a self-contained bundle — an abridged `QUICKSTART.md` plus a ready-to-run `docker-compose.yml`. Zip it and hand it off; they only need Docker Desktop and their Adobe credentials file. See [Packaging the distribution bundle](#packaging-the-distribution-bundle).

---

## MCP Server Configuration

> The setup steps appear **one at a time** — only Step 1 is shown when the page loads, and each subsequent step is revealed automatically once you complete the one before it.

### 1. Open the UI

Navigate to `http://localhost:3000` in your browser.

### 2. Upload environment file

Drag and drop your credentials file — see [Prerequisites → 1. Adobe API credentials](#1-adobe-api-credentials-the-environment-file) for how to obtain it.

> Credentials are stored in memory only. They are never written to disk, logged, or returned through tools.

As soon as the file is loaded, the server validates the credentials, auto-detects your **tenant namespace** — displayed in a banner directly below this step so you can confirm the right tenant before continuing — and discovers the sandboxes the credentials can access, which populates the dropdown in the next step.

### 3. Select sandbox

The sandbox dropdown is **populated automatically** from the sandboxes your uploaded credentials can access, so in most cases you just pick the one you want from the menu — no typing required. A selection is always required and nothing is pre-selected, even when only one sandbox is available.

If automatic discovery isn't possible — for example, the Sandbox Management API isn't enabled on your Developer Console project, or the credentials don't have permission to list sandboxes — the UI falls back to a **manual entry** field where you can type the sandbox name yourself. You can switch between the dropdown and manual entry at any time using the links beneath the field.

You can find the sandbox name from the URL of your AJO instance — look for the parameter called `sname:`. Traditionally the sandboxes are named like `dev`, `staging`, or `prod`, but the exact name needs to be verified since they aren't enforced and can vary slightly between orgs.

### 4. Set the access mode

Use the **Allow write operations** toggle to choose what connected LLM clients can do:

- **Off — read-only (default).** Only *list* and *get* operations run. Write tools (create, update, delete, publish, archive) are rejected at execution with a `READ_ONLY_MODE` error.
- **On — read & write.** Write tools execute normally.

Read-only is the safe default — leave it off unless you explicitly want clients to modify content.

The full tool set is **always advertised** to clients regardless of this setting, and enforcement happens when a tool is *called*. This is deliberate: many clients (e.g. Claude Desktop) cache the tool list when they connect and don't react to a mid-session tool-list change, so hiding write tools would strand them in read-only even after you turned writes on. Instead, the server tells the LLM that writes are runtime-gated, so it attempts the operation when asked and surfaces the `READ_ONLY_MODE` error if it's currently off. Because of this, flipping the toggle **takes effect immediately with no client restart** — once you switch to On, the next write attempt simply succeeds.

#### Write confirmation

When write access is on, the server adds a second safety layer: before performing a write it asks you to confirm the target, naming the org, tenant namespace, and sandbox (and the author it's acting as). This uses the MCP [elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation) capability, so the confirmation is enforced by the server rather than left to the LLM to remember to ask.

- **Destructive writes** (`delete_content_template`, `archive_content_fragment`, `delete_folder`, `delete_tag`) are confirmed **every time** — there is no undo.
- **Other writes** (create, update, patch, publish) are confirmed **once per sandbox per session**, then remembered for the rest of that session.
- **Decline or dismiss** the prompt and the operation is **not performed** — the tool returns a `WRITE_CANCELLED` error and the LLM is instructed not to retry unless you ask again.
- Clients that **don't support elicitation** fall back to a **confirm-and-retry gate**: the first write is held with a `WRITE_CONFIRMATION_REQUIRED` error that instructs the LLM to confirm the target with you conversationally, then re-invoke the same tool with `confirmWrite: true`. The same destructive-vs-other cadence applies (destructive ops require the confirmation every time; other writes once per sandbox per session). The access-mode toggle is still enforced independently — this gate is about confirming the *target*, not granting write permission.
  - `confirmWrite` is declared as an **optional boolean** on every write tool's input schema. It has to be advertised this way because strict clients (e.g. Claude Desktop) validate arguments against the schema and silently drop any property that isn't declared — so a flag the LLM tacked on without it being in the schema would never reach the server, and the gate could never be cleared. Leave it unset on the first call (that's what triggers the hold); the server strips it from the arguments before they reach the underlying AJO API.

##### Client support for elicitation

Elicitation is a newer part of the MCP spec ([2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation), with URL mode added in 2025-11-25) and client support is still uneven. A client must advertise the `elicitation` capability during the initialize handshake for the interactive prompt to appear; otherwise the server uses the confirm-and-retry fallback above. As of **2026-06-15**:

| Client | Elicitation prompt | Behavior here |
| --- | --- | --- |
| **Claude Code** (≥ 2.1.76, Mar 2026) | ✅ Supported | Interactive confirmation dialog |
| **Cursor** | ✅ Supported | Interactive confirmation dialog |
| **VS Code** (MCP) | ✅ Supported | Interactive confirmation dialog |
| **Claude Desktop** | ❌ Not yet | Confirm-and-retry gate |

> This is a moving target — support is expanding, so a client listed as unsupported today may gain the interactive prompt in a future release with no change needed here (the server already advertises and uses elicitation whenever the client offers it). Re-check your client's release notes if you expect the dialog and don't see it.

### 5. Enter your email and click "Start MCP Server"

The launch step requires **your email address**. It's mandatory and is recorded with every content change made while the server runs, so create/update/delete/publish/archive actions can be attributed to a person (see [Audit log](#audit-log)). It is **not verified** — it's an honor-system field, so enter your real address.

Once you provide it, click Start. The server authenticates once, caches the token, and begins accepting MCP connections. The connection summary then shows the active **access mode** — your tenant namespace and selected sandbox are already shown above (in the tenant banner and Step 2), so they aren't repeated here.

### Audit log

Every content write is appended to an audit trail as one JSON object per line (JSONL), tagged with the email you entered at launch plus the sandbox, tenant namespace, tool, resource ID/name, and timestamp. Records are also mirrored to the server logs (`docker logs ajo-content-mcp`).

```json
{"timestamp":"2026-06-15T06:12:14.161Z","action":"create_content_fragment","authorEmail":"alice@example.com","resourceType":"fragment","resourceId":"b6d70a45-…","resourceName":"Promo Banner","sandbox":"my-sandbox","tenantNamespace":"_mytenant","success":true}
```

The file path is set by the `AUDIT_LOG_PATH` environment variable. `docker-compose.yml` defaults it to `/audit/audit-log.jsonl` and bind-mounts the host's `./audit/` directory there, so the log persists across restarts and lands in your working tree — ready to commit to a **private** repo. (The author email is unverified and self-declared; keep the repo private since the log contains email addresses.)

The author identity is also surfaced to the connected LLM through three channels, in increasing order of reliability:

- **Server `instructions`** sent at connection time (*"You are acting on behalf of &lt;email&gt;…"*). Advisory — some clients don't pass this to the model, so don't depend on it alone.
- **Every tool result** is prefixed with `[… | author: <email>]`, so the identity is visible whenever any tool runs.
- **The `get_server_context` tool**, which returns the author, sandbox, tenant, and write-access state on demand. This is the dependable way to ask the LLM "who is this running on behalf of?" — tools are always visible to the model, unlike the instructions.

These reflect the email entered at the most recent setup; reconnect the client after reconfiguring with a different email.

---

## GitHub Integration (optional)

The server can mirror every AJO content change to a GitHub repository as a structured JSON commit, giving you a full version history of your content assets outside of AJO. You can also use it as a **human-approval gate**: instead of writing to AJO directly, the LLM opens a pull request that a human reviews and merges, then a follow-up tool call applies the approved changes.

The integration is entirely opt-in — the server works normally without it, and you can enable or disable it at any time from the setup UI.

### Two operating modes

| Mode | How it works |
|------|--------------|
| **Audit Trail** | After every successful AJO write, the server asynchronously commits a JSON record of the args and result to the repository. The AJO write is never blocked — if the GitHub commit fails, the write has already succeeded and the server surfaces a warning to the LLM. |
| **PR Approval Gate** | Instead of writing to AJO, the LLM opens a branch and a pull request with the proposed content. Once a human merges it, call `deploy_merged_changes` with the PR URL to apply the changes to AJO. |

### Setting up the GitHub PAT

The integration uses a **GitHub fine-grained Personal Access Token (PAT)**, not a classic token. Fine-grained PATs let you scope permissions to a single repository.

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Under **Repository access**, select **Only select repositories** and choose your target repo.
3. Under **Repository permissions**, grant:
   - **Contents: Read and write** — required to commit files and read file content.
   - **Pull requests: Read and write** — required for PR Approval Gate mode (creating and reading PRs).
4. Copy the generated token — it is shown only once.

> **Keep the PAT private.** It is stored in server memory only and is never written to disk, logged, or returned through any MCP tool.

### Repository requirements

- **Empty repositories are handled automatically.** If you point the integration at a brand-new repo with no commits, clicking "Test Connection" will push an initial `README.md` commit via the git HTTPS protocol (using your PAT for auth), so GitHub's git storage is initialized and subsequent REST API commits work normally. The success message will note that the repo was initialized.
- The integration works with **public or private** repositories, as long as the PAT has the permissions above.

### Configuring the integration

In the setup UI at `http://localhost:3000`, a **GitHub Integration** card appears after the server has started (Step 5). Fill in:

- **Personal Access Token** — the fine-grained PAT from the step above.
- **Owner** — the GitHub username or organization that owns the repository (e.g. `acmecorp`).
- **Repository** — the repository name (e.g. `ajo-content`).
- **Mode** — choose **Audit Trail** or **PR Approval Gate**.

Click **Test Connection** to verify the PAT has write access and the repository has at least one commit. Once the test passes, click **Enable GitHub Integration** to activate it.

The integration settings are stored in memory for the lifetime of the server — restart the container and you'll need to re-enter them. This is intentional; secrets are never written to disk.

### File structure in the repository

Each AJO write produces one JSON file whose path mirrors the sandbox and folder structure you've set up in AJO:

```
{sandbox-name}/
  content-templates/
    {ajo-folder-path}/
      {asset-name}.json
  content-fragments/
    {ajo-folder-path}/
      {asset-name}.json
  tags/
    {tag-name}.json
```

The `{ajo-folder-path}` is resolved by walking the AJO folder hierarchy (e.g. a template in the `BIS › Wishlist` folder under `NV` produces `content-templates/NV/BIS/Wishlist/`). If an asset has no parent folder, it's placed directly under the asset-type directory. The filename is the asset's name (not its UUID), so the repo is human-readable without any ID lookups.

Every file contains a `_meta` block with the operation name, timestamp, author email, sandbox, and tenant namespace, followed by the tool arguments used to produce the asset. Delete/archive operations write a **tombstone record** — the file stays in the repo (preserving history) but its content is replaced with a record showing what was removed and when.

**Example commit for `create_content_fragment`** (fragment named `NV_BIS_Wishlist_Hero` in folder `NV › BIS › Wishlist`):
```json
{
  "_meta": {
    "operation": "create_content_fragment",
    "ajoId": "b6d70a45-a149-453b-85ba-809a5d40066d",
    "updatedAt": "2026-06-22T14:32:00.000Z",
    "updatedBy": "alice@example.com",
    "sandbox": "my-sandbox",
    "tenant": "_mytenant"
  },
  "name": "NV_BIS_Wishlist_Hero",
  "type": "html",
  "channels": ["email"],
  "fragment": { "content": "<footer>© 2026 Acme Corp</footer>" }
}
```

This file lands at `my-sandbox/content-fragments/NV/BIS/Wishlist/NV_BIS_Wishlist_Hero.json`.

### PR Approval Gate workflow

1. **LLM proposes a change** — instead of calling `create_content_fragment` directly, the LLM opens a PR with the proposed JSON payload. It returns the PR number and URL.
2. **Human reviews and merges** — the PR shows exactly what will be sent to AJO. Merge it on GitHub when you're happy with the content.
3. **Deploy the merged change** — ask the LLM: *"Deploy the changes from [PR URL]."* It calls `deploy_merged_changes`, which reads the merged payload, strips `_meta`, and calls the original tool to write to AJO. The write goes through the normal audit trail and confirmation gate.
4. **Check status** — at any point you can ask: *"What is the status of [PR URL]?"* The `check_pr_status` tool returns whether the PR is open, merged, or closed.

### Example prompts for GitHub integration

> "What's the status of the PR at [PR URL]?"

> "Deploy the approved changes from [PR URL] to AJO."

> "Create a content fragment for our new promo banner, but open a PR for review instead of writing directly."

> "Is the GitHub integration enabled? What repo is it pointing to?"

---

## Client Connection Guide

> **Prerequisite:** finish [Build & Run](#build--run) and [Configuration](#configuration) first. There is **one** long-lived container (started by `docker compose up -d`) that you configure once at `http://localhost:3000`. Every client below connects to that same running server at `http://localhost:3000/mcp` — no client starts its own container, so the configuration you entered is shared by all of them and survives client restarts.

### Claude Code (HTTP)
Run this from your terminal — it registers the server in the right place automatically (no file editing needed):
```bash
claude mcp add --transport http et-ajo-content-mgmt http://localhost:3000/mcp
```

### Claude Desktop (via `mcp-remote` bridge)
Claude Desktop's config only speaks STDIO, so it can't point at an HTTP URL directly. The
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge connects it to the already-running
container — **do not** have Claude Desktop launch its own container, or it would collide with the
one from `docker compose up` (port 3000) and start unconfigured.

**Install Node.js first.** `npx` is not a standalone tool — it ships with npm, which ships with
[Node.js](https://nodejs.org/en/download). Without Node installed, Claude Desktop's `npx` command
fails with `spawn npx ENOENT`. This is the one client that needs Node locally; everything else
talks to the container directly over HTTP. After installing, verify with:
```bash
npx --version
```
You do **not** need to install `mcp-remote` separately — `npx -y mcp-remote` downloads and caches it
on first run (needs network access the first time).

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows), then restart Claude Desktop:
```json
{
  "mcpServers": {
    "et-ajo-content-mgmt": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

> **If Claude Desktop still reports `npx` not found after installing Node:** Claude Desktop launches
> `npx` using the GUI app's `PATH`, which on macOS is often **not** the same as your terminal's
> `PATH` (common with `nvm`- or Homebrew-managed installs). Fix it either by installing Node via the
> official `.pkg` (macOS) / `.msi` (Windows) installer, which puts it in a standard system location,
> or by using the absolute path in the config — find it with `which npx` (macOS) / `where npx`
> (Windows) and set e.g. `"command": "/usr/local/bin/npx"`.

The container from [Build & Run](#build--run) must already be running and configured. Because that
container is long-lived, your credentials persist across Claude Desktop restarts — you only
configure once at `http://localhost:3000`.

### Cursor
Add via **Settings → MCP Servers → Add Server**, or edit `~/.cursor/mcp.json` (global) or
`.cursor/mcp.json` (project root) directly:
```json
{
  "mcpServers": {
    "et-ajo-content-mgmt": {
      "url": "http://localhost:3000/mcp",
      "type": "http"
    }
  }
}
```

### Codex CLI
`codex mcp add` only supports stdio servers, so add the streamable HTTP endpoint
to `~/.codex/config.toml`:
```toml
[mcp_servers.et-ajo-content-mgmt]
url = "http://localhost:3000/mcp"
```

### Codex Desktop
The Codex IDE extension / desktop app reads the same config file as the CLI.
Add the block above to `~/.codex/config.toml`, then restart Codex.

### Generic HTTP Client
```
MCP Endpoint: http://localhost:3000/mcp
Protocol: Streamable HTTP (MCP 2024-11-05)
```

---

## Available Tools — Detailed

All tools, with typical arguments. Full input schemas live in `src/tools/`. **Read** tools are always available; **write** tools (marked) run only when write access is enabled (see [Access mode](#configuration)). The two GitHub integration tools (`check_pr_status`, `deploy_merged_changes`) are only present when the GitHub integration is enabled.

### Content templates

#### `list_content_templates` *(read)*
```json
{ "limit": 20, "orderBy": "-modifiedAt", "property": ["channels==email", "name~^Welcome"] }
```
All fields optional. Pass `_page.next` from the response as `start` to fetch the next page.

#### `create_content_template` *(write)*
```json
{
  "name": "Welcome Email",
  "templateType": "html",
  "channels": ["email"],
  "template": {
    "html": "<html>Hello {{profile.person.name}}</html>"
  }
}
```
`templateType`: `html` | `html_primary_page` | `html_sub_page` | `content`. `channels`: exactly one of `email`, `push`, `inapp`, `sms`, `code`, `directMail`, `landingpage`, `shared`.

**Organization:** pass `tagIds` (array of tag UUIDs) to tag the new template — these go in the create body directly. Pass `parentFolderId` to file it into a `content-template` folder — the AJO create body rejects `parentFolderId`, so the server applies it via an automatic follow-up `add` PATCH after create; if only that step fails the create still succeeds and a `warnings` entry explains how to retry. `labels` (OLAC access-control strings) are also accepted. On `update_content_template`, `parentFolderId` is ignored (placement is preserved); use `patch_content_template` to move.

#### `get_content_template` *(read)*
```json
{ "templateId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Returns the template and its etag (needed for updates/patches).

#### `update_content_template` *(write)*
Full replacement (PUT). Always fetch first to get the etag:
```json
{
  "templateId": "b6d70a45-...",
  "etag": "\"v2\"",
  "name": "Updated Welcome Email",
  "templateType": "html",
  "channels": ["email"],
  "template": { "html": "<html>Updated content</html>" }
}
```

#### `patch_content_template` *(write)*
Metadata-only changes via JSON Patch. Supported paths: `/name`, `/description`, `/parentFolderId`, `/tagIds`, `/labels`. Use op `add` for `/parentFolderId`, `/tagIds`, `/labels` (members that may not exist yet — the server auto-normalizes `replace`→`add` for these; `/tagIds`/`/labels` set the whole array). For content/type/channel changes use `update_content_template`.
```json
{
  "templateId": "b6d70a45-...",
  "etag": "\"v2\"",
  "patches": [
    { "op": "replace", "path": "/name", "value": "New Name" }
  ]
}
```

#### `delete_content_template` *(write)*
```json
{ "templateId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Permanent deletion.

### Content fragments

#### `list_content_fragments` *(read)*
```json
{ "limit": 20, "orderBy": "-modifiedAt", "property": ["status==PUBLISHED"] }
```
All fields optional. Paginate with `start` = `_page.next`.

#### `create_content_fragment` *(write)*
```json
{
  "name": "Global Footer",
  "type": "html",
  "channels": ["email"],
  "fragment": { "content": "<footer>© 2026 Acme Corp</footer>" }
}
```
For an expression fragment: `"type": "expression"`, `"channels": ["shared"]`, `"fragment": { "expression": "Hello {{profile.person.firstName}}" }`.

**Organization:** pass `tagIds` (array of tag UUIDs) to tag the new fragment — these go in the create body directly. Pass `parentFolderId` to file it into a `fragment` folder — the AJO create body rejects `parentFolderId`, so the server applies it via an automatic follow-up `add` PATCH after create; if only that step fails the create still succeeds and a `warnings` entry explains how to retry. `labels` (OLAC access-control strings) are also accepted. On `update_content_fragment`, `parentFolderId` is ignored (placement is preserved); use `patch_content_fragment` to move.

#### `get_content_fragment` *(read)*
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Returns the fragment and its etag.

#### `update_content_fragment` *(write)*
Full replacement (PUT). Fetch first for the etag:
```json
{
  "fragmentId": "b6d70a45-...",
  "etag": "\"v3\"",
  "name": "Global Footer",
  "type": "html",
  "channels": ["email"],
  "fragment": { "content": "<footer>Updated footer</footer>" }
}
```

#### `patch_content_fragment` *(write)*
Metadata-only changes via JSON Patch. Supported paths: `/name`, `/description`, `/parentFolderId`, `/tagIds`, `/labels`. Use op `add` for `/parentFolderId`, `/tagIds`, `/labels` (members that may not exist yet — the server auto-normalizes `replace`→`add` for these; `/tagIds`/`/labels` set the whole array). For content changes use `update_content_fragment`.
```json
{
  "fragmentId": "b6d70a45-...",
  "etag": "\"v3\"",
  "patches": [
    { "op": "replace", "path": "/name", "value": "New Name" }
  ]
}
```

#### `publish_content_fragment` *(write)*
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Publication is async. Poll `get_fragment_publication_status` until `status === "complete"`.

#### `get_live_fragment` *(read)*
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Returns the content from the fragment's last successful publication — what campaigns and journeys actually serve right now.

#### `get_fragment_publication_status` *(read)*
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Reports the status of the most recent publication request (poll until `status === "complete"`).

#### `archive_content_fragment` *(write)*
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Fragments cannot be deleted via the AJO Content REST API — archiving is the equivalent. An archived
fragment is removed from the active library and can no longer be referenced in new campaigns or
journeys.

> **Note:** This tool calls an internal AJO GraphQL API (`exc-unifiedcontent.experience.adobe.net`)
> that is not part of the public Content REST API. Adobe may change this endpoint without notice.

### Folders (Unified Folders API)

Organize content into a navigable tree. Every folder call requires **both** a `folderType` (an **onboarded object-family noun**, not free-form) and a `folderId`. **For AJO content the nouns are asymmetric — `fragment` for content fragments and `content-template` for content templates** (note: the fragment noun is `fragment`, *not* `content-fragment`). They are *not* `dataset`/`segment` (other Experience Platform families the same API serves); any non-onboarded noun is rejected with `422` "not onboarded" (the server appends the known content nouns to that error). There is no API to enumerate onboarded nouns. The virtual id `root` addresses the top of a folderType's tree (e.g. for `list_subfolders`). File content into a folder by passing the folder id as `parentFolderId` on `create_content_fragment` / `create_content_template` (or via the patch tools). **Requires the Unified Tags/Folders API enabled on the credential's Developer Console project** (otherwise `FORBIDDEN` / 403). Override the gateway with `AJO_UNIFIED_TAGS_BASE_URL` if needed.

#### `create_folder` *(write)*
```json
{ "folderType": "fragment", "name": "Q3 Campaign", "parentFolderId": "6a5e0927-1527-4abc-9993-376fd7067ca5" }
```
Use `"folderType": "content-template"` for template folders. Omit `parentFolderId` for a top-level folder (it is sent as `parentFolderId: null`). Note the field is `parentFolderId` — the OpenAPI spec's `parentId` is incorrect.

#### `get_folder` *(read)* · `list_subfolders` *(read)* · `validate_folder` *(read)*
```json
{ "folderType": "content-template", "folderId": "83f8287c-767b-4106-b271-257282fd170e" }
```
`get_folder` returns one folder; `list_subfolders` returns its children (walk the tree — use `"folderId": "root"` for the top level); `validate_folder` checks whether the folder is eligible to hold objects.

#### `update_folder` *(write)*
```json
{ "folderType": "content-template", "folderId": "83f8287c-...", "name": "Renamed Folder" }
```
The API only supports replacing the folder name; the tool builds the JSON-Patch op for you.

#### `delete_folder` *(write, destructive)*
```json
{ "folderType": "content-template", "folderId": "83f8287c-..." }
```
Irreversible — confirmed every time.

### Tags & tag categories (Unified Tags API)

Classify content for discovery. A **tag** belongs to exactly one **tag category** (`Uncategorized` if none is given at create time). The `property` argument on the list tools is a filter attribute (e.g. `tagCategoryId=<id>`, `name`, `archived`) — **not** the FIQL grammar used by the content list tools. **Requires the Unified Tags/Folders API enabled on the credential's Developer Console project.**

> **Tag categories are read-only here.** Creating/updating/deleting a tag *category* requires system/product administrator privileges in AJO, which the typical MCP principal does not have — so those operations are intentionally **not exposed** (they would only ever return 403). Use the read tools to discover categories, and create tags in `Uncategorized` for the non-admin path. To bind a tag to content, see `patch_content_fragment` / `patch_content_template` (`/tagIds`).

#### `list_tag_categories` *(read)* · `get_tag_category` *(read)* · `list_tags` *(read)* · `get_tag` *(read)*
```json
{ "property": "tagCategoryId=e2b7c656-067b-4413-a366-adde0401df50", "sortBy": "name", "sortOrder": "asc" }
```

#### `create_tag` *(write)*
```json
{ "name": "summer-sale" }
```
Omit `tagCategoryId` to file the tag under `Uncategorized` (the path that does not require admin rights). Passing a custom `tagCategoryId` requires admin privileges and otherwise returns 403.

#### `update_tag` *(write)*
```json
{ "tagId": "8af14b1e-...", "name": "summer-sale-2026", "archived": false }
```
Provide at least one field to change. The tool sends a **bare JSON-Patch array** of replace ops — `[ { "op": "replace", "path": "archived", "value": "true" } ]` (paths `name` / `archived` / `tagCategoryId`, no leading slash; `value` is always a string, so `archived` is coerced to `"true"`/`"false"`) — and the `experience.adobe.io` gateway wraps it into the backend's `{ patchRequestList: [...] }` envelope itself. (Sending it pre-wrapped causes a double-wrap that the backend rejects.) All supplied fields go in one PATCH. Renaming and archiving need no special rights; **moving a tag into a custom category requires admin privileges** (otherwise 403). To hide a tag without deleting it, set `archived: true`.

#### `validate_tags` *(read)*
```json
{ "ids": ["2bd5ddd9-7284-4767-81d9-c75b122f2a6a", "invalid-tag"] }
```
Returns the valid/invalid split — useful before applying tag references to content.

#### `delete_tag` *(write, destructive)*
```json
{ "tagId": "8af14b1e-..." }
```
Irreversible — confirmed every time. **AJO enforces two preconditions:** the tag must not be applied to any content (otherwise `403 "Associated Tag Count is not Zero"` — clear it from the `/tagIds` of every referencing fragment/template first) and it must be archived (otherwise `409 "Tag is not archived"` — `update_tag` with `archived: true` first). Full teardown order: clear associations → archive → delete. The server surfaces these as resource-specific hints (no stray template/fragment etag guidance).

### Schema Registry / XDM

All read-only. These query the AEP Schema Registry to discover the **actual** personalization attribute paths in the sandbox. Use them before inserting personalization fields so content references attributes that really exist. **Requires the AEP Schema Registry API enabled on the credential's Developer Console project** (otherwise they return `FORBIDDEN` / 403).

> Typical flow: `list_xdm_field_groups` (find the customer's custom groups) → `get_xdm_field_group` (read its attribute paths), or `get_xdm_union_schema` for the complete merged Profile view. Custom attributes are nested under the tenant namespace key (e.g. `_yourtenant`) in the schema's `properties` — that nesting is the personalization path.

#### `list_xdm_schemas` *(read)*
```json
{ "container": "tenant", "property": "title~Profile" }
```
`container` defaults to `tenant` (customer-defined); use `global` for standard XDM. Returns concise summaries (title, `$id`, `meta:altId`, version).

#### `get_xdm_schema` *(read)*
```json
{ "schemaId": "https://ns.adobe.com/_yourtenant/schemas/abc123", "full": true }
```
`full` defaults to `true` (fully resolved — all field groups inlined, complete property tree). Pass the `$id` or `meta:altId` from `list_xdm_schemas`.

#### `list_xdm_field_groups` *(read)*
```json
{ "container": "tenant" }
```
Lists field groups; custom ones (tenant container) are where non-default personalization attributes live.

#### `get_xdm_field_group` *(read)*
```json
{ "fieldGroupId": "https://ns.adobe.com/_yourtenant/mixins/abc123", "full": true }
```

#### `list_xdm_union_schemas` *(read)*
```json
{}
```
Lists union schemas (tenant). A union merges all field groups of a class into one schema — e.g. the full Profile.

#### `get_xdm_union_schema` *(read)*
```json
{ "unionId": "https://ns.adobe.com/xdm/context/profile__union", "full": true }
```
The resolved Profile union is the complete attribute set available for personalization.

### Server context

#### `get_server_context` *(read)*
```json
{}
```
Returns who/what the server is operating as — `authorEmail` (self-declared at setup, unverified), `sandbox`, `tenantNamespace`, `orgName`, and `writeAccess`. Use it to answer "who is this running on behalf of?" or "which sandbox am I on?" without performing a content operation.

It also returns `tools` — the full catalog of every tool this server exposes, grouped by domain (`[{ group, tools: [{ name, title }] }]`). This is the reliable way for a client to discover all capabilities by exact name in a single call, which matters when the client defers tools and a fuzzy tool search ranks one below its result cutoff. The same catalog is also rendered into the server `instructions` at connection time, so the two channels cover each other (instructions need no tool call but are dropped by some clients; this tool result is high-salience but requires the call).

### GitHub integration tools

These tools are only exposed when the [GitHub Integration](#github-integration-optional) is enabled. They are read-only from the perspective of AJO — they interact with GitHub, not with AJO's Content API.

#### `check_pr_status` *(read)*
```json
{ "prUrl": "https://github.com/owner/repo/pull/42" }
```
Returns the PR's number, state (`open` | `closed`), whether it has been merged, its title, and the merge commit SHA (if merged). Use this before calling `deploy_merged_changes` to confirm the PR is ready.

#### `deploy_merged_changes` *(write)*
```json
{ "prUrl": "https://github.com/owner/repo/pull/42" }
```
Reads the JSON payloads from a merged pull request (created by the PR Approval Gate mode) and re-executes the AJO write operations they describe. Each file in the PR that has a valid `_meta.operation` produces one write call. Requires the PR to be merged — the call fails with a clear error if the PR is still open or was closed without merging.

The `_meta` block is stripped before the args are passed to the AJO tool, so only the original content payload reaches the API. Each operation goes through the normal write-confirmation gate (and is logged to the audit trail if it succeeds).

### Authoring references

Read-only reference content, delivered as tools so the model can fetch it on its own even in clients that can't read MCP resources directly (e.g. Claude Desktop). The `create_*` / `update_*` tools' descriptions point the model here before it authors HTML or personalization.

#### `get_visual_designer_requirements` *(read)*
```json
{}
```
Returns the complete AJO Visual Email Designer HTML authoring spec (non-negotiable rules, the fixed nesting chain, the full structure and component catalogs, the verbatim required `<head>`, a known-good minimal template, and a pre-output checklist). Call it before constructing email HTML (`templateType` `html`, or `content` `html.body`, channel `email`) or HTML fragments — generic email HTML imports in Compatibility mode and loses drag-and-drop editing.

#### `get_personalization_syntax` *(read)*
```json
{}
```
With **no argument**, returns the index: a syntax primer plus the menu of categories. Pass a `category` to fetch one full section (the library is large, so it's served one category at a time):
```json
{ "category": "dates" }
```
Categories: `core`, `helpers`, `operators`, `strings`, `dates`, `arrays`, `aggregation`, `arithmetic`, `objects`, `maps`, `context-iteration`, `dataset-lookup` (or `all` for the entire library). Covers AJO-native personalization **syntax** — expression language, helper functions, conditionals, loops, dataset lookup. This is syntax only; get the real attribute **paths** from the Schema Registry tools or the `discover-personalization-paths` prompt, and never guess paths or emit JavaScript/Liquid/Jinja.

---

## MCP Resources

Alongside its tools, the server exposes MCP **resources** — addressable, readable context a client can fetch directly (and, in clients with a resource picker, attach via `@`-mention) without invoking a tool. All resources use the `ajo://` URI scheme.

> **Claude Desktop note:** attaching these resources to the chat via the **+** menu currently **fails in Claude Desktop** ("failed to attach resource"). This is a limitation in how Claude Desktop handles local servers bridged through `mcp-remote` — it affects *every* such server (including Adobe's own AJO MCP server), and is **not** a sign that this server is broken. It does **not** affect functionality: all tools work normally, and the same reference content is reachable by the model through tools — `get_visual_designer_requirements` for the Visual Email Designer spec, and `get_server_context` for the full catalog of tools *and* resources (each listed with how to obtain it). See [Troubleshooting](#claude-desktop-failed-to-attach-resource-in-the-chat-ui).

### Static resources

These are always listed (via `resources/list`) and have fixed URIs.

| URI | Description |
|-----|-------------|
| `ajo://server/status` | Live configuration and authentication status (JSON): server name/version, whether it's configured, auth state, write access, and tool count. |
| `ajo://sandbox/channel-reference` | Canonical reference (text) mapping AJO channels to valid `templateType` values, required template/fragment content shapes, and `subType` options. Read before constructing create/update payloads. |
| `ajo://error-codes` | Reference (text) of every error code the server can return, with cause and recovery action for each. |

### Browsable collections

Name→id **directories**, so a human or client can locate an object by name and then drill into it — solving the discovery problem that bare UUIDs can't (nobody knows a fragment's UUID by heart). Each entry includes a `resource` link to the per-object resource below.

| URI | Description |
|-----|-------------|
| `ajo://fragments` | Directory of content fragments (`{ count, truncated, next?, items: [{ id, name, type, status, channels, modifiedAt, resource }] }`). Follows the API's pagination cursor to include every fragment, bounded by a safety cap (up to 5,000); if the cap is hit, `truncated` is `true` and `next` carries a resume cursor. |
| `ajo://templates` | Directory of content templates, same shape (with `templateType` in place of `type`/`status`). |

### Templated resources (by UUID)

Listed via `resources/templates/list`. The `{id}` variable is the object's UUID; resolving the URI returns the live object plus its current etag — so the etag needed for a follow-up update/patch comes back with the read, no extra fetch.

| URI template | Description |
|--------------|-------------|
| `ajo://fragment/{id}` | A single content fragment by UUID, as JSON (`{ data, etag }`). |
| `ajo://template/{id}` | A single content template by UUID, as JSON (`{ data, etag }`). |

> **Argument completion:** for the `{id}` of the templated resources, the server provides live autocompletion (via the MCP completions capability) backed by the current fragment/template list, so clients that support it can suggest real IDs as you type.

A typical browse-then-read flow: read `ajo://fragments` to find the fragment named "Global Footer" and its id → read `ajo://fragment/<that-id>` for the full object and etag. The `get_content_fragment` / `get_content_template` tools remain the model-driven equivalent of the per-object read.

---

## MCP Prompts

Beyond the free-form [Example Prompts](#example-prompts) above (which you type yourself), the server also publishes **MCP prompts** — named, parameterized workflows the client surfaces as ready-to-run commands (e.g. Claude Desktop's slash-command / prompt picker). Selecting one injects a fully-formed, multi-step instruction set into the conversation, so the model executes a known-good procedure instead of improvising. Each prompt also **embeds the relevant reference resource** inline (the channel reference or error-code reference), so the model has it on hand while running the workflow rather than having to fetch it.

| Prompt | Argument(s) | What it does |
|--------|-------------|--------------|
| `create-content` | `channel` *(required)* — email, push, sms, inapp, code, directMail, landingpage, or shared; `content_kind` *(optional)* — `template` (default) or `fragment`; `name` *(optional)*; `use_case` *(optional)* | Walks the full creation workflow: confirms the correct `templateType`/`type` and content shape for the channel, reads the Visual Email Designer requirements for email, looks up real XDM personalization paths and the AJO syntax when the content is personalized, confirms the complete payload with you, then calls `create_content_template` / `create_content_fragment`. Embeds the channel reference (plus the visual-designer requirements for email). |
| `discover-personalization-paths` | `use_case` *(optional)* — what you want to personalize, e.g. "greet by first name" | Walks the XDM lookup sequence (`list_xdm_field_groups` → `get_xdm_field_group`, or the Profile union) to find the **real** attribute paths in this sandbox, so personalization expressions reference attributes that actually exist instead of guessed defaults, then points to `get_personalization_syntax` for the expression syntax. Embeds the channel reference. |
| `publish-fragment` | `fragment_id` *(required)* — UUID of the fragment | Runs the full async publish-and-verify workflow: check current state → trigger publication → poll `get_fragment_publication_status` until `complete` or `error`. Embeds the error-code reference for recovery. |
| `audit-content-library` | `content_type` *(optional)* — `templates`, `fragments`, or `both` (default `both`) | Surveys the sandbox: pages through all content, groups by type/channel/status, and flags action items (stale templates, drafts never published, fragments with failed/in-progress publications). Embeds the channel reference. |

> **Argument completion:** the server provides autocompletion for prompt arguments (via the MCP completions capability) — `content_type` offers the static `templates`/`fragments`/`both` choices, and `publish-fragment`'s `fragment_id` is backed by a live lookup of fragments in the sandbox, so clients that support it suggest real IDs as you type.

These map to the workflow guidance the server's `instructions` point the model at — use `create-content` for the guided create workflow, `discover-personalization-paths` before inserting any `{{ }}` expression, `publish-fragment` for the full publication cycle, and `audit-content-library` to take stock of a sandbox.

---

## Observability

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness check — always 200 when running |
| `GET /ready` | Readiness — 200 only after credentials configured |
| `GET /metrics` | Prometheus metrics (tool calls, errors, latency, auth refreshes) |

### Prometheus Metrics
- `mcp_tool_calls_total{tool, status}` — total tool invocations
- `mcp_tool_call_duration_seconds{tool}` — latency histogram
- `mcp_auth_refresh_total` — IMS token refresh count
- `mcp_adobe_api_errors_total{endpoint, status_code}` — API errors

---

## Security

- Credentials stored in memory only, never logged or returned via tools
- GitHub PAT stored in memory only — never written to disk, logged, or returned through any MCP tool
- Rate limiting: 200 req/min global, 5 req/min on `/api/configure`
- Helmet security headers
- Input validation via Zod on all tool inputs
- Non-root Docker user (`mcpuser`)
- Read-only container filesystem

---

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run with coverage
npm test -- --coverage

# Type-check only
npm run typecheck

# Run locally (no Docker)
npm run dev
```

### Build the Docker image from source

End users pull the pre-built image (see [Run](#run)), but contributors can build it locally from the `Dockerfile`. Layer the build override on top of the default compose file:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

This builds the image locally instead of pulling from GHCR; all other settings (ports, audit volume, security options) are inherited from `docker-compose.yml`.

### Publishing a new image

The [`Publish image`](.github/workflows/release.yml) GitHub Actions workflow builds the multi-arch image (`linux/amd64` + `linux/arm64`) and pushes it to GHCR. Push a version tag to release:

```bash
git tag v1.0.1 && git push origin v1.0.1   # publishes :1.0.1, :1.0, and :latest
```

You can also trigger it manually from the **Actions** tab (publishes `:latest`). The first push creates the GHCR package as **private** — make it **public** once (GitHub → your profile → Packages → `ajo-content-mcp` → Package settings → Change visibility) so end users can pull without `docker login`.

### Packaging the distribution bundle

To hand the server to an end user who won't clone the repo, zip the self-contained [`distribution/`](distribution/) folder (an abridged `QUICKSTART.md` + a pull-only `docker-compose.yml`):

```bash
zip -r ajo-content-mcp-quickstart.zip distribution/
```

The recipient unzips it, then runs `docker compose up -d` from the folder — no source, no build. If you change the root `docker-compose.yml`, keep `distribution/docker-compose.yml` in sync (it's a deliberate standalone copy so the bundle has no repo dependencies).

---

## Troubleshooting

### Authentication issues
- Ensure `CLIENT_SECRET` and `API_KEY` are correct in your credentials file
- Alternatively, provide a pre-obtained `ACCESS_TOKEN` directly
- Check `/ready` endpoint for auth status

### Sandbox issues
- Prefer selecting the sandbox from the auto-populated dropdown — it lists exactly the sandboxes your credentials can access
- If the dropdown is empty or falls back to manual entry, the Sandbox Management API may not be enabled on your Developer Console project, or the credentials may lack permission to list sandboxes
- Manually entered sandbox names are case-sensitive — find the exact name in Adobe Experience Platform → Sandbox switcher, or in your AJO URL under the `sname:` parameter

### Connectivity issues
- Verify the container is running: `docker ps`
- Check container logs: `docker logs ajo-content-mcp`
- Ensure port 3000 is not in use

### Adobe API issues
- `401 UNAUTHORIZED`: Token expired — restart the server to re-authenticate
- `403 FORBIDDEN`: Check that your API key has the required AJO Content permissions
- `404 NOT_FOUND`: Verify the template/fragment ID and sandbox
- `409 CONFLICT`: ETag mismatch — fetch the resource again to get the latest etag

### Tool not working
- Check `/ready` returns `{ "ready": true }`
- Verify the MCP client is connected to `http://localhost:3000/mcp`
- Review logs: `docker compose logs -f`

### Claude Desktop: "failed to attach resource" in the chat UI
Attaching this server's **resources** or **prompts** to the chat via the **+** menu fails in Claude Desktop ("failed to attach resource" / "server not found"). **This is a Claude Desktop limitation, not a problem with this server**, and it does **not** affect functionality.

- It affects **every** local server connected through the `mcp-remote` bridge — reproducible with Adobe's own AJO MCP server too, not just this one.
- The server is healthy: the request actually **succeeds** at the protocol level. `docker compose logs -f` shows the `resources/read` / `prompts/get` returning a normal result — the failure is purely in Claude Desktop's attach UI.
- **Tools are unaffected** and work normally (they use a different path than the resource picker).
- The model can still reach the same content through tools: call **`get_visual_designer_requirements`** for the Visual Email Designer HTML spec, and **`get_server_context`** for the full catalog of tools *and* resources (each resource listed with an "access" hint for how to obtain it).
- Resources *do* attach normally in clients connected as **native/remote** connectors, and in any client that supports reading MCP resources directly.

### Which server actually handled a request?
LLM clients **cannot reliably report their own MCP connections** — if you ask the model "which MCP servers are you connected to?" or "which server did you use?", it may omit this local server, list unrelated cloud connectors, or claim it was "proxied" through another server. That's the model guessing from tool names, not ground truth.

To confirm this server did the work, use authoritative signals instead:
- **Container logs** are the source of truth — every tool call is logged: `docker compose logs -f` (look for entries like `create_content_fragment`).
- The landing page's **Connected client** panel at `http://localhost:3000` shows the live connection (e.g. `Claude Desktop · http`).
- This server's tools are namespaced under **`et-ajo-content-mgmt`** — that prefix is the real one.
- `mcp-remote` connects **directly** to `http://localhost:3000/mcp`; it does not route through any cloud service.

If a client also has **cloud Adobe/AJO connectors** enabled (e.g. via its connectors UI), their tools overlap in purpose with this server's and the model may conflate them. Disable the ones you aren't using so `et-ajo-content-mgmt` is unambiguous.

### Connected-client list seems out of date
Each client gets its own MCP **session**, and the **Connected client** panel tracks those sessions — so the list stays correct even with several clients connected at once (e.g. Claude Code and Claude Desktop). Activity on one client's session never refreshes another's.
- **A client you just closed still shows:** when a client disconnects cleanly its session ends and it's removed promptly. If it lingers, give it up to ~10 seconds (the safety-net window for an unclean exit). For Claude Desktop, make sure the app fully quit (not just the window closed) so the `mcp-remote` bridge process actually exits.
- **A connected client isn't listed:** it appears as soon as it sends anything, and every tool call keeps it listed. If it's missing, run any tool and it'll reappear.
- The list reflects connections to the **running container**; restarting it (`docker compose restart`) clears the list entirely.

---

## Architecture

```
.
├── src/
│   ├── server/
│   │   ├── index.ts            Entry point — starts STDIO + HTTP transports, graceful shutdown
│   │   └── app.ts              Express app — landing page, /api/* config endpoints, /mcp endpoint
│   ├── mcp/
│   │   ├── server.ts           MCP server factory, tool routing, resources, prompts, STDIO/HTTP setup
│   │   ├── resources.ts        Static, collection, and templated resource definitions (ajo:// URIs)
│   │   ├── prompts.ts          Guided workflow prompt definitions (discover-personalization-paths, etc.)
│   │   ├── personalization-syntax.ts  Loads + splits the personalization syntax library asset into categories
│   │   ├── tool-catalog.ts     Builds the grouped tool catalog (for get_server_context + instructions)
│   │   ├── access-policy.ts    Runtime read-only / write-access toggle
│   │   ├── connected-clients.ts  Tracks which MCP clients are connected (for the landing page)
│   │   └── sdk-types.d.ts      Local type declarations for the MCP SDK
│   ├── tools/
│   │   ├── templates.ts        Content template tool definitions + handlers
│   │   ├── fragments.ts        Content fragment tool definitions + handlers
│   │   ├── github.ts           check_pr_status and deploy_merged_changes tool definitions + handlers
│   │   ├── schema-registry.ts  XDM schema / field group / union lookup tools (read-only)
│   │   ├── visual-designer.ts  get_visual_designer_requirements tool — AJO email HTML spec (read-only)
│   │   ├── personalization.ts  get_personalization_syntax tool — AJO personalization syntax library (read-only)
│   │   └── context.ts          get_server_context tool — reports author/sandbox/tenant (read-only)
│   ├── github/
│   │   ├── client.ts           GitHub REST API client — PAT auth, repo/file/branch/PR operations
│   │   ├── sync.ts             Audit-trail commit and PR approval-gate logic (commitAuditTrail, createApprovalPR, readMergedPRContent)
│   │   └── types.ts            GitHubConfig type (token, owner, repo, defaultBranch, mode)
│   ├── reference/
│   │   └── ajo-personalization-syntax-library.md  Personalization syntax library (shipped asset, served by get_personalization_syntax)
│   ├── adobe/
│   │   ├── client.ts           AJO Content API client (axios + retry, injects auth headers)
│   │   └── schema-registry-client.ts  AEP Schema Registry (XDM) read client
│   ├── auth/
│   │   └── token-manager.ts    Adobe IMS token acquisition with caching + refresh
│   ├── validation/
│   │   └── schemas.ts          Zod schemas for the credentials file and tool inputs
│   ├── telemetry/
│   │   ├── index.ts            Winston logging + Prometheus metrics registry
│   │   └── audit.ts            Append-only JSONL audit trail for content writes
│   └── ui/
│       └── landing.ts          Single-page setup UI (HTML/CSS/JS), served at /
├── Dockerfile                  Multi-stage build (npm ci → tsc → slim runtime image)
├── docker-compose.yml          Builds the image and runs the container
├── package.json                Dependencies and scripts
├── tsconfig.json               TypeScript compiler configuration

```

The server boots both transports in `src/server/index.ts`: an **STDIO** transport and an **HTTP streaming** transport (Express, port 3000) that also serves the landing page. The HTTP transport is **stateful** — each client is assigned an MCP session ID at `initialize` and includes it on every subsequent request. This lets the server attribute all activity (including tool calls, which carry no client identity) to the right client, so the **Connected client** panel stays accurate even when several clients are connected at once (`mcp/connected-clients.ts` keys HTTP clients by session ID). Credentials submitted via the UI are validated (`validation/`), used to obtain an IMS token (`auth/`), and applied to the API client (`adobe/`); MCP tool calls are routed through `mcp/server.ts` to the handlers in `tools/`.

---

## License

MIT