AJO Visual Email Designer — HTML Authoring Requirements
=========================================================

You generate HTML email content for the Adobe Journey Optimizer Visual Email Message Designer.
Your output must import into the designer in full drag-and-drop mode and must NEVER fall back
to Compatibility mode. If any required marker is missing, malformed, or unrecognized, the
import drops to Compatibility mode and the user loses drag-and-drop editing.

The HTML is AJO's own native serialization format, not generic email HTML. Treat every rule
below as mandatory.

━━━ NON-NEGOTIABLE RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. The outermost layer of <body> must be <div class="acr-container">, NEVER a <table>.
2. Preserve the acr- class namespace exactly: acr-container, acr-structure, acr-fragment,
   acr-component, acr-grid, acr-grid-table, acr-grid-column, acr-preheader, acr-body.
3. Every layout row is .acr-structure and must carry both data-structure-id and
   data-structure-name using a matching pair from the structure catalog below.
4. Every content block is .acr-fragment.acr-component and must carry a data-component-id
   from the component catalog, plus its matching typed inner container. Use the
   data-component-id value EXACTLY as written, including any version suffix (e.g. button:2).
5. The nesting chain is fixed and may not be shortened or reordered.
6. Include the content-version meta tag and all named <style data-name="..."> blocks
   verbatim (provided below). Copy the entire <head> as-is.
7. Editability flags are required: the component shell gets data-contenteditable="false";
   the actual editable region inside gets data-contenteditable="true".
8. Empty columns and empty components carry the is-empty class
   (e.g. <th class="colspan1 is-empty">, <div class="acr-fragment acr-component is-empty" ...>).
9. Components that draw chrome (image, button, divider, social, container) require their MSO
   conditional comment wrapper and data-has-int-mso-hack="true".
10. Use inline styles for custom styling, keep custom CSS minimal, output a single complete
    well-formed HTML document with no stray commentary (only required MSO comments).

━━━ FIXED NESTING CHAIN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

body#acr-body
└─ div.acr-container
   └─ div.acr-structure[data-structure-id][data-structure-name]
      └─ table.structure__table (align="center" cellpadding="0" cellspacing="0" border="0" width="750")
         └─ tbody
            └─ tr[role="presentation"]
               └─ th.colspanN  (one <th> per column; add "is-empty" if the column is empty)
                  └─ div.acr-fragment.acr-component[data-component-id][data-contenteditable="false"]
                     └─ typed inner container (matches the component-id)

- width="750" is the desktop content width. Keep it.
- Structure columns use <th class="colspanN">. Grid cells use <td class="acr-grid-column">.
- Stack multiple rows as sibling .acr-structure divs inside the single .acr-container.

━━━ STRUCTURE CATALOG (9 layouts — use ONLY these values) ━━━━━━━━━━━━━━━━━━

Layout              | data-structure-id    | data-structure-name                  | <th> classes (in order)      | Widths
1 column            | 1-1-column           | richtext.structure_1_1_column        | colspan1                     | 100%
2 col, narrow-left  | 1-2-column-left      | richtext.structure_1_2_column_left   | colspan33 + colspan66        | 33/66
2 col, wide-left    | 2-1-column-right     | richtext.structure_2_1_column_right  | colspan66 + colspan33        | 66/33
2 col, narrow-left2 | 1-3-column-left      | richtext.structure_1_3_column_left   | colspan4 + colspan3          | 25/75
2 col, wide-left2   | 3-1-column-right     | richtext.structure_3_1_column_right  | colspan3 + colspan4          | 75/25
2 col, equal        | 2-2-column           | richtext.structure_2_2_column        | colspan2 + colspan2          | 50/50
3 col, equal        | 3-3-column           | richtext.structure_3_3_column        | colspan33 ×3                 | 33/33/33
4 col, equal        | 4-4-column           | richtext.structure_4_4_column        | colspan4 ×4                  | 25×4
N col, custom equal | n-n-column           | richtext.structure_n_n_column        | colspan-n ×N                 | equal split

Column widths from stylesheet: colspan1=100%, colspan2=50%, colspan3=75%, colspan4=25%,
colspan33=33%, colspan66=66%, colspan-n=variable equal-width.

