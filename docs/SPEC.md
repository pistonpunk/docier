# docier — Consolidated Specification

**Status:** authoritative. This document supersedes the five domain drafts in `docs/spec/`, which are kept
for provenance only. Where a domain draft and this document disagree, this document wins.
**Scope:** the whole library — document model and file layer, layout engine, editing and formatting,
objects and UI chrome, public API, tokenization module, and cross-cutting quality.

**Provenance.** Consolidated from `docs/spec/01-document-model-and-export.md` (73 features),
`02-layout-engine.md` (67), `03-editing-and-formatting.md` (70: 39 `ED-*` plus 31 `FM-*`),
`04-objects-and-ui.md` (71) and `05-tokens-api-and-quality.md` (76): 357 feature entries, merged here into
**328**. Nothing was dropped: every source id appears in §3, and where two drafts specified the same
deliverable the entry carries both ids.

**Reading the ids.** Source ids are stable and are kept as the audit trail (`PKG-01`, `LE-004`, `ED-023`,
`FM-021`, `OBJ-25`, `UI-08`, `TOK-01`, `API-03`, `QUA-16`, …). They are not a dependency graph; use the
module names below. Cross-references in the drafts that name a sibling spec by number are unreliable — each
draft numbered the others differently, and §1.6 records the mapping.

---

## 1. Architecture

### 1.1 Package and module breakdown

**One npm package, `docier`, ESM-only, subpath exports, no monorepo.** The drafts variously assumed
`@docier/core`, `@docier/pdf` and per-framework packages; the repository's `package.json` (single package
`docier`, `"type": "module"`, `sideEffects: false`) is the ground truth and is correct. `@docier/*` is used
only for genuinely separate packages — the framework bindings.

```jsonc
// package.json — exports, normative
{
  "name": "docier",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".":                    { "types": "./dist/index.d.ts",             "import": "./dist/index.js" },
    "./server":             { "types": "./dist/server/index.d.ts",      "import": "./dist/server/index.js" },
    "./pdf":                { "types": "./dist/export/pdf/index.d.ts",  "import": "./dist/export/pdf/index.js" },
    "./tokens":             { "types": "./dist/tokens/index.d.ts",      "import": "./dist/tokens/index.js" },
    "./testing":            { "types": "./dist/testing/index.d.ts",     "import": "./dist/testing/index.js" },
    "./style.css": "./dist/style.css"
  }
}
```

Rules:

- **Import boundaries are enforced by lint, and violations fail the build.** `src/export/pdf/**` imports no
  DOM and no `src/ui/**`; `src/tokens/**` is imported by nothing in the core (the core sees only the
  `TokenController | null` interface); `src/server/**` reaches no DOM global.
- The core entry point contains **no reference to `window`, `document`, `navigator`, `localStorage`,
  `matchMedia`, `ResizeObserver` or `IntersectionObserver`** at module scope. DOM-touching code lives behind
  the renderer/ui entries and is loaded by dynamic `import()` inside `mount()`.
- The tokenization module is a separate entry with its own bundle-size budget, imported by the host only if
  it enables it.
- Framework bindings are separate packages (`@docier/react`, `@docier/vue`, `@docier/svelte`) of ~20 lines
  each. The core has zero framework dependencies. The repository's root `tsconfig.json` sets
  `"jsx": "react-jsx"`, which is a **defect for a framework-agnostic core** and must be removed; JSX belongs
  to the binding packages only.

Internal layout of `src/`:

| Directory | Owns | Source features |
|---|---|---|
| `src/model/` | The canonical OOXML tree: parts, relationships, nodes, addressing, property cascade inputs, styles, numbering, theme, settings, sections, annotations, content controls, media registry, document properties | `PKG-*`, `MOD-*`, `STY-*`, `NUM-*`, `THM-*`, `SET-*`, `SEC-*`, `ANN-*`, `SC-*`, `MED-*`, `PRO-*` |
| `src/ooxml/` | Parse and serialise pipelines, part passthrough, dirty tracking, schema handling, fidelity ledger | `SER-*`, `EXD-*`, `INT-*` |
| `src/layout/` | The layout engine and `units.ts`; the only producer of `LayoutResult` | `LE-*` |
| `src/render/` | The paint-only DOM renderer, page surface, overlays, virtualisation, the divergence detector's render half | `LE-002`, `LE-003`, `LE-066` |
| `src/editing/` | Caret and selection state, input pipeline, IME, history, clipboard, find, proofing, protection | `ED-*` |
| `src/format/` | Formatting and style commands, the effective-formatting query surface over the engine's resolved bags | `FM-*` |
| `src/objects/` | The object model and its manipulation commands (images, shapes, text boxes, groups) | `OBJ-*` |
| `src/ui/` | Default chrome: menu bar, ribbon, rulers, status bar, dialogs, context menus, panels, mini-toolbar, theming | `UI-*` |
| `src/api/` | `createDocier`, config, command registry, event bus, plugin host, slots, diagnostics, errors | `API-*` |
| `src/tokens/` | The optional tokenization/templating module (entry `docier/tokens`) | `TOK-*` |
| `src/export/` | DOCX, PDF, HTML, Markdown, plain text, print | `EXP-*`, `EXO-*` |
| `src/i18n/` | Message catalogues, the shared locale formatter, ro/ru specifics | `QUA-09`…`QUA-15` |
| `src/server/` | Headless entry: fill and DOCX I/O with no DOM | `API-21`, `ED-039` |
| `src/testing/` | Corpus runner, comparators, fixture helpers (entry `docier/testing`) | `INT-01`, `QUA-20` |

### 1.2 Single source of layout truth (the spine)

Everything else in this specification is consistent with the following, which is not negotiable and is
inherited from the layout draft:

1. **The engine's immutable `LayoutResult` is the only layout authority.** The browser never lays out text.
   The engine computes every line break, page break, baseline and box edge in its own coordinate system
   before any DOM node exists.
2. **The DOM is a paint-only renderer.** One absolutely positioned box per `RunFragment`; no element
   participates in flow; `white-space: pre` with no wrapping opportunity; no geometry is ever read back from
   the DOM except by the divergence detector.
3. **The unit is the integer millipoint (`Mp`, 1/1000 pt).** `LayoutResult` contains no floats, no `Date`,
   no locale-dependent formatting, no `Math.random`. Origin is the top-left of page 1; the y axis is
   continuous across pages.
4. **pt → px happens in exactly one function**, `toCssPx(mp, zoom)` in `src/layout/units.ts`, and nowhere
   else. The PDF writer never calls it; it calls `toPt(mp)` and consumes the same numbers. An ESLint
   `no-restricted-syntax` rule forbids the `/1000`, `/750`, `*0.75`, `*1.3333` family outside `units.ts`.
5. **Zoom is a paint scale that never re-runs layout.** One scalar into `toCssPx` for geometry *and*
   `font-size`; changing zoom must not invalidate a `LayoutResult` (asserted by `documentHash` equality).
   Zoom is not a CSS `transform: scale()` on the page element (a transient pinch preview is allowed, with
   hit testing suppressed until it settles).
6. **A rendered-DOM-vs-engine divergence detector runs in dev and in CI** (`LE-005`): a flat 0.5 CSS px
   tolerance per run, 0 px on page count and page size; any exceedance emits `LayoutDivergence` with the
   document hash, the fragment, both widths and the resolved font, and fails the job. It also asserts PDF
   parity: a browser screenshot at zoom 1 and a rasterised PDF page from the same `LayoutResult` differ only
   within rasteriser anti-aliasing tolerance.
7. **PDF parity is by construction**: the PDF writer receives the same `LayoutResult` the renderer received,
   re-shapes nothing and re-breaks nothing, so a feature that "works on screen but not in the PDF" is a
   renderer bug by definition.

Consequences that bind the rest of the document:

- A design change to on-screen spacing is made in the engine and appears in the PDF too.
- The font registry is an input to layout and part of `documentHash`; a font change invalidates layout, a
  zoom change does not.
- Caret, selection, hit testing and the find-highlight overlay are pure functions of `LayoutResult`, built
  from fragment rects, painted on layers independent of page content.
- Revision-mark display state (`w:settings`) is a layout input and part of `documentHash`.

### 1.3 The layout pipeline (dependency order)

15 passes plus two sub-passes, four bounded loops. Every pass is a pure function of the model plus the
outputs of the passes it depends on; passes are individually cacheable and individually invalidatable. This
order is load-bearing — the non-obvious edges are listed after it.

| # | Pass | Consumes | Produces | Depends on |
|---|---|---|---|---|
| **P0** | Ingest and style resolution | OOXML tree, styles, theme, numbering, settings | Normalised tree with flat, fully resolved property bags; no style indirection remains | — |
| **P1** | Sectioning and page setup | P0 | Ordered sections: page size, margins, gutter, columns, header/footer refs, borders, `vAlign`, line numbering, per-section block ranges | P0 |
| **P2** | Font resolution and metrics | P0, P1, font registry, embedded fonts | Concrete font per character run; `FontMetrics` parsed from the font binaries | P0, P1 |
| **P3** | Shaping and inline atomization | P0, P2 | `InlineAtom[]` per paragraph: glyph clusters with advances, tabs, breaks, inline drawings, note refs, field results; measured `xAdvance` in mp | P2 |
| **P4** | Bidi and paragraph direction | P0, P3 | Per-atom bidi level, paragraph base direction, logical→visual run order | P3 |
| **P5** | Intrinsic width measurement | P3, P4 | Per block: `minWidth` (widest unbreakable unit) and `preferredWidth` | P3, P4 |
| **P6** | Table column resolution | P5 (recursively), P1 | Every table grid resolved to concrete column widths in mp | P5 |
| **P7** | Header/footer layout | P3–P6 on each header/footer story, P1 | Per (section × page kind) header/footer fragments and stack heights | P3–P6 |
| **P8** | Content box resolution | P1, P7 | Body content box **per page kind** (first/even/odd), displaced by actual header/footer heights | P7 |
| **P9** | Line breaking (P9a provisional → P9b anchors → P9c re-break) | P3, P4, P5, P8; loop L1 with P10 | `LineFragment`s: atom ranges, break positions, widths, caret stops | P8 |
| **P10** | Float, frame and exclusion resolution | P9a, P0 | Anchored object boxes, wrap polygons, exclusion bands per page/column | P9a |
| **P11** | Line assembly | P9, P10 | Baseline y, line advance, inter-atom x in visual order, ascent/descent | P9c |
| **P12** | Justification | P11 | Final x positions, exact right-edge landing | P11 |
| **P13** | Block flow and pagination | P11, P12, P5, P6; loop with P14 | Vertical machine: spacing, keeps, widow/orphan, breaks, row placement and splitting, footnote reservation; page/column assignment | P12 |
| **P14** | Footnote/endnote placement | P13, P3–P12 on note stories | Note-area fragments; displaced body lines | P13 |
| **P15** | Section balancing and break types | P13, P14 | Column balancing, even/odd forcing, section vertical alignment | P14 |
| **P16** | Page-count convergence (L3) | P7, P13–P15 | Header/footer heights and field widths re-resolved against the real page count | P15 |
| **P17** | Finalization | all | Immutable `LayoutResult`, indices, diagnostics, hash, per-page diff | all |

Edges that must not be "optimised" away: shaping (P3) before breaking (P9); intrinsic widths (P5) before
table columns (P6) before breaking; columns (P6) before headers (P7) because a header may contain a table;
headers (P7) before the content box (P8) before body breaking, because header height displaces the body top
and is page-kind dependent; anchored floats (P10) inside breaking (loop L1); justification (P12) after
assembly (P11) and never changing the atom range; pagination (P13) after justification because the vertical
machine needs caret geometry; notes (P14) after pagination and iterated (L2); balancing (P15) after
pagination; page-count convergence (P16) last.

**Loops are bounded, deterministic and self-reporting.** None may run unbounded; a non-converged loop emits
a diagnostic and freezes its last state rather than freezing the editor.

