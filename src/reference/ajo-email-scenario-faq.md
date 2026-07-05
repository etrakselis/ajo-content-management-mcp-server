# AJO Email Scenario — Scenario FAQ & Clarifying‑Question Playbook

### A reference for an LLM that converts an arbitrary retail/transactional HTML email into an Adobe Journey Optimizer (AJO) personalized template — interactively

This file is **not** a step‑by‑step one‑shot spec. It is a **scenario catalog** so that, when you (the LLM) are handed *some* input HTML email you've never seen, you can:

1. **Recognize** which personalization scenarios the input contains,
2. **Recall** roughly what the AJO solution for each looks like, and
3. **Ask the user the right clarifying questions** whenever the input doesn't tell you what a scenario needs.

The worked reference behind every pattern here is a Luma "shopping‑bag price‑drop" triggered email (a static Bluecore HTML export → an AJO Visual‑Designer template). Treat that as *one illustrative instance*, not a template to copy verbatim — the next input will differ.

> For the deep, step‑by‑step mechanics of any pattern, defer to the reference tools this MCP server exposes — this FAQ is the *triage + conversation* layer that sits on top of them:
>
> - **`get_visual_designer_requirements`** — the native Visual Email Designer HTML serialization spec (structure/component catalog, required `<head>`) so the output stays drag-and-drop editable, not Compatibility mode.
> - **`get_personalization_guidance`** — when & what to personalize (data-source resolution order, collection/iteration detection, coverage review).
> - **`get_personalization_syntax`** — the AJO-native expression/function syntax (how to write `{{ }}` / `{%= %}` / `{% let %}` / `topN` / `datasetLookup`, etc.).
> - **`list_xdm_field_groups` / `get_xdm_union_schema`** — the real attribute paths that exist in *this* sandbox (never guess them).
> - **`get_aem_image_embed_instructions`** — how to resolve an AEM image's media-library embed attributes.

---

## How to use this FAQ (session posture)

- **Be interactive, not heroic.** Do not guess IDs, schema paths, dataset/event IDs, API keys, or business rules. When a scenario needs a value the input doesn't contain, **ask** — and batch related questions into a single **interactive form** the user fills in directly in the client UI (see *Collecting answers: present the questions as an interactive form* below), drawing from the master list at the end. Don't dump a wall of plain‑text questions.
- **Triage first, build second.** Scan the input, list the scenarios you detect, tell the user your plan, ask the open questions, *then* build section by section.
- **Never invent AJO syntax, function names, attribute paths, or fragment/dataset IDs.** If unsure whether a function exists, say so and verify against the AJO personalization syntax library (call **`get_personalization_syntax`**) rather than inventing one.
- **Discover the sandbox's XDM schema paths yourself — don't ask the user for them.** Attribute paths are *discoverable*: enumerate this sandbox's schema with the XDM tools (`list_xdm_union_schemas` → `get_xdm_union_schema` (`full=false`) → `get_xdm_field_group` on each ref) or the **`discover-personalization-paths`** prompt, and resolve every profile attribute path from what actually exists — standard XDM under `profile.…`, tenant‑custom under `profile._<tenantId>.…` (the tenant namespace is discoverable too — don't ask for it). Only ask the user for what the schema *can't* tell you: **which** discovered field a value maps to when it's ambiguous, event‑payload keys, dataset/result IDs, and business rules — never for the paths themselves. If you can't find a path, say so and re‑check the schema; never invent one.
- **Confirm the two things that break silently:** (1) that the output must open in the Visual Email Designer (native `acr-*` format, not Compatibility mode); (2) that URLs/attributes use **triple‑brace `{{{ }}}`** (unescaped) output, never `{{ }}` (which HTML‑escapes `&`/`=` and breaks links).
- **Preserve pixel‑exact retail markup inside custom‑HTML components.** Don't rebuild a complex product layout from catalog components; keep the original table markup in a `data-component-id="html"` component and personalize it in place.

### Session flow (suggested)

1. **Triage** the input against the recognition checklist below.
2. **Summarize** to the user: "I see these scenarios: A, B, C. Here's what each becomes in AJO. Before I build, I need to confirm N things."
3. **Ask** the batched clarifying questions for the detected scenarios — present them as an **interactive form** the user fills in (see *Collecting answers* below), not a wall of text.
4. **Build** one Structure/section at a time; show the user each and iterate.
5. **Validate** against the checklist at the end.

