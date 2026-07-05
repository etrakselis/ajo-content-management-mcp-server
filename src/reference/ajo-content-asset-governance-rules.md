# Adobe Journey Optimizer Asset Governance & Naming Standard

## Enterprise Governance Specification for LLM Asset Management

---

# Purpose

This specification defines the mandatory standards an LLM must follow when creating, naming, validating, tagging, organizing, migrating, deprecating, and managing Adobe Journey Optimizer (AJO) assets.

Covered asset types:

- Folders
- Tags
- Content Fragments
- Content Templates

Objectives:

- Consistent naming
- Easy asset discovery
- Reuse before creation
- Reduced duplication
- Scalable governance
- Predictable migrations
- Clear asset relationships
- Enterprise asset lifecycle management

---

# Core Governance Principles

## Principle 1 — Names Identify Assets

Asset names communicate:

- Brand
- Trigger Category
- Trigger Name
- Asset Purpose

Asset names must never contain:

- Asset type designators (such as `Template` or `Fragment`)
- Lifecycle state
- Sandbox names
- Environment identifiers
- Migration status
- Approval status
- Dates
- Timestamps
- Version numbers
- User names

The asset type is always implied by the repository the asset lives in. Because Content Fragments and Content Templates are stored in separate repositories, restating the type in the name (for example, by appending `_Template` or `_Fragment`) adds no information and is prohibited.

---

## Principle 2 — Folders Organize Assets

Folders provide navigation only.

Folders must not be used to represent:

- Lifecycle state
- Environment
- Migration status

---

## Principle 3 — Tags Describe Assets

Tags provide:

- Searchability
- Filtering
- Governance metadata
- Lifecycle tracking
- Migration readiness
- Asset grouping

---

# Metadata Minimization Principle

The LLM must avoid storing metadata that can be reliably inferred from existing platform structure.

Metadata should only be added when it provides unique governance, discovery, lifecycle, relationship, or operational value.

The LLM should prefer minimal governance metadata over redundant metadata.

Examples of metadata that should not be duplicated:

- Asset type (already inferred from repository — must not appear in names or tags)
- Environment information
- Sandbox information
- Folder hierarchy information already represented by the folder path

---

# Example Usage Policy

Examples contained in this specification are illustrative only.

Examples exist solely to demonstrate:

- Naming structure
- Hierarchy
- Formatting
- Governance patterns

Examples are not preferred values.

When generating names, the LLM must:

- Derive names from the current request context.
- Derive names from approved vocabulary.
- Derive names from existing assets when appropriate.

The LLM must not:

- Copy example asset names.
- Reuse example trigger names because they appear in examples.
- Select names based solely on example content.
- Treat examples as templates for business values.

If an example conflicts with governance rules, governance rules always win.

---

# Naming Convention

## Naming Order Principle

Asset names must always follow:

```text
Brand → Trigger Category → Trigger Name → Asset Purpose
```

Format:

```text
[Brand]_[TriggerCategory]_[TriggerName]_[AssetPurpose]
```

The Asset Purpose token applies to **Content Fragments**, where it is the approved Section (for example, `Hero`). **Content Templates omit the Asset Purpose token**: a template is named with Brand, Trigger Category, and Trigger Name only, because the template represents the whole experience and its type is already implied by its repository.

Illustrative Examples:

```text
LM_PD_BrowseAbandon_Hero
NV_BIS_Wishlist_TopBanner
LM_UNIT_OrderConfirmation
```

(The third example is a Content Template — three tokens, no purpose suffix and no `_Template` designator.)

---

# Controlled Vocabulary Registry

Only approved vocabulary may be used.

## Brands

| Brand | Acronym |
|---------|----------|
| Luma | LM |
| Nova | NV |

## Trigger Categories

| Category | Abbreviation |
|-----------|--------------|
| Price Drop | PD |
| Back In Stock | BIS |
| Unitary | UNIT |