| Loop | Between | Rule | Bail-out |
|---|---|---|---|
| **L1** float exclusions | P9a ⇄ P10 ⇄ P9c | ≤3 iterations; anchor positions freeze after iteration 2 | keep last break, emit `FLOAT_UNSTABLE` with anchor ids |
| **L2** footnote displacement | P13 ⇄ P14 | ≤4 iterations per page | overflow to the next page's note area with the continuation separator; emit `NOTE_OVERFLOW` |
| **L3** page count / header | P16 ⇄ P7/P13 | ≤3 iterations | accept the **larger** page count on oscillation (Word's conservative behaviour); emit `PAGECOUNT_UNSTABLE` |
| **L4** incremental resync | scheduling, not layout | re-run the dirty suffix until a page's fragment set is identical to the previous version's | stop at the document end, re-publish the whole tail |

**Incremental contract.** Paragraph-local relayout is synchronous and always correct; pagination is
asynchronous and eventually consistent. A keystroke re-runs P3 → P9 → P11–P12 for one paragraph
synchronously, then P13 forward in a worker in time slices. Resync stops as soon as a page is structurally
identical to the previous result (unchanged pages are the same objects, so the renderer diffs by identity).
A page not yet repaginated is painted from the previous result with its pagination marked provisional, and
the scroll container keeps the previous page count so the scrollbar does not jump mid-typing. Budget: the
synchronous path p95 **< 4 ms** per typical paragraph.

**`LayoutResult` shape** (normative; fragments are plain, `readonly`, `structuredClone`-able data):

```ts
type Mp = number & { readonly __mp: true };

interface LayoutResult {
  readonly version: number;                       // monotonic per document revision
  readonly documentHash: string;                  // model + resolved styles + font registry + compat flags
  readonly pages: readonly PageFragment[];        // ordered, structurally shared with the previous result
  readonly stories: ReadonlyMap<StoryId, Story>;
  readonly indices: {
    readonly positionToFragment: (pos: DocPos) => FragmentRef;
    readonly pageToFragmentRange: PageIndex;
    readonly fragmentToPage: (pos: DocPos) => number;
  };
  readonly diagnostics: readonly LayoutDiagnostic[];
}
```

`PageFragment → BlockFragment → LineFragment → RunFragment`, plus `BoxFragment` (drawings, floats, text
boxes, shading, borders, drop caps, note areas, separators), `TableFragment → RowFragment → CellFragment`,
`NoteFragment` and `CaretStop`. Invariants asserted in `layout.invariants.test.ts`, always on: every block
fragment lies inside its page content box on x (flagged exceptions); no vertical overlap except floats,
`wrapNone`, negative spacing and `vAlign`; every model position maps to exactly one caret stop and back;
every atom is covered by exactly one fragment; nothing is dropped or duplicated except repeated header rows
(marked `repeat: true`); a justified line's right edge equals the content-box right edge exactly; the page
count equals the final `NUMPAGES` value.

### 1.4 The document model

- **OOXML is the model.** The in-memory tree is a lossless-enough projection of WordprocessingML; edits never
  route through HTML, which exists only as an export target. Unmodelled elements, attributes and parts are
  carried as preserved raw markup and re-emitted in place — "unsupported" means "untouched", never "deleted".
- **Untouched bytes stay bytes.** A part that was not modified is written back from its original compressed
  bytes. Round-trip guarantees are graded FL0–FL3 (byte-identical, semantically equivalent with **cycle
  stability**, structurally preserved, declared lossy) and every feature states its level; the loss ledger
  is reported on parse and export.
- **Node identity and addressing.** Nodes carry stable ids (not indices); mutations go through transactions
  addressed by those ids. `TextPosition = { story, paragraphId, offset, affinity }` where `offset` counts
  UTF-16 code units of the paragraph's *logical text*; `TextRange = { anchor, focus }`, order-independent.
  Positions are stable across layout and invalidated by edits; the library re-maps them through an edit and
  a host must not cache one across a command it did not issue. `StoryId` is
  `'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'comment' | 'textbox'` plus the part instance
  (`header:rId7`).
- **Logical text.** A paragraph's logical text is all `w:t`/`w:delText` content plus one character per
  structural inline (`\t` tab, `\n` break, `-` non-breaking hyphen, soft hyphen, U+FFFC inline object,
  U+0001 field-result boundary). All offsets, find/replace, proofing and word segmentation operate on
  logical text. Field *codes* are not part of it; field *results* are.
- **The property cascade resolves once, in P0**, to flat bags with no inheritance left, so no later pass can
  re-derive a property differently. Toggle properties XOR rather than override. This single implementation
  serves layout, the formatting toolbar, "reveal formatting" and every style query — see §1.6 conflict 4.
- **Units.** The model stores what OOXML stores: EMU for drawing properties, twips for text and section
  properties, half-points for `w:sz`, eighths for border widths, and the OOXML integer scale for
  percentages. Nothing is stored in px; no float geometry is stored. Conversion happens at the ingest/layout
  boundary into mp, once, through `src/layout/units.ts`.
- **Dirty tracking.** A part is dirty when its model content changed; only dirty parts are re-serialised.
  Preserved raw subtrees are emitted verbatim in their original position.
- **Determinism (R6).** Same model + same config + same library version ⇒ byte-identical export bytes. No
  wall-clock time, no UUIDs, no map-iteration-order drift.

### 1.5 The command and event surface

**Every state change is a command; every state change is observable as an event.** No code path mutates the
document directly — not autocorrect, not paste, not drag-and-drop, not IME commit, not token insertion, and
not a UI control. This is what makes the chrome replaceable and the library headless.

**Command ids** are `docier.command.<area>.<action>`, lowerCamelCase, with `<area>` from the closed set:

```
doc, edit, selection, format, style, theme, numbering, insert, table, object,
view, ui, history, clipboard, find, proof, token, data, export, a11y, dev
```

Examples: `docier.command.format.bold`, `docier.command.token.insert`, `docier.command.object.image.insert`,
`docier.command.table.insertRow`, `docier.command.doc.save`. Plugin commands use their own dotted namespace
and may not squat in `docier.command.*`: a plugin id is `<pluginId>.<area>.<action>`. Ids are stable forever;
renaming is a breaking change.

**Event names** are `docier:<area>:<verb>`, lower-case, past tense for notifications and `before<Verb>` for
cancellable requests.

**The alternative namings in the drafts are dead.** `document.changed` (03) is `docier:doc:change`;
`object.created` (04) is `docier:object:created`; `zoom.changed` is `docier:view:zoomchange`;
`command.rejected` is `docier:command:blocked`; the `edit.*` / `format.*` / `view.*` command prefixes become
`docier.command.edit.*` and so on. §1.6 has the full mapping table.

**Envelope and result.** A command executes as a transaction: the unit of undo, of `docier:doc:change`, and
of layout invalidation. It takes one plain argument object, returns a promise, and never throws for policy
refusals.

```ts
type CommandResult<R> =
  | { status: 'ok';      value: R; affectedRanges: readonly TextRange[]; invalidation: LayoutInvalidation }
  | { status: 'noop' }                                        // effect already in force: no event, no undo entry
  | { status: 'blocked'; code: DocierErrorCode; reason: LocalizedString }
  | { status: 'failed';  error: DocierError };

type LayoutInvalidation =
  | { kind: 'none' }
  | { kind: 'range';      story: StoryId; from: DocPos; to: DocPos }
  | { kind: 'paragraph';  story: StoryId; paragraphIds: readonly NodeId[] }
  | { kind: 'container';  story: StoryId }
  | { kind: 'document' };
```

Rules: `blocked` carries a code from the same closed `DocierErrorCode` set as thrown errors, plus a
localised, specific `reason` ("Select text to format", never "Unavailable"). A command whose effect is
already in force returns `noop` and emits nothing. A command that cannot be inverted must not exist. Layout
invalidation is computed by the command, never guessed by the caller; an `rPr`/`pPr` change invalidates at
least the affected paragraph range, and style/theme/numbering/`docDefaults` changes are always `document`.

**Event ordering for one command execution** is fixed and asserted as a golden trace:

```
docier:command:beforeexecute → docier:doc:beforechange → [mutation] → docier:doc:change
  → docier:history:change → docier:selection:change → docier:issues:change (if recomputed)
  → docier:render:layoutend → docier:command:execute
```

Cancellable events dispatch synchronously and `defaultPrevented` is inspected immediately after dispatch.
Notifications dispatch synchronously by default so a listener always sees a consistent document; a listener
registered with `deferred: true` is queued to a microtask. A listener that throws is caught, reported as
`docier:error` with context naming the listener, and never propagates into the caller.

### 1.6 Convention conflicts in the five drafts, and how they are settled

Each of the five drafts was written independently, and each numbered (and in places redefined) the others.
The following are the substantive disagreements found while consolidating; every one is decided here.

| # | Conflict | Sources | Resolution |
|---|---|---|---|
| 1 | **Sibling numbering.** Draft 01 calls 04 "tokenization" and 05 "UI"; 02 calls 04 "rendering" and 05 "export"; 04 calls 02 "editing-and-text" and 03 "layout-and-pagination". None matches the filenames. | 01, 02, 04 headers | Canonical **module names only** in this document: model, ooxml, layout, render, editing, format, objects, ui, api, tokens, export, i18n, server. The numeric filenames are historical. Any cross-reference in the drafts must be re-read as a module name. |
| 2 | **Unit of record.** 04: the document model stores geometry as integer EMU, floats only at the render boundary. 02: the engine's result is integer mp and `emu→mp` is "applied once, at ingest, and never again". | 04 §1, 02 §1.3 | Both, at different layers: the model stores the OOXML unit (EMU/twips/half-points/eighths) with no floats; **mp is the only geometry unit inside `LayoutResult`, hit testing, caret geometry and PDF writing**; px exists only in `toCssPx`. `emu→mp` is the single lossy conversion and happens once at the model→layout boundary. |
| 3 | **Percentages.** 04: DrawingML percentages are 1/1000 of a percent and must **never** be stored as 0–1 floats. 02: `a:srcRect` is normalised at ingest into fractions. | 04 §1, 02 `LE-053` | Store the **OOXML integer** (thousandths of a percent for DrawingML, fiftieths for `w:tblW/@w:type="pct"`) and convert to a fraction or mp only at the layout boundary. The two scales must not share a helper. |
| 4 | **Effective formatting / style cascade implemented twice.** 01/02 put cascade resolution in P0 with flat bags; 03 specifies its own cascade for runs and paragraphs (`FM-021`, `FM-022`), and `LE-008` specifies a third description of the same rules. | 01, 02, 03 | **One implementation, in P0** (`LE-008` + `FM-021` + `FM-022` merged). The editing side consumes resolved bags through a query API for the toolbar, the Font/Paragraph dialogs and reveal-formatting; it never re-resolves. This is the largest single correctness win in the consolidation, because a second cascade is exactly how the previous attempt's toolbar and page disagreed. |
| 5 | **Command naming.** 05: `docier.command.<area>.<action>`. 03: bare `edit.*`, `format.*`, `view.*`, `selection.*`. 04: `object.*`, `view.*`, `ui.*`. | 03 §1.4, 04 §2, 05 `API-06` | 05's convention wins (it owns the public API); the area set is **extended** to cover 03's and 04's namespaces (see §1.5). Bare prefixes map 1:1 by adding `docier.command.`. |
| 6 | **Command result shape.** 03: synchronous `{ ok: true, affectedRanges, layoutInvalidation } \| { ok: false, code, message }`. 05: `Promise<CommandResult<R>>` with `ok \| blocked \| noop \| failed`. | 03 §1.4, 05 `API-06` | 05's shape wins, with 03's `layoutInvalidation` retained inside the `ok` variant, and 03's "I4 silence" rule expressed as the `noop` status. All command execution is async, including for pure-model mutations (`batch` is the synchronous plugin path). |
| 7 | **Refusal and error codes, three incompatible schemes.** 05 has a closed SCREAMING_SNAKE `DocierErrorCode` union; 03 enumerates 15 rejection reasons in lower-kebab (`protected`, `read-only`, `inapplicable`, `not-found`, `empty-selection`, `document-boundary`, `clipboard-unavailable`, `layout-unavailable`, `pattern-too-complex`, `no-op-selection`, `incompatible-target`, `style-not-found`, `builtin-not-deletable`, `style-in-use-by-token`, `special-unavailable`) returned as `ok: false`; 01 defines a third set on its own `DocierParseError` (`NOT_A_PACKAGE`, `NOT_OOXML`, `WRONG_DOCUMENT_TYPE`, `LEGACY_DOC_NOT_SUPPORTED`, `PACKAGE_ENCRYPTED`, `PACKAGE_RIGHTS_MANAGED`, `DOCUMENT_TOO_LARGE`, `EXPORT_IN_FLIGHT`, `INVALID_PAGE_RANGE`, `LAYOUT_REQUIRED`). All three are closed and none overlaps. | 01 `SER-01`, 03 §4.1, 05 `API-26` | **One closed union**, spelled SCREAMING_SNAKE, in §2.8. It is 05's set (05 owns the error surface and the `DocierError` class) plus 01's package codes verbatim — 01's parse vocabulary is the right one for a package that cannot be opened, and re-spelling it would lose precision — plus 03's refusal reasons promoted one-for-one (`not-found` → `NOT_FOUND`, `style-in-use-by-token` → `STYLE_IN_USE_BY_TOKEN`, …), with `no-op-selection` dropped because it is the `noop` status, not a refusal. `LAYOUT_REQUIRED` is kept in the union but becomes unreachable for PDF export, which computes layout on demand. `blocked` results and thrown `DocierError`s draw from the same union; 03's `command.rejected` event becomes `docier:command:blocked` carrying `{ code, reason }`. |
| 8 | **Cyrillic and `w:cs`.** 02 says a Cyrillic character in a run whose `w:rFonts/@w:cs` differs from `@w:ascii` **resolves against `w:cs`**. 03 says Cyrillic is *not* a complex script, must be formatted through `ascii`/`hAnsi`, and that `w:szCs`/`w:bCs`/`w:iCs` must not apply to it. | 02 `LE-010`, 03 §1.8 | **03 is right and 02 is wrong.** ECMA-376 assigns `cs` to complex scripts only (Arabic, Hebrew, Syriac, Thaana, Devanagari family, Thai); Cyrillic and Romanian diacritics are Latin and resolve through `ascii`/`hAnsi`, with `w:hint` as the tie-breaker in mixed runs. `LE-010`'s rule is corrected to a script-itemisation table keyed by Unicode script, and a Russian fixture with a differing `w:cs` must assert it is **not** used. |
| 9 | **Text measurement.** 02 forbids `measureText` outright and shapes from the font binary. 05's performance policy measures "using canvas `measureText` for bulk measurement". | 02 `LE-015`, 05 `QUA-16` | 02 wins. Shaping and advances come from the font binary (the only method that also works in a worker and in Node for golden tests). `measureText` is permitted only in the divergence detector's verification path, never in the layout path. |
| 10 | **`contenteditable`.** 02: text is not `contenteditable` and no geometry is read back. 05 `QUA-01`: the document area is `role="document"`, `aria-multiline="true"`, `contenteditable="true"`. | 02 `LE-002`, 05 `QUA-01` | Exactly **one hidden `contenteditable` input host per instance** — the composition/clipboard/AT host from the editing draft — and it is never the painted page layer. `QUA-01`'s attribute list applies to that host and to the optional accessibility mirror, not to the run boxes. |
| 11 | **Default font set.** 02 bundles DejaVu Sans/Serif, Liberation Serif/Sans/Mono and a Cyrillic-complete serif. 05's fixtures pin Carlito/Caladea/Liberation as the metric-compatible set. | 02 §1.8, 05 `QUA-20` | One set, since both requirements are real: **Carlito** (Calibri metrics), **Caladea** (Cambria metrics), **Liberation Serif/Sans/Mono** (Times/Arial/Courier metrics), **DejaVu Sans** and a Cyrillic-complete serif for coverage. The substitution table maps DOCX names onto this set; the registry is part of `documentHash`; every substitution is a diagnostic. Licensing is ADR-0020. |
| 12 | **Mount API.** 04: `new Docier(container, { chrome: 'full' \| 'minimal' \| 'none' \| ChromeSlots })`. 05: `createDocier(options): Promise<DocierInstance>` plus `mount(target, options)`. | 04 §3, 05 `API-01` | **Functional API wins**: `createDocier()` + `mount()`. Chrome is selected by `config.ui.chrome` with the same three modes plus `ChromeSlots`; the slot names, the `data-docier="<slot>"` attributes and the `docier:command` / `docier:state` `CustomEvent` bridge from 04 are adopted verbatim, because a non-TypeScript host must be able to integrate without importing our types. |
| 13 | **Priority and effort scales.** 02: S<1wk, M 1–3wk, L 3–6wk, XL>6wk. 03: S≤3d, M≤2wk, L≤6wk, XL>6wk. 04: S≤3d, M 1–2wk, L 3–5wk, XL 6+wk. | 02 §3, 03 §1.2–1.3, 04 §1 | Adopt **03's scale** (S ≤ 3 days, M ≤ 2 weeks, L ≤ 6 weeks, XL > 6 weeks, one engineer including tests). Estimates in §3 are the source estimates, not re-estimates; where drafts disagreed the merged entry takes the **larger** effort and the strongest priority, and §1.6 conflict 14 records the largest disagreement. |
| 14 | **The cascade's cost.** 02 estimates the style-resolution pass at L; 03 estimates the same cascade (`FM-021` + `FM-022`) at two XLs — a 5× disagreement. | 02 `LE-008`, 03 `FM-021/022` | Merged at **XL**, because one implementation must satisfy both consumers (layout's flat bags and the editing side's per-run/per-paragraph queries, including numbering and table-style conditional formatting). The larger estimate is the honest one; a single L estimate for this pass was how the previous attempt shipped a cascade that disagreed with itself. |
| 15 | **PDF/A must be decided before layout.** 01 states that A-1b's transparency flattening "must be **decided before layout**, because flattening changes what layout renders", while PDF/A is `later` priority. | 01 `EXP-09` | Accepted and promoted to a gating decision: the profile is chosen in ADR-0006 **before the layout result is frozen**, even though the archival writer ships late. Choosing A-2b avoids the coupling; choosing A-1b makes flattening a layout input. |
| 16 | **Chrome delivery.** 04 explicitly leaves custom elements vs plain DOM vs per-framework adapters to "spec 05". 05 specifies slots, `ui.override()` and separate binding packages but never names a chrome technology. | 04 §5 item 2, 05 `API-16`/`API-20`/`API-23` | ADR-0010: **plain DOM renderers behind the typed slot/registry API**, no custom elements, no framework in core; bindings are thin separate packages. This keeps SSR safe and lets a host copy the default chrome. |
| 17 | **Image compression location.** 04 assumes in-browser `OffscreenCanvas`/`WebCodecs` with a host hook; the quality/PPI/codec matrix is unsettled. | 04 `OBJ-14`, 04 §5 item 3 | ADR-0011: mechanism in-browser with an injected host endpoint for batch/server paths; policy defaults are a product decision. |
| 18 | **Deferred-item labels.** 02 marks `LE-037`/`LE-043`/`LE-044`/`LE-052`/`LE-062` `later`; 04 marks `OBJ-38` `later`; 03 marks nothing `later` but defers within `important` features; 05 marks `API-18`, `TOK-24`, `QUA-11` `later`. | 02, 03, 04, 05 | `later` means **designed-for but not scheduled**, and the interface must be present so the feature is additive. The merged list preserves each draft's own label; §4 states which `later` items are nonetheless load-bearing for the architecture (the `Shaper` interface for `LE-028`/`LE-029`, the exclusion mechanism for `LE-052`, the plugin `features` registry for `API-18`). |
| 19 | **The config tree.** 05 owns the config object and gives it 16 top-level keys, but five keys it uses elsewhere in its own text (`config.units.imageDpi`, `config.images.maxPixels`, `config.preview.enabled`, `config.onError`, `config.maxInstancesPerPage`) appear in no block, and `config.preview.*` collides conceptually with `tokenization.preview.*`. Meanwhile the layout and file layers need inputs — the font set, compatibility overrides, the loop iteration caps, and worker and decompression ports — for which 05's tree has no home. | 02 §1.8, 04 §3, 05 `API-03` | 05's tree is authoritative and is extended in §2.2 by exactly two new keys, each with a stated reason: `layout` (fonts, compatibility overrides, loop limits — these are layout inputs and part of `documentHash`) and `transport` (I/O ports; `storage` is persistence and must not be overloaded with them), plus top-level `units`, `images`, `onError` and `maxInstancesPerPage` to resolve 05's own dangling references. `config.preview.*` resolves to `config.tokenization.preview.*` — preview is produced by the token module, so there is no top-level `preview`. |
| 20 | **Public-surface naming drift.** The drafts name the same fields differently: `label` vs `title`, `category` vs `area`, `execute` vs `run`, `container` vs `target`, `updateConfig` vs `configure`, `canExecute` vs `isEnabled` + `disabledReason`, `undoable` vs `reversible`, `CommandResult`'s blocked keys `code`+`reason` (05) vs `code`+`message` (03), and 03's `message` on errors vs 05's `detail`. | 03 §1.4, 04 §2, 05 `API-01`/`API-06`/`API-26` | 05 wins throughout, because it owns the public API and the host app is written against it: `label`, `category`, `execute`, `container`, `updateConfig`, `isEnabled` + `disabledReason` + `isVisible` + `isActive`, `undoable`, `{ code, reason }`, `detail`. 04's `{ id, args, source, transient? }` survives as the *execution* envelope (`ExecuteOptions.source` plus a transient flag) because it carries the source the event envelope needs; it is not a second result type. 03's `affectedRanges` and `layoutInvalidation` survive inside the `ok` variant. |

### 1.7 Where the drafts agree (and that agreement is now binding)

Worth recording, because it was checked rather than assumed:

- `w:sdt` as the canonical token storage (05 `TOK-01`) matches the content-control model of 01 (`SC-01`,
  `SC-02`, `SC-04`): the token module is a consumer of the model, not a parallel one. The tag/alias/id
  semantics and the "unknown children of `w:sdtPr` are preserved" rule agree in both.
- Word's greedy line breaking (02 `LE-023`) is consistent with 03's Word-faithful navigation and formatting
  rules; no draft proposes Knuth-Plass.
- Determinism (`R6` in 01, `LE-001` in 02, `EXP-08` in 01's export domain) is specified identically in all
  three places where it appears: no clock, no randomness, no map-order drift, pinned compression.
- The refusal semantics of 03 and the `blocked` result of 05 describe the same behaviour; only the shape
  differed (conflict 6).
- 04's "everything is a command, every state change is an event" is the same invariant as 03's `I1`; neither
  draft allowed a direct mutation, and this specification forbids one in three places on purpose.
---

## 2. Public API

One typed entry point. Everything a host or the token module needs is here; nothing requires reaching into a
subpath except `docier/server`, `docier/pdf`, `docier/tokens` and `docier/testing`, each of which exists so a
host pays for it only if it imports it. Every signature below is normative; a field named here has one
spelling and one meaning, and pages of the drafts that spell it differently are superseded.

### 2.1 Mount and lifecycle

```ts
export type InstanceState = 'created' | 'mounting' | 'ready' | 'reconfiguring' | 'destroyed';

export function createDocier(options: DocierOptions): Promise<DocierInstance>;

export interface DocierOptions {
  config?: DocierConfigPatch;
  /** Absent means a headless instance; createDocier then performs no DOM work at all (SSR-safe). */
  container?: HTMLElement | string;
  plugins?: readonly DocierPlugin[];
  document?: DocumentSource;
  tokenData?: TokenData;
}

export interface DocierInstance {
  readonly id: string;
  readonly state: InstanceState;
  readonly commands: CommandRegistry;
  readonly events: EventBus<DocierEventMap>;
  readonly document: DocumentController;
  readonly data: DataController;
  readonly tokens: TokenController | null;      // null exactly when tokenization is disabled
  readonly plugins: PluginHost;
  readonly theme: ThemeController;
  readonly ui: UIRegistry;
  readonly renderers: RendererRegistry;
  readonly layout: LayoutHandle;                // current immutable LayoutResult + relayout events
  whenReady(): Promise<void>;
  mount(target?: HTMLElement | string, options?: MountOptions): Promise<void>;
  updateConfig(patch: DocierConfigPatch): Promise<ConfigApplyReport>;
  getDiagnostics(): Diagnostics;
  export(format: ExportFormat, options?: ExportOptions): Promise<ExportResult>;
  /** Resolves once layout work has settled. For tests and for export ordering. */
  settle(): Promise<void>;
  destroy(options?: DestroyOptions): Promise<void>;
}

export interface MountOptions {
  replaceContent?: boolean;                     // default false: we append, we never adopt siblings
  inheritStyles?: boolean;                      // copy the container's computed font as the default
  height?: CSSLength;
  minHeight?: CSSLength;
  ariaLabel?: string;                           // defaults to the document title, else "Document"
  dir?: 'ltr' | 'rtl' | 'auto';                 // drives chrome mirroring; document dir comes from the model
  autoFocus?: boolean;
}

export interface DestroyOptions { flushAutosave?: boolean; reason?: string }
```

Lifecycle rules, all asserted by tests:

- `createDocier` is async because it validates config and loads non-DOM resources. It does **no DOM work**
  when `container` is absent — that is the whole SSR story, and it is why `isServer` is exported from the
  root entry.
- `state` progresses monotonically except during `reconfiguring`. `whenReady()` resolves once after `ready`
  and rejects if the instance is destroyed first.
- Instances are fully isolated: separate `w:id` allocators, event buses, undo stacks and storage namespaces
  keyed by instance id. The hard cap is `config.maxInstancesPerPage` (default 8); past it, creation fails
  with `INSTANCE_LIMIT`.
- `mount()` with the same target **moves** the instance rather than throwing; it is idempotent per target.
  A detached target rejects with `MOUNT_TARGET_DETACHED`.
- After `destroy()`, every method **rejects** with `INSTANCE_DESTROYED` rather than throwing synchronously —
  a difference that matters to a `useEffect` cleanup. `destroy()` is idempotent, disposes plugins in
  reverse installation order, aborts in-flight fetches, flushes autosave, and removes every listener,
  portal, observer and worker.
- `createDocier` is the only constructor. There is no `new Docier()`, and the drafts' constructor form is
  superseded by §1.6 conflict 12.

### 2.2 Configuration

One object, deep-merged over the defaults; arrays are replaced rather than merged, and function-valued
options always win outright. `DocierConfigPatch` is a `DeepPartial` of the real type, so a misspelled key is
a **type error**, not a silent no-op.

```ts
export interface DocierConfig {
  // --- 16 keys carried over verbatim from the API draft ---
  locale: LocaleCode;                    fallbackLocale: LocaleCode;      messages?: MessagesOverride;
  document: DocumentConfig;              editing: EditingConfig;          permissions: PermissionsConfig;
  tokenization: TokenizationConfig;      a11y: A11yConfig;                performance: PerformanceConfig;
  storage: StorageConfig;                export: ExportConfig;            theme: ThemeConfig;
  ui: UiConfig;                          keyboard: KeyboardConfig;        telemetry: TelemetryConfig;
  plugins: PluginConfig;                 debug: DebugConfig;
  // --- additions this document makes, with the reason ---
  maxInstancesPerPage: number;           // 05's dangling key, resolved here (default 8)
  onError?: (error: DocierError) => void;// 05's dangling key: observe every error, replace the message,
                                         // never swallow the diagnostic
  units: { imageDpi: number };           // 05's dangling `config.units.imageDpi` (default 96)
  images: { maxPixels: number; compression: ImageCompressionConfig };  // 05's dangling `config.images.*`
  layout: LayoutConfig;                  // fonts, compatibility overrides and the loop limits: the layout
                                         // inputs that form part of documentHash had no home in 05's tree
  transport: TransportConfig;            // worker / decompression / export-sink ports. `storage` is
                                         // persistence; I/O ports are not persistence and must not share it
}
```

Two of 05's dangling references are resolved by naming, and the rest by the tree above: `config.preview.*`
is **`config.tokenization.preview.*`** (the token module owns preview — there is no top-level `preview`),
and `config.document.docId` lives on `DocumentConfig`. `SaveMode` is `'template' | 'document'` and is a
field of the export and fill options, not a config key.

The two config types the token module and the host both consume, verbatim:

```ts
export interface TokenizationConfig {
  enabled: boolean;                              // the on/off switch; inert until exactly `true`
  storage: 'sdt' | 'text';                       // default 'sdt'
  display: 'placeholder' | 'fieldCode' | 'resolved';   // default 'placeholder'
  trigger: string;                               // default '{{'
  triggerEnabled: boolean;                       // false = the host owns the key handling
  markerSyntax: { open: string; close: string; extraPairs?: readonly [string, string][] };
  catalogue: TokenCatalogue | string | null;     // inline, or a URL fetched once at mount
  cataloguePollSeconds: number | null;
  importLegacyFields: boolean;                   // default true (MERGEFIELD and friends)
  issuePolicy: 'block' | 'warn' | 'ignore';      // default 'block': export is refused on an error issue
  keepControlsOnFill: boolean;                   // keep the w:sdt wrappers on a 'document' save
  lockBypassOnUnlink: boolean;                   // must be true to unlink a w:locked token
  loops: { wordCompatibility: boolean; maxRows: number; maxTotalRows: number; allowNested: boolean };
  preview: { enabled: boolean; sampleDateBase: IsoDate; defaultData?: TokenData };
  autoUnresolvedHighlight: boolean;
  palette: { groups: boolean; virtualizeAfter: number; recentCount: number };
  dialog: { enabled: boolean; showPreview: boolean };
}

export interface PermissionsConfig {
  readOnly: boolean;
  allow: readonly ('edit' | 'format' | 'insert' | 'insertToken' | 'editToken' | 'paste'
                 | 'fillData' | 'export' | 'saveTemplate' | 'unlinkToken')[];
  deny?: readonly string[];
  regionEnforcement: boolean;
  canEdit?(ctx: PermissionContext): boolean;
}
```

`permissions.readOnly` is a UI-level guard and is documented as such: **it is not a security boundary**, and
a host that needs one must not trust the client. Config validation draws the same line the API draft drew:
an **unknown** key produces a `config-validation` warning in `getDiagnostics()` and is otherwise ignored,
because a host shipping ahead of the library must not break; a **wrongly typed** key is a hard
`CONFIG_INVALID` rejection, because silently coercing `enabled: "true"` has cost more than it has saved.

`updateConfig(patch)` is atomic — the whole patch validates and applies, or nothing changes — and it returns
a `ConfigApplyReport` naming any key that is `requiresReload` (document source, storage adapter, shadow DOM,
the font set, OOXML conformance, chrome mode, tokenization enabled-state) instead of half-applying it. It
never resets scroll position or selection and never clears undo history: **a reconfiguration that dirties
the document is a defect.** A config may carry `version`; the library applies ordered migrations from that
version and refuses a config from a newer major with `CONFIG_VERSION_NEWER`, recording each applied
migration in diagnostics, and a migration never silently changes a value the host set explicitly.

### 2.3 Commands

Ids are `docier.command.<area>.<action>` in lowerCamelCase, with `<area>` from a **closed** set so a host can
build a menu without a curated list: `doc`, `edit`, `format`, `insert`, `table`, `token`, `data`, `view`,
`history`, `a11y`, `dev` — extended here with `selection`, `object`, `style`, `numbering`, `clipboard`,
`find`, `proof`, `export`, `ui` to cover the namespaces the editing, object and export drafts use. Ids are
stable forever; renaming is a breaking change. A plugin id is `<pluginId>.<area>.<action>` and may not
squat in `docier.command.*`.

```ts
export interface CommandRegistry {
  register<A, R>(definition: CommandDefinition<A, R>): Disposable;
  get(id: string): CommandDefinition | undefined;
  list(filter?: CommandFilter): readonly CommandDescriptor[];
  execute<A, R>(id: string, args?: A, options?: ExecuteOptions): Promise<CommandResult<R>>;
  isEnabled(id: string, args?: unknown): boolean;
  disabledReason(id: string, args?: unknown): LocalizedString | undefined;
  isActive(id: string, args?: unknown): boolean;
  setKeybinding(id: CommandId, bindings: readonly KeyBinding[]): void;   // rebinds; never changes the id
}

export interface CommandDefinition<A = void, R = void> {
  id: CommandId;
  label: LocalizedString;
  category: CommandArea;
  description?: LocalizedString;
  icon?: IconRef;
  keywords?: readonly string[];
  bindings?: readonly KeyBinding[];
  layer?: 'document' | 'chrome' | 'global';     // 'chrome' commands never touch the document or history
  undoable?: boolean;
  repeatable?: boolean;
  isVisible?(ctx: CommandContext<A>): boolean;  // should it exist in this UI at all
  isEnabled?(ctx: CommandContext<A>): boolean;  // can it run right now
  isActive?(ctx: CommandContext<A>): boolean;   // is it a toggled-on state
  disabledReason?(ctx: CommandContext<A>): LocalizedString | undefined;
  execute(args: A, ctx: CommandContext<A>): R | Promise<R>;
}

export type CommandResult<R> =
  | { status: 'ok';      value: R; affectedRanges: readonly TextRange[]; invalidation: LayoutInvalidation }
  | { status: 'noop' }                                        // effect already in force: no event, no entry
  | { status: 'blocked'; code: DocierErrorCode; reason: LocalizedString }
  | { status: 'failed';  error: DocierError };

export interface ExecuteOptions { force?: boolean; source?: EventSource; transaction?: TransactionOptions }
```

Rules that make this safe to build on:

- **The three questions are distinct and conflating them is a defect.** `isVisible` answers "should this
  exist here" (token commands when tokenization is off). `isEnabled` answers "can it run now". `isActive`
  answers "is it on". A disabled command **must** supply a specific, localised `disabledReason` ("Select
  text to format", never "Unavailable"); the built-in chrome renders it as a tooltip *and* as the
  accessible description, and shows the same string in the status bar on keyboard focus, never
  hover-only.
- `execute` never throws for an expected refusal; refusals are `blocked` with a code from the closed union,
  and a stale UI invoking a disabled command is exactly the `blocked` case. `COMMAND_NOT_FOUND` and a
  rejected `argsSchema` are `failed`.
- **`noop` is honoured centrally.** A command whose effect is already in force emits no event and writes no
  history entry — the editing draft's invariant I4, enforced at the registry so no individual command can
  forget it.
- A command is stateless and re-entrant-safe; executing a command from inside `docier:command:beforeexecute`
  for the same id is refused with `REENTRANT_COMMAND`.
- `ExecuteOptions.force` bypasses `isEnabled` for host automation but is **refused** for any block derived
  from `permissions`.
- `list()` returns cheap snapshots, not live bindings, and the documentation must say so plainly;
  descriptors are re-read after `docier:command:*` and `docier:selection:change`.
- Transient commands (a live drag) return `noop` and emit a `*.preview` event; the gesture is closed by
  exactly one non-transient commit command, so a 200-frame drag is one undo entry.
- Layout invalidation is computed by the command, never guessed by the caller. An `rPr`/`pPr` change
  invalidates at least the affected paragraph range; style, theme, numbering and `docDefaults` changes are
  always `document`; an edit inside a footnote, text box or table cell also invalidates the owning
  container; marker-only commands (formatting marks, proofing decorations, selection) declare `range` and
  must not alter text metrics.

### 2.4 Events

```ts
export interface EventBus<M extends EventMap> {
  on<K extends keyof M>(type: K, listener: (event: M[K]) => void, options?: ListenerOptions): Unsubscribe;
  once<K extends keyof M>(type: K, listener: (event: M[K]) => void): Unsubscribe;
  off<K extends keyof M>(type: K, listener: (event: M[K]) => void): void;
  onAny(listener: (type: keyof M, event: unknown) => void): Unsubscribe;   // logging and dev tooling only
}

export interface ListenerOptions { deferred?: boolean; signal?: AbortSignal; priority?: number }

export interface DocierCancellableEvent<T> {
  payload: T;
  preventDefault(): void;
  readonly defaultPrevented: boolean;
}

export type LocalizedString = string | Readonly<Partial<Record<LocaleCode, string>>>;
export type CommandId = string & { readonly __brand: 'CommandId' };
export type TokenKey = string & { readonly __brand: 'TokenKey' };
export type TokenInstanceId = number & { readonly __brand: 'TokenInstanceId' };
export type PartName = string & { readonly __brand: 'PartName' };
```

Names are `docier:<area>:<verb>`: lower case, past tense for notifications, `before<Verb>` for cancellable
requests. The catalogue is closed and typed in `DocierEventMap`; the events that matter to an integrator
first are `docier:ready`, `docier:doc:beforechange` (cancellable), `docier:doc:change`,
`docier:selection:change`, `docier:history:change`, `docier:command:beforeexecute` (cancellable),
`docier:command:execute`, `docier:command:blocked`, `docier:fill:before` (cancellable), `docier:fill:after`
(`FillSummary & { durationMs }`), `docier:issues:change`, `docier:export:before` (cancellable),
`docier:export:blocked`, `docier:export:after`, `docier:render:layoutstart`, `docier:render:layoutend`,
`docier:configchange`, `docier:error`, and the token set `docier:token:beforeinsert`, `docier:token:insert`,
`docier:token:change`, `docier:token:remove`, `docier:token:unlink`, `docier:token:unknown`,
`docier:data:change`, `docier:data:error`.

Payload rules: `docier:doc:change` carries a compact `patches` array — node id, operation, before/after
lengths — sufficient for a collaborator or an audit log without shipping the whole document.
`docier:doc:save` and `docier:export:after` are **async** notifications (the bytes already exist and the
listener is not on the critical path); their listeners are not awaited. Every event carries an envelope with
`instanceId`, `documentRevision`, `transactionId?` and `source: 'ui' | 'api' | 'undo' | 'collab' | 'auto' |
'plugin'`. The timestamp on that envelope is monotonic and for ordering only — it is never written into any
export.

The ordering for one command execution is fixed and asserted as a golden trace:

```
docier:command:beforeexecute → docier:doc:beforechange → [mutation] → docier:doc:change
  → docier:history:change → docier:selection:change → docier:issues:change (if recomputed)
  → docier:render:layoutend → docier:command:execute
```

Cancellable events are dispatched **synchronously** and `defaultPrevented` is read immediately after
dispatch. Notifications are synchronous by default, so a listener reading `instance.document` sees a
consistent document; `deferred: true` queues a listener to a microtask and is the escape hatch for
expensive host work (the built-in chrome uses it). Listeners run in `priority` order then registration
order. A throwing listener is caught, reported as `docier:error` with context naming the listener, and never
propagates into the caller. Re-entrant emission from inside a listener is refused for cancellable events and
permitted for notifications.

Two bridge forms exist because a host may not be written in TypeScript: chrome DOM carries
`data-docier="<slot>"` and `data-docier-part="<name>"`, and chrome state changes are mirrored as
`CustomEvent`s `docier:command` and `docier:state` on the container. Dispatching `docier:command` with
`{ id, args }` runs anything; reading `docier:state` gives enablement. That is the whole integration surface
for a non-TypeScript host, and it is why the chrome contract is worth more than the chrome.

### 2.5 Transactions, history and plugins

```ts
export interface TransactionController {
  run<T>(name: string, fn: (tx: Transaction) => T | Promise<T>, options?: TransactionOptions): Promise<T>;
  /** The synchronous, lightweight variant for pure-model mutations from a plugin. */
  batch<T>(fn: () => T, options?: TransactionOptions): T;
}

export interface TransactionOptions {
  undoable?: boolean;
  coalesceKey?: string;               // merges consecutive transactions with this key within the window
  label?: LocalizedString;
  selectionAfter?: SelectionTarget;
}

export interface DocierPlugin {
  id: string;                         // unique per instance; it is also the command-id prefix
  version?: string;
  docier?: string;                    // semver range checked against the running version
  optional?: boolean;                 // false = a failed install rejects the mount
  install(ctx: PluginContext): void | Disposable | Promise<void | Disposable>;
  uninstall?(ctx: PluginContext): void | Promise<void>;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly config: Readonly<DocierConfig>;
  readonly commands: CommandRegistry;
  readonly events: EventBus<DocierEventMap>;
  readonly ui: UIRegistry;
  readonly renderers: RendererRegistry;
  readonly features: DocumentFeatureRegistry;
  readonly tokens: TokenController | null;
  readonly data: DataController;
  readonly storage: PluginStorage;
  readonly logger: Logger;
  readonly disposables: DisposableStore;
}
```

A transaction is the unit of undo, of `docier:doc:change`, and of layout invalidation; nested transactions
join the outer one and only the outermost commits. A transaction that throws rolls back every mutation made
inside it and re-throws as a `DocierError` with the original as `cause`, leaving the document exactly as it
was. `coalesceKey` within `editing.coalesceWindowMs` (default 400 ms) is how typing produces one undo entry
per word-ish run rather than one per keystroke. A transaction may not be committed across an `await` if
someone else has mutated the document: it fails with `TRANSACTION_STALE` and rolls back. History is
per-instance, bounded by `editing.undoDepth` (default 200) and `editing.undoMemoryMb` (default 64), evicting
oldest-first; a command marked `undoable: false` never enters it; a command that mutates and then reverts
must be inside one transaction or dev mode reports it as a lint violation.

A plugin is installed at most once per instance and everything it registers is tracked in
`ctx.disposables` and released on uninstall — **a plugin never receives a raw registry it could leak.** A
throwing `install` reports `docier:plugin:error`, marks the plugin `failed` in `plugins.list()`, rolls back
its registrations, and continues unless `optional: false`. A plugin throwing inside an event handler or a
command is contained the same way. `ctx.features.register()` is the most powerful extension point and the
most dangerous, because it can produce documents Word cannot open: it is gated behind
`config.plugins.allowDocumentFeatures` (default `false`), and output from an extended document is validated
against a relaxed OOXML check before save, with a warning naming the plugin when the check fails.

### 2.6 The token module

The module is **inert until `config.tokenization.enabled === true`**, and that is enforced rather than
documented. With it off: no `docier.command.token.*` command is registered, no token UI is mounted,
`w:sdt` elements in an opened DOCX are preserved verbatim as opaque content, `docier.tokens` is `null`, and
the `docier/tokens` entry point is never imported. Nothing else in the library may depend on the module, and
an **import-boundary lint rule** fails the build if that changes. Bundle-size ceilings are reported per entry
point with the token module's weight broken out separately, because it must stay optional.

```ts
// docier/tokens
export interface TokenController {
  readonly catalogue: TokenCatalogue | null;
  readonly data: DataController;
  getIssues(filter?: IssueFilter): readonly DataIssue[];
  subscribeIssues(listener: (issues: readonly DataIssue[]) => void): Unsubscribe;
  refs(): readonly TokenInstanceRef[];
  resolve(ref: TokenInstanceRef): RichValue | undefined;
  /** Replaces the w:sdt with its w:sdtContent children, preserving run properties exactly. */
  unlink(ref: TokenInstanceRef | readonly TokenInstanceRef[], options?: { freeze?: boolean }): Promise<void>;
  fill(options?: { mode?: FillMode; signal?: AbortSignal }): Promise<FillSummary>;
}

export interface DataController {
  setData(data: TokenData, options?: SetDataOptions): Promise<FillSummary>;
  mergeData(patch: TokenData, options?: SetDataOptions): Promise<FillSummary>;
  getData(): Readonly<TokenData>;
  clearData(): void;
  setDataSource(source: DataSource | null): void;
  refresh(paths?: string[]): Promise<FillSummary>;
  getIssues(filter?: IssueFilter): readonly DataIssue[];
  subscribeIssues(listener: (issues: readonly DataIssue[]) => void): Unsubscribe;
  setPreview(preview: PreviewOptions | null): Promise<void>;
}

export type TokenData = Readonly<Record<string, unknown>>;

export interface SetDataOptions {
  mode?: 'replace' | 'merge';
  refill?: boolean;                    // false stores data without pushing it into the document
  source?: 'host' | 'user' | 'preview';
  signal?: AbortSignal;
}

export interface FillSummary {
  filled: number; unresolved: number; failed: number; loopsExpanded: number;
  issues: readonly DataIssue[]; durationMs: number;
}

export interface DataSource {
  id: string;
  load(request: DataRequest, signal: AbortSignal): Promise<DataResponse>;
}

export interface DataRequest {
  paths: readonly string[];
  loops: readonly { path: string; offset: number; limit: number }[];
  locale: LocaleCode;
  documentId: string;
}

export interface DataResponse {
  values: TokenData;
  loops?: Record<string, { rows: readonly TokenData[]; total?: number; nextCursor?: string }>;
  issues?: readonly DataIssue[];
}
```

`setData` replaces the whole data object; `mergeData` merges deeply at leaf level and **never element-merges
an array** — a loop's rows are replaced wholesale. Both are async (they may fetch), both resolve after the
fill pass has completed and after `docier:fill:after`, and both are idempotent: the same data twice gives
the same document and no additional undo entry. Concurrent calls are serialised, and the later call's
`AbortSignal` cancels the earlier in-flight fill, whose promise rejects with `FILL_ABORTED`. `clearData()`
returns every token to placeholder state and touches nothing else.

The catalogue is a **contract with the backend team**, so its shape is normative:

```ts
export interface TokenCatalogue {
  version: string;
  revision: number;
  generatedAt: IsoDateTime;
  defaultLocale: LocaleCode;
  tokens: readonly TokenCatalogueEntry[];
}

export interface TokenCatalogueEntry {
  key: string;
  kind: 'field' | 'image' | 'if' | 'loop' | 'agg';
  label: LocalizedString;
  description?: LocalizedString;
  group?: LocalizedString;
  order?: number;
  type: 'text' | 'number' | 'date' | 'boolean' | 'currency' | 'image' | 'rows';
  format?: TokenFormat;
  required?: boolean;
  allowEmpty?: boolean;
  sampleValue?: unknown;
  validation?: ValidationRule[];
  enumValues?: readonly { value: string; label: LocalizedString }[];
  loop?: { rowType: 'object' | 'scalar'; fields: readonly string[]; maxRows?: number;
           sort?: { key: string; direction: 'asc' | 'desc'; collation?: string } };
  permissions?: { read?: boolean; write?: boolean };
  deprecated?: { since: string; replacement?: string };
}

export interface ValidationRule {
  type: 'required' | 'regex' | 'minLength' | 'maxLength' | 'min' | 'max' | 'dateRange' | 'enum' | 'custom';
  value?: unknown;
  pattern?: string;
  flags?: string;
  message?: LocalizedString;
  validate?(value: unknown, ctx: ValidationContext): ValidationResult;
}

export interface TokenFormat {
  type: 'text' | 'number' | 'date' | 'boolean' | 'currency';
  pattern?: string;
  locale?: LocaleCode;
  currency?: string;
  dateStyle?: 'short' | 'medium' | 'long' | 'full';
  numberStyle?: 'decimal' | 'percent' | 'currency';
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  caseTransform?: 'none' | 'upper' | 'lower' | 'capitalize' | 'title';
  pluralCategory?: boolean;
}

export type RichValue =
  | { kind: 'text'; text: string; runs?: RichRun[] }
  | { kind: 'paragraphs'; paragraphs: RichParagraph[] }
  | { kind: 'html'; html: string; allowList?: HtmlAllowList }
  | { kind: 'image'; source: ImageSource; sizing?: ImageSizing; alt?: string }
  | { kind: 'docx'; bytes: Uint8Array };

export type ImageSource =
  | { kind: 'url'; url: string; cacheKey?: string }
  | { kind: 'blob'; blob: Blob | Uint8Array; mimeType: string }
  | { kind: 'dataUri'; uri: string }
  | { kind: 'placeholderFrame' };

export interface ImageSizing {
  mode: 'natural' | 'fitWidth' | 'fitBox' | 'exact';
  width?: CssLengthPx; height?: CssLengthPx;
  maxWidthPx?: number; maxHeightPx?: number;
  keepAspectRatio?: boolean;
}

export type ConditionExpression =
  | { op: 'truthy'; key: string }
  | { op: 'eq' | 'neq'; key: string; value: string | number | boolean }
  | { op: 'gt' | 'gte' | 'lt' | 'lte'; key: string; value: number | IsoDate }
  | { op: 'in' | 'notIn'; key: string; values: readonly (string | number)[] }
  | { op: 'empty' | 'notEmpty'; key: string }
  | { op: 'and' | 'or'; operands: readonly ConditionExpression[] }
  | { op: 'not'; operand: ConditionExpression };

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCode =
  | 'unknown-token' | 'value-missing' | 'value-null' | 'value-empty-required'
  | 'value-invalid-format' | 'value-invalid-rule' | 'value-type-mismatch'
  | 'condition-unresolved' | 'loop-empty-required' | 'loop-row-missing'
  | 'image-unresolved' | 'catalogue-stale' | 'catalogue-missing';

export interface DataIssue {
  code: IssueCode;
  severity: IssueSeverity;
  message: LocalizedString;
  key?: string;
  format?: string;
  instances?: readonly TokenInstanceRef[];
  partName?: PartName;
  location?: { paragraphIndex: number; runIndex: number; pageHint?: number };
  value?: unknown;
  suggestion?: { action: 'remap'; key: string } | { action: 'provide'; key: string } | { action: 'unlink' };
  detail?: string;
}

export interface PreviewOptions {
  enabled: boolean;
  data?: TokenData;
  source?: DataSource;
  locale?: LocaleCode;
  showUnresolvedAs?: 'placeholder' | 'marker' | 'blank';
  pageLayout?: 'paginated' | 'continuous';
  readOnly?: boolean;
}
```

Catalogue rules: fetched once at mount when `catalogue` is a URL, cached in memory, re-fetched on
`cataloguePollSeconds` if set, and a fetch failure **never blocks mount** — the instance starts with a
stale or empty catalogue and records `catalogue-stale` / `catalogue-missing`. The catalogue is validated on
receipt (duplicate keys, a loop entry without `loop.fields`, a kind missing its required format produce
`DOC_CATALOGUE_INVALID` diagnostics and the offending entries are skipped), unknown fields are preserved and
passed through **so the backend can ship ahead of the library**, and labels resolve through the locale
fallback chain. The catalogue is the only source of truth for what may be inserted: the palette never
invents an entry. Preview is produced by the same fill engine and the same layout engine as the document —
not a separate renderer — it is read-only unless `readOnly: false`, and it reports issues but never blocks.

Enablement, both paths:

```ts
import { createDocier } from 'docier';
import { createTokenModule, fillTemplate, listTemplateTokens } from 'docier/tokens';

// Path 1 — config only. The module is loaded for you and everything §2.6 describes is available.
const docier = await createDocier({
  container: '#editor',
  config: { tokenization: { enabled: true, catalogue: '/tokens.json', trigger: '{{' } },
});

// Path 2 — host-held module. For a host that wants the catalogue and the data controller but not the
// recognition triggers, or that wants to read issues with no editor mounted at all.
const tokens = createTokenModule({ catalogue, issuePolicy: 'warn' });
await tokens.data.setData({ employee_name: 'Ana Popescu' });

// Headless, no editor: the same engine, in Node or in a worker.
const { bytes, summary, issues } = await fillTemplate({
  template, data, mode: 'document', catalogue, locale: 'ro-RO', onIssue: 'collect',
});

const keys = await listTemplateTokens(template);
```

`docier.tokens` is `null` exactly when the module is off, and the type says so, so a host cannot forget the
check. Nodes that are not `sdt` become tokens in `storage: 'text'` mode by keeping literal marker text, but
loops and conditionals are still expanded at fill time, rich values degrade to plain text, and a startup
warning is emitted — that mode exists for consumers that cannot read OOXML controls, and it is not the
default. Tokens are stored as `w:sdt` content controls with `w:tag`, which is exactly the content-control
model of the document layer: the module consumes the model and never creates a parallel one. A block-level
`w:sdt` may not span table rows (OOXML cannot represent it), so block insertion inside a table is confined
to a single `w:tc`. Recognition never mutates a field code, a `w:locked` or module-reserved `w:sdt`, a
comment author field, or deleted revision text; results are cached per paragraph revision and invalidated by
`docier:doc:change`; and background recognition is undo-transparent, because it may not create a history
entry. **The rendered DOM is never read back into the DOCX** — an implementation that serialises what is on
screen is a defect.

### 2.7 Export

```ts
export type ExportFormat = 'docx' | 'pdf' | 'html' | 'markdown' | 'plainText';

export interface ExportOptions {
  mode?: SaveMode;                              // 'template' | 'document'
  pages?: string;                               // "1-3,5,8-": document page numbers, not labels
  fieldScope?: 'selection' | 'document';        // default 'document', matching Word
  deterministic?: boolean;                      // default true
  sink?: ExportSink;                            // Uint8Array by default; Blob / Buffer / stream available
  signal?: AbortSignal;
  onProgress?(p: { phase: string; fraction: number }): void;
}

export interface ExportResult {
  format: ExportFormat;
  bytes: Uint8Array;
  /** The machine-readable loss ledger: everything that could not be represented, with a reason. */
  losses: readonly LossEntry[];
  fidelity: FidelityLevel;                      // FL0 | FL1 | FL2 | FL3
  byteLength: number;
}
```

`export('pdf')` dynamically imports `docier/pdf`, a separate entry with its own weight budget and no
dependency on the browser entry: a Node host imports `docier/pdf` directly and never loads DOM code. PDF
needs a layout result and DOCX does not; when no layout exists, PDF export computes one on demand rather
than refusing with `LAYOUT_REQUIRED`, because that is the friendlier default. A second export while one is
in flight **queues** rather than rejecting with `EXPORT_IN_FLIGHT`: print is the caller that makes this
matter. Missing fonts follow `fontMissing: 'fallback' | 'fail' | 'blank'` (default `'fallback'`), except
that a font a barcode or an embedded object depends on **hard-fails** rather than substituting silently.
The PDF-specific options (`pdfa`, `encryption`, `tagged`, `deflate`, `attachments`) are typed in
`docier/pdf` and are decided by ADR-0002 through ADR-0007.

### 2.8 Errors and diagnostics

```ts
export class DocierError extends Error {
  readonly code: DocierErrorCode;
  readonly detail?: string;
  readonly context: ErrorContext;
  readonly recoverable: boolean;
  override readonly cause?: unknown;
}

export interface ErrorContext {
  instanceId: string;
  operation: string;
  commandId?: CommandId;
  tokenKey?: TokenKey;
  partName?: PartName;
  pluginId?: string;
  documentRevision: number;
}

export interface Diagnostics {
  version: string;
  build: string;
  instanceId: string;
  state: InstanceState;
  browser: { ua: string; features: Record<string, boolean> };
  config: Readonly<DocierConfig>;
  resolvedLocale: LocaleCode;
  document: DocumentStats;
  plugins: readonly { id: string; state: string; version?: string }[];
  warnings: readonly Diagnostic[];
  errors: readonly { code: DocierErrorCode; at: number; count: number }[];
  performance: { lastLayoutMs: number; lastFillMs: number; lastExportMs: number; pages: number;
                 heapBytes?: number };
}
```

The code union is **closed** and is the single union for both thrown errors and `blocked` command results.
It is the union the API draft defined plus the parse-layer codes the document draft defined plus the
refusal reasons the editing draft defined, which is §1.6 conflict 7:

```ts
export type DocierErrorCode =
  // API and lifecycle
  | 'CONFIG_INVALID' | 'CONFIG_VERSION_NEWER' | 'INSTANCE_DESTROYED' | 'INSTANCE_LIMIT'
  | 'MOUNT_TARGET_MISSING' | 'MOUNT_TARGET_DETACHED' | 'NOT_SUPPORTED_BROWSER' | 'INTERNAL'
  // Commands, transactions and plugins
  | 'COMMAND_NOT_FOUND' | 'REENTRANT_COMMAND' | 'TRANSACTION_STALE'
  | 'PLUGIN_FAILED' | 'PLUGIN_VERSION_MISMATCH' | 'SLOT_RENDERER_FAILED'
  | 'REQUIRES_RELOAD'
  // Document and package I/O (the parse layer's own vocabulary)
  | 'NOT_A_PACKAGE' | 'NOT_OOXML' | 'WRONG_DOCUMENT_TYPE' | 'LEGACY_DOC_NOT_SUPPORTED'
  | 'PACKAGE_ENCRYPTED' | 'PACKAGE_RIGHTS_MANAGED' | 'DOC_CORRUPT' | 'DOC_LOAD_FAILED'
  | 'DOC_UNSUPPORTED' | 'DOC_TOO_LARGE' | 'SAVE_FAILED' | 'EXPORT_IN_FLIGHT' | 'INVALID_PAGE_RANGE'
  // Tokens, data and filling
  | 'DOC_CATALOGUE_INVALID' | 'FILL_ABORTED' | 'DATA_SOURCE_FAILED' | 'EXPORT_BLOCKED'
  // Storage
  | 'STORAGE_UNAVAILABLE' | 'STORAGE_QUOTA' | 'AUTOSAVE_FAILED'
  // Refusals (the editing layer's vocabulary, promoted from codes to the same union)
  | 'PROTECTED' | 'READ_ONLY' | 'INAPPLICABLE' | 'NOT_FOUND' | 'EMPTY_SELECTION'
  | 'DOCUMENT_BOUNDARY' | 'CLIPBOARD_UNAVAILABLE' | 'LAYOUT_UNAVAILABLE' | 'PATTERN_TOO_COMPLEX'
  | 'INCOMPATIBLE_TARGET' | 'STYLE_NOT_FOUND' | 'BUILTIN_NOT_DELETABLE' | 'STYLE_IN_USE_BY_TOKEN'
  | 'SPECIAL_UNAVAILABLE' | 'INSIDE_TOKEN' | 'REGION_PROTECTED';
```

Rules: every error thrown or rejected is a `DocierError` whose `code` comes from this union — **a raw
`TypeError` reaching a host is a bug.** `recoverable` tells a host whether continuing is sane. A
user-triggered operation (open, save, export, insert) surfaces its failure as an event plus a localised UI
notification; a programmatic call rejects. Nothing fails silently: every caught internal error reaches
`getDiagnostics().errors` at minimum. `config.onError` may observe every error and may replace the
user-facing message but **may not swallow the diagnostic**. `docier.command.dev.diagnostics` copies the
whole payload as JSON to the clipboard — the support-report path — and logging never includes token
*values* unless `debug.includeValues === true`.

### 2.9 Entry points and packaging

`package.json` today exports `.`, `./tokens` and `./style.css`. That is correct as far as it goes and
incomplete for this specification; the normative map is:

| Entry | Contains | Notes |
|---|---|---|
| `docier` | model, layout engine, renderer, editing, formatting, objects, chrome, command/event surface, DOCX I/O | No `window`/`document`/`navigator` at module scope; `export { isServer }` |
| `docier/server` | `createDocierCore`, `fillTemplate`, `listTemplateTokens`, DOCX read/write, the fill engine | Build-asserted to contain no reference to `document`, `window` or `navigator` |
| `docier/pdf` | the PDF writer | Dynamically imported by `export('pdf')`; never imported by core; own weight budget |
| `docier/tokens` | the token module | Absent from a build that never imports it |
| `docier/testing` | corpus runner, comparators, fixture helpers | So an integrator can assert fidelity for their own templates |
| `docier/style.css` | the stylesheet | Never injected at import time; a host imports it or calls `injectStyles()` |

Rules: nothing else is importable, and a deep import outside `exports` is a build error for a consumer on
`moduleResolution: node16` or `bundler`. `sideEffects: false` is load-bearing. `.d.ts` is rolled up with API
Extractor, and a committed `api-report.md` is diffed in CI with any public signature change requiring an
explicit reviewer acknowledgement. Versioning: pre-1.0 a minor may break and every break is listed under
"Breaking" in `CHANGELOG.md` with a codemod note; post-1.0, command ids, event names, config option names
and CSS custom properties are stable, adding an option is a minor, and removing, re-typing or **renaming an
event** is a major. A document saved by docier N must open in N+1 with no content loss, and the file records
`docier:version` as a `docProps/app.xml` custom property — never a proprietary part. Theming and slots are
the two extension surfaces a host should reach for before a plugin: `theme.vars` for the `--docier-*`
contract (class names and internal selectors are not part of it), and `ui.override({ toolbar: MyToolbar })`
per surface, which is **all-or-nothing per surface** because partial replacement of built-in internals would
freeze those internals into the public contract. `permissions.readOnly` is a UI guard, `role="application"`
is used only where key handling is fully custom, and heavy template authoring on a phone is documented as
unsupported — viewing, filling and light editing are not.

---

## 3. The merged feature list

Every feature from all five drafts, deduplicated and grouped by the module that owns it. **328 entries
covering all 357 source ids.** Each entry keeps its priority and effort from §1.6 conflict 13, and the
`Ids` column lists every source id the entry absorbs: where two drafts proposed the same deliverable it is
one entry with both ids, and the `Notes` column records which id was folded in, and why the priority or
effort differs from a draft's own value where it does.

Counts by group: A. Package, file layer and document I/O 18; B. Document model 39; C. Layout engine 67; D. Editing, input and formatting 61; E. Objects 31; F. UI chrome 30; G. Export and print 14; H. Public API, plugin surface, extensibility and tokenization 51; J. Cross-cutting quality 17. Total 328.

**Priority** — `core` (required for a usable product for the HR-manager persona; ships in v1), `important`
(required for "feels like Word" acceptance and for HR workflows, but v1 can ship without it), `later`
(deferred; the data model and interfaces must not be designed in a way that prevents it). **Effort** —
S ≤ 3 days, M ≤ 2 weeks, L ≤ 6 weeks, XL > 6 weeks, one engineer including tests.

**Where two entries conflicted and could not be merged** — a genuine fork, not an overlap — the entry
names the winner and §1.6 has the reasoning. There are 25 merges in total.


### A. Package, file layer and document I/O

| Ids | Feature | Priority | Effort | Notes |
|---|---|---|---|---|
| PKG-01 | OPC container read | core | L |  |
| PKG-02 | OPC container write | core | M |  |
| PKG-03 | `[Content_Types].xml` management | core | M |  |
| PKG-04 | Relationship graph | core | M |  |
| PKG-05 | Unmodified-part passthrough | core | L |  |
| PKG-06 | Part naming, allocation and media lifecycle | core | M |  |
| PKG-07 | Unsupported and special package variants | important | L |  |
| PRO-01 | Core properties (`docProps/core.xml`) | core | S |  |
| PRO-02 | Extended and custom properties (`app.xml`, `custom.xml`) | important | M |  |
| SER-01 | Parse pipeline and error recovery | core | XL |  |
| SER-02 | Streaming versus full parse, and the memory budget | important | XL |  |
| SER-03 | Serialise pipeline and dirty tracking | core | XL |  |
| SER-04 | Schema conformance, strict/transitional, and validation | important | L |  |
| EXD-01 | Export API and sinks | core | M |  |
| EXD-02 | Fidelity contract and loss ledger | core | M |  |
| EXD-03 | Word repair safety and compatibility mode | core | L |  |
| INT-02 | Fidelity levels as executable assertions | core | M |  |
| INT-03 | Third-party producer quirks and interop with Word itself | important | L |  |

### B. Document model

| Ids | Feature | Priority | Effort | Notes |
|---|---|---|---|---|
| MOD-01 | XML tree, namespaces and prefix fidelity | core | L |  |
| MOD-02 | Unknown-markup preservation | core | L |  |
| MOD-03 | Body and block-level content model | core | M |  |
| MOD-04 | Paragraph model (`w:p`, `w:pPr`) | core | M |  |
| MOD-05 | Run model (`w:r`, `w:rPr`) and run content | core | M |  |
| MOD-06 | Property cascade and toggle semantics | core | XL |  |
| MOD-07 | Table model | core | L |  |
| MOD-08 | Hyperlinks and bookmarks | core | S |  |
| MOD-09 | Node identity, addressing, and mutation transactions | core | L |  |
| MOD-10 | Revision, rsid and proofing bookkeeping at document level | important | M |  |
| STY-01 | `styles.xml` structure, defaults and latent styles | core | L |  |
| STY-02 + FM-020 | Style cascade, inheritance and resolution | core | L | merged FM-020 |
| STY-03 + FM-023 | Style editing operations and id stability | important | L | merged FM-023 |
| NUM-01 + FM-031 | `numbering.xml` model | core | L | merged FM-031; priority conflict core/important → core |
| NUM-02 | Instance resolution: `numId` → `abstractNumId` | core | M |  |
| NUM-03 | Number evaluation and rendering | important | L |  |
| THM-01 + FM-024 | `theme1.xml` | important | L | merged FM-024; effort conflict M/L → L |
| SET-01 | `settings.xml` | core | M |  |
| SET-02 | Document variables, attached template and protection surface | later | S |  |
| SEC-01 | `w:sectPr` and page geometry | core | L |  |
| SEC-02 | Section breaks and section inheritance | core | M |  |
| SEC-03 | Headers and footers: parts and references | core | L |  |
| SEC-04 | Header/footer inheritance and "link to previous" | core | M |  |
| SEC-05 | Page numbering, page fields and section page counts | important | M |  |
| ANN-01 | Footnotes and endnotes | important | L |  |
| ANN-02 | Note numbering and placement settings | important | M |  |
| ANN-03 | Comments: classic and threaded | core | L |  |
| ANN-04 | Tracked revisions: model and accept/reject | important | XL |  |
| ANN-05 | Annotation preservation policy | core | S |  |
| SC-01 | Content controls (`w:sdt`) | core | XL |  |
| SC-02 | Content control semantics: `w:tag`, `w:alias`, `w:id`, `w:lock` | core | M |  |
| SC-03 | Data binding and custom XML parts | important | L |  |
| SC-04 | Typed content controls | important | XL |  |
| SC-05 | Fields and field codes | core | L |  |
| SC-06 | Field instruction parsing and the evaluated subset | important | L |  |
| SC-07 | `altChunk`, glossary documents, OLE and math | later | M |  |
| MED-01 + OBJ-15 | Image ingestion, format policy and de-duplication | core | L | merged OBJ-15; effort conflict M/L → L |
| MED-02 | DrawingML picture model (inline and anchored) | core | L |  |
| MED-03 | Legacy VML, shapes, textboxes, charts and OLE | important | M |  |

### C. Layout engine

| Ids | Feature | Priority | Effort | Notes |
|---|---|---|---|---|
| LE-001 | Millipoint coordinate system and determinism contract | core | S |  |
| LE-002 | The DOM renders from the layout result (no browser flow) | core | M |  |
| LE-003 | Paint-only CSS contract, enforced by lint | core | S |  |
| LE-004 + UI-17 | Zoom as a pure paint scale (type scales with the page) | core | L | merged UI-17; effort conflict S/L → L |
| LE-005 | Divergence detector (dev + CI) | core | M |  |
| LE-006 | PDF parity by construction | core | M |  |
| LE-007 + ED-001 | Engine-derived caret, selection and hit testing | core | L | merged ED-001; effort conflict M/L → L |
| LE-008 + FM-021 + FM-022 | Style resolution to flat property bags | core | XL | merged FM-021, FM-022; effort conflict L/XL/XL → XL |
| LE-009 | Settings and compatibility flags that change layout | core | M |  |
| LE-010 + ED-017 | Romanian and Russian text normalization (layout-visible) | core | M | merged ED-017; effort conflict S/M → M |
| LE-011 | Numbering and list geometry resolution | core | L |  |
| LE-012 + THM-02 + FM-025 | Font registry and deterministic resolution | core | L | merged THM-02, FM-025; effort conflict M/L/M → L; priority conflict core/core/important → core |
| LE-013 | Embedded and obfuscated fonts | important | M |  |
| LE-014 | Metric extraction from the font binary | core | L |  |
| LE-015 | Shaping, kerning and ligatures | core | L |  |
| LE-016 | Measurement and shaping cache | core | M |  |
| LE-017 | Run metric properties: spacing, scale, position, caps, hidden, vertAlign | core | M |  |
| LE-018 | Inline atomization (run → atoms) | core | M |  |
| LE-019 | Bidirectional text (UAX #9) | important | L |  |
| LE-020 | RTL/LTR mirroring of layout properties | important | M |  |
| LE-021 | Fields whose result occupies space | core | M |  |
| LE-022 | Notes and other out-of-line stories as inline references | core | S |  |
| LE-023 | Greedy line breaking (the decision), Word-faithful | core | L |  |
| LE-024 | Break opportunities per language, and non-breaking constructs | core | M |  |
| LE-025 | Hyphenation for Romanian, Russian and English | important | L |  |
| LE-026 | Justification: space distribution and exact edge landing | core | M |  |
| LE-027 | Drop caps (exclusion-based) | important | M |  |
| LE-028 | Kashida justification (Arabic) — deferred | later | M |  |
| LE-029 | East Asian line breaking (kinsoku) — deferred | later | M |  |
| LE-030 | Trailing/leading whitespace and empty-line semantics | core | S |  |
| LE-031 | Deterministic behaviour when a constraint cannot be satisfied | core | M |  |
| LE-032 | Widow and orphan control | core | M |  |
| LE-033 | Keep-with-next and keep-lines-together | core | M |  |
| LE-034 | Page-break-before / page-break-after and hard breaks | core | S |  |
| LE-035 | Line height: auto, atLeast, exact, and multiple spacing | core | M |  |
| LE-036 | Paragraph spacing before/after, auto-spacing, contextual spacing | core | M |  |
| LE-037 | Grid snapping and document grid | later | M |  |
| LE-038 | Paragraph borders | important | L |  |
| LE-039 | Paragraph and run shading | important | M |  |
| LE-040 | The vertical machine (block flow) | core | L |  |
| LE-041 | Section breaks and break types | core | L |  |
| LE-042 | Columns and column balancing | important | L |  |
| LE-043 | Section vertical alignment of content | later | S |  |
| LE-044 | Line numbering | later | M |  |
| LE-045 | Table grid resolution and column widths | core | XL |  |
| LE-046 | Cell measurement and recursive cell layout | core | L |  |
| LE-047 | Cell and table borders with conflict resolution | core | L |  |
| LE-048 | Row heights, row splitting across pages, cantSplit | core | L |  |
| LE-049 | Merged cells: gridSpan and vMerge | core | L |  |
| LE-050 | Repeated header rows | core | M |  |
| LE-051 | Nested tables | important | M |  |
| LE-052 | Floating tables (tblpPr) and table positioning | later | L |  |
| LE-053 | Image measurement: intrinsic size, EMU, cropping, fill and rotation | core | L |  |
| LE-054 + OBJ-05 | Inline vs anchored drawings, and the block-level drawing paragraph | core | L | merged OBJ-05 |
| LE-055 + OBJ-27 + OBJ-28 | Wrap modes: square, tight, through, top-and-bottom, none, behind, in front | core | XL | merged OBJ-27, OBJ-28; effort conflict XL/L/M → XL; priority conflict important/core/important → core |
| LE-056 | Anchoring, relative-from and float placement | important | L |  |
| LE-057 | Text boxes and legacy frames | important | L |  |
| LE-058 | Exclusion areas as one shared mechanism | core | M |  |
| LE-059 | Headers and footers: regions, page kinds, and height displacement | core | L |  |
| LE-060 | Page numbering and page-count-dependent fields (loop L3) | important | M |  |
| LE-061 | Footnotes: numbering, area, displacement | important | XL |  |
| LE-062 | Endnotes, separators and note conversions | later | M |  |
| LE-063 | Layout tree, fingerprints and invalidation | core | L |  |
| LE-064 | Incremental relayout: rewind, re-run, resync | core | XL |  |
| LE-065 + QUA-16 | Typing latency budget and worker scheduling | core | XL | merged QUA-16; effort conflict L/XL → XL |
| LE-066 + QUA-17 | Page virtualization and painting | core | XL | merged QUA-17; effort conflict M/XL → XL; priority conflict important/core → core |
| LE-067 + INT-01 + QUA-20 | Fidelity harness: golden corpus, divergence tests, Word comparison | core | XL | merged INT-01, QUA-20; effort conflict L/L/XL → XL |

### D. Editing, input and formatting

| Ids | Feature | Priority | Effort | Notes |
|---|---|---|---|---|
| ED-002 | Selection model: anchor/focus, normalization, multi-range, persistence | core | L |  |
| ED-003 | Selection gestures: multi-click ladder, drag-select, autoscroll, shift-click, Extend Mode | core | L |  |
| ED-004 | Selection units: character, word, sentence, line, paragraph, block, cell, row, column, object, all | core | M |  |
| ED-005 | Block (column) selection | important | M |  |
| ED-006 | Select All escalation (Ctrl+A) | core | S |  |
| ED-007 + OBJ-06 | Object selection and manipulation gestures | core | L | merged OBJ-06; effort conflict M/L → L |
| ED-008 | Character and visual-line navigation (Left/Right/Up/Down, goal column) | core | M |  |
| ED-009 | Word navigation (Ctrl+Left/Ctrl+Right, Word-exact) | core | M |  |
| ED-010 | Line and document edge navigation (Home/End, Ctrl+Home/Ctrl+End) | core | S |  |
| ED-011 | Paragraph, page, and history navigation (Ctrl+Up/Down, Page Up/Down, Go Back) | core | M |  |
| ED-012 | Insertion pipeline: typing, Tab contexts, overwrite, formatting inheritance | core | L |  |
| ED-013 | Paragraph split (Enter) and break insertion (Shift+Enter, page/column) | core | M |  |
| ED-014 | Deletion: Backspace/Delete merge rules and word/line deletion | core | M |  |
| ED-015 | Character input beyond typing: Insert Symbol, Alt+X, dead keys, combining marks, normalization | important | M |  |
| ED-016 | IME composition | core | L |  |
| ED-018 | Russian/Cyrillic input and script switching | core | M |  |
| ED-019 | Autocorrect | important | L |  |
| ED-020 | AutoFormat As You Type | important | L |  |
| ED-021 | Smart typography: quotes, dashes, ellipsis, capitalization correction | core | M |  |
| ED-022 | Token recognition triggers (tokenization module integration) | important | S |  |
| ED-023 + API-10 | Undo/redo stack, bounds, save point, dirty flag, async and remote changes | core | XL | merged API-10; effort conflict XL/L → XL |
| ED-024 | Typing-run coalescing | core | M |  |
| ED-025 | One undo entry per object-manipulation gesture | core | M |  |
| ED-026 | Copy and cut payload construction | core | M |  |
| ED-027 | Paste pipeline: flavours, Paste Special, cross-document | core | XL |  |
| ED-028 | Clipboard round-trip fidelity: fields, content controls, bookmarks, comments, notes | core | L |  |
| ED-029 | External HTML import (Word, Google Docs) and sanitization | important | L |  |
| ED-030 + OBJ-03 | Images, embedded objects, and file paste | core | M | merged OBJ-03 |
| ED-031 + OBJ-02 | Drag-and-drop of text and files | core | L | merged OBJ-02; effort conflict L/M → L; priority conflict important/core → core |
| ED-032 | Find bar, search index, and search scope | core | L |  |
| ED-033 | Formatting-aware find | important | M |  |
| ED-034 | Regex and wildcard find and replace | important | L |  |
| ED-035 | Replace, Replace All, and special character codes | core | M |  |
| ED-036 | Spellcheck integration and proof state | important | L |  |
| ED-037 | Show formatting marks | important | S |  |
| ED-038 | Read-only, document protection, and range-level exceptions | core | L |  |
| ED-039 | Headless / no-DOM mutation driving | core | L |  |
| FM-001 | Character toggles: bold, italic, underline, strike, superscript/subscript | core | L |  |
| FM-002 | Fonts: family, theme fonts, script routing, size, grow/shrink | core | L |  |
| FM-003 | Character colour, highlight, text effects, borders, and shading | core | L |  |
| FM-004 | Character spacing: spacing, kerning, scaling, position, fit text, OpenType features | important | M |  |
| FM-005 | Case commands and the Change Case dialog | important | S |  |
| FM-006 | Clear character formatting | core | S |  |
| FM-007 | Format painter | important | M |  |
| FM-008 | Reveal formatting / inspect effective formatting | important | M |  |
| FM-009 | Alignment, justification, and text direction | core | M |  |
| FM-010 | Line spacing | core | M |  |
| FM-011 | Paragraph spacing before/after and contextual spacing | core | M |  |
| FM-012 | Indentation: left, right, first line, hanging, mirror indents | core | M |  |
| FM-013 | Tab stops: default interval, explicit stops, leaders | important | M |  |
| FM-014 | Paragraph borders and shading | important | M |  |
| FM-015 + UI-19 | Paragraph dialog: Indents and Spacing, Line and Page Breaks, Tabs | core | L | merged UI-19 |
| FM-016 | Pagination and line-break rules: keepNext, keepLines, pageBreakBefore, widowControl, hyphenation, snap to grid | core | M |  |
| FM-017 | Styles gallery and the Styles pane | core | L |  |
| FM-018 | Applying styles: paragraph, character, linked, table, list | core | L |  |
| FM-019 | Creating and modifying styles: update to match, autoRedefine, next style | core | L |  |
| FM-026 | Bulleted lists | core | M |  |
| FM-027 | Numbered lists, numbering formats, and Define New Number Format | core | L |  |
| FM-028 | Multilevel lists: levels, lvlText, restart, isLgl, promote/demote | core | L |  |
| FM-029 | Numbering restart, continuation, and set numbering value | important | M |  |
| FM-030 | List styles vs direct list formatting (styleLink/numStyleLink) | important | L |  |

### E. Objects

| Ids | Feature | Priority | Effort | Notes |
|---|---|---|---|---|
| OBJ-01 | Insert image from file | core | M |  |
| OBJ-04 | Insert image from URL | important | M |  |
| OBJ-07 | Resize — aspect-locked | core | M |  |
| OBJ-08 | Resize — free (aspect unlocked) | important | S |  |
| OBJ-09 | Crop | core | L |  |
| OBJ-10 | Rotate | important | M |  |
| OBJ-11 | Flip | important | S |  |
| OBJ-12 | Alt text, title, and object name | core | S |  |
| OBJ-13 | Replace image (keep formatting) | important | S |  |
| OBJ-14 | Image compression | important | M |  |
| OBJ-16 | Insert shapes and format them | core | L |  |
| OBJ-17 | Freeform shapes | important | L |  |
| OBJ-18 | Text boxes | core | L |  |
| OBJ-19 | Text inside shapes | important | M |  |
| OBJ-20 | Text autofit and overflow | important | M |  |
| OBJ-21 | Group and ungroup | core | L |  |
| OBJ-22 | Align and distribute | important | M |  |
| OBJ-23 | Position relative to page / margin / paragraph / character / line | core | L |  |
| OBJ-24 | Anchor locking | important | S |  |
| OBJ-25 | Move with text | core | M |  |
| OBJ-26 | Position gallery (presets) | important | M |  |
| OBJ-29 | Z-order operations | core | M |  |
| OBJ-30 | Move by drag, snapping and smart guides | core | L |  |
| OBJ-31 | Nudge and precise positioning | important | S |  |
| OBJ-32 + UI-28 | Object context menu | core | XL | merged UI-28; effort conflict M/XL → XL |
| OBJ-33 | Multi-select, Selection pane, and keyboard reachability | important | M |  |
| OBJ-34 | Object clipboard: cut, copy, paste, duplicate, delete | core | M |  |
| OBJ-35 | Anchor placement and the anchor marker | important | M |  |
| OBJ-36 | Object-related panels (Layout Options, Alt Text, Format) | important | L |  |
| OBJ-37 + QUA-06 | Object accessibility and non-visual operation | core | M | merged QUA-06; priority conflict core/important → core |
| OBJ-38 | Connector attachment and re-routing | later | L |  |

### F. UI chrome

| Ids | Feature | Priority | Effort | Notes |
|---|---|---|---|---|
| UI-01 + API-20 | Chrome mounting and slot contract | core | L | merged API-20; effort conflict L/M → L; priority conflict core/important → core |
| UI-02 | Menu bar and backstage | core | L |  |
| UI-03 | Ribbon structure: tabs, groups, control vocabulary, dialog launchers | core | XL |  |
| UI-04 | Contextual tabs | core | M |  |
| UI-05 | Ribbon collapsing and responsive behaviour | important | M |  |
| UI-06 | Keyboard access and Alt key tips | core | L |  |
| UI-07 | Quick Access Toolbar | important | S |  |
| UI-08 | Ruler framework: one ruler for a multi-page document | core | L |  |
| UI-09 | Ruler: units and origin | important | S |  |
| UI-10 | Ruler: margin markers | core | M |  |
| UI-11 | Ruler: indent markers | core | M |  |
| UI-12 | Ruler: tab stops | core | L |  |
| UI-13 | Ruler: drag behaviour, snapping and the canvas link | important | M |  |
| UI-14 | Ruler: vertical ruler | important | M |  |
| UI-15 | Status bar | core | M |  |
| UI-16 | Zoom controls and fit modes | core | M |  |
| UI-18 | Dialog framework | core | L |  |
| UI-20 | Font dialog | core | L |  |
| UI-21 | Page Setup dialog | core | L |  |
| UI-22 | Insert Field dialog | core | M |  |
| UI-23 | Find and Replace dialog | core | L |  |
| UI-24 | Table properties dialog | important | L |  |
| UI-25 | Selection mini-toolbar | important | M |  |
| UI-26 | Floating text controls over a selection | core | M |  |
| UI-27 | Context menu framework | core | L |  |
| UI-29 | Panels and sidebar framework | important | L |  |
| UI-30 | Navigation pane and document outline | important | L |  |
| UI-31 | View modes | important | L |  |
| UI-32 | Empty, first-run and error states | core | M |  |
| UI-33 + API-19 | Theming, density and layout tokens | core | M | merged API-19; priority conflict important/core → core |

### G. Export and print

| Ids | Feature | Priority | Effort | Notes |
|---|---|---|---|---|
| EXP-01 | PDF engine architecture and the client/server split | core | XL |  |
| EXP-02 | Page ranges and selection | core | M |  |
| EXP-03 | Print and print preview | core | L |  |
| EXP-04 | Font embedding, subsetting and text extraction | core | XL |  |
| EXP-05 | Font substitution and metric compatibility | core | L |  |
| EXP-06 | Image handling in PDF | core | L |  |
| EXP-07 | PDF metadata, outline and internal links | important | M |  |
| EXP-08 | Determinism of PDF output | important | M |  |
| EXP-09 | PDF/A, legal archiving, and encryption | later | XL |  |
| EXP-10 | Tagged PDF and accessibility (PDF/UA) | later | XL |  |
| EXP-11 | Server-side rendering path | important | XL |  |
| EXO-01 | Plain text | important | S |  |
| EXO-02 | HTML | important | L |  |
| EXO-03 | Markdown | important | M |  |

### H. Public API, plugin surface, extensibility and tokenization

| Ids | Feature | Priority | Effort | Notes |
|---|---|---|---|---|
| TOK-01 | Canonical token storage is a content control (`w:sdt`) | core | XL |  |
| TOK-02 | Plain-text marker syntax as import and interchange form | core | L |  |
| TOK-03 | Token identity: key, instance, kind | core | L |  |
| TOK-04 | Run-splitting normalisation on import | core | L |  |
| TOK-05 | Insert from the token palette | core | M |  |
| TOK-06 | Type-trigger autocomplete | core | L |  |
| TOK-07 | Insert and edit via dialog | important | M |  |
| TOK-08 | Display modes and the display/export agreement rule | core | L |  |
| TOK-09 | Token chip interaction semantics | core | M |  |
| TOK-10 | The host data API: `setData`, `mergeData`, `getIssues` | core | L |  |
| TOK-11 | The fill engine | core | XL |  |
| TOK-12 | Plain vs rich values and style inheritance | core | L |  |
| TOK-13 | Value escaping and injection safety | core | M |  |
| TOK-14 | Image tokens | important | L |  |
| TOK-15 + QUA-12 | Date, number, and currency formatting per locale | core | L | merged QUA-12; effort conflict L/M → L |
| TOK-16 | Conditional content | important | XL |  |
| TOK-17 | Repeating sections and loops | important | XL |  |
| TOK-18 | Loop scope, metadata, and aggregation | important | L |  |
| TOK-19 | The data-issue model | core | L |  |
| TOK-20 | Surfacing unresolved and missing values before export | core | M |  |
| TOK-21 | Unlink / freeze a token to plain text | important | M |  |
| TOK-22 | The token catalogue contract with the backend | core | L |  |
| TOK-23 | Unknown-token validation and remap | core | M |  |
| TOK-24 | Legacy field import: MERGEFIELD, DOCVARIABLE, REF, IF | later | M |  |
| TOK-25 | Preview mode with real data | important | L |  |
| TOK-26 | Value validation rules | important | M |  |
| TOK-27 | Locked tokens and protected regions | important | M |  |
| API-01 | `createDocier()` and the instance lifecycle | core | L |  |
| API-02 | Mounting and mount options | core | M |  |
| API-03 | The configuration object, in full | core | XL |  |
| API-04 | Config merge, validation, and migration | important | M |  |
| API-05 | Runtime reconfiguration | important | M |  |
| API-06 | Command shape and naming convention | core | L |  |
| API-07 | Grouping and placement metadata for host-built UI | core | M |  |
| API-08 | Availability, visibility, and disabled reasons | core | M |  |
| API-09 | Transactions and batching | core | L |  |
| API-11 | Event bus shape and typing | core | L |  |
| API-12 | Event catalogue | core | XL |  |
| API-13 | Event ordering and synchronicity guarantees | core | L |  |
| API-14 | Plugin API: install, dispose, isolation | core | L |  |
| API-15 | Extending: adding a command | core | S |  |
| API-16 | Extending: adding a UI control and slots | important | M |  |
| API-17 | Extending: custom renderers | important | M |  |
| API-18 | Extending: document features | later | XL |  |
| API-21 | Headless / server-side use | important | L |  |
| API-22 | SSR safety | important | M |  |
| API-23 | Framework bindings | important | L |  |
| API-24 | Public TypeScript typing strategy | core | M |  |
| API-25 | Versioning and backwards compatibility | core | M |  |
| API-26 | Errors, error codes, and the boundary | core | L |  |
| API-27 | Diagnostics, logging, debug mode | important | M |  |

### J. Cross-cutting quality

| Ids | Feature | Priority | Effort | Notes |
|---|---|---|---|---|
| QUA-01 | Document surface roles, names, and accessible structure | core | M |  |
| QUA-02 | Screen-reader behaviour on paginated content | core | L |  |
| QUA-03 | Keyboard-only operation of every feature | core | L |  |
| QUA-04 | Focus management and restoration | core | M |  |
| QUA-05 | Live regions and status announcements | important | M |  |
| QUA-07 | High contrast, forced colors, and non-colour encoding | important | M |  |
| QUA-08 | Hit targets, zoom and reflow, motion | important | S |  |
| QUA-09 | UI localisation, plural rules, and the message contract | core | M |  |
| QUA-10 | RTL and bidirectional text | important | L |  |
| QUA-11 | CJK and complex-script text handling | later | L |  |
| QUA-13 | Document language vs UI language | core | M |  |
| QUA-14 | Romanian specifics | core | M |  |
| QUA-15 | Russian specifics | core | M |  |
| QUA-18 | Autosave, recovery, and crash safety | core | L |  |
| QUA-19 | The same document open twice | important | L |  |
| QUA-21 | Browser support | core | M |  |
| QUA-22 | Quality gates in CI | important | M |  |
---

## 4. Build order

Phases are ordered by **what unblocks a usable editor soonest**, not by module. Each phase ends at a
demonstrable state with a named exit criterion, and each has an explicit dependency on the phases before
it. Effort is given in engineer-weeks for the phase, at the effort scale of §1.6 conflict 13, and assumes
the phase's stated scope only — it is a planning input, not a commitment.

### P0 — Foundations (no visible output)

Ships: `src/layout/units.ts` (the single conversion site and the only place `Mp` is created from document
units); the `LayoutResult` type with its invariants; `DocierError` and the closed `DocierErrorCode` union;
the `EventBus` with the fixed ordering trace; the `CommandRegistry` with `noop`/`blocked` semantics and the
closed area set; `DocierConfig` and `configure()`; the plugin host and slot registry; the import-boundary
lint rules; the CI gates (typecheck under `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`,
lint, bundle-size budgets per entry point, the golden-trace test); and `src/testing` with the corpus runner
and comparators.

Depends on: nothing. This phase exists to make P1's invariants testable rather than aspirational.
Exit criterion: a synthetic `LayoutResult` can be constructed, hashed, cloned and diffed, and the CI gates
pass on an empty implementation. Removing `"jsx": "react-jsx"` from the root `tsconfig.json` is part of this
phase.
Effort: ~3–4 weeks. **Do not skip or compress this phase** — the divergences this specification exists to
prevent were all introduced by starting at P1.

### P1 — Open a real document and paint it

Ships: OPC container read and write with unmodified-part passthrough (`PKG-01`–`PKG-06`); the parse and
serialise pipelines with the opaque-node mechanism and the loss ledger (`SER-01`, `SER-03`, `MOD-01`,
`MOD-02`); the model's node identity and text addressing (`MOD-03`–`MOD-09`); the property cascade
resolved once, to flat bags, in P0 (`LE-008`, `FM-021`, `FM-022`); font registry and metrics; shaping and
inline atomization (`LE-018`, `LE-019`); line breaking and block flow and pagination for the single-column
body case (`LE-023`–`LE-040`); the paint-only renderer for text and simple blocks; page virtualisation;
PDF export for the same subset (`EXP-01`, `EXP-04`, `EXP-05`, `EXP-06`, `EXP-08`); and the divergence
detector wired into dev and CI.

Depends on: P0.
Exit criterion: **a 40-page DOCX opens, paints correctly, scrolls at 60 fps, saves byte-identically when
not edited, and exports a PDF whose text lands where the screen put it.** The divergence detector reports
zero exceedances on the corpus, and the PDF-parity assertion runs in CI. This is the earliest point at
which the spine is proven end to end, and it is deliberately before any editing.
Effort: ~10–14 weeks. The largest phase; it contains the cascade, the engine and the PDF writer.

### P2 — Edit text

Ships: caret and selection model and all Word navigation (`ED-001`–`ED-011`); the insertion pipeline with
run merging, the five-step formatting inheritance and O(1) typing (`ED-012`, `ED-014`, `ED-015`); word
delete, tab and break handling; IME composition (`ED-016`); undo/redo with structural inverses, bounds and
the save point (`ED-023`, `ED-024`); incremental relayout with the L4 resync rule and the two-tier
synchronous/asynchronous split; caret, selection and find overlays as paint layers; the minimum chrome:
menu bar, ribbon with the Home tab, context menus built from the registry, status bar, single sticky ruler
(`UI-01`–`UI-07`, `UI-08`, `UI-15`, `UI-27`, `UI-33`); basic character and paragraph commands
(`FM-001`–`FM-016`); DOCX save with dirty-part tracking.

Depends on: P1 (the whole phase consumes `LayoutResult` for caret geometry).
Exit criterion: **a user can type and format a letter in Romanian and in Russian, undo it, and save it**,
with the toolbar state derived from the resolved bags and never stored. The typing latency budget holds at
p95 < 4 ms synchronous.
Effort: ~8–11 weeks.

### P3 — Real documents: structure, styles, tables, notes

Ships: numbering and list commands (`NUM-01`–`NUM-03`, `FM-026`–`FM-031`); tables — grid, merges, borders,
cell margins, row splitting and repeated headers (`LE-041`–`LE-048`); sections, headers and footers,
multi-column, and the L3 page-count convergence (`SEC-01`–`SEC-05`, `LE-049`, `LE-059`–`LE-061`);
footnotes and endnotes with the L2 loop; images and their ingest, format and placement subset
(`MED-01`, `THM-01`, `THM-02`, `LE-053`, `LE-054`, `LE-057`, `LE-058`); the styles gallery, apply/modify/
create, style inheritance and the reveal-formatting pane (`FM-017`–`FM-025`); clipboard with all flavours
and the degraded event (`ED-026`–`ED-028`); find and replace including regex and formatting-aware find
(`ED-032`–`ED-035`); and the remaining chrome: dialogs, panels, mini-toolbar, navigation pane, key tips.

Depends on: P2 (the commands need history and addressing) and P1's L1/L2/L3 loops, which are exercised for
the first time here.
Exit criterion: **a contract with a header, a footer, a table, numbered clauses and a footnote opens,
round-trips FL1 with cycle stability, and prints identically from screen and PDF.**
Effort: ~12–16 weeks. The pagination loops and the table engine are the risk; both are already specified
in full, which is why they are scheduled together rather than in two phases.

### P4 — Tokenization and objects

Ships: the token module at minimum viable depth — catalogue, data controller, issue reporting, fill,
preview and the `w:sdt` storage (`TOK-01`–`TOK-27`), enabled per §2.6; tokens as template building blocks;
the object layer — selection and manipulation gestures, resize, rotate, z-order, align, position presets,
wrap modes with square/tight/through/top-and-bottom and the L1 float loop, alt text, and the drawing
inspector (`OBJ-01`–`OBJ-38` minus the deferred items).

Depends on: P3 for tables and images (objects anchor in table cells), P2 for the gesture/undo contract.
Exit criterion: **a template with `{{tokens}}` over a table fills from a data object, reports its issues,
and the filled document exports to PDF with the same layout as the preview.**
Effort: ~9–12 weeks.

### P5 — Fidelity depth, quality and reach

Ships: the remaining fidelity work — chart and diagram and OLE preservation, `altChunk` (only if ADR-0019
says yes), custom XML and data binding, mail-merge fields, glossary building blocks, and the field
evaluator (`SC-01`–`SC-07`, `MED-03`, `ANN-01`–`ANN-05`, `SET-01`, `SET-02`); the export matrix beyond DOCX
and PDF — HTML, Markdown, plain text, print (`EXO-01`–`EXO-03`, `EXP-03`, `EXP-07`); PDF/A and tagged PDF
(`EXP-09`, `EXP-10`) once ADR-0006 and the archiving authority have answered; accessibility hardening to
the I7 contract; i18n completeness for `ro-RO` and `ru-RU`; and the deferred `later` items, each behind its
interface.

Depends on: P4 for the object and token surfaces that key features here consume.
Exit criterion: **the FL0–FL3 ledger is empty for FL0/FL1 targets on the whole corpus, the fuzz and
round-trip suites are green, and the product's own acceptance documents open and export without a loss the
ledger did not predict.**
Effort: ~12–18 weeks, deliberately spread; this phase is a queue, not a milestone.

### Dependency summary

```
P0 ──► P1 ──► P2 ──► P3 ──► P4 ──► P5
        │             │
        └─ divergence └─ export matrix, FL ledger
           detector      grow here
```

Two hard edges that a re-plan may not move: **P0 before P1** (the units and the determinism lint are what
keep the engine single-sourced), and **P1 before P2** (caret geometry is derived from `LayoutResult`, so
editing cannot precede layout without a second geometry source — the exact defect this specification
exists to prevent). Everything else may be resequenced if the product needs a feature earlier, at the cost
of the phase's exit criterion no longer being meaningful.

---

## 5. Non-goals

Stated with the reason, because the reason is what makes a non-goal stick.

**Document formats**
- **`.doc`, OLE-CFB binary.** Detect by magic bytes and throw `LEGACY_DOC_NOT_SUPPORTED`; never attempt a
  partial parse. A half-parse produces a document that looks right and is not, which is worse than a
  refusal.
- **Encrypted OOXML decryption in v1.** Detected and refused with `PACKAGE_ENCRYPTED`. The honest error is
  the deliverable; a decryption path we cannot test against every producer is a liability.
- **Rights-managed / IRM documents.** Refuse with `PACKAGE_RIGHTS_MANAGED`; there is no legitimate way to
  honour the policy and no way to fail softly.
- **Strict OOXML as a first-class input** unless ADR-0016 says otherwise. Detect, preserve, and report; the
  initial release does not need a second conformance dialect in the model.
- **`altChunk` flattening** unless the template product needs it (ADR-0019). It is a whole import pipeline,
  and it can never be done implicitly.

**Layout**
- **Complex-script shaping** beyond what the font-binary shaper provides for Arabic, Hebrew and the
  Devanagari family; **no** re-implementation of HarfBuzz. The product's scripts are Latin and Cyrillic,
  both of which the shaper handles without a full shaping engine.
- **Knuth-Plass or any optimal-fit breaking.** Word is greedy; a document that grows a line cannot be
  scored by an algorithm Word does not use.
- **Math layout.** OMML is preserved as opaque markup and never laid out or edited.
- **Charts, SmartArt, diagrams and OLE are preserved, never edited.** Editing chart data and embedded
  spreadsheets is out of scope; the parts round-trip untouched, which is what a contract needs.
- **Revision marks are modelled and preserved, not authored.** Revisions are never auto-accepted, and the
  review workflow is not ours to build until the review model is owned.
- **Ink, 3D and media objects** beyond round-tripping them.

**Model**
- **HTML as an editing substrate.** HTML is an export target only, and is not a round-trip format. This is
  the single most important non-goal in the document: every previous failure mode in this product category
  traces back to a round trip through HTML.
- **A second geometry representation.** There is no px-based model, no measured-DOM layout, and no
  `contenteditable` page layer. §1.2 is the whole of it.
- **Forced image re-encoding**, and **converting VML to DrawingML**. Both destroy byte-identity for no gain.
- **Writing back derived state.** Except for the one documented case (an explicit "turn bold off" on
  styled text), the file never records what the cascade computed.
- **Claiming to be Word.** `/Producer`, `docProps/app.xml` and the `Generator` meta tag always name docier.

**Product surface**
- **A brand palette.** The library ships theme variables with no values that constitute a brand; a
  framework-agnostic library must not impose one.
- **Storage.** Recent files, autosave destinations, host settings and the custom dictionary are the host's.
- **A server.** `docier-render` is a deployment option, not a hosted service we operate; the library must
  work with no server at all, offline, in a browser.
- **Forging or removing document protection.** We honour it or we refuse; we do not break it.
- **A sound-alike ("sounds like") search mode.** We have no phonetic engine, so the feature is absent from
  the UI rather than present and broken.
- **Silently creating styles from repeated formatting.** A repeated direct pattern is surfaced as
  `docier:style:suggestion` and the host decides.

**Out of scope for the specification, and owned elsewhere**
Framework bindings (`@docier/react`, `@docier/vue`, `@docier/svelte`) are thin adapters written against
§2 and carry no logic. The server render path, signing/qualified signatures, and PDF encryption are
covered by their own ADRs, and the country-specific archival profile is a customer decision the library
implements but does not choose.