### Collecting answers: present the questions as an interactive form

Once you know which scenarios are in play, **do not** paste the clarifying questions as a long plain‑text list — that is tedious to answer and easy to answer only partially. Instead, **generate an interactive form on the fly** so the user can answer everything in one place, directly in the client UI:

- **If the client can render interactive artifacts/UI (e.g., Claude Desktop), build a single self‑contained HTML form artifact** containing only the questions relevant to the scenarios you detected. Pick the right control for each question:
  - **Radio buttons / dropdown** for either‑or choices — e.g. *event‑triggered* vs *audience‑based*; *journey‑contextual* vs *in‑email* dataset lookup; Visual‑Designer‑editable yes/no; sort ascending/descending.
  - **Checkboxes** for multi‑select — e.g. which product fields to show (brand/name/price/image/rating/CTA); which tracking types are needed (deep link, mirror page, unsubscribe).
  - **Short text / textarea** for free‑form values the schema can't give you — UTM conventions, fragment IDs, URL patterns, dataset/result IDs, event‑payload keys. (Do **not** ask for XDM attribute paths or the tenant namespace — discover those from the sandbox schema yourself.)
  - **Group the fields by topic** (Message type & data, Products/feed, Links & images, Recommendations, Reuse/conditions/compliance, Output), pre‑fill sensible defaults, and clearly mark which answers are **required**.
- **Make the answers easy to hand back to you.** An artifact's form state is **not** automatically sent back to the chat, so include a **"Copy my answers" button** (or a read‑only summary box) that assembles every response into one structured block the user can paste into the conversation. Wait for that block before you start building.
- **If the client can't render an interactive form,** fall back to a compact, **numbered** checklist the user can fill in inline (still grouped by topic, defaults shown).

Only include what the detected scenarios actually require — pull the relevant items from each scenario's *"Ask the user if unclear"* list and the master list at the end. Re‑surface the form (or a short follow‑up form) if their answers reveal new scenarios or leave required fields blank.

### 60‑second triage checklist (what to look for in ANY input)

| If the input has… | …it's probably this scenario | Jump to |
|---|---|---|
| Plain `<table>` soup, no `acr-*` classes | Structure re‑serialization | S1 |
| Hard‑coded UTM params in links, a campaign name | Global variables | S2 |
| A header/logo bar + a footer that look "standard" | Reusable chrome → fragments | S3 |
| Hidden preview text near the top | Preheader | S4 |
| One or more repeated product blocks (image/brand/name/price/CTA) | Product feed / item module | S5 |
| Several products where order seems to matter | Sorting | S6 |
| Any hint that some products shouldn't show (out of stock, excluded) | Eligibility filtering | S7 |
| "Up to N products," or a need to log what was shown | Counters / limits / accumulators | S8 |
| A sale price + a struck‑through original price | Price handling | S9 |
| ALL‑CAPS brands, or very long product names | Text transforms | S10 |
| A row of star icons | Star ratings | S11 |
| Opaque click‑tracking URLs (e.g. an ESP redirect) | Links: tracking + deep links + UTM | S12 |
| Local image paths (e.g. `something_files/…`) | Images → media library / dynamic media | S13 |
| A "Recommended for you"/"You may also like" grid | Recommendation tray | S14 |
| Content that varies by member tier, region, store | Conditional content | S15 |
| Nothing visible, but reporting/reconciliation is mentioned | Execution metadata | S16 |
| Unsubscribe / "view online" / legal footer | Compliance links | S17 |
| **Any value that can vary by customer/event/product** | **Data‑source resolution (do this first)** | S0 |

---

# S0 — Data‑source resolution (the master scenario — resolve this before anything dynamic)

**Recognize it when:** you're about to personalize *any* value (a name, price, product list, image, URL). Before writing the expression you must know **where the value comes from**.