## Approved Fragment Sections

```text
TopBanner
Hero
BottomBanner
```

New vocabulary requires governance approval before use.

---

# Naming Character Standards

## Separator Standard

Use underscores only.

Correct:

```text
LM_PD_BrowseAbandon_Hero
```

Incorrect:

```text
LM-PD-BrowseAbandon-Hero
LM PD BrowseAbandon Hero
LM.PD.BrowseAbandon.Hero
```

---

## Trigger Formatting

Multi-word trigger names must use PascalCase.

Correct:

```text
BrowseAbandon
CartAbandon
OrderConfirmation
```

Incorrect:

```text
browse abandon
browse_abandon
browse-abandon
```

---

## Special Character Removal

Remove:

```text
/
\
&
%
#
@
!
?
-
```

Convert resulting values to PascalCase.

Example:

```text
Browse Abandon → BrowseAbandon
```

---

# Content Fragment Naming

Format:

```text
[Brand]_[TriggerCategory]_[TriggerName]_[Section]
```

Illustrative Example:

```text
LM_PD_BrowseAbandon_Hero
```

Do not append a `_Fragment` designator. The final token is the approved Section, and the Content Fragment repository already establishes that the asset is a fragment.

---

# Content Fragment Description

Every Content Fragment must have a populated `description` field. The LLM must never create a Content Fragment with an empty, placeholder, or name-restating description.

The description is the fragment's human-readable statement of intent. It exists so that anyone browsing the fragment library — or an LLM searching for a fragment to reuse — can understand what the fragment is for without opening it.

The description must make clear:

- **Purpose** — the role this fragment plays in the experience (for example, the hero section of a specific journey).
- **Content** — what the fragment actually displays: the kind of content, its key elements, and any dynamic or personalized values it renders.
- **Context** — the brand, trigger, and section it belongs to, where that adds clarity.

The description must:

- Be specific to this fragment, not generic boilerplate.
- Describe the content, not merely restate the name.
- Be written in plain, complete sentences.

Illustrative Example (for a fragment named `LM_PD_BrowseAbandon_Hero`):

```text
Hero section for the Luma Price Drop Browse Abandonment email. Displays the primary promotional banner with the personalized product image, product name, the dropped price shown alongside the original struck-through price, and the primary "Shop Now" call-to-action.
```

The example illustrates the level of detail expected; it is not a value to copy. Derive every description from the actual content of the fragment being created.

This requirement complements the Metadata Minimization Principle rather than conflicting with it: a fragment description conveys purpose and content that cannot be inferred from the name, folder, or repository, so it provides unique discovery and operational value.

---

# Content Template Naming

A Content Template represents an entire experience. Its asset type is already established by the Content Template repository it lives in, so the name must not restate it.

Format:

```text
[Brand]_[TriggerCategory]_[TriggerName]
```

Illustrative Example:

```text
LM_PD_BrowseAbandon
```

Do not append a `_Template` suffix. Do not append any Asset Purpose / Section token. A Content Template name contains exactly three tokens: Brand, Trigger Category, and Trigger Name.

---

# Repository Separation Rule

Content Fragments and Content Templates are managed in separate repositories.

Folder structures are evaluated independently within each repository.

The LLM must not assume that Content Fragments and Content Templates share a common folder hierarchy.

A folder path is unique only within the repository being evaluated.

The existence of a folder path within the Content Fragment repository does not imply the same folder exists within the Content Template repository.

The LLM must not treat matching folder paths across repositories as duplicates.

Repository membership inherently identifies the asset type. Because the repository already identifies the asset type, the type must never be repeated in the asset name or as a tag.

---

# Folder Structure

Folders must mirror the naming hierarchy within the asset's repository.

Content Fragments and Content Templates maintain independent folder structures.

## Content Fragment Folder Structure

```text
/{Brand}/
    /{TriggerCategory}/
        /{TriggerName}/
```

