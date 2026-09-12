# docier

A Word-compatible **DOCX editor for the browser**, written in TypeScript.

DOCX is the native format, not an export target: docier parses a `.docx`, holds an OOXML-faithful
document model, lays it out, edits it, and writes a valid `.docx` back. It is framework-agnostic — plain
DOM chrome in the core, driven through commands and observed through events — and it ships an optional
tokenization module for document templates.

```ts
import { createEditor } from 'docier'
import { mountChrome } from 'docier/ui'

const editor = createEditor('#app', { document: { source: bytes } })
mountChrome(editor)

editor.commands.execute('docier.command.format.bold')
editor.events.on('docier:doc:change', ({ patches }) => save(patches))
```

## Why it exists

Browser editors either emulate a word processor or embed one behind a server. docier takes the position
that a document editor should be a library, that DOCX is the document, and that what you see must be
exactly what prints.

## Architecture

One engine owns layout. Two painters render it.

```
.docx bytes
   │  ooxml: ZIP + prefix-preserving XML + part registry
   ▼
document model ── layout engine ──► LayoutResult (immutable, millipoints)
   (OOXML-faithful)                        │
                                           ├──► DOM painter   (screen)
                                           └──► PDF painter   (paper)
```

**The engine is the only layout authority.** The renderer positions one absolutely-positioned box per run
from engine coordinates, and no CSS participates in layout. Point-to-pixel conversion happens in exactly
one function. Zoom is a pure paint scale that never re-runs layout. The PDF exporter paints the *same*
`LayoutResult` — it is never a DOCX-to-PDF conversion through LibreOffice or any external converter,
because that would reintroduce a second layout engine and the drift this architecture exists to prevent.

The invariant is enforced mechanically rather than by review: a contract test reads the renderer's source
and fails if it imports the layout layer, so the renderer cannot re-run layout even by accident.

**"Exact" means screen equals print, and both are faithful to the DOCX semantics** — not pixel-identical
to Microsoft Word. Nothing in a browser is, including LibreOffice, ONLYOFFICE and Word Online. And it is
not required here: templates are authored in docier, so Word is never in the loop and there is nothing to
be exact *with* except itself.

## Design commitments

- **Unknown markup is preserved, never dropped.** Documents come from Word full of things this library
  does not model. Re-saving must not destroy them. Unmodelled parts pass through as raw bytes.
- **Everything is a command; every state change is an event.** One surface for actions and observation, so
  any host can drive the library and the token module is just another consumer.
- **Unicode is preserved, not normalised**, on save. A name's byte representation must not change because
  we re-saved the file.
- **Deterministic output.** The same document produces byte-identical bytes, proven across separate
  processes. This is why `fflate` is a dependency: the platform's compressor is not reproducible across
  engines, and determinism cannot be met without pinning it.
- **A command that cannot run says why.** No control is silently inert, and nothing reports success while
  doing nothing.
- **No fonts and no dictionary data are bundled.** Both are host-supplied, which keeps the package small
  and leaves licensing with the host.

## The tokenization module

Optional, its own entry point, off by default. A host that does not enable it never loads it.

A token is a real Word **content control** (`w:sdt`) whose tag is the field code, so a template stays a
valid `.docx` that can be opened and edited in Word itself.

```ts
import { createTokenAttachment, fillTemplate } from 'docier/tokens'

const tokens = createTokenAttachment(editor, { catalogue, locale: 'ro-RO' })
tokens.data.setData({ 'employee.surname': 'Popescu' })

const { bytes, issues } = await fillTemplate({ template, catalogue, data, locale: 'ro-RO' })
```

Fill runs **headless** — bytes in, bytes out, no DOM and no network — so a backend can fill a template
without a browser. A missing value is reported by code *and* rendered visibly, because a contract must
never print a silently blank name.

## Requirements

Evergreen browsers: Chrome/Edge 120+, Firefox 121+, Safari 17.4+. The floor is capability-based —
`CompressionStream`, `Intl.Segmenter` (locale-aware line and word breaking for Romanian and Russian),
`Popover API`, `structuredClone`, ESM with top-level await. No legacy polyfills.

## Status

Under active development. Verified by the test suite and CI on every push.

**Working:** DOCX round trip with unmodelled markup preserved; the document model including styles with
the real cascade and Word's toggle semantics, numbering, tables and sections; layout with line breaking,
pagination, widow and orphan control, keeps, and full table layout with row splitting and repeating
headers; a paint-only renderer with a divergence detector; the editor with caret, selection, navigation,
mutation and undo; 112 registered commands with honest availability; clipboard with a model-content
buffer; the chrome — ribbon, menus, context menus, ruler, status bar; and the tokenization module.

**Not yet:** loops and conditionals in tokens; block-level tokens spanning paragraphs; objects (authoring
images and shapes); comments, headers, footers and footnotes — these need the transaction snapshot widened
beyond the document body, which is the largest remaining architectural gap; find and replace; and
proofing.

## Licence

Dual-licensed: **AGPL-3.0-only** for open source, or a **commercial licence** for proprietary use. See
`LICENSE` and `COMMERCIAL.md`.
