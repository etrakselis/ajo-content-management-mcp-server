# Adobe Journey Optimizer Asset Governance & Naming Standards (Enterprise Governance Specification)

## Purpose

This specification defines the mandatory standards an LLM must follow when creating, naming, tagging, organizing, migrating, deprecating, and managing Adobe Journey Optimizer (AJO) assets.

Covered asset types:

- Folders
- Tags
- Content Fragments
- Content Templates

Objectives:

- Consistent naming
- Easy asset discovery
- Reuse before creation
- Simplified governance
- Clear relationships between assets
- Predictable migrations
- Reduced duplication
- Scalable enterprise asset management

---

# Governance Principles

## Names identify the asset

Names communicate:

- Brand
- Trigger Category
- Trigger Name
- Asset Purpose

Names never contain:

- Lifecycle state
- Sandbox names
- Environment information
- Migration status
- Approval status
- Dates
- Version numbers

## Folders organize the asset

Folders provide navigational structure only.

## Tags describe the asset

Tags provide:

- Filtering
- Governance
- Lifecycle tracking
- Migration readiness
- Asset grouping

---

# Naming Convention

## Naming Order Principle

Names must always be structured from the broadest business context to the most granular identifier.

```text
Brand → Trigger Category → Trigger Name → Asset Purpose
```

Example:

```text
LM_PD_ShopBag_Hero
```

---

# Controlled Vocabulary Registry

## Example Brands

| Brand | Acronym |
|---------|----------|
| Luma | LM |
| Nova | NV |

## Trigger Categories

| Trigger Category | Abbreviation |
|------------------|--------------|
| Price Drop | PD |
| Back In Stock | BIS |
| Unitary | UNIT |

## Approved Template Sections

```text
TopBanner
Hero
BottomBanner
```

New brands, trigger categories, trigger names, or sections must be added to the approved registry before use.

---

# Content Fragment Naming

Format:

```text
[Brand]_[TriggerCategory]_[TriggerName]_[Section]
```

Examples:

```text
LM_PD_ShopBag_Hero
LM_PD_ShopBag_TopBanner
LM_PD_ShopBag_BottomBanner
```

---

# Content Template Naming

Format:

```text
[Brand]_[TriggerCategory]_[TriggerName]_Template
```

Examples:

```text
LM_PD_ShopBag_Template
LM_BIS_Wishlist_Template
```

---

# Folder Structure

```text
/LM/
    /PD/
        /ShopBag/
            /Fragments/
            /Templates/
```

Folder hierarchy should mirror naming hierarchy.

---

# Tagging Strategy

Required tag categories:

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
trigger-shopbag
trigger-wishlist
```

## Asset Type

```text
content-fragment
content-template
```

## Section (Fragments Only)

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
asset-family-lm-pd-shopbag
```

Environment tags are prohibited.

---

# Asset Creation Decision Tree

Before creating any asset:

## Step 1: Search for Existing Assets

Determine whether an existing asset already satisfies the requirement.

If an existing asset can be reused:

- Reuse the asset
- Do not create a duplicate

## Step 2: Determine Asset Type

Identify:

- Content Fragment
- Content Template
- Folder
- Tag

## Step 3: Determine Hierarchy

Identify:

- Brand
- Trigger Category
- Trigger Name
- Section (if fragment)

## Step 4: Generate Name

Apply naming convention.

## Step 5: Apply Tags

Apply all required tags.

## Step 6: Place Asset

Place asset in correct folder.

---

# Duplicate Detection Rules

The LLM must avoid creating duplicate assets.

An asset is considered a duplicate when:

- Same Brand
- Same Trigger Category
- Same Trigger Name
- Same Asset Purpose
- Same business intent

Before creating a new asset:

1. Search existing assets.
2. Compare intended purpose.
3. Reuse when possible.

When uncertain, prefer reuse over creation.

---

# Asset Relationship Standards

Templates and fragments belonging to the same experience must share:

- Brand
- Trigger Category
- Trigger Name
- Asset Family Tag