Illustrative Example:

```text
/LM/
    /PD/
        /BrowseAbandon/
```

---

## Content Template Folder Structure

```text
/{Brand}/
    /{TriggerCategory}/
        /{TriggerName}/
```

Illustrative Example:

```text
/LM/
    /PD/
        /BrowseAbandon/
```

---

## Folder Placement Rule

When creating a Content Fragment:

- Place the asset within the Content Fragment repository hierarchy.
- Do not create a `/Fragments` subfolder.

When creating a Content Template:

- Place the asset within the Content Template repository hierarchy.
- Do not create a `/Templates` subfolder.

Because the repositories are separate, identical folder paths may exist in both repositories.

Example:

### Content Fragment Repository

```text
/LM/PD/BrowseAbandon
```

### Content Template Repository

```text
/LM/PD/BrowseAbandon
```

These represent different repository locations and are not duplicates.

---

# Template Composition Standard

A Content Template must be assembled exclusively from embedded Content Fragments.

The LLM must never place raw or inline HTML directly inside a Content Template. The template is an assembly layer: it references fragments and defines their arrangement, but holds no markup of its own.

## Required Decomposition Process

When the LLM is given HTML for an experience, it must:

1. Analyze the HTML and identify its logical, reusable regions (for example: top banner, hero, body, bottom banner).
2. Split the HTML along those logical boundaries.
3. Create (or reuse) one Content Fragment per region, placing the corresponding HTML inside that fragment.
4. Name and tag each fragment per the standards in this document, using the approved Section vocabulary for the fragment's purpose.
5. Embed the resulting Content Fragments into the Content Template by reference.

## Why Composition Is Required

- Fragments are independently reusable across templates and journeys.
- A fragment can be updated once and reflected everywhere it is embedded.
- Templates stay lightweight and free of duplicated markup.
- Content ownership and QA happen at the fragment level.

## Decomposition Guidance

- Map each visually or functionally distinct region to its own fragment.
- Prefer the approved Section vocabulary (`TopBanner`, `Hero`, `BottomBanner`) when a region matches one of those purposes.
- Reuse an existing fragment when one already satisfies the region (search and reuse rules still apply).
- If a region does not map cleanly to an existing approved Section, request governance approval for new Section vocabulary rather than inventing a name or falling back to inline HTML.

## Prohibited

- Inline or raw HTML placed directly inside a Content Template.
- A Content Template that embeds zero fragments.
- HTML duplicated across a template and the fragments it embeds.

---

# Required Tags

## Brand

```text
brand-lm
brand-nv
```

## Trigger Category

```text
trigger-category-pd
trigger-category-bis
trigger-category-unit
```

## Trigger

```text
trigger-{triggername}
```

## Fragment Section (Fragments Only)

```text
section-hero
section-topbanner
section-bottombanner
```

## Lifecycle

```text
draft
ready-to-migrate
prod
retired
```

## Asset Family

```text
asset-family-{brand}-{category}-{trigger}
```

Environment tags are prohibited.

Asset type tags are prohibited.

---

# Asset Type Metadata

Asset type tags are prohibited.

Asset type designators in names are also prohibited.

Adobe Journey Optimizer stores Content Fragments and Content Templates in separate repositories.

Because repository membership already identifies the asset type, additional asset-type tags provide no governance value and create redundant metadata, and asset-type suffixes in names (such as `_Template` or `_Fragment`) provide no information.

The LLM must not create or apply tags such as:

```text
content-fragment
content-template
```

The LLM must not append name suffixes such as:

```text
_Template
_Fragment
```

Asset type must be inferred from the repository in which the asset exists.

---

# Asset Creation Workflow

The following process is mandatory.

## Step 1 — Search Existing Assets

Before creating any asset:

- Search all accessible assets.
- Search folders.
- Search templates.
- Search fragments.
- Search tags.

Creation may not proceed until search is completed.

---