**AJO pattern — pick the source in this priority order:**
- **Profile attribute** — persistent customer data: `profile.person.name.firstName`; tenant‑custom under `profile._<tenantId>.…` (e.g. `profile._luma.identities.shopperId`).
- **Journey context** — values available during execution: `context.journey.…`.
- **Event payload** — the triggering event's data: `context.journey.events.\`<eventId>\`.…` (numeric IDs **must** be backtick‑escaped).
- **Dataset lookup** — reference/catalog data that does not live on the profile (e.g. a product catalog, store directory, or offer table). There are **two distinct kinds — confirm which one applies**, because they are configured and accessed completely differently:
  - **Journey-contextual dataset lookup (performed on the AJO journey canvas):** the lookup is configured as a **Lookup action on the journey canvas**, and its result is passed *into* the email as a contextual variable. The email does **not** perform the query — it simply reads the already-resolved rows the journey handed down, at `context.journey.datasetLookups.\`<resultId>\`.entities` (a numeric/string result ID must be backtick-escaped, as shown). Prefer this when the lookup is shared across journey steps, or when the matching key comes from journey/event context.
  - **In-email (inline) dataset lookup:** the lookup is performed **inside the email template itself** with the `{{datasetLookup datasetId="<datasetId>" id=<key> result="x"}}` helper, which queries the dataset at render time and returns the row matching `<key>`. Prefer this when the lookup is local to this one message and the key is already available in the template.

