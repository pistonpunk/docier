# docier

A DOCX editor for the browser, written in TypeScript.

`docier` opens a `.docx`, lets a person edit it, and writes a valid `.docx` back. It is a library
rather than an application: you mount it into an element, configure it with one object, drive it
through commands and observe it through events. It is framework-agnostic, has one runtime dependency,
and ships an optional module for document templates.

[![CI](https://github.com/pistonpunk/docier/actions/workflows/ci.yml/badge.svg)](https://github.com/pistonpunk/docier/actions/workflows/ci.yml)

## The problem it solves

Most browser editing is HTML editing. You type into a `contenteditable`, the browser decides where the
text goes, and a converter guesses at a `.docx` afterwards. That works until the document matters: the
line breaks are not the ones that print, the page breaks are not the ones Word would choose, and each
conversion loses something.

`docier` treats the `.docx` as the document and computes the layout itself. Text is positioned from a
computed layout rather than from what the browser happened to do, so the page you see and the page that
prints are the same page. Documents from Word keep their markup, including the parts `docier` does not
understand, so re-saving a contract does not quietly remove things.

## Install

```
npm install docier
```

## Quick start

```ts
import { createEditor } from 'docier'
import { mountChrome } from 'docier/ui'

const bytes = await fetch('/contract.docx').then((r) => r.arrayBuffer())

const editor = createEditor('#editor', {}, { document: bytes })
mountChrome(editor)

editor.events.on('docier:doc:change', () => scheduleSave(editor.document))
```

`createEditor(target, config, options)` where `target` is an element or a selector:

- `config` is a deep-partial configuration object; every key has a default.
- `options.document` accepts a `Uint8Array`, `ArrayBuffer`, `Blob`, or an already-parsed package or
  model. `options.zoom` and `options.render` are also accepted here.

The call is safe to repeat: mounting twice on the same element returns the first handle, and `destroy()`
is idempotent.

## Using it

Everything the user can do is a command. Every state change is an event.

```ts
editor.commands.execute('docier.command.format.bold')
editor.commands.execute('docier.command.insert.table', { rows: 3, columns: 4 })

const bold = editor.commands.describe('docier.command.format.bold')
// { enabled: true, active: false, ... }

const blocked = editor.commands.describe('docier.command.table.deleteRow')
// { enabled: false, reason: 'The caret is not inside a table' }
```

A command that cannot run tells you why. Nothing is silently inert, and nothing reports success while
doing nothing: `describe` returns a reason, and executing a blocked command returns a structured status
carrying the same reason.

Events follow the same naming scheme, `docier:<area>:<verb>`, with the cancellable ones named
`before<Verb>`:

```ts
editor.events.on('docier:selection:change', ({ from, to }) => updateToolbar(from, to))
editor.events.on('docier:doc:beforechange', (event) => {
  if (!confirmDiscard()) event.preventDefault()
})
```

## Exporting

PDF export is a separate entry point, so an application that never exports never loads it.

```ts
import { exportPdf } from 'docier/pdf'

const { bytes, report } = await exportPdf(editor.layout, { pdfa: 'a-2b' })
```

The exporter renders the same computed layout the screen renders. It does not re-run layout, re-measure
text, or consult the document for any position. That is what makes the screen and the printed page agree
rather than approximately agree. Glyph advances come from the same font measurement the layout used, and
a font whose metrics disagree is reported rather than substituted.

Output is deterministic: the same document produces byte-identical bytes, verified across separate
processes. Missing fonts and missing images are reported as losses rather than silently omitted.

Printing is available too, with page ranges shared by the print and PDF paths.

## Document templates

Optional, a separate entry point, and off unless enabled. An application that does not use templates
never loads it.

A token is a real Word **content control**. It is the same mechanism Word itself uses for fillable
fields, which means a template stays a valid `.docx` that a person can open and edit in Word, with the
fields still working. Placeholders are not a special text syntax that only `docier` understands.

```ts
import { createTokenAttachment, fillTemplate } from 'docier/tokens'

const tokens = createTokenAttachment(editor, { catalogue, locale: 'ro-RO' })
tokens.data.setData({ 'employee.surname': 'Popescu' })

const { bytes, issues } = await fillTemplate({ template, catalogue, data, locale: 'ro-RO' })
```

The catalogue is the backend's authority. A template that references a field the catalogue does not
define is reported rather than rendering as blank, and a value that is missing is both reported by code
and shown as a visible placeholder. A contract must never print a silently empty name.

Filling runs headlessly: bytes in, bytes out, no DOM and no network, so a server can fill a template
without a browser.

## What it handles

- **DOCX fidelity.** Round-trips a real `.docx`, preserving markup it does not model as raw bytes rather
  than dropping it. Unicode is preserved exactly, not normalised.
- **Layout.** Line breaking, justification, hyphenation points, widow and orphan control, keep-with-next
  and keep-lines-together, page breaks, sections, columns, tab stops, borders and shading.
- **Tables.** Column resolution, all three row height rules, row splitting across pages, repeating header
  rows, merged cells, nested tables, and editing inside cells.
- **Headers, footers and page fields.** Default, first-page and even/odd variants, with `PAGE`,
  `NUMPAGES`, `SECTION` and `SECTIONPAGES` resolved to real values.
- **Styles.** The full cascade: document defaults, table styles and conditional formatting, numbering,
  paragraph and character styles with their `basedOn` chain, and direct formatting, with Word's toggle
  semantics.
- **Editing.** Caret and selection, Word's navigation keys, typing, splitting and joining, clipboard with
  a model-content buffer, undo and redo with one entry per gesture, and 112 commands.
- **Chrome.** Ribbon with tabs and groups, context menus on every surface, a floating selection toolbar,
  a ruler, a status bar, and theming through CSS custom properties.

## Requirements

Evergreen browsers: Chrome and Edge 120+, Firefox 121+, Safari 17.4+.

The floor is set by capability rather than version. `docier` uses `CompressionStream`, `Intl.Segmenter`
for locale-aware line and word breaking, the Popover API, `structuredClone`, and ES modules with
top-level await. There are no polyfills for older browsers.

**Fonts are not bundled.** You supply them. This keeps the package small and leaves font licensing with
you, but it means text will not render correctly until you wire up the fonts your documents use. See
`docs/` for the requirement.

### The font integration contract

Layout happens before paint and without a browser, so the engine cannot ask a font file how wide a run
is. It measures through a `TextMeasurer`, and the widths it returns are the widths the renderer has to
produce. That makes three things your responsibility, and they have to agree with each other:

1. **Supply the face bytes.** Read the TTF or OTF files you are licensed to serve, keyed by the family
   names and the four styles (regular, bold, italic, bold italic) the documents actually ask for.
2. **Register screen faces for every document family name.** The browser paints with fonts resolved from
   CSS, so a family the page does not know falls back to something else and the painted run will not be
   the width the engine reserved. A document asks for `Calibri`, `Times New Roman` or `Arial`, not for
   the name of the file you happen to ship. Declare only the styles you can actually serve: a `@font-face`
   with no file behind it makes the browser substitute a font the measurer never saw, which is worse than
   leaving the style out and letting the family's regular face answer for it.
3. **Build the measurer from the same bytes.** `createFontMeasurer({ faces })` takes `{ family, bold,
   italic, bytes }` records and returns a `TextMeasurer` that reads real `hmtx` advances and `cmap`
   coverage, segments text exactly like the built-in model (combining marks and variation selectors stay
   with their base), and reports a face id the PDF exporter can verify against the font it embeds. Pass
   it as `layout.measurer`:

   ```ts
   import { createEditor, createFontMeasurer } from 'docier';

   const measurer = createFontMeasurer({
     faces: [
       { family: 'Calibri', bold: false, italic: false, bytes: regularBytes },
       { family: 'Calibri', bold: true, italic: false, bytes: boldBytes },
     ],
     fallbackFamily: 'Calibri',
   });

   const handle = createEditor(host, { layout: { measurer }, /* ... */ });
   ```

`layout.measurer` is a reload key, so setting a different measurer lays the document out again with it;
`updateConfig({ layout: { measurer: other } })` takes effect on the next layout rather than mutating the
painted page in place.

If no measurer is supplied the engine falls back to a deterministic advance model, which is legible in
tests but is not a font: real faces are 14 to 30 percent wider, so with that model adjacent runs overlap
and right-aligned text runs past the margin. That is the failure you see when only the screen `@font-face`
rules were wired up.

Check that what you fetched really is a font. A development server that answers a missing file with its
own HTML page returns `200 OK` and markup, and font bytes are parsed rather than trusted, so a placeholder
page in the place of a face is an error rather than a silent fallback.

The full worked example is the demo host in `example/src/fonts.ts` and `example/src/main.ts`: it loads the
faces, registers the screen aliases, and hands the same bytes to `createFontMeasurer`.

## Status

Version 0.x. Under active development, CI on every push, 1,200+ assertions.

**Working:** everything listed under "What it handles".

**Not yet:** templates with repeating sections and conditionals; inserting images and shapes, as opposed
to rendering ones already in a document; comments; footnotes; find and replace; proofing; and editing a
header or footer from the UI. See `agent_progress.md` for the current state and `docs/SPEC.md` for the
full design.

## Architecture

For contributors, and for anyone who wants to know why the page you see is the page that prints.

There is one layout engine and two renderers. The engine produces an immutable layout result in
millipoints; the screen renderer paints it into the DOM and the PDF exporter paints it into a file. No CSS
takes part in layout, the point-to-pixel conversion happens in exactly one place, and zoom is a paint
scale that never triggers a re-layout. The constraint is enforced by a test that fails if the renderer
imports the layout layer, so the two cannot drift apart through inattention.

The document model is a typed view over the parsed XML rather than a structure rebuilt from it. That is
what lets unmodelled markup survive an edit, and it is why an unknown element in a contract is still
there after a save.

See `docs/SPEC.md` for the full design and `docs/adr/` for the decisions behind it.

## Licence

Dual-licensed: **AGPL-3.0-only** for open source, or a **commercial licence** for proprietary use.

The AGPL covers use over a network, so it applies to a hosted product as well as a distributed one. If
that does not suit your project, a commercial licence is available. See `LICENSE` and `COMMERCIAL.md`.