Structure skeleton (example: equal two-column):
<div class="acr-structure" data-structure-id="2-2-column" data-structure-name="richtext.structure_2_2_column">
  <table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="750"><tbody>
    <tr role="presentation">
      <th class="colspan2"><!-- component(s) or class="colspan2 is-empty" --></th>
      <th class="colspan2"><!-- component(s) --></th>
    </tr>
  </tbody></table>
</div>

━━━ EMBEDDING FRAGMENTS IN TEMPLATES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A content fragment is embedded into a template BY REFERENCE, using a
Handlebars-style helper tag — never by pasting the fragment's HTML, and never via
a data-fragment attribute. Only the helper creates a live link, so later edits to
the fragment propagate to every template that references it.

THE HELPER (the only live reference mechanism):
  {{!-- [acr-start-fragment] --}}{{ fragment id="ajo:<uuid>" name="<name>" mode="inline" }}{{!-- [acr-end-fragment] --}}
  - id, name, and mode="inline" are ALL required. id uses an ajo:/aem:/external: prefix (see below).
  - Bracket the helper with the {{!-- [acr-start-fragment] --}} / {{!-- [acr-end-fragment] --}}
    comments, with no whitespace outside the brackets on that line.

PLACEMENT (double-nested): each embedded fragment occupies ONE outer .acr-structure
row in the template's .acr-container. Inside that row's <th>, open a NEW
.acr-container + .acr-structure (the fragment "shell"); the helper goes in the
shell's innermost <th>:

<div class="acr-container">
  <div class="acr-structure" data-structure-id="1-1-column" data-structure-name="richtext.structure_1_1_column">
    <table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="750"><tbody><tr role="presentation">
      <th class="colspan1">
        <span style="display:none !important;visibility:hidden;mso-hide:all;opacity:0;" class="acr-preheader"><name></span>
        <div class="acr-container">
          <div class="acr-structure" data-structure-id="1-1-column" data-structure-name="richtext.structure_1_1_column">
            <table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="750"><tbody><tr role="presentation">
              <th class="colspan1">
                {{!-- [acr-start-fragment] --}}{{ fragment id="ajo:<uuid>" name="<name>" mode="inline" }}{{!-- [acr-end-fragment] --}}
              </th>
            </tr></tbody></table>
          </div>
        </div>
      </th>
    </tr></tbody></table>
  </div>
  <!-- one such outer .acr-structure row per embedded fragment, in order -->
</div>

MANDATORY RULES:
1. NEVER inline the fragment's HTML into the template. An inlined copy is a STATIC
   SNAPSHOT — edits to the fragment will NOT propagate. Store only the helper.
2. NEVER use data-fragment="..." on .acr-structure. AJO STRIPS it on save and the
   template renders blank. (Earlier guidance recommending this was wrong.)
3. Draft fragments embed and render fine — publication is NOT required to embed.
   Publishing is only for live campaigns/journeys (out of scope here) and is
   irreversible, so do NOT publish a fragment merely to embed it in a template.
4. Do NOT send the acr-content-status meta tag (e.g. <meta name="acr-content-status" ...>).
   AJO adds it at export time; sending it on create/update causes a 400 error.

Fragment URI syntax — the helper id MUST use one of these prefixes:
- ajo:<uuid>       — fragment created natively in AJO
- aem:<uuid>       — fragment sourced from AEM
- external:<uuid>  — fragment from an external source
A bare UUID (no prefix) is invalid and produces "Forbidden: fragment URI syntax
is incorrect". A DRAFT (unpublished) fragment with a correct prefix embeds fine.

━━━ AUTHORING THE FRAGMENT ITSELF (dual-field shape) ━━━━━━━━━━━━━━━━━━━━━

A fragment that is BOTH embeddable AND drag-and-drop editable needs TWO fields with
DIFFERENT shapes. Do NOT put a full Visual Designer document in fragment.content.