**Ask the user if unclear:**
- Is this email **triggered by an event** (and if so, what's in the event payload) or **audience/segment‑based**?
- For each dynamic value: does it live on the **profile**, in the **event payload**, in **journey context**, or in an **AEP dataset** (lookup)?
- **Don't ask for the tenant namespace or schema paths — discover them** from this sandbox's XDM schema yourself (XDM tools / `discover-personalization-paths`). Only confirm with the user *which* discovered field a value maps to when it's ambiguous. (Never invent paths.)
- If a dataset lookup is involved: is it a **journey-contextual lookup** (a Lookup action on the canvas whose result is passed into the email as a variable) or an **in-email inline `datasetLookup`** call (run inside the template at render time)? What is the **dataset ID / result ID**, and the **primary key** used to match a row?

---

# S1 — Structure re‑serialization (raw HTML → Visual Designer format)

**Recognize it when:** the input is generic email HTML — nested `<table>`s, arbitrary `<head>`, no `acr-container`/`acr-structure`/`acr-component` classes.

**AJO pattern:** wrap the body in `div.acr-container`; break the email into full‑width `1-1-column` Structures (one per logical section); paste each section's original markup into a `data-component-id="html"` component; replace the `<head>` with the required Visual Designer `<head>` (content‑version meta + the named style blocks) plus any brand CSS. The `html` component is the workhorse — most of the email lives there.

**Ask the user if unclear:**
- Should the result be **drag‑and‑drop editable in the Visual Email Designer** (native format), or is Compatibility mode acceptable?
- Is this a **content template**, a **fragment**, or both?
- Any brand CSS / web‑font blocks to carry over into `<head>`?

---

# S2 — Global variables (campaign‑level constants)

**Recognize it when:** UTM parameters, a campaign name, an email ID, or preheader text are hard‑coded and repeated throughout the input.

**AJO pattern:** hoist them into a `{% let %}` block in the first Structure so they can be reused downstream (AJO variables are visible to later components/sections):
```handlebars
{% let utm_campaign = "n_shopbag_PD" %}
{% let utm_source   = "N_triggered" %}
{% let preHeaderTxt = "Shop now before it's gone." %}
```

**Ask the user if unclear:**
- What are your **UTM conventions** (source/medium/campaign/term) and how is `utm_campaign` derived (e.g., from the email name)?
- Is there an **Email ID / campaign ID** scheme?
- Should the preheader text/URL be variables here?

---

# S3 — Reusable chrome → Content Fragments

**Recognize it when:** the input has a standard header/logo/ticker bar and a footer (social, legal, loyalty) that would repeat across many emails.

**AJO pattern:** author each as a **Content Fragment** and embed **by reference** with the live helper (never inline the HTML, never use a `data-fragment=` attribute):
```handlebars
{{!-- [acr-start-fragment] --}}{{ fragment id="ajo:<uuid>" name="<name>" mode="inline" }}{{!-- [acr-end-fragment] --}}
```
A fragment can also define shared variables (e.g. `utmLinkParams`, `enterpriseId`) that the rest of the template consumes.

**Ask the user if unclear:**
- Do **header/footer/global fragments already exist** in this sandbox (give me the fragment IDs), or should I create new ones?
- Which parts are shared/reusable vs. unique to this email?
- Do any existing fragments define shared variables I should rely on (UTM link params, enterprise ID, etc.)?
- *(Note: you'll see exported/imported templates use `data-fragment-ref="ajo:…" data-fragment-legacy="true"` — that's the legacy representation; author new embeds with the `{{ fragment }}` helper.)*

---

# S4 — Preheader

**Recognize it when:** hidden preview text sits near the top of the body.

**AJO pattern:** static span or conditional linked version:
```handlebars
{%#if isNotEmpty(preHeaderUrl)%}
  <a href="{{{preHeaderUrl}}}?{{{utmLinkParams}}}preheader">{{{preHeaderTxt}}}</a>
{%else%}<span>{{{preHeaderTxt}}}</span>{%/if%}
```

**Ask the user if unclear:** What's the preheader copy? Static text or a linked/clickable preheader?

---

# S5 — Product feed / item module (the core scenario)

**Recognize it when:** the input shows one or more **repeated product blocks** (image + brand + name + price + CTA, maybe stars). In the input these are usually **hard‑coded** sample products.

**AJO pattern:** replace the hard‑coded block(s) with a single **template** rendered inside a loop over a data collection, extracting each field with fallbacks:
```handlebars
{% let product_arr = context.journey.datasetLookups.`<lookupId>`.entities %}
{{#each product_arr as |product|}}
  {% let label   = titleCase(product._<tenant>.productDetails.label ?: "null") %}
  {% let clickUrl= product._<tenant>.productDetails.url ?: "null" %}
  … product markup with {{{label}}}, {{{clickUrl}}}, etc. …
{{/each}}
```

**Ask the user if unclear:**
- **Where do the products come from** (event payload / dataset lookup / profile array)? What's the collection path and the per‑item field paths?
- **How many** products should render (max)? Is there a fixed layout (single hero vs. grid)?
- What's the **sort order** (see S6)?
- Which fields are shown per product (brand, name, price, image, rating, CTA)?
- Any **fallback** behavior when a field is missing?

---

# S6 — Sorting

**Recognize it when:** product order appears meaningful (e.g., biggest discount first, highest price first).

**AJO pattern:** `topN(array, numericField, amount)` sorts descending and takes N (`bottomN` for ascending):
```handlebars
{% let sorted = topN(product_arr, _<tenant>.productDetails.sellingRetailPrice, 2000) %}
```

**Ask the user if unclear:** Sort by which field, ascending or descending? How many to keep?

---

# S7 — Eligibility filtering / suppression

**Recognize it when:** there's any implication that not every candidate product should appear (out of stock, discontinued, region‑restricted, excluded tags).

**AJO pattern:** wrap the rendered product in a multi‑condition `{%#if%}`:
```handlebars
{%#if salabilityStatus = "SELLABLE"
  and isShipAvailable = "true"
  and availableQuantity >= 5
  and isDeleted = "N"
  and indexOf(enticementTags, excludeValue) = -1 %}
  … render …
{%/if%}
```

**Ask the user if unclear:**
- What makes a product **eligible to show** (status, stock threshold, shippable, not deleted)?
- Any **exclusions** (enticement tags, restricted audiences, SKU prefixes)?
- What's the **minimum stock** threshold, if any?

---

# S8 — Counters / limits / accumulators

**Recognize it when:** "show up to N," or a need to record which products were shown (for reporting/reconciliation).

**AJO pattern:** initialize a variable before the loop and **reassign** it inside (AJO `{% let %}` can be reassigned to accumulate):
```handlebars
{% let counter = 1 %}
{% let sku_list = "" %}
{{#each sorted as |product|}}
  {%#if counter <= 4 %}
    {% let sku_list = concat(concat(sku_list, ","), skuId) %}
    {% let counter = counter + 1 %}
    … render …
  {%/if%}
{{/each}}
```

**Ask the user if unclear:** What's the display cap? Do you need a **list of shown SKUs** logged for message feedback/reporting (see S16)?

---

# S9 — Price handling (sale vs. was)

**Recognize it when:** two prices appear — a highlighted current price and a struck‑through original.

**AJO pattern:** if prices arrive as separate fields, output each; if they arrive as one combined string (e.g. `"new|old"` from an event map), split with `replace` + `trim`:
```handlebars
{% let pair = get(context.journey.events.`<eventId>`._<tenant>.productTrigger.priceDropSKUs, skuId) %}
{% let salePrice = trim(replace(pair, "\\|.*", "")) %}
{% let wasPrice  = trim(replace(pair, ".*\\|", "")) %}
```
Then `${{{salePrice}}}` and `<span style="text-decoration:line-through">${{{wasPrice}}}</span>`.

**Ask the user if unclear:**
- Where do sale and original prices come from — **separate fields** or a **combined string** (what delimiter/format)?
- Any **currency formatting** needed (or is the value pre‑formatted)?
- Which price is keyed per product (by SKU?) vs. on the catalog record?

---

# S10 — Text transforms (casing, truncation)

**Recognize it when:** brands render in a specific case, or long product names would overflow.

**AJO pattern:**
```handlebars
{% let label = titleCase(rawLabel) %}
{% let name  = rawTitle %}
{%#if length(rawTitle) > 50 %}{% let name = concat(substr(rawTitle, 0, 45), "...") %}{%/if%}
```

**Ask the user if unclear:** Preferred casing for brand/name? Truncation length and ellipsis behavior?

---

# S11 — Star ratings

**Recognize it when:** a row of full/half/empty star icons appears.

**AJO pattern:** coerce the rating to a number, bucket it with an `else if` ladder, render star images conditionally:
```handlebars
{% let rating = productRating + 0.0 %}
{% let stars = "0" %}
{%#if rating > 4.99%}{% let stars = "5" %}
{%else if rating > 4.49%}{% let stars = "4.5" %}
… {%else%}{% let stars = "0" %}{%/if%}
```

**Ask the user if unclear:** Where's the rating value? Half‑star support? What are the star image URLs (full / half / empty)?

---

# S12 — Links: tracking, deep links, UTM

**Recognize it when:** links point at an **opaque ESP click‑tracking redirect** (a long encoded URL) instead of the real destination.

**AJO pattern:** replace with the real destination, AJO link‑type attributes, and shared UTM params (unescaped output for the URL):
```html
<a data-nl-type="DEEPLINK" data-tracking-type="DEEPLINK"
   href="{{{clickUrl}}}?{{{utmLinkParams}}}pd_hero&color={{color}}{{{redirect}}}">SHOP NOW</a>
```
Common `data-nl-type` values: `DEEPLINK`, `mirrorPage` (view‑online), `unsubscription`.

**Ask the user if unclear:**
- What is the **real destination URL** source (a product field? a pattern?)?
- Which links should be **tracked / deep links**, and how do you want UTM params appended (is there a shared `utmLinkParams` variable/fragment)?
- Any redirect/passthrough parameters to append?

---

# S13 — Images: local files → media library / dynamic media

**Recognize it when:** `<img src>` points at **local paths** (e.g. `brand_files/foo.jpg`) or an external CDN.

**AJO pattern:** two cases —
- **Brand chrome hosted in AEM:** the `<img>` needs all three attributes or it won't resolve: `data-medialibrary-id`, `data-mediarepo-id`, `data-medialibrary-source="aem"` — resolve them with **`get_aem_image_embed_instructions`** (this server doesn't look them up; the IDs come from the separate AEM MCP server).
- **Personalized product images:** point `src` at the product's image field, optionally a dynamic‑media/Scene7 URL with transforms: `src="{{{primaryImageUrl}}}?trim=color&crop=pad&w=1024&h=1024"`.