Example:

```text
LM_PD_ShopBag_Template
LM_PD_ShopBag_Hero
LM_PD_ShopBag_TopBanner
LM_PD_ShopBag_BottomBanner
```

Shared tag:

```text
asset-family-lm-pd-shopbag
```

---

# Migration Readiness Criteria

An asset may receive the tag:

```text
ready-to-migrate
```

only when:

- Content is complete.
- QA review is complete.
- Required tags are present.
- Naming convention is compliant.
- Folder placement is correct.
- Asset relationships are established.

---

# Deprecation and Retirement Policy

Assets should never be deleted solely because they are no longer active.

Retired assets should:

- Receive the `retired` tag.
- Remain discoverable.
- Preserve references to dependent assets.

If a replacement exists:

- Link through shared naming hierarchy.
- Preserve asset family relationships.

---

# Naming Exception Handling

## Long Trigger Names

If a trigger name exceeds practical length limits:

- Use an approved business abbreviation.
- Maintain readability.
- Document the abbreviation in the controlled vocabulary registry.

## Special Characters

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

Convert names to PascalCase.

Example:

```text
Browse Abandon → BrowseAbandon
```

---

# LLM Enforcement Rules

The LLM must:

- Follow naming conventions.
- Follow folder conventions.
- Apply required tags.
- Reuse assets when appropriate.
- Prevent duplicates.
- Maintain asset family relationships.
- Use approved vocabulary.

The LLM must not:

- Include lifecycle data in names.
- Include environment data in names.
- Create duplicate assets.
- Invent new abbreviations without approval.
- Create folders outside the approved hierarchy.

---

# Validation Checklist

Before finalizing any asset:

- Correct brand acronym
- Correct trigger category abbreviation
- Correct trigger name
- Correct asset purpose
- Correct folder placement
- Required tags applied
- Asset family tag applied
- No lifecycle data in name
- No environment data in name
- Duplicate check completed
- Naming hierarchy validated

---

# Governance Summary

Names identify the asset.

Folders organize the asset.

Tags describe the asset.

The LLM must enforce these standards consistently across all Adobe Journey Optimizer assets.


---

# Naming Character Standards

## Underscore Requirement

Asset names must never contain spaces.

Use underscores (`_`) as the only separator between naming components.

### Correct

```text
LM_PD_ShopBag_Hero
LM_PD_ShopBag_Template
LM_BIS_Wishlist_Hero
```

### Incorrect

```text
LM PD ShopBag Hero
LM-PD-ShopBag-Hero
LM.PD.ShopBag.Hero
LM/PD/ShopBag/Hero
```

## Trigger Name Formatting

Within a naming component, multi-word values should use PascalCase.

Example:

```text
BrowseAbandon
CartAbandon
ShopBag
```

Do not use spaces inside naming components.

---

# Required Output Format

When creating, recommending, or validating assets, the LLM should return information using the following structure.

## Content Fragment

```text
Asset Type: Content Fragment

Name:
LM_PD_ShopBag_Hero

Folder:
/LM/PD/ShopBag/Fragments/

Tags:
brand-lm
trigger-category-pd
trigger-shopbag
content-fragment
section-hero
asset-family-lm-pd-shopbag
draft

Reasoning:
Content fragment for the Hero section of the ShopBag Price Drop journey.
```
## Content Template

```text
Asset Type: Content Template

Name:
LM_PD_ShopBag_Template

Folder:
/LM/PD/ShopBag/Templates/

Tags:
brand-lm
trigger-category-pd
trigger-shopbag
content-template
asset-family-lm-pd-shopbag
ready-to-migrate

Reasoning:
Primary template associated with the ShopBag Price Drop journey.
```
## Validation Responses

When validating an existing asset, return:

```text
Asset Name:
LM_PD_ShopBag_Hero

Status:
Compliant

Validation Results:
✓ Naming convention compliant
✓ Folder placement compliant
✓ Required tags present
✓ Asset family tag present
✓ No prohibited metadata in name
```
