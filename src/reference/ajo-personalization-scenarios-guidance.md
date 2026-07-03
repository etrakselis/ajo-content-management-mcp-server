# Adobe Journey Optimizer Content Creation Agent Personalization Rules

## Purpose

This document defines the mandatory rules that the Adobe Journey Optimizer (AJO) Content Creation Agent must follow when generating:

- Content Templates
- Content Fragments
- Email Content
- Landing Pages
- Push Notifications
- In-App Messages
- Any AJO-authored content asset

The objective is to ensure that all generated content correctly implements Adobe Journey Optimizer personalization and dynamic content capabilities using only supported AJO syntax.

---

# Companion MCP Server Tools

This guide is the **"what & when"** layer of personalization. Use it together with the other capabilities this MCP server exposes, in this order:

1. **`get_personalization_guidance`** (this document) — decide WHAT to personalize and WHEN: find every dynamic value, resolve its data source, detect collections needing iteration, and review coverage.
2. **Discover the real attribute paths** — find WHICH paths actually exist in this sandbox. Call `list_xdm_field_groups` / `get_xdm_field_group` and `list_xdm_union_schemas` / `get_xdm_union_schema`, or run the `discover-personalization-paths` prompt. Never assume or invent paths.
3. **`get_personalization_syntax`** — learn HOW to write the expression: AJO-native expression language, helper functions, conditionals, loops, and dataset lookup. It is served by category — call with no argument for the index, then request a category (e.g. `core`, `dates`, `arrays`, `dataset-lookup`).

For email and landing-page HTML, personalization expressions must sit inside markup that follows the AJO Visual Email Designer format — call `get_visual_designer_requirements` for that structure.

When the task is to **create a new AJO email or convert a provided HTML email into an AJO template**, start with **`get_email_scenario_faq`** — the triage/conversation layer that recognizes the common email personalization scenarios (product feeds, reusable header/footer fragments, price/text transforms, conditional content, tracking links, etc.) and, for each, lists the clarifying questions to ask the user — *before* applying this guide's what/when analysis.

---

# Core Personalization Principles

## Use Only AJO-Supported Syntax

The agent must always reference the official AJO Personalization Syntax Library — available via the `get_personalization_syntax` tool (or the `ajo://personalization-syntax` resource) — before generating personalization expressions.

The agent must:

- Use only AJO-supported personalization syntax.
- Use only AJO-supported helper functions.
- Use only AJO-supported looping constructs.
- Use only AJO-supported conditional logic.
- Use only AJO-supported lookup functions.

The agent must never generate:

- JavaScript
- Python
- Liquid
- Handlebars
- Mustache
- Jinja
- Custom templating languages
- Assumed or invented personalization syntax

If the required syntax is unknown, the agent must consult the AJO Personalization Syntax Library rather than generating syntax from memory.

---

# Personalization Discovery Process

Before generating content, the agent must analyze the content and identify:

1. Dynamic collections requiring iteration
2. Individual fields requiring personalization
3. URLs requiring personalization
4. Images requiring personalization
5. Dates requiring personalization
6. Conditional content opportunities

The agent should assume that any value that can vary by customer, event, journey execution, transaction, or product may require personalization.

---

# Data Source Resolution

Before generating personalization, the agent must determine where the data originates.

The agent should evaluate sources in the following order:

## 1. Profile Attributes

Examples:

- First Name
- Last Name
- Loyalty Status
- Loyalty Points
- Membership Tier
- Customer Preferences

Use profile personalization when customer-level attributes exist within the profile.

Do NOT assume attribute paths — look them up first (see "Companion MCP Server Tools"). Standard XDM fields are rooted under `profile.` (e.g. `{{profile.person.name.firstName}}`); attributes a customer added in a custom field group live under their tenant namespace, `profile._<tenantId>.` (e.g. `{{profile._acme.loyaltyTier}}`). Never root standard XDM fields under the tenant namespace, and never invent a path that the schema tools did not return.

---

## 2. Journey Context

Journey Context includes all contextual attributes available during journey execution.

Examples:

- Journey entry attributes
- Journey contextual attributes
- Upstream journey variables
- Journey-level enrichment data
- Data passed between journey activities

If the data is already available in the journey execution context, the agent should use Journey Context personalization.

---

## 3. Event Payload

Event Payload includes all payload-based data made available to the journey.

Examples:

- Business Events
- Unitary Events
- Custom Action Responses
- External API Responses
- Transaction Events
- Order Confirmation Events
- Reservation Events
- Offer Decisioning Responses

If the data is delivered within an event payload, the agent should reference the payload directly.

---

## 4. Dataset Lookup

Dataset Lookup should only be used when the required data is not available through:

- Profile Attributes
- Journey Context
- Event Payload

Examples:

- Product Catalog Enrichment
- Historical Purchase Data
- Inventory Data
- External Reference Data

The agent should apply AJO-supported dataset lookup functionality only when required — for its exact syntax call `get_personalization_syntax` (category `dataset-lookup`).

---

# Ambiguous Data Sources

If the agent cannot determine where the data originates, it must ask the user for clarification.

Example:

> Should this information be sourced from the journey context, the incoming event payload, a profile attribute, or an AEP dataset lookup?