## Step 2 — Determine Reuse Eligibility

If an existing asset satisfies the requirement:

- Reuse the asset.
- Do not create a duplicate.

When uncertain:

- Prefer reuse over creation.

---

## Step 3 — Determine Asset Type

Identify:

- Content Fragment
- Content Template
- Folder
- Tag

---

## Step 4 — Determine Hierarchy

Identify:

- Brand
- Trigger Category
- Trigger Name
- Asset Purpose
- Section (Fragments Only)

---

## Step 5 — Generate Name

Construct the name using approved vocabulary only.

Generate from request context.

Do not generate from example values.

Do not append asset-type designators (`_Template`, `_Fragment`). A Content Fragment name ends in its approved Section; a Content Template name ends in the Trigger Name.

---

## Step 6 — Write Description (Content Fragments)

When the asset is a Content Fragment, populate its `description` field with a specific statement of the fragment's purpose and the content it displays (see [Content Fragment Description](#content-fragment-description)). Never leave the description empty or set it to a restatement of the name.

---

## Step 7 — Apply Tags

Apply required governance tags only.

Do not create redundant tags for metadata already represented by platform structure.

---

## Step 8 — Place Asset

Place the asset in the correct repository hierarchy.

For Content Fragments:

```text
/{Brand}/{TriggerCategory}/{TriggerName}
```

For Content Templates:

```text
/{Brand}/{TriggerCategory}/{TriggerName}
```

Do not create asset-type subfolders such as:

```text
/Fragments/
/Templates/
```

unless explicitly required by the platform.

---

## Step 9 — Compose Templates From Fragments

When the asset being produced is a Content Template, the LLM must not place HTML directly in the template. It must instead follow the Template Composition Standard: split the provided HTML into logical regions, store that HTML inside Content Fragments, and embed those fragments into the template by reference. A compliant template contains embedded fragments and no inline markup.

---

# Duplicate Detection Policy

The LLM must actively prevent duplicate assets.

## Duplicate Definition

An asset is considered a duplicate when any of the following are true.

### Exact Duplicate

Same normalized name.

### Functional Duplicate

Same:

- Brand
- Trigger Category
- Trigger Name
- Asset Purpose

### Business Duplicate

Same business intent.

---

## Name Normalization Rules

Before duplicate evaluation:

1. Convert to lowercase.
2. Trim whitespace.
3. Treat separators as equivalent:
   - underscore
   - hyphen
   - period
   - space
4. Remove punctuation.
5. Compare approved vocabulary tokens.

Example:

```text
LM_PD_ShopBag_Hero
lm-pd-shopbag-hero
LM.PD.ShopBag.Hero
```

All normalize to the same identity.

---

## Duplicate Resolution

If a duplicate exists:

- Reuse the existing asset.
- Do not create a new asset.

If a near duplicate exists:

- Prefer reuse.
- Create only if business intent is demonstrably different.

---

# Asset Relationship Standards

Assets belonging to the same experience must share:

- Brand
- Trigger Category
- Trigger Name
- Asset Family Tag

Illustrative Pattern:

```text
{Brand}_{Category}_{Trigger}            (Content Template)
{Brand}_{Category}_{Trigger}_Hero       (Content Fragment)
{Brand}_{Category}_{Trigger}_TopBanner  (Content Fragment)
{Brand}_{Category}_{Trigger}_BottomBanner (Content Fragment)
```

The Content Template embeds the related fragments; it does not contain their markup directly.

Shared family tag:

```text
asset-family-{brand}-{category}-{trigger}
```

---

# Migration Readiness Criteria

An asset may receive:

```text
ready-to-migrate
```

Only when:

- Content complete
- QA complete
- Required tags complete
- Naming compliant
- Folder placement compliant
- Asset relationships established
- For templates: composed only of embedded fragments, with no inline HTML

---

# Retirement Policy

Assets should not be deleted solely because they are inactive.

Retired assets must:

- Receive the `retired` tag
- Remain searchable
- Preserve references
- Preserve asset-family relationships

---

# LLM Enforcement Rules

The LLM must:

- Search before creating.
- Reuse before creating.
- Follow approved vocabulary.
- Follow naming standards.
- Follow folder standards.
- Respect repository separation.
- Apply required governance tags.
- Populate the `description` field of every Content Fragment with a specific statement of its purpose and the content it displays.
- Prevent duplicates.
- Maintain asset relationships.
- Compose Content Templates only from embedded Content Fragments.
- Split provided HTML across Content Fragments and embed those fragments into the template.
- Validate before finalizing.

The LLM must not:

- Copy example names.
- Generate names from examples.
- Create duplicate assets.
- Invent abbreviations.
- Append asset-type designators such as `_Template` or `_Fragment` to asset names.
- Include lifecycle information in names.
- Include environment information in names.
- Create folders outside approved hierarchy.
- Assume templates and fragments share the same repository.
- Create redundant tags for metadata already represented by platform structure.
- Create asset-type tags.
- Insert raw or inline HTML directly into a Content Template.

---

# Validation Checklist

Before finalizing any asset:

- Sandbox search completed
- Duplicate evaluation completed
- Repository validated
- Brand validated
- Trigger category validated
- Trigger validated
- Asset purpose validated
- Naming convention compliant
- No asset-type designator in name
- Folder placement compliant
- Content Fragment description populated — states purpose and content (fragments only)
- Required tags present
- Asset family tag present
- No lifecycle data in name
- No environment data in name
- Relationships established
- For templates: composed only of embedded fragments (no inline HTML)

---

# Required Output Format

## Content Fragment

```text
Asset Type: Content Fragment

Name:
LM_PD_BrowseAbandon_Hero

Folder:
/LM/PD/BrowseAbandon

Description:
Hero section for the Luma Price Drop Browse Abandonment email. Displays the personalized product image, product name, the dropped price shown alongside the original struck-through price, and the primary "Shop Now" call-to-action.

Tags:
brand-lm
trigger-category-pd
trigger-browseabandon
section-hero
asset-family-lm-pd-browseabandon
draft

Reasoning:
Content fragment for the Hero section of the Browse Abandon Price Drop journey.
```

---

## Content Template

```text
Asset Type: Content Template

Name:
LM_PD_BrowseAbandon

Folder:
/LM/PD/BrowseAbandon

Embedded Fragments:
LM_PD_BrowseAbandon_TopBanner
LM_PD_BrowseAbandon_Hero
LM_PD_BrowseAbandon_BottomBanner

Tags:
brand-lm
trigger-category-pd
trigger-browseabandon
asset-family-lm-pd-browseabandon
ready-to-migrate

Reasoning:
Primary template for the Browse Abandon Price Drop journey. The name carries no
asset-type suffix because the Content Template repository already implies the
type. The template contains no inline HTML; it embeds the TopBanner, Hero, and
BottomBanner fragments, which hold the markup.
```

---

## Validation Response

```text
Asset Name:
[Asset Name]

Status:
Compliant | Non-Compliant

Validation Results:
✓ Naming convention compliant
✓ No asset-type designator in name
✓ Folder placement compliant
✓ Content Fragment description populated (fragments only)
✓ Required tags present
✓ Asset family tag present
✓ Duplicate check completed
✓ No prohibited metadata in name
✓ Template composed only of embedded fragments (templates only)
```

---

# Governance Summary

Names identify assets.

Folders organize assets.

Tags describe assets.

Content Fragment descriptions state each fragment's purpose and content.

Asset type is implied by the repository — never put it in a name or a tag.

Templates embed fragments — never inline HTML.

Search before creation.

Reuse before creation.

Prevent duplicates.

Respect repository separation.

Minimize redundant metadata.

Examples demonstrate structure only.

Governance rules always take precedence over examples.