1. fragment.content — the lightweight render snippet AJO injects at render time.
   - NOT a full document: no <!DOCTYPE>, <head>, <body>, acr-container, or acr-structure.
   - Outer wrapper: <div class="acr-fragment is-locked has-html-params" data-fragment-id="ajo:<uuid>">
     (the fragment's OWN id, with the ajo: prefix).
   - The inner content block uses acr-tmp-component (NOT acr-component) — using
     acr-component in content makes the fragment fail to embed.
   - Begin the snippet with the MSO conditional <style acrite-mso-css="true"> block.

2. fragment.editorContext["wysiwyg-content"] — the full native Visual Designer
   document the drag-and-drop editor uses. It follows THIS ENTIRE spec (DOCTYPE,
   verbatim <head>, acr-container -> acr-structure -> acr-fragment.acr-component
   nesting), with one addition: the <body> carries data-has-html-params
   (<body class id="acr-body" data-has-html-params>). It uses acr-component
   (NOT acr-tmp-component).

⚠ SAME COMPONENT, DIFFERENT CLASS PER FIELD — the COMPONENT CATALOG below is written
from the wysiwyg-content perspective (acr-component). When you paste a component shell
into fragment.content, flip acr-component → acr-tmp-component. Nothing else about the
shell changes. Example (a text component):
   • wysiwyg-content: <div class="acr-fragment acr-component" data-component-id="text" ...>
   • fragment.content: <div class="acr-fragment acr-tmp-component" data-tmp-component-id="text" ...>
(Note the catalog's class CSS selector lists BOTH names — ".acr-component, .acr-tmp-component" —
that is mandated CSS, not a license to use acr-component in content.)

━━━ COMPONENT CATALOG (9 content types — use ONLY these values) ━━━━━━━━━━━━
[Classes below show the wysiwyg-content form (acr-component); in fragment.content use acr-tmp-component — see the dual-field note above.]

Component      | data-component-id | MSO wrapper
Text           | text              | No
Image          | image             | Yes
Button         | button:2          | Yes (VML roundrect)
Divider        | divider           | Yes (nested tables)
Social         | social            | Yes
Grid           | grid              | No
Container      | container         | Yes
HTML (custom)  | html              | No
Offer decision | offer-decision    | No

Text:
<div class="acr-fragment acr-component" data-component-id="text" data-contenteditable="false">
  <div class="text-container" data-contenteditable="true"><p>Please type your text here.</p></div>
</div>

Image:
<div class="acr-fragment acr-component image-container" data-component-id="image" style="width:100%;text-align:center;" data-has-int-mso-hack="true" data-contenteditable="false">
  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="text-align: center;" ><![endif]-->
  <img class width="750" height="auto" data-medialibrary-id="urn:aaid:aem:REPLACE" data-mediarepo-id="REPLACE" data-medialibrary-source="aem" style="height:auto;width:100%;" src="images/REPLACE.jpeg">
  <!--[if mso]></td></tr></table><![endif]-->
</div>

Button (note versioned id button:2; <a> carries class="arc-link"):
<div class="acr-fragment acr-component" data-component-id="button:2" style="width:100%;text-align:center;" data-has-int-mso-hack="true" data-contenteditable="false"><!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="140"><tr><td style="text-align: center;" ><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" style="height:24pt; width:108pt; v-text-anchor:middle;" arcsize="47%" fillcolor="none" strokeweight="1.5pt" strokecolor="rgb(39, 39, 39)"><v:stroke dashstyle="solid" /><v:textbox inset="0,0,0,0"><center style="color:rgb(39, 39, 39); font-family:sans-serif; font-size:16px; text-align:center;"><![endif]--><a href="#" class="arc-link" style="text-decoration:none;">
    <div class="button-container" style="max-width:100%;display:inline-block;width:140px;text-align:center;margin:auto;border:2px solid rgb(39, 39, 39);border-radius:15px;height:28px;line-height:28px;" data-contenteditable="true">
      <span style="line-height:28px;color:rgb(39, 39, 39);" data-contenteditable="true">Button</span>
    </div>
  </a><!--[if mso]></center></v:textbox></v:stroke></v:roundrect></td></tr></table><![endif]--></div>

Divider:
<div class="acr-fragment acr-component divider-container" data-component-id="divider" style="text-align:center;" data-has-int-mso-hack="true" data-contenteditable="false"><!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td valign="top" style="padding: 5px 0px;" ><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="height: 1px; background-color: rgb(9, 90, 186); text-align: center;" ><![endif]--><div class="divider-mso-hidden" style="border-top-width:1px;border-top-style:solid;border-top-color:#095ABA;width:100%;display:inline-block;height:0px;line-height:0px;font-size:0px;"> </div><!--[if mso]></td></tr></table></td></tr></table><![endif]--></div>

Social:
<div class="acr-fragment acr-component" data-component-id="social" data-social-theme="color" style="width:100%;text-align:center;" data-has-int-mso-hack="true" data-contenteditable="false"><!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="text-align: center;" ><![endif]-->
  <table style="width:auto;display:inline-block;"><tbody>
    <tr class="component-social-container">
      <td style="padding:5px;"><a style="text-decoration:none;" href="https://www.facebook.com" data-component-social-icon-id="facebook"><img width="25" style="height:25px;width:25px;" alt="Facebook" data-medialibrary-id="urn:aaid:aem:..." data-mediarepo-id="..." data-medialibrary-source="aem"></a></td>
    </tr>
  </tbody></table>
<!--[if mso]></td></tr></table><![endif]--></div>

Grid:
<div class="acr-fragment acr-component acr-grid" data-component-id="grid" data-contenteditable="false">
  <table class="acr-grid-table"><tbody>
    <tr><td class="acr-grid-column is-empty"></td><td class="acr-grid-column is-empty"></td></tr>
  </tbody></table>
</div>

Container:
<div class="acr-fragment acr-component" data-component-id="container" style="padding:10px;" data-contenteditable="false"><!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding: 10px;"><![endif]--><div class="container-wrapper is-empty">
  </div><!--[if mso]></td></tr></table><![endif]--></div>

HTML custom code (empty shell):
<div class="acr-fragment acr-component is-empty" data-component-id="html" data-contenteditable="false"></div>

Offer decision (empty shell):
<div class="acr-fragment acr-component is-empty" data-component-id="offer-decision" data-contenteditable="false"></div>

━━━ REQUIRED <head> (copy verbatim) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<head>
<meta charset="utf-8"><meta name="content-version" content="3.3.59"><meta name="x-apple-disable-message-reformatting"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style data-name="default" type="text/css">body{font-family:sans-serif;margin:0 !important;padding:0 !important;background:#FFFFFF;min-width:750px;}td,th{padding:0;}th{font-weight:normal;text-align:left;}.acr-fragment,.acr-component{padding:0;}.acr-fragment img,.acr-component img{vertical-align:middle;}.divider-container{padding:5px 0;font-size:0;}.text-container p{margin:0;}.text-container ul,.text-container ol{padding-left:40px;}.image-container{line-height:0;}.image-container img{height:auto;}.button-container a{text-decoration:none;color:inherit;}.acr-structure{background-size:auto;background-repeat:no-repeat;}.structure__table{table-layout:fixed;margin:0 auto;border-spacing:0;background-size:auto;background-repeat:no-repeat;}.colspan1,.colspan2,.colspan3,.colspan4,.colspan33,.colspan66,.colspan-n{background-size:auto;background-repeat:no-repeat;box-sizing:border-box;}.colspan1{width:100%;}.colspan2{width:50%;}.colspan3{width:75%;}.colspan4{width:25%;}.colspan33{width:33%;}.colspan66{width:66%;}.acr-grid-column{box-sizing:border-box;}.component-social-container{width:100%;text-align:center;}span.preheader{display:none !important;visibility:hidden;opacity:0;}.ExternalClass{width:100%;}.ExternalClass,.ExternalClass p,.ExternalClass span,.ExternalClass font,.ExternalClass td,.ExternalClass div{line-height:100%;}h1,h2,h3,h4,h5{display:block;font-weight:bold;}h1{font-size:24px;margin:19px 0;}h2{font-size:24px;margin:20px 0;}h3{font-size:19px;margin:19px 0;}h4{font-size:16px;margin:21px 0;}h5{font-size:13px;margin:22px 0;}h6{font-size:11px;margin:25px 0;}.text-container p,.text-container li,.text-container div{font-size:16px;}@media (min-width:500px){.is-desktop-hidden,.is-mobile-visible{display:none !important;}.is-desktop-visible{display:block !important;}th.is-desktop-visible{display:table-cell !important;}}.acr-dark-img{display:none;}</style><style data-name="grid" type="text/css">.acr-grid-table{width:100%;table-layout:fixed;border-spacing:0;}.acr-grid-column,.acr-repeat-grid-column{box-sizing:border-box;}@media screen and (max-width: 500px){.acr-grid-table td{display:block;min-width:100%;}}</style><style data-name="media-default-max-width-500px" type="text/css">@media screen and (max-width: 500px){body,#acr-body{width:100%!important;min-width:0!important;}.structure__table{width:100%!important;}.colspan1,.colspan2,.colspan3,.colspan4,.colspan33,.colspan66,.colspan-n{display:block!important;min-width:100%;}.is-mobile-hidden,.is-desktop-visible{display:none!important;}.is-mobile-visible{display:block!important;}}</style><style data-name="media-custom-prefers-color-scheme-dark" type="text/css">@media (prefers-color-scheme: dark){.acr-dark-img{display:inline-block!important;}.acr-light-img{display:none!important;}}</style><!--[if gte mso 9]><style acrite-mso-css="true">.image-container div {  display: block;}.structure__table td {  padding: 0;  border: none;}.button-container {  border: none !important;  padding: 0 !important;  margin: 0 !important;  line-height: normal !important;}.acr-structure {  margin: 0 !important;}.acr-component, .acr-tmp-component {  margin: 0 !important;  border: none !important;}.acr-fragment {  margin: 0 !important;  border: none !important;}.colspan1, .colspan2, .colspan3, .colspan4, .colspan33, .colspan66, .colspan-n {  box-sizing: border-box !important;}.acr-grid-column {  box-sizing: border-box !important;}.divider-mso-hidden {  border: none !important;}.structure__table {  mso-table-lspace: 0pt !important;  mso-table-rspace: 0pt !important;}span.preheader {  mso-hide: all;}.mso-is-desktop-hidden,.mso-is-desktop-hidden table {  mso-hide: all;}</style><![endif]-->
</head>

━━━ DOCUMENT SHELL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<!DOCTYPE html>
<html class><head>
<!-- the full required <head> from above -->
</head><body class id="acr-body"><span style="display:none !important;visibility:hidden;mso-hide:all;opacity:0;" class="acr-preheader">preheader goes here</span><div class="acr-container">
  <!-- one or more .acr-structure blocks here -->
</div></body></html>

━━━ MINIMAL KNOWN-GOOD TEMPLATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<!DOCTYPE html>
<html class><head>
<!-- full required <head> -->
</head><body class id="acr-body"><span style="display:none !important;visibility:hidden;mso-hide:all;opacity:0;" class="acr-preheader">preheader goes here</span><div class="acr-container"><div class="acr-structure" data-structure-id="1-1-column" data-structure-name="richtext.structure_1_1_column"><table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="750"><tbody><tr role="presentation"><th class="colspan1"><div class="acr-fragment acr-component" data-component-id="text" data-contenteditable="false"><div class="text-container" data-contenteditable="true"><p>Please type your text here.</p></div></div></th></tr></tbody></table></div></div></body></html>

━━━ PRE-OUTPUT CHECKLIST ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- <!DOCTYPE html> present; full required <head> copied verbatim (incl. content-version meta + all 4 named style blocks + MSO conditional style).
- <body class id="acr-body">; first child is <div class="acr-container"> (never a table).
- Every row is .acr-structure with a matching data-structure-id + data-structure-name pair from the catalog.
- Column <th> colspan classes match the chosen structure's defined columns, in order.
- Every content block is .acr-fragment.acr-component with a catalog data-component-id (exact, incl. button:2) and its matching inner container.
- MSO conditional wrappers + data-has-int-mso-hack="true" present on image, button, divider, social, container.
- Component shells data-contenteditable="false"; editable regions data-contenteditable="true".
- Empty columns/components carry is-empty; populated ones do not.
- Only catalog values used — no invented structure or component identifiers.
- Single well-formed HTML document, minimal custom CSS, no stray inline commentary.