The agent must never assume a data source.

---

# Dynamic Collection Detection

The agent must determine whether any content section represents a collection of items.

Examples:

- Order Items
- Purchased Products
- Recommended Products
- Cart Contents
- Loyalty Rewards
- Reservations
- Flight Segments
- Hotel Bookings
- Shipment Packages
- Store Locations
- Event Registrations

If a collection is detected, the agent must generate an AJO-compatible iteration construct.

---

# Iteration Requirements

Whenever a collection is detected:

1. Generate the appropriate AJO for-each loop syntax.
2. Wrap the entire repeating content block within the loop.
3. Personalize all collection-level attributes.
4. Avoid hardcoded values.
5. Ensure all repeated content is dynamically generated.

The exact looping syntax must always be obtained from the AJO Personalization Syntax Library — call `get_personalization_syntax` (category `arrays` for `{{#each}}` iteration; `context-iteration` for journey-event/payload collections).

---

# Collection Personalization Rules

Within a looped item, the agent must identify every attribute that could vary between records.

Examples for product collections:

- Product Name
- Product SKU
- Product Description
- Product Price
- Product Quantity
- Product Color
- Product Size
- Product Image URL
- Product Category
- Product Discount
- Product Rating
- Product Detail URL

The agent must replace static values with appropriate personalization expressions wherever applicable.

The exact syntax used must be sourced from the AJO Personalization Syntax Library (`get_personalization_syntax`).

---

# Non-Collection Personalization Rules

Even when iteration is not required, the agent must inspect every content section for personalization opportunities.

Examples include:

## Customer Information

- First Name
- Last Name
- Loyalty Tier
- Loyalty Points
- Preferred Store
- Membership Status

---

## Transaction Information

- Order Number
- Tracking Number
- Reservation Number
- Confirmation Number
- Invoice Number

---

## Event Information

- Event Date
- Appointment Date
- Booking Date
- Departure Date
- Arrival Date

---

## Offer Information

- Offer Name
- Offer Expiration
- Offer Amount
- Promotion Details

---

# URL Personalization

The agent must inspect every URL for dynamic content opportunities.

Examples:

- CTA URLs
- Product URLs
- Tracking URLs
- Deep Links
- Offer URLs

Personalization may be required within:

- Query parameters
- Path parameters
- Dynamic destinations

The agent should never assume URLs are static.

---

# Image Personalization

The agent must inspect all image references for dynamic content opportunities.

Examples:

- Product Images
- Personalized Banners
- Offer Graphics
- Dynamic Hero Images

Image source URLs may require personalization.

---

# Date Handling Rules

The agent must never hardcode current dates or years.

Examples of content requiring dynamic dates:

- Copyright Statements
- Current Year References
- Timestamp Displays
- Date-Based Messaging

When current dates are required, the agent must use the appropriate AJO-supported date function obtained from the Personalization Syntax Library — call `get_personalization_syntax` (category `dates`).

Example:

❌ Incorrect

```html
© 2026 Company Name
```

✅ Correct

Use the AJO-supported expression that dynamically generates the current year.

---

# Conditional Content

The agent should identify opportunities where content may require conditional rendering.

Examples:

- Loyalty tier variations
- Membership status variations
- Geographic variations
- Product availability variations
- Promotional eligibility variations

Conditional logic must use only AJO-supported syntax — call `get_personalization_syntax` (category `core` for `{%#if%}`/`{%else%}`, `operators` for comparison/boolean operators).

---

# Personalization Coverage Review

Before finalizing content, the agent must perform a comprehensive personalization review.

For every content element, ask:

- Can this vary by customer?
- Can this vary by event?
- Can this vary by journey execution?
- Can this vary by transaction?
- Can this vary by product?
- Can this vary by API response?
- Can this vary by business event?

If yes, personalization should be considered.

---

# Required Validation Checklist

## Data Source Validation

- Data source identified
- Correct source selected
- No assumptions made

---

## Iteration Validation

- Collections identified
- Loop required?
- Correct AJO iteration syntax applied
- Entire repeating block wrapped correctly

---

## Personalization Validation

- Customer attributes personalized
- Event attributes personalized
- Journey context attributes personalized
- Collection attributes personalized
- URLs reviewed
- Images reviewed
- Dates reviewed

---

## Syntax Validation

- AJO-compatible syntax only
- No JavaScript
- No Python
- No Liquid
- No Handlebars
- No Mustache
- No invented syntax

---

# Final Agent Directive

Before generating any AJO content:

1. Identify all personalization opportunities.
2. Determine the source of each dynamic value.
3. Identify any collections requiring iteration.
4. Apply AJO-supported loops where necessary.
5. Personalize all eligible content elements.
6. Review URLs, images, dates, and metadata for personalization opportunities.
7. Use only syntax obtained from the official AJO Personalization Syntax Library — the `get_personalization_syntax` tool (or `ajo://personalization-syntax` resource).
8. Never invent personalization syntax.
9. Never substitute another scripting language.
10. Ask for clarification whenever data source or personalization requirements are uncertain.

The generated content should maximize appropriate personalization while remaining fully compatible with Adobe Journey Optimizer rendering and execution requirements.