**Ask the user if unclear:**
- Are the static images in **AEM** (I'll need to resolve the media‑library IDs by name/folder), on a CDN, or elsewhere?
- For product images, what's the **image URL field**, and are dynamic‑media transform params expected?

---

# S14 — Recommendation tray (recTray)

**Recognize it when:** there's a "Recommended for you"/"You may also like" grid — often visually similar to the product feed but conceptually different.

**AJO pattern:** this is frequently **not** a data collection but a **recommendation‑service URL**. Build the image/link endpoints once with `concat`, then render fixed slots appending a per‑slot index:
```handlebars
{% let catRecUrl = concat(concat(baseURL,"url"), coreParams) %}   {{!-- + apikey, placement, shopper_id, style_id, offset= --}}
```
```html
<a href="{{{catRecUrl}}}0{{{passthrough}}}0{{{redirect}}}"><img src="{{{catRecImg}}}0"></a>
<a href="{{{catRecUrl}}}1{{{passthrough}}}1{{{redirect}}}"><img src="{{{catRecImg}}}1"></a>
… slots 2…N …
```

**Ask the user if unclear:**
- Is this grid powered by a **recommendation service** (endpoint URL, API key, placement, shopper ID source) or is it **another dataset feed** to iterate?
- **How many slots**? What's the per‑slot indexing/offset scheme?
- Same tracking/UTM treatment as the main products?

---

# S15 — Conditional content (tier / region / status)

**Recognize it when:** blocks vary by loyalty tier, membership, store/region, or a promo banner that only some recipients see.

**AJO pattern:**
```handlebars
{%#if equalsIgnoreCase(loyaltyStatus, "Icon") or equalsIgnoreCase(loyaltyStatus, "Luminary") %}
  … VIP banner …
{%/if%}
{%#if isNotEmpty(credBnrDeskImg) and isNotEmpty(credBnrMobImg) %} … loyalty banner … {%/if%}
```
Guards: `isNotNull/isNull` for objects, `isNotEmpty/isEmpty` for strings.

**Ask the user if unclear:** What are the variant conditions, and which data fields drive them? What's the default/fallback content?

---

# S16 — Execution metadata (message feedback / reconciliation)

**Recognize it when:** the user mentions reporting, reconciliation, or downstream analytics — usually invisible in the rendered email.

**AJO pattern:**
```handlebars
{{executionMetadata key="campaignId" value=utm_term}}          {{!-- unquoted = dynamic variable --}}
{{executionMetadata key="campaignType" value="MARKETING_TRIGGERED"}}   {{!-- quoted = literal --}}
{{executionMetadata key="skuIds" value=metadata_sku_list}}
```

**Ask the user if unclear:** What metadata keys does your reporting/reconciliation need (campaign ID, type, banner, shown SKUs)? Which are literals vs. computed?

---

# S17 — Compliance links (unsubscribe, view‑online, legal footer)

**Recognize it when:** there's an unsubscribe link, "View Online," and legal footer text.

**AJO pattern:** use the AJO link types:
```html
<a data-nl-type="mirrorPage" data-tracking-type="MIRROR_PAGE">View Online</a>
<a data-nl-type="unsubscription" data-tracking-type="OPT_OUT"
   href="…/email-opt-out?enterpriseId={{{enterpriseId}}}&{{{utmLinkParams}}}unsub">Unsubscribe</a>
```

**Ask the user if unclear:** What's the unsubscribe URL pattern and where does the identifier (enterprise/subscriber ID) come from? Any dynamic legal/copyright content (e.g., current year)?

---

# Master clarifying‑question list (grouped — ask what's relevant to the detected scenarios)

**Message type & data**
- Is this **event‑triggered** or **audience‑based**? What triggers it, and what's in the event payload?
- **Tenant namespace & schema paths:** discover these from the sandbox's XDM schema yourself (don't ask the user); only confirm *which* discovered field a value maps to when it's ambiguous.
- For each dynamic value: **profile / journey context / event payload / dataset lookup**?
- If a dataset lookup is used: **journey-contextual** (Lookup action on the canvas → passed in as a variable) or **in-email inline `datasetLookup`** (dataset id + key)?

**Products / feed**
- Product **collection source** and **per‑item field paths**?
- **Max products** to show; hero vs. grid layout?
- **Sort** field and direction?
- **Eligibility rules** (status, stock threshold, shippable, exclusions)?
- Do you need a **list of shown SKUs** logged?
- Price fields (separate vs. combined string; delimiter; currency formatting)?
- Rating source; half‑star support; star image URLs?
- Name/brand casing and truncation length?

**Links & images**
- Real **destination URLs** (field or pattern)?
- **UTM** convention and shared `utmLinkParams` source?
- Tracking types needed (deep link, mirror page, unsubscribe)?
- Where are **static images** (AEM media library? CDN?) and what are the **product image** fields/transforms?

**Recommendations**
- Rec **service** (endpoint, API key, placement, shopper‑id source) or another **dataset feed**? How many slots?

**Reuse, conditions, compliance**
- Existing **fragments** to reuse (IDs) or create new? Any shared variables they expose?
- **Conditional** content variants and the fields that drive them?
- **Metadata** keys for reporting?
- **Unsubscribe** URL + identifier source; dynamic legal content?

**Output**
- Must it be **Visual‑Designer editable** (native format)? Template, fragment, or both? **content‑version** to target?

---

# Non‑negotiable guardrails (apply to every output)

- **Triple vs. double brace:** `{{{ }}}` for anything in a URL/attribute/raw markup; `{{ }}` only for HTML‑escaped plain text.
- **Numeric event/lookup IDs must be backtick‑escaped:** `context.journey.events.\`123\``.
- **Native Visual Designer format** (the full spec is returned by **`get_visual_designer_requirements`**) or the user loses drag‑and‑drop editing: `body#acr-body` → `div.acr-container` → `div.acr-structure[data-structure-id][data-structure-name]` → `th.colspanN` → `div.acr-component[data-component-id]`; required `<head>` copied verbatim; don't send the `acr-content-status` meta on authoring.
- **Beautify and comment every block of raw HTML you author.** Emit cleanly-formatted markup (consistent indentation, one element/block per line, no minified single-line soup). AJO accepts **two comment forms — use the right one for what you are annotating:**
  - **`{{!-- … --}}` (handlebars comments)** for the **personalization logic** — variable declarations, loops, conditionals, sorting/suppression. AJO strips these at render (they never reach the inbox), and they are the same form AJO's own markers use. Examples drawn from a real template: `{{!-- Global Variables and the logics to be defined here --}}`, `{{!-- dataset lookup output results --}}`, `{{!-- sort the products based on the highest new price --}}`, `{{!-- only show up to 4 products --}}`, `{{!-- increment eligible product counter --}}`.
  - **`<!-- … -->` (HTML comments)** to **label layout sections/components** in the rendered markup, usually as BEGIN/END pairs around a block. Examples: `<!-- BEGIN PREHEADER -->` … `<!-- END PREHEADER -->`, `<!-- BEGIN NAVIGATION -->` … `<!-- END NAVIGATION -->`, `<!-- brand -->`, `<!-- Name -->`, `<!-- Price -->`, `<!-- star rating -->`, `<!-- CTA Section -->`, `<!-- BEGIN FOOTER -->` … `<!-- END FOOTER -->`.
  - **Preserve AJO's own markers verbatim** — the fragment markers `{{!-- [acr-start-fragment] --}}` / `{{!-- [acr-end-fragment] --}}` and any product-block markers such as `<!--BLOCK_METADATA_PREFIX-{…}-BLOCK_METADATA_POSTFIX-->` — and never let a comment or reformatting change the required `acr-*` nesting or the verbatim `<head>`.
- **Embed fragments by reference** (`{{ fragment … }}`), never inline; never use a `data-fragment=` attribute.
- **Don't invent** function names, attribute paths, schema fields, or IDs. If a field like `replace`, `trim`, `substr`, `titleCase`, the `?:` fallback operator, or the `if(cond,a,b)` function is needed, use it as shown here but **verify against the AJO personalization syntax library (`get_personalization_syntax`)** before introducing anything new.
- **Fallbacks everywhere:** `?:` for defaults, `isNotEmpty`/`isNotNull` guards for optional data.
- When two or more required inputs are missing, **stop and ask** (batched) rather than assuming.

---

## Quick syntax cheat‑sheet (for reference while asking/building — the authoritative library is **`get_personalization_syntax`**)

| Need | Form |
|---|---|
| Output escaped text | `{{value}}` |
| Output raw (URL/attr) | `{{{value}}}` |
| Evaluate inline | `{%= fn(args) %}` |
| Declare / reassign var | `{% let x = expr %}` |
| Default value | `expr ?: "fallback"` |
| Inline conditional value | `if(cond, a, b)` |
| Block conditional | `{%#if c%}…{%else if c2%}…{%else%}…{%/if%}` |
| Loop | `{{#each arr as \|item\|}}…{{/each}}` |
| Sort + take N | `topN(arr, numericField, n)` / `bottomN(...)` |
| Read map by key | `get(map, key)` |
| Strings | `concat`, `length`, `indexOf`, `replace`, `trim`, `substr`, `titleCase`, `equalsIgnoreCase` |
| Numeric coercion | `value + 0.0` |
| Guards | `isNotEmpty`/`isEmpty` (strings), `isNotNull`/`isNull` (objects) |
| Helpers | `{{ fragment … }}`, `{{ executionMetadata … }}`, `{{ datasetLookup … }}`, `{{ url … }}` |
| Event / lookup data | `context.journey.events.\`<id>\`.…`, `context.journey.datasetLookups.\`<id>\`.entities` |
