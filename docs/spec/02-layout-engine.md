# 02 - Layout, Pagination & Typography Engine

| | |
|---|---|
| **Spec id** | `02-layout-engine` |
| **Library** | docier - framework-agnostic TypeScript DOCX editor |
| **Domain** | Layout, pagination, typography |
| **Status** | Draft for implementation |
| **Depends on** | `01-document-model` (OOXML ingest, normalized tree), `03-editing-commands`, `04-rendering`, `05-export` |
| **Is depended on by** | `04-rendering` (DOM renderer consumes only the LayoutResult), `05-export` (PDF writer consumes the same LayoutResult), `03-editing-commands` (caret, hit testing, selection geometry), the optional tokenization module (token replacement must not change layout semantics) |
| **Hard constraint** | Layout must be **Word-faithful**. Where this spec and intuition disagree, Word wins. |

---

## 0. The failure this document exists to prevent

A previous attempt at this product edited the document in a `contenteditable` and kept a hand-maintained
CSS mirror of the layout engine's constants. Screen and PDF diverged continuously - unit systems disagreed,
fonts differed, margins collapsed differently, list spacing differed - and **nothing detected it**. Bugs were
found by users, on documents, in production.

The root cause was not any single wrong constant. It was that **two layout engines existed** and there was no
mechanism that could notice. This spec's first job is architectural: make a second layout engine
structurally impossible, and make any residual divergence loud.

Everything else in this document - line breaking, tables, floats, footnotes - is a feature catalogue that
hangs off that architecture.

---

## 1. Single source of layout truth

### 1.1 The decision

> **The DOM renders *from* the layout result. The browser never lays out text.**

The engine computes every position, every line break, every page break, every baseline, every box edge, in
its own coordinate system, before any DOM node exists. The renderer is a *painter*: it creates elements at
the coordinates the engine produced and applies only properties that affect **paint**, never **position**.

The alternative ("let the browser lay out, then read the result back and reconcile") is rejected outright.
It cannot be made Word-faithful (the browser is not Word), it gives two authorities (WHO is right when they
differ?), and it makes PDF export a separate implementation of layout, which is precisely the failure above.

### 1.2 What "the layout result" is

One immutable value, produced by one module, hashed, and consumed by everything:

```
LayoutResult = {
  version: number              // monotonically increasing per document revision
  documentHash: string         // hash of the normalized model + style resolution + font registry
  pages: PageFragment[]        // ordered; structurally shared with the previous result
  stories: Map<StoryId, Story> // body, per-section headers/footers, footnote/endnote areas, textboxes
  indices: {                   // derived, rebuilt per version
    positionToFragment: (docPos) => FragmentRef
    pageToFragmentRange: PageIndex
    fragmentToPage: (docPos) => number
  }
  diagnostics: LayoutDiagnostic[]
}
```

- `PageFragment` → `BlockFragment[]` → `LineFragment[]` → `RunFragment[]` (+ `BoxFragment` for images,
  floats, text boxes, note areas, table borders, shading).
- Fragments are **plain data**, `readonly`, with integer coordinates. No DOM references, no callbacks, no
  classes with behaviour. `structuredClone`-able, `postMessage`-able, JSON-serializable for golden tests.
- The renderer, the PDF writer, the caret, the selection, the hit tester and the divergence detector are all
  **pure functions of `LayoutResult`**. If any of them needs something the result does not carry, the fix is
  to add it to the result, never to recompute it downstream.

### 1.3 Coordinate system and unit

| Property | Decision |
|---|---|
| Origin | Top-left of page 1's top-left corner, +x right, +y down |
| Y axis | **Continuous across pages.** Page *n* occupies `y ∈ [n · pageHeight, (n+1) · pageHeight)`. Page-local coordinates are derived (`y - page.y`), never stored twice |
| Unit | **Integer millipoints (mp)**, `1 mp = 1/1000 pt`. Type `Mp = number & {__mp:true}` |
| Types | All geometry is `Mp` (i32 range: ±2.1 M pt; documents are < 100 k pt). All arithmetic on integers, `round()` at defined boundaries only |
| Determinism | Same document + same font registry ⇒ byte-identical `LayoutResult`, in Chrome, Firefox, Safari, Node and a worker. No floats in the result, no `Date`, no locale-dependent `toLocaleString`, no `Math.random` |

Why millipoints and not twips (Word's own 1/1440") or EMU (1/914400") or px:

- Twips are too coarse for glyph advances: a 12 pt DejaVu Sans `m` is 13.05 pt = 260.9 twips. Rounding every
  glyph advance to a twip accumulates ~0.5 twip/glyph, ≈ 1.5 pt across an 80-character line - a visible,
  cascading reflow.
- EMU is fine in precision but its scale factor to pt (12700) makes every conversion a division with no exact
  binary representation, and i32 overflows on page-height math (a 792 pt page is 10 M EMU; summing with
  floats reintroduces nondeterminism).
- px is `devicePixelRatio`-dependent by definition, i.e. the exact disease we are eliminating. px appears
  **nowhere** in the engine.

Conversion constants (all exact integers, defined once in `src/layout/units.ts`):

```
twip → mp      × 50                 (1/1440 in × 1000/72)
halfPoint → mp × 500                (w:sz, w:position)
eighthPoint → mp × 125              (w:sz inside w:pBdr/tcBorders)
emu → mp       round(emu * 1000 / 12700)   (1 pt = 12700 EMU)
point (fr)     × 1000
```

`emu → mp` is the only lossy conversion an ingest performs; it is applied once, at ingest, and never again.

### 1.4 Where pt → px happens

**Exactly once, in the renderer, in one function:**

```ts
// src/layout/units.ts - the only place px exists in the codebase
const CSS_PX_PER_PT = 96 / 72;
export const toCssPx = (mp: Mp, zoom: number): number =>
  (mp / 1000) * CSS_PX_PER_PT * zoom;
export const toPt = (mp: Mp): number => mp / 1000;   // PDF export path only
```

- The **PDF writer never calls `toCssPx`**. It calls `toPt` and writes `Td`/`Tm` operators from the same mp
  values. Screen and PDF therefore consume identical numbers and differ only by a constant scale of 4/3 that
  is exact in both directions.
- An ESLint rule (`no-restricted-syntax` in `src/render/**` and `src/export/**`) forbids numeric literals
  `/1000`, `/750`, `*0.75`, `*1.3333` outside `units.ts`, so a second conversion site cannot be introduced by
  accident. This rule is part of the definition of done for the renderer package, not a nicety.

### 1.5 Zoom

**Zoom is a paint-time scale factor passed into the renderer. It never reaches the engine and never
invalidates a `LayoutResult`.**

- `toCssPx(mp, zoom)` scales geometry *and* font-size together, so type scales with the page and the page's
  aspect never changes.
- Zoom does **not** re-run line breaking. Line breaks are zoom-invariant (Word does not reflow on zoom either).
  Asserted in tests: `layout(doc, zoom=0.5).pages.length === layout(doc, zoom=2).pages.length` and the
  `documentHash` is identical, because zoom is not an input to the engine at all.
- Zoom is **not** implemented as CSS `transform: scale()` on the page element. A transform would (a) re-rasterize
  or blur text depending on engine and compositing, (b) break caret/hit-test math unless every input is
  un-transformed by hand - i.e. a second coordinate system, which is the thing we have banned, and (c) break
  `position: fixed` overlays and native scroll into-view. Pinch-zoom may show a **transient** CSS transform
  preview for smoothness, but on settle the renderer recomputes at the new `zoom` and drops the transform.
  Layout is cached, so a zoom change is a re-paint of visible pages only.
- Independent scale knobs exist (page fit-width, fit-page, explicit `N%`) and are all expressed as a single
  scalar into `toCssPx`. There is one number, in one place.

### 1.6 When the engine and the browser disagree

The question "what if the engine's line breaking disagrees with the browser's?" has a deliberately
unsatisfying answer: **the browser's line breaking cannot happen**, so it cannot disagree.

- No rendered text element is ever allowed to wrap. Every `RunFragment` renders inside a
  `white-space: pre; overflow: visible; word-break: normal; overflow-wrap: normal;` box that is
  `position: absolute` with an explicit `left` and `top`. CSS has no wrapping to perform and no flow to
  reflow: it receives final glyph positions.
- A `RunFragment`'s box is emitted at the engine's x **per run**, so a residual advance error inside one run
  cannot push text later on the line, cannot re-break a line, and cannot change page count. The error is
  bounded to the end of one run, and usually to fractions of a pixel.
- Three layers protect against the residual:

| Layer | Mechanism |
|---|---|
| **Prevent** | Engine owns breaking, positioning, alignment, sizing, spacing. The renderer is forbidden from emitting anything that participates in layout (see §1.7) |
| **Bound** | Per-run absolute placement caps any advance disagreement to one run; page geometry, baselines and line breaks are never derived from DOM measurement |
| **Detect** | `DivergenceDetector` (LE-005) measures the *rendered* DOM after paint and compares to the engine's mp numbers; a mismatch beyond tolerance emits `LayoutDivergence` with the run, both widths, the resolved font, and the document hash, and fails CI |

The realistic causes of a real disagreement are all *measurement* bugs, and all are caught at measure time or
detect time, in this order of likelihood:

1. **Font substitution** - the DOCX names `Times New Roman`, the machine lacks it, the browser silently picks
   something else. Prevented by the font registry (§1.8): the engine resolves every DOCX font name to a
   concrete bundled font *before* measuring, records the substitution, and reports it. The renderer emits the
   resolved family, not the DOCX name.
2. **Missing glyphs** - a character absent from the resolved font. Detected during shaping (`.notdef`
   coverage check) and raised as `MissingGlyph`, never silently tofu'd with a different font's advance.
3. **Kerning / feature mismatch** - `w:kern` above threshold, or a browser applying `liga`/`kern` we didn't.
   The renderer pins `font-kerning`, `font-variant-ligatures` and `font-feature-settings` to the engine's
   shaping configuration, and shaping is done by the engine from the font binary, not by `measureText`.
4. **Sub-pixel rounding** - the only irreducible residue; bounded per run, and the detector's tolerance.

### 1.7 What CSS is allowed to do

The renderer is a **paint-only substrate**. Allowed properties: `position`, `left`, `top`, `width`, `height`,
`font-family`, `font-size`, `font-weight`, `font-style`, `font-kerning`, `font-variant-*`,
`font-feature-settings`, `line-height` (set from the engine so the browser's internal baseline agrees),
`color`, `background-color`, `background-image`, `border-*` (drawn by the engine, so only as a *replication*
of an engine-emitted border rect), `text-decoration`, `transform` (paint effects: rotation, flip only),
`opacity`, `z-index`, `visibility`, `overflow: visible`.

Forbidden anywhere on the document surface: `display: inline` flow, `margin`/`padding` that affects position,
`text-align`, `text-indent`, `float`, `columns`, `flex`, `grid`, `width: auto`, `height: auto`,
`line-height: normal`, `letter-spacing`, `word-spacing`, `white-space` other than `pre`, `text-wrap`,
`hyphens`. A stylelint config denies them in `src/render/**` and the review checklist names them.

If a designer wants a spacing change on screen, the change is made to the engine and it appears in the PDF
too. That is the whole point.

### 1.8 Fonts (the WYSIWYG precondition)

The engine measures and the browser paints **the same bytes**, or nothing is guaranteed:

- docier ships a **default font set** (DejaVu Sans, DejaVu Serif, Liberation Serif/Sans/Mono, and a
  Cyrillic+Latin complete serif) with metrics parsed from the binaries, and loads them via `FontFace` into the
  render surface. The editing surface uses the **PDF font**, so the editor is WYSIWYG by construction.
- A DOCX-embedded font (`w:embedRegular`/`w:embedBold`/`w:embedItalic` inside `w:fontTable`) is extracted and
  registered; obfuscated (`w:fontKey`, the 32-byte XOR header) fonts are de-obfuscated.
- The host application may register additional fonts. The registry is an **input to the layout engine and part
  of `documentHash`** - a font change invalidates layout, a zoom change does not.
- Unresolvable font names resolve through an explicit, configurable substitution table (e.g.
  `Times New Roman → Liberation Serif`), never through browser fallback. Every substitution is a diagnostic.
- The presentation layer (`--doc-font`) and the layout engine read the same registry. There is no second font
  list in CSS.

---

## 2. Pass order (the core deliverable)

Layout is a **deterministic, topologically ordered pipeline of 15 passes**, with **four bounded fixed-point
loops** where Word itself has circular dependencies. Every pass is a pure function of the model plus the
outputs of the passes it depends on. Passes are individually cacheable and individually invalidatable - that
is what makes incremental relayout (LE-064) possible.

### 2.1 The passes

| # | Pass | Consumes | Produces | Depends on |
|---|---|---|---|---|
| **P0** | **Ingest & style resolution** | OOXML tree, styles part, theme, numbering, settings | Normalized tree with *flat, fully resolved* property bags; no style indirection remains | - |
| **P1** | **Sectioning & page setup** | P0 | Ordered sections: page size, orientation, margins, gutter, columns, header/footer refs, page borders, `vAlign`, line-numbering config, per-section block ranges | P0 |
| **P2** | **Font resolution & metrics** | P0, P1, font registry, embedded fonts | Concrete font per character run; `FontMetrics` (ascent, descent, lineGap, capHeight, advances, kern pairs) parsed from the binaries | P0, P1 |
| **P3** | **Shaping & inline atomization** | P0, P2 | `InlineAtom[]` per paragraph: glyph clusters with advances, plus tabs, breaks, inline drawings, note refs, field results. Every atom has a measured `xAdvance` in mp | P2 |
| **P4** | **Bidi & paragraph direction** | P0, P3 | Per-atom Unicode bidi level; paragraph base direction; logical→visual run order (applied at line assembly) | P3 |
| **P5** | **Intrinsic width measurement** | P3, P4 | Per block: `minWidth` (widest unbreakable unit) and `preferredWidth` (unwrapped). No line breaking - pure shaping arithmetic | P3, P4 |
| **P6** | **Table column resolution** | P5 (recursively), P1 | Every table's grid resolved to concrete column widths in mp; cell content boxes fixed | P5 |
| **P7** | **Header/footer layout** | P3-P6 applied to each header/footer story, P1 | Per (section × page-kind) header/footer fragments + **stack heights** | P3-P6 |
| **P8** | **Content box resolution** | P1, P7 | Body content box **per page kind** (first / even / odd): top and bottom displaced by actual header/footer heights | P7 |
| **P9** | **Line breaking** | P3, P4, P5, P8; **loop L1** with P10 | `LineFragment`s: atom ranges, break positions, line widths, caret stops | P8 |
| **P9a** | *provisional break* (no float exclusions) | | | |
| **P9b** | *anchor/float resolution* (→ P10) | | | |
| **P9c** | *re-break of affected paragraphs with exclusion bands* | | | |
| **P10** | **Float, frame & exclusion resolution** | P9a, P0 | Anchored object boxes: x/y/w/h, wrap mode, wrap polygon, exclusion bands per page/column | P9a |
| **P11** | **Line assembly** | P9, P10 | Baseline y per line; line advance from line-height rules; inter-atom x positions in visual order; per-line ascent/descent | P9c |
| **P12** | **Justification** | P11 | Final x positions with distributed space; exact right-edge landing; alignment per line | P11 |
| **P13** | **Block flow & pagination** | P11, P12, P5, P6; **loop with P14** | Vertical machine: paragraph spacing, keeps, widow/orphan, page/column breaks, table row placement and row splitting, footnote reservation. Assigns every fragment to a page + region | P12 |
| **P14** | **Footnote/endnote placement** *(loop L2)* | P13, P3-P12 applied to note stories | Note-area fragments per page; displaced body lines when the note area overflows | P13 |
| **P15** | **Section balancing & break types** | P13, P14 | Column balancing for continuous sections, even/odd-page forcing, section-level vertical alignment | P14 |
| **P16** | **Page-count convergence** *(loop L3)* | P7, P13-P15 | Header/footer heights and field widths re-resolved against the real page count | P15 |
| **P17** | **Finalization** | all | Immutable `LayoutResult`, indices, diagnostics, hash, per-page dirty diff vs the previous version | all |

### 2.2 Why this order (the dependency edges that force it)

```
P0 ─┬─> P1 ─┬────────────────────────────> P8 ─┐
    │       │                                  │
    ├─> P2 ─> P3 ─> P4 ─> P5 ─> P6 ─> P7 ──────┤
    │              │          ↑                 │
    │              └──────────┘ (P6 needs intrinsic widths of cell content)
    │                                          ↓
    │                                   P9a ─> P10 ─> P9c ─> P11 ─> P12 ─> P13 ─┐
    │                                    ↑                                    │
    │                                    └─────── L1: exclusions ─────────────┘
    │                                                         P13 <──> P14 (L2)
    │                                                         P14 ─> P15 ─> P16 (L3) ─> P17
```

Edges that are non-obvious and must not be "optimized" away:

1. **Shaping (P3) before breaking (P9).** Advances and unbreakable units come from shaping. Anything that
   breaks a line before knowing a glyph's advance is guessing.
2. **Intrinsic widths (P5) before table columns (P6) before line breaking (P9).** A table's column widths
   depend on the min/preferred width of *cell content*, which requires shaping the cell's paragraphs but not
   breaking them. Getting column widths wrong changes every line inside the table, so this edge is hard.
   P5 is deliberately a *cheap* pass (shaping arithmetic, no line construction) so this edge does not cost
   a second full text pass.
3. **Table columns (P6) before headers (P7), because a header can contain a table**, and before line
   breaking for the same reason. P6 recurses to arbitrary depth (nested tables) and must terminate on depth
   limits, not on width resolution failure.
4. **Headers (P7) before the content box (P8) before body line breaking (P9).** A header taller than its
   margin area displaces the body's top edge, so the body's available width is not knowable until the header
   is laid out. Header height is content-dependent and **page-kind-dependent** - first-page and even-page
   headers can have different heights, so the content box is computed **per page kind**, not per section.
   This is a real Word behaviour and a common source of "we're one line off" bugs.
5. **Anchored floats (P10) inside the breaking pass (P9).** A square-wrapped image shrinks the lines beside
   it; its y depends on the line it is anchored to. This is genuinely circular (loop **L1**). It is contained
   by splitting line breaking into provisional → anchor → re-break, and by the rule that only anchors relative
   to *line* or *paragraph* can move; anchors relative to *page*, *margin* or *column* have positions
   independent of text and are resolved before the provisional break.
6. **Justification (P12) after line assembly (P11).** Justification distributes space *within* the line's
   already-chosen atom range. It can never change the range - a justified line that would overflow is a
   line-breaking bug, not a justification bug.
7. **Pagination (P13) after justification (P12).** Pagination consumes *heights*, and heights come from
   assembled lines. Justification does not change height, so P12 and P13 could theoretically be swapped; they
   are not, because the vertical machine also needs final caret geometry for the selection/hit-test indices.
8. **Footnotes (P14) after pagination (P13), and iterated.** Notes occupy space at the bottom of the page;
   the body lines they displace can carry further notes; a displaced line's note moves with it. Word does
   this iteratively and so do we (loop **L2**).
9. **Balancing (P15) after pagination (P13).** Column balancing on the last page of a continuous section is
   only computable from the section's total content height, which only exists after the vertical machine has
   run.
10. **Page-count convergence (P16) last.** `NUMPAGES`/`SECTIONPAGES` in a header change the header's width,
    which can change the header's height, which changes the content box, which changes pagination, which
    changes the page count. Loop **L3**, bounded.

### 2.3 The four loops, with convergence rules

Every loop is **bounded, deterministic, and self-reporting**. None may run unbounded; a non-converged loop
emits a diagnostic and freezes its last state rather than freezing the editor.

| Loop | Between | Iteration rule | Bail-out |
|---|---|---|---|
| **L1** Float exclusions | P9a ⇄ P10 ⇄ P9c | Provisional break → place anchors → compute exclusion bands → re-break only paragraphs whose line bands intersect a band. Max 3 iterations; anchor positions freeze after iteration 2 | Place floats at their final iteration positions, keep the last break, emit `FLOAT_UNSTABLE` with the offending anchor ids |
| **L2** Footnote displacement | P13 ⇄ P14 | Lay out body → place notes for the page → if body+notes exceed the content height, move the minimum number of body lines (carrying their notes) to the next page. Max 4 iterations per page | Accept overflow onto the following page's note area with a continuation separator (Word does this too), emit `NOTE_OVERFLOW` |
| **L3** Page-count/header | P16 ⇄ P7/P13 | If any header/footer field width or auto-sized element depends on the page count, re-run P7→P15 with the new count. Max 3 iterations | Use the last iteration, emit `PAGECOUNT_UNSTABLE` (Word's own "1 of 1 until you print" behaviour) - this is a real Word-observable state, not a bug |
| **L4** Incremental resync | LE-064 | Not a layout loop but a scheduling loop: re-run the dirty suffix until a page whose fragment set is identical to the previous version is reached | Stop at the document end; re-publish the whole tail |

### 2.4 Pass cost and what a single keystroke re-runs

| Scenario | Passes re-run |
|---|---|
| Type one character in a paragraph | P3 (one paragraph) → P9 (one paragraph) → P11-P12 (one paragraph). Then, asynchronously: P13 from that point, P14-P17 as needed |
| Change a run's bold | P3 → P9 → P11 → P12 for the paragraph, then forward pagination |
| Change a cell's text | P5 → P6 for the table → P9-P12 for the cell → P13 row heights |
| Change page margins | P7 → P8 → everything |
| Change a font in the registry | P2 → everything |
| Change the header text | P3-P7 (header story) → P8 → P9 forward (content box changed) → everything below |

The invariant that protects typing latency: **paragraph-local relayout is synchronous and always
correct; pagination is asynchronous and eventually consistent** (LE-064).

---

## 3. Feature catalogue

Field legend - **Pass**: pipeline pass from §2. **OOXML**: the element/attribute that carries the behaviour.
**Pri**: `core` (blocks the MVP / is required for Word fidelity on ordinary HR documents) · `important`
(needed for real documents, ships shortly after) · `later` (rare in the target corpus, or explicitly out of
the first release). **Effort**: S (< 1 week) · M (1-3 weeks) · L (3-6 weeks) · XL (> 6 weeks).

### A. Truth model and guardrails

---

**LE-001 - Millipoint coordinate system and determinism contract**
**Pass** all · **OOXML** all measurement attributes · **Pri** core · **Effort** S

- Every geometric value in `LayoutResult` is an integer `Mp` (1/1000 pt). Floats are permitted only inside
  measurement and shaping, never in the emitted result.
- Rounding is defined per conversion and applied **once**: `emu→mp` and `eighthPoint→mp` round half-to-even;
  advances are summed as integers and rounded only at the sum (never per glyph), so 40 glyphs cannot each
  contribute 0.5 mp of drift.
- Conversion constants live in `src/layout/units.ts` and are the only place twips, half-points, eighths,
  EMU, pt and px are related. `twip×50`, `halfPoint×500`, `eighthPoint×125`, `emu×1000/12700`.
- Invariants asserted in tests: `layout(x) === layout(x)` byte-for-byte across Chrome/Firefox/Safari/Node;
  `documentHash` excludes zoom, viewport size, `devicePixelRatio`, selection and locale; `documentHash`
  includes the font registry, the compat flags, and every resolved style.
- Edge cases: negative indents produce negative `Mp`; i32 is sufficient for any page up to 100 000 pt; no
  `Infinity`/`NaN` may appear in a result - a producing pass must throw instead.

---

**LE-002 - The DOM renders from the layout result (no browser flow)**
**Pass** P17 / renderer · **OOXML** n/a · **Pri** core · **Effort** M

- The page surface is built as: page container (`position: relative`, explicit `width`/`height` from
  `toCssPx`) → absolutely positioned fragment boxes at engine coordinates. No element participates in flow.
- One absolutely positioned box **per `RunFragment`**, never one wrapping element per line or paragraph.
  This bounds every residual browser advance error to a single run.
- `white-space: pre` and no wrapping-related properties on text boxes, so the browser has no break
  opportunity to take. `overflow: visible`.
- `line-height` and `font-size` are set from the engine so the browser's internal baseline placement agrees
  with the engine's baseline arithmetic; the box's `top` is `baselineY − ascent`, computed by the engine.
- Text is not `contenteditable`. Caret, selection and IME use the overlays described in LE-007 and the
  hidden composition host from spec `03-editing-commands`; **no geometry is ever read back from the DOM**
  except by the divergence detector.
- Edge cases: a run split across a line break becomes two fragments; a run split across a page break becomes
  two fragments on two pages; a run inside a rotated text box carries a `transform` that is a paint effect
  only (hit testing uses the inverse transform from the model, not from the DOM).

---

**LE-003 - Paint-only CSS contract, enforced by lint**
**Pass** renderer · **OOXML** n/a · **Pri** core · **Effort** S

- The allowed property list of §1.7 is codified in `stylelint` config for `src/render/**`. Forbidden:
  `text-align`, `text-indent`, `float`, `letter-spacing`, `word-spacing`, `hyphens`, `white-space` other than
  `pre`, `margin`, `padding`, `width: auto`, `line-height: normal`, and all layout containers.
- An ESLint `no-restricted-syntax` rule forbids arithmetic on layout numbers outside `units.ts` (the
  `/1000`, `/750`, `*0.75` family) - this is what prevents a second unit system from being reintroduced.
- A repository test scans the renderer package for these patterns and fails the build. Removing the check is
  a spec violation, not a refactor.

---

**LE-004 - Zoom as a pure paint scale (type scales with the page)**
**Pass** renderer · **OOXML** n/a · **Pri** core · **Effort** S

- Zoom is one scalar passed to `toCssPx` for geometry **and** `font-size`, so glyphs scale with the page and
  line breaks are invariant.
- Changing zoom must not invalidate or recompute a `LayoutResult`. Asserted by hash equality.
- Fit-width / fit-page / explicit percentage all collapse to that scalar.
- Pinch/ctrl-wheel may use a transient CSS transform on the page container for smoothness; on settle the
  transform is removed and the page re-painted at the new scale. During a transient transform, hit testing is
  **suppressed** (clicks that land mid-gesture are replayed by the host) so no code path ever does inverse
  transform math.
- Edge case: at very small zoom, `toCssPx` may yield sub-pixel box sizes; boxes are never rounded to whole px
  (rounding positions is how a 1 px accumulation across a page appears), only the browser's compositor
  rounding applies, and it applies to each box independently - no accumulation.

---

**LE-005 - Divergence detector (dev + CI)**
**Pass** P17 + renderer · **OOXML** n/a · **Pri** core · **Effort** M

The direct answer to "nothing detected it".

- After paint (dev builds, and always in CI), the detector samples every rendered `RunFragment` and compares
  the browser's measured box to the engine's numbers: run width, run `top`/`left`, line baseline y, page
  count, page box size.
- Tolerance: 0.5 CSS px per run (accumulation is structurally impossible, so this is a flat threshold), 0 px
  on page count and page size. Any exceedance emits `LayoutDivergence { docHash, fragmentId, engineWidthMp,
  renderedWidthPx, resolvedFontFamily, fontFileHash, text }` and fails the CI job.
- Detects, by construction: font substitution, missing glyphs, kerning/ligature mismatch, a hand-authored CSS
  regression, a stale `LayoutResult` rendered against a newer model (via `version` mismatch), and a renderer
  that started reading the DOM and feeding it back.
- Also runs as an assertion in the PDF parity test: a browser screenshot at zoom 1 and a rasterized PDF page
  from the same `LayoutResult` must differ only within rasterizer anti-aliasing tolerance.

---

**LE-006 - PDF parity by construction**
**Pass** P17 / export · **OOXML** n/a · **Pri** core · **Effort** M

- The PDF writer receives the same `LayoutResult` object the DOM renderer received. It never re-shapes, never
  re-breaks, never re-measures.
- mp → pt via `toPt` (exact /1000). Text is emitted as positioned glyph runs with the same font file (subset
  + embedded) the engine measured, so advances are identical by construction rather than by luck.
- The PDF writer is therefore ~a serialiser, and any layout feature automatically appears in both targets.
  A feature that "works on screen but not in the PDF" is a renderer bug by definition, and this invariant is
  what makes that statement true rather than aspirational.
- Page boxes, margins and content boxes come from the result, not from a PDF-specific page setup.

---

**LE-007 - Engine-derived caret, selection and hit testing**
**Pass** P9/P11 + services · **OOXML** n/a · **Pri** core · **Effort** M

- Caret stops are produced by the line breaker (LE-023): for every inter-atom boundary, a stop with x (from
  atom advances), y (baseline), and bidi level. The caret is drawn by the editor's overlay, never by the
  browser's caret.
- Hit testing: point → page → line band (nearest baseline by y within the paragraph) → nearest caret stop by
  x, with bidi affinity rules at level changes. Clicking right of the last stop on a line snaps to the line
  end; clicking below the last line of a paragraph snaps to the paragraph end; clicking in a margin snaps to
  the nearest position on that line.
- Selection = the union of fragment rects between two document positions, per line, so a selection across
  pages and table cells yields one rect per line with correct start/end x on the first and last lines.
- Edge cases: selection across a page break produces one rect per visible line; a caret inside a float's
  wrap exclusion still resolves against the line's caret stops (the line's stops already exclude the float);
  a caret at a table row boundary resolves to the adjacent cell's nearest position, never to the row.

---

### B. Ingest and resolution (layout-relevant)

---

**LE-008 - Style resolution to flat property bags**
**Pass** P0 · **OOXML** `w:styles`, `w:docDefaults`, `w:latentStyles`, `w:basedOn`, `w:link`,
`w:tblStylePr`, `w:pPr`, `w:rPr`, `w:theme` · **Pri** core · **Effort** L

- Resolve, in order: `docDefaults` → paragraph/character style chain (`basedOn`, cycle-safe) → linked
  character style → direct formatting → `w:rPr` in `w:pPr` (paragraph-mark formatting) → table style with
  **conditional formatting** (`firstRow`, `lastRow`, `firstCol`, `lastCol`, `band1Horz`, `band2Horz`, …)
  applied in ECMA-376 order with the correct `w:tblLook` mask.
- Toggle properties (`w:b`, `w:i`, `w:caps`, `w:smallCaps`, `w:strike` and their `Cs` counterparts) **toggle**
  rather than override when inherited: b(true) under b(true) is false. Getting this wrong silently unbolds
  half a contract.
- `w:sz` is half-points → mp (×500); `w:szCs` applies to complex-script runs; `w:spacing` (in twips),
  `w:ind`, `w:jc`, `w:keepNext`, `w:keepLines`, `w:pageBreakBefore`, `w:widowControl`, `w:snapToGrid`,
  `w:contextualSpacing` are inherited through the paragraph style chain only, never from character styles.
- Theme fonts (`w:rFonts w:asciiTheme`, `w:hAnsiTheme`, `w:cs`, `w:eastAsia`) resolve through the theme part's
  major/minor font scheme, honouring `w:themeFontLang`.
- Output is a **flat bag per node with no inheritance left**, so no later pass can re-derive a property
  differently. Style-resolution bugs are thereby confined to one pass and one test file.
- Edge cases: styles.xml missing entirely (use docDefaults + the built-in defaults table); `w:styleId`
  duplicated (last wins, emit a diagnostic); a `basedOn` cycle (break at the cycle, emit a diagnostic, keep
  the partial chain); `w:semiHidden`/`w:unhideWhenUsed` styles are irrelevant to layout but must not be
  dropped if referenced.

---

**LE-009 - Settings and compatibility flags that change layout**
**Pass** P0 · **OOXML** `w:settings` · **Pri** core · **Effort** M

- Consumed: `w:defaultTabStop` (twips), `w:autoHyphenation`, `w:hyphenationZone`, `w:consecutiveHyphenLimit`,
  `w:doNotHyphenateCaps`, `w:evenAndOddHeaders`, `w:mirrorMargins`, `w:gutterAtTop`/`w:rtlGutter`,
  `w:compat` entries (`doNotExpandShiftReturn`, `suppressTopSpacing`, `suppressSpBfAfterPgBrk`,
  `doNotWrapTextWithPunct`, `doNotUseHTMLParagraphAutoSpacing`, `useWord2002TableStyleRules`,
  `doNotBreakWrappedTables`, `doNotVertAlignInTxbx`, `doNotUseIndentAsNumberingTabStop`,
  `ulTrailSpace`), `w:displayBackgroundShape`, `w:displayHorizontalDrawingGridEvery` /
  `w:displayVerticalDrawingGridEvery` (drawing grid **off** in our rendering; the grid is a Word UI aid, and
  `w:docGrid` is the layout-affecting one), `w:characterSpacingControl`.
- Each consumed flag is recorded in `documentHash` and in the resolved settings object, so no pass reads a
  flag out of the raw XML.
- Flags we deliberately do **not** follow (`w:removePersonalInformation`, `w:trackRevisions` display) are
  listed in a single `UNSUPPORTED_COMPAT` table with a diagnostic when present, so the omissions are explicit
  rather than accidental.
- Edge case: `w:suppressTopSpacing` at the top of a page removes a paragraph's space-before only for the
  first paragraph of the body - not for the first paragraph after a page break in the middle of a document
  unless `suppressSpBfAfterPgBrk` is set. These two flags are separate and commonly confused.

---

**LE-010 - Romanian and Russian text normalization (layout-visible)**
**Pass** P0 · **OOXML** `w:lang`, `w:rFonts` · **Pri** core · **Effort** S

- **Romanian**: normalize the legacy cedilla forms U+015F/U+0163 (ş ţ) to the correct comma-below U+0219/U+021B
  (ș ț) at ingest **only when the resolved language is `ro-*` and the character is not part of a protected
  token**, recording the change as a `NormalizationNote`. This is invisible to layout only if the font
  covers both; DejaVu Sans does, so width is identical, but the rendered glyph differs - hence the note and
  a report to the host app so the tokenizer's output can be fixed at source rather than at every save.
- **Russian**: preserve `ё`/`Ё` exactly as authored (never fold to е); hyphenation and case operations are
  `ё`-aware. Record `w:lang w:val="ru-RU"` for hyphenation dictionary selection.
- Script itemization for mixed Cyrillic/Latin runs: a Cyrillic character inside a run whose `w:rFonts`
  `w:cs` differs from `w:ascii` resolves against `w:cs`; without this, a font that covers Latin but not
  Cyrillic produces tofu on every Russian document - and with browser fallback, produces *a different width*,
  which is worse.
- Edge cases: NBSP (U+00A0) and word joiner (U+2060) used inside Romanian/Russian phrases must survive
  normalization untouched (they are line-break control, not text - see LE-024); a token placeholder from the
  tokenization module is a single unbreakable atom and is never normalized.

---

**LE-011 - Numbering and list geometry resolution**
**Pass** P0 (consumed by P3, P9) · **OOXML** `w:numbering`, `w:abstractNum`, `w:lvl`,
`w:lvlOverride`, `w:numPr`, `w:numFmt`, `w:lvlText`, `w:lvlJc`, `w:suff`, `w:startOverride` · **Pri** core ·
**Effort** L

- Lists affect layout through **indentation and the number's own width**, and that is exactly the area the
  previous implementation got wrong ("list spacing differed").
- Resolve per level: `w:ind` on the level's `w:pPr` gives the number's x (left/hanging) and the text's x;
  `w:lvlJc` (left/center/right) positions the number within the gap; `w:suff` (tab/space/nothing) determines
  what follows the number - `tab` advances to the next tab stop **after** the hanging indent position, which
  is the classic "why is my list text 0.25 in off" bug.
- `w:lvlText` is assembled from `%1`..`%9` placeholders with per-level `w:numFmt` (decimal, lowerLetter,
  upperRoman, bullet with a literal character, `ro`/`ru` locale-aware formats), producing a **numbered run**
  that occupies real width and is measured like any other text.
- Numbering restarts: `w:startOverride` on `w:num`, `w:lvlRestart`, and the implicit restart when a
  higher-level counter increments. A wrong counter value changes the number's digit count, which changes a
  hanging-indent list's text start - layout is affected, so counter resolution belongs in P0, not in a
  separate "numbering module" consultable later.
- Bullets are characters from a symbol font (Symbol/Wingdings). The font registry maps them to a bundled
  glyph source (LE-013), because a missing bullet glyph is the single most common all-documents-are-wrong
  failure for DOCX renderers.
- Edge cases: a paragraph with `w:numPr` referencing a missing `w:numId` (fall back to no numbering,
  diagnostic); `w:numId=0` means "no numbering"; a list item inside a table cell continues the numbering of
  the surrounding list unless `w:lvlRestart` says otherwise; 9-level nesting depth limit; a numbered list
  whose number is wider than its hanging indent overlaps the text (Word does not clip it - mirror that).

---

### C. Fonts, metrics and shaping

---

**LE-012 - Font registry and deterministic resolution**
**Pass** P2 · **OOXML** `w:fontTable`, `w:rFonts`, `w:theme`, `w:altName`, `w:panose1`, `w:charset`,
`w:family` · **Pri** core · **Effort** M

- A DOCX font name is resolved **by the engine** to a concrete font file before any measurement, through an
  ordered chain: document-embedded font → host-registered font → bundled default set → explicit substitution
  table → declared failure. Browser fallback is never consulted and never trusted.
- `w:altName` is honoured; `w:panose1`/`w:family`/`w:charset` are used to pick a metrically sane substitute
  when only the family class is known (serif → serif), never a sans substitute for a serif.
- Every substitution is recorded as `FontSubstitution { requested, resolved, reason }` and surfaced to the
  host app, because a substituted font changes pagination and the user must be told.
- The resolved set of (font name → file hash) is part of `documentHash`; loading a font that was not present
  at layout time triggers a full relayout, which is correct and must be automatic.
- Edge cases: `w:rFonts` may specify `w:hint="eastAsia"` changing which attribute wins; a font name with
  leading/trailing whitespace or a case difference must resolve to the same file; `w:cs` missing entirely on
  a Cyrillic run falls back to `w:ascii`.

---

**LE-013 - Embedded and obfuscated fonts**
**Pass** P2 · **OOXML** `w:embedRegular`, `w:embedBold`, `w:embedItalic`, `w:embedBoldItalic`,
`w:fontKey`, `w:embedTrueType`/`w:embedSystemFonts` in `w:settings` · **Pri** important · **Effort** M

- Extract embedded font parts from the package (including `.odttf`), apply the documented 32-byte XOR
  de-obfuscation using `w:fontKey`, validate the sfnt header, and register.
- Respect the embedding permissions bits (`fsType` in OS/2): if the font forbids editing embedding, use it for
  measurement and screen display but **do not** subset-embed it in an exported PDF; substitute instead and
  emit a diagnostic. This is a legal posture, not a technical one, and it must be explicit.
- Fonts referenced but not embedded resolve through LE-012.
- Edge cases: an embedded font that fails to parse falls back with a diagnostic rather than throwing; a
  subsetted embedded font (`w:subsetted="1"`) has no complete `cmap` - treat it as display-only and prefer a
  bundled substitute for measurement if the substitute's metrics are within tolerance, otherwise use it and
  flag the risk.

---

**LE-014 - Metric extraction from the font binary**
**Pass** P2 · **OOXML** n/a (font tables) · **Pri** core · **Effort** L

- Parse the sfnt directly: `head.unitsPerEm`, `hhea`(ascent, descent, lineGap, numberOfHMetrics), `hmtx`
  advances, `OS/2` (`sTypoAscender/Descender/LineGap`, `usWinAscent/Descent`, `sCapHeight`, `sxHeight`,
  `fsType`, `ulUnicodeRange`), `post`, `cmap` (format 4 and 12), `kern` (format 0 pairs), and `GPOS`
  PairPos when kerning is enabled.
- **Line box rule (Word-faithful):** a single line's height is `(winAscent + winDescent + lineGap) / unitsPerEm
  × fontSize` using the OS/2 **win** metrics, with the `hhea` values as the fallback when OS/2 is absent
  (`OS/2` version 0 has no `sTypoLineGap` guarantee). For DejaVu Sans this yields ≈1.164 × font size, which
  is why Word's "single" spacing is not 1.0 × font size.
- Glyph advance `= hmtx.advance / unitsPerEm × fontSize`, accumulated with kerning adjustments, and rounded
  **once** at the aggregate (LE-001).
- Coverage check: every character in every run is tested against `cmap`; a miss is a `MissingGlyph`
  diagnostic carrying the code point (this is what catches a Romanian ș in a font built before 2005, and a
  Cyrillic char in a Latin-only font).
- Edge cases: fonts with `unitsPerEm = 2048` (DejaVu) vs `1000` (CFF/OTF) vs `2048`/`4096`;
  `.notdef` advance used when no fallback exists, but flagged; `numberOfHMetrics < numGlyphs` (monospaced
  tail) handled by repeating the last advance; CFF/OTF (`CFF ` table) parsed for the same metrics.

---

**LE-015 - Shaping, kerning and ligatures**
**Pass** P3 · **OOXML** `w:kern`, `w:rFonts` · **Pri** core · **Effort** L

- Shaping is done by the engine from the font binary - **not** by `CanvasRenderingContext2D.measureText`.
  `measureText` results differ across engines and platforms, cannot run in a worker without an
  `OffscreenCanvas` font-loading dance, and cannot run in Node for golden tests. All three matter.
- Default feature set: `kern` **off** unless `w:kern w:val` is set *and* the font size ≥ the threshold (Word's
  documented behaviour), `liga`/`clig`/`dlig` **off** (Word does not enable discretionary ligatures), `calt`
  on, `smcp` off (small caps are synthesised - LE-017), `tnum`/`pnum` per `w:rFonts`-adjacent settings if
  present.
- Kerning pairs come from `kern` format 0 and, when present, `GPOS` PairPos format 1/2 for the scripts in
  scope. Since ro/ru/en are all simple alphabetic scripts, this is tractable; complex-script shaping
  (Arabic, Indic, Khmer) is explicitly out of scope for v1 with the interface shaped for a future
  HarfBuzz-wasm backend (`Shaper` interface, one implementation).
- The chosen feature set is written into the renderer's `font-feature-settings` so the browser applies
  exactly the same features (this is a paint-only property, allowed by LE-003).
- Edge cases: a kern pair that makes the advance negative (clamped to the pair's value, never to zero);
  combining marks (`U+0301`, Romanian/Russian accents) attach to the base with **zero advance**, and a run
  must never break between a base and its combining mark; ZWJ/ZWNJ in the text are respected.

---

**LE-016 - Measurement and shaping cache**
**Pass** P3 · **OOXML** n/a · **Pri** core · **Effort** M

- Two-level cache. **Shaping cache**: key `(fontFileHash, text, fontSizeMp, featuresHash)` →
  `{ glyphIds, advances: Mp[], clusterMap, widthMp }`. **Paragraph break cache**: key
  `(paragraphRevision, columnWidthMp, exclusionProfileHash, breakerConfigHash)` → `LineFragment[]`.
- Both are bounded LRU with a memory budget (default ~32 MB of advances) and both are safe to drop at any
  time; dropping them costs time, never correctness.
- The cache makes the common incremental cases (scroll, zoom, re-render, undo of a formatting toggle) free,
  and makes the paragraph-local synchronous relayout (LE-064) cheap enough to run inside a keystroke.
- Edge cases: cache keys must include the font file **hash**, not the family name (a substituted font is a
  different key); a cache entry must never be reused across a `documentHash` change in the font registry
  dimension.

---

**LE-017 - Run metric properties: spacing, scale, position, caps, hidden, vertAlign**
**Pass** P3 · **OOXML** `w:spacing`, `w:w`, `w:position`, `w:caps`, `w:smallCaps`, `w:vanish`,
`w:vertAlign`, `w:fitText` · **Pri** core · **Effort** M

- `w:spacing` (twips, may be negative) adds to **every** glyph advance including the last in the run; it is
  applied during shaping so line breaking sees the real width.
- `w:w` is horizontal character scale in percent (applied per glyph, rounded once per run).
- `w:position` (half-points, may be negative) raises/lowers the glyph baseline without changing the line
  height and **without** changing advances (Word's raised text can extend the line box only in specific
  cases; we mirror the common case: no height change).
- `w:smallCaps` synthesises small caps at the font's `smcp` if available, else at a **scaled font size** -
  the scale factor is a fixed 0.8 with the real cap height from `OS/2.sCapHeight` used to correct the
  baseline, rather than scaling from the font size alone. `w:caps` uppercases via full Unicode case mapping
  (locale-aware, which matters for `i`→`İ` in Turkish documents but not ro/ru; the mapping is
  language-tagged).
- `w:vanish` (hidden text) occupies **zero width** in layout and is not rendered, matching Word's default.
  Hidden text that is *shown* (an editor preference) is a render-time flag, and when enabled it is laid out
  like normal text and emits a different `documentHash` dimension for the flag.
- `w:vertAlign` superscript/subscript: scale by the font's own `OS/2` superscript metrics when present, else
  the conventional 0.65 scale with a raised baseline - and the resulting advance must be used, because
  superscript footnote references change line widths.
- `w:fitText` (fit a run to a given width by scaling): supported by measuring then applying a per-run scale
  factor; `w:fitText w:id` ties the runs together to one scale computed from their combined width.
- Edge cases: negative `w:spacing` large enough to make an advance negative (clamp at 0 and diagnose); caps
  applied to a ligature-forming pair (case first, then shape); `w:caps` plus `w:smallCaps` together (caps
  wins, Word's order).

---

### D. Inline structure, bidi, fields

---

**LE-018 - Inline atomization (run → atoms)**
**Pass** P3 · **OOXML** `w:r`, `w:t`, `w:tab`, `w:br`, `w:cr`, `w:noBreakHyphen`, `w:softHyphen`,
`w:sym`, `w:drawing`, `w:pict`, `w:object`, `w:footnoteReference`, `w:fldChar`, `w:instrText`,
`w:oMath`, `w:ruby` · **Pri** core · **Effort** M

- The output is a flat, ordered `InlineAtom[]` per paragraph. Atom kinds: `Cluster` (glyph cluster with
  advance), `Tab`, `Break` (line), `ColumnBreak`, `PageBreak`, `Symbol` (from `w:sym`, which names a font by
  `w:font` and a code point - resolved like any other font), `InlineDrawing`, `NoteRef`, `FieldMarker`,
  `MathBox`, `Ruby`, `FldResult`.
- `w:cr` and `w:br` are both hard line breaks; `w:br w:type="page"` is a page break; `"column"` is a column
  break; `"textWrapping"` (the default) is a line break. A hard break **ends a line unconditionally** and
  the resulting lines are not justified (unless `w:jc="distribute"`).
- `w:noBreakHyphen` is a non-breaking hyphen (it is a break *inhibitor*), `w:softHyphen` is a
  discretionary break that renders as a hyphen **only** when taken - the classic implementation bug is
  rendering it always.
- Every atom carries its source range so a caret stop maps back to a model position (LE-007).
- Edge cases: a paragraph whose only content is an inline drawing (the line height comes from the object);
  a `w:t` containing only whitespace between two drawings (it must survive, because it is a break
  opportunity); `xml:space="preserve"` is already handled at ingest but leading/trailing spaces in a run
  still affect breaking (LE-027).

---

**LE-019 - Bidirectional text (UAX #9)**
**Pass** P4 · **OOXML** `w:bidi`, `w:rtl` (rPr), `w:lang w:bidi`, `w:rtlGutter` · **Pri** important ·
**Effort** L

- Full UAX #9 with explicit, paragraph and weak/neutral types, isolating run sequences, and the
  `w:bidi`-driven base direction (explicit `w:bidi` on `w:pPr` overrides; otherwise first strong character
  per UAX #9 rule P2/P3, with a `w:lang` heuristic only when the paragraph has no strong character).
- `w:rtl` on a run sets its embedding level independently of the text's own bidi class.
- Visual reordering happens **per line**, after breaking (logical order is what the breaker sees, which is
  what UAX #14 requires). A line's atoms are reordered to visual order by level runs, then x-accumulated
  from the line's start edge.
- Mirrored characters (parentheses, brackets, `<`, `>`) are resolved via the `Bidi_Mirrored` property, not
  by a hardcoded table.
- Numbers keep LTR order inside RTL text, and a leading minus/plus attaches to the number (bidi class
  handling of `ET`/`EN` - the "‎-5" vs "5-" bug).
- Edge cases: `w:rtl` on `w:rPr` inside a bidi paragraph (level override); a table cell whose paragraph is
  RTL inside an LTR table (`w:bidiVisual` governs the *table's* column order, not the cell's text - two
  independent switches, commonly conflated); tab stops in an RTL paragraph mirror about the right margin
  (LE-024).

---

**LE-020 - RTL/LTR mirroring of layout properties**
**Pass** P4 (applied in P6, P9, P11, P13) · **OOXML** `w:bidi`, `w:mirrorIndents`, `w:bidiVisual`,
`w:lvlJc`, `w:tab w:val="start"|"end"`, `w:jc` · **Pri** important · **Effort** M

- When a paragraph is RTL (or `w:mirrorIndents` is set), the following mirror about the paragraph's text
  edges: left/right indents, left/right paragraph borders and their spacing, tab stop positions and
  alignment (`left`↔`right`, `center` stays centered), the list number's side and `w:lvlJc`, float anchor
  sides and wrap distances, and the "start" edge for alignment.
- `w:jc` values `left`/`right` are interpreted with bidi awareness as `start`/`end` for RTL paragraphs
  (Word's observed behaviour); `w:jc="start"`/`"end"` are the unambiguous forms.
- `w:bidiVisual` on a table mirrors **column order** (grid column 1 renders rightmost) and mirrors cell
  borders horizontally; it does **not** change cell text direction.
- Edge cases: mirroring a hanging indent turns it into a right-side hanging indent without changing the
  first-line offset magnitude; mirror margins (`w:mirrorMargins` in settings) alternate the left/right
  margin on even/odd pages and is a **section-level** mirror, not a paragraph-level one.

---

**LE-021 - Fields whose result occupies space**
**Pass** P3 (+ P16 for page-count fields) · **OOXML** `w:fldSimple`, `w:fldChar`, `w:instrText`,
`w:fldLock`, `w:dirty` · **Pri** core · **Effort** M

- Layout never parses field instructions. It lays out the **cached result** (runs between `separate` and
  `end`), which is what Word itself displays before a field update. A field with no cached result (a
  never-opened document) renders as a zero-width placeholder flagged `FieldNoResult` for the host app to
  resolve - we never guess a value, because a guessed value changes line widths silently.
- Fields the layout engine resolves itself, because they are page-dependent: `PAGE`, `NUMPAGES`,
  `SECTIONPAGES`, `SECTION`. Their widths feed loop L3 (LE-060).
- A field's result can contain formatting, breaks or even a drawing and is laid out as ordinary atoms
  (fields are transparent to the inline pipeline). Nesting is handled by depth counting, not recursion.
- `w:fldChar` results that are locked or dirty are still laid out from the cached result; "dirty" affects
  only whether the editing side recomputes, never geometry.
- Edge cases: unbalanced `begin`/`end` (recover, diagnostic); a `w:fldChar` split across runs/paragraphs
  (a field can span a paragraph boundary - the cached result then spans paragraphs and must be laid out as
  such, which is why field state lives in the story, not in a paragraph); `w:instrText` containing a
  quoted string with an escaped quote.

---

**LE-022 - Notes and other out-of-line stories as inline references**
**Pass** P3 (ref) / P13-adjacent · **OOXML** `w:footnoteReference`, `w:endnoteReference`,
`w:annotationRef`, `w:commentReference`, `w:footnoteRef` (in note text) · **Pri** core · **Effort** S

- A note reference is an inline atom whose width comes from the formatted reference mark (superscript by
  default, size from the reference's `w:rPr` - usually the `FootnoteReference` character style). It is a
  real, measured, breakable-adjacent atom: a footnote reference is a common cause of "one line too many".
- The note's *body* is a separate story laid out in the note area (LE-061); the reference atom and the note
  body are linked by id, and moving a reference moves its note - which is why the note belongs to the
  paragraph and the paragraph's page, not to the page directly.
- Comment references (`w:commentReference`) render a small mark whose size comes from the same style chain,
  and their ranges are exported for the comment overlay.
- Edge cases: a reference inside a table cell whose row is split (the note belongs to the page where the
  reference's fragment lands, which the pagination pass must decide before notes are placed - hence loop
  L2); a footnote reference inside a footnote (Word forbids it; we lay it out but emit a diagnostic);
  endnote references are numbered in a separate sequence from footnotes.

---

### E. Line breaking and hyphenation

---

**LE-023 - Greedy line breaking (the decision), Word-faithful**
**Pass** P9 · **OOXML** `w:jc`, `w:wordWrap`, `w:overflowPunct`, `w:kinsoku` · **Pri** core · **Effort** L

**Decision: greedy (first-fit) breaking is the only breaker used for the editing surface and for the
default PDF path.** Knuth-Plass is rejected as the default, for three reasons that are all hard:

1. **Word is greedy.** The fixed design decision is Word fidelity. KP produces different break points, so a
   document would paginate differently from Word, and "Word-faithful" would be false in the most visible
   possible way (line endings). The whole point of the product is that an HR manager's contract looks like
   the DOCX they authored.
2. **Incremental relayout.** KP optimizes over the whole paragraph, so a one-character edit can move the
   first break of the paragraph backwards. That destroys the local-invalidation model (LE-064) that keeps
   typing fast on a long document, and it produces visible reflow of text the user is not editing.
3. **Determinism and cost.** KP needs a feasible-break graph with demerits; for a 40-page document with
   tables it multiplies the per-edit cost by roughly the paragraph's line count.

Rules of the greedy breaker (all Word-observable):

- Fill the line with atoms while the accumulated advance ≤ available width. The line ends before the first
  atom that would overflow.
- Available width = `columnWidth − leftIndent − rightIndent − (float/object exclusion bands intersecting the
  line's vertical band)`. First-line and hanging indents adjust the **first** line's available width.
- A trailing run of collapsible spaces at a break is **not counted** toward the line width and is rendered
  zero-width (but still counted as a stretch point for justification). Without this rule, every justified
  paragraph loses words to the next line one time in twenty.
- A hard break (`w:br`, `w:cr`) ends the line unconditionally; a paragraph's final line always ends at the
  paragraph mark.
- `w:wordWrap w:val="false"` (allow Latin text to break at any character - a CJK-oriented setting) and
  `w:overflowPunct` are honoured; `w:overflowPunct` allows punctuation to hang past the right margin
  instead of being pushed down.
- The breaker emits caret stops as a by-product (LE-007) - it is the only pass that knows all break
  positions.

---

**LE-024 - Break opportunities per language, and non-breaking constructs**
**Pass** P9 · **OOXML** `w:noBreakHyphen`, `w:softHyphen`, `w:tab`, `w:compat` flags · **Pri** core ·
**Effort** M

- A Unicode UAX #14 subset, tuned for ro/ru/en, defines after which characters a line may break. Latin and
  Cyrillic: breaks after a space, after a hyphen, after a solidus in some cases, never before a closing
  punctuation mark, never between a base and a combining mark, never before a `%` or a currency symbol
  attached to a number.
- **Inhibitors:** NBSP (U+00A0), narrow NBSP (U+202F), word joiner (U+2060), ZWNJ (U+200C), and the
  non-breaking hyphen (`w:noBreakHyphen`, U+2011) all forbid a break at their position. Romanian and Russian
  text routinely uses NBSP to keep short prepositions and initials on the same line - a breaker that treats
  NBSP as a plain space produces visibly wrong line endings on exactly our target documents.
- **Discretionary:** `w:softHyphen` (U+00AD) and ZWSP (U+200B) create opportunities that render nothing
  unless taken. A soft hyphen that becomes a break renders as a visible hyphen **at the line end only**.
- Leading spaces at the start of a wrapped line are collapsed to zero and are not counted in the line width.
- A tab is not a break opportunity: a tab advances to the next tab stop, and a line whose remaining width
  cannot reach the next stop either overflows or (Word's behaviour) treats the tab as a single space's
  worth of advance. The chosen behaviour: the tab advances to the stop if it fits, otherwise the line breaks
  before the tab. This is a documented fidelity risk and a golden-test case.
- Edge cases: a run of 50 spaces (kept, breakable, collapsed at line end); a zero-width cluster at a break
  position; a soft hyphen at the very start of a line (never taken); `w:t` elements split mid-word across
  runs (breaking works on atoms, so a run boundary is invisible - this is a correctness requirement, not an
  optimization).

---

**LE-025 - Hyphenation for Romanian, Russian and English**
**Pass** P9 · **OOXML** `w:suppressAutoHyphens`, `w:autoHyphenation`, `w:hyphenationZone`,
`w:consecutiveHyphenLimit`, `w:doNotHyphenateCaps`, `w:lang` · **Pri** important · **Effort** L

- Dictionary-driven hyphenation using Liang's pattern algorithm over hyphenation patterns bundled with the
  library: `ro` (Romanian patterns), `ru` (Russian), `en-US`/`en-GB`. Pattern sets are permissively licensed
  (TeX `hyph-utf8` / hunspell hyphenation dictionaries) and shipped as compact tries, ~100-300 KB total for
  the three languages.
- Word-equivalent controls: `w:autoHyphenation` enables it for the document; `w:suppressAutoHyphens` disables
  it per paragraph; `w:hyphenationZone` (twips) makes the breaker hyphenate only when the resulting rag would
  otherwise exceed the zone - this is the weird one and must be implemented as written, or hyphenation
  breaks lines Word would not; `w:consecutiveHyphenLimit` caps consecutive hyphenated lines (default 2 in
  Word when unset); `w:doNotHyphenateCaps` skips words in full caps.
- Language selection is per-run via `w:lang w:val`, not per document. Mixed ro/ru documents hyphenate each
  run by its own language; a run with no language falls back to the document default (`w:themeFontLang`).
- **Russian specifics**: never hyphenate across a hard sign / soft sign in the wrong position; do not
  hyphenate a word whose remaining part is a single letter; digits and mixed alphanumerics (contract
  numbers, IDNO) are never hyphenated.
- **Romanian specifics**: hyphenation must not separate `ii` at a word end into an ugly single vowel; the
  cedilla/comma-below normalization (LE-010) happens before hyphenation so patterns match.
- Left-hyphen minimum: Word will hyphenate leaving 2 characters before the hyphen; enforce the same
  (a 1-character fragment is never produced, hyphenated or not).
- Edge cases: a hyphenated word inside a table cell, in a header, in a footnote (all supported - the
  hyphenator is a pure function of text + language); a word longer than the line (breaks at the minimum
  fragment, overflowing only if even that fails - Word overflows too); hyphenation interacting with
  justification (a hyphenated line is stretched like any other).
- **Priority note**: hyphenation off by default unless the document enables it - matching Word - so the
  common HR document is unaffected and the fidelity surface stays small.

---

**LE-026 - Justification: space distribution and exact edge landing**
**Pass** P12 · **OOXML** `w:jc`, `w:spacing`, `w:adjustRightInd`, `w:snapToGrid` · **Pri** core ·
**Effort** M

- `w:jc` values: `both` (justified), `left`/`start`, `right`/`end`, `center`, `distribute` (and
  `thaiDistribute`), `kashida*` variants (LE-028). Mapping to bidi-aware start/end per LE-020.
- **Inter-word only.** Extra space is distributed **across existing space atoms only**; Word does not add
  letter-spacing to justify Latin or Cyrillic text. Adding letter-spacing (a common shortcut) is what makes
  a renderer look "not quite Word".
- **Exact landing.** After distribution, the line's right edge must land **exactly** on the right margin
  (for `both`). Distribution is therefore computed in mp with a largest-remainder assignment of the
  rounding residue across the spaces, so no line ends 1 mp short and no accumulation is possible.
- **Lines not justified:** the last line of a paragraph, the line before a hard break, and the single line
  of a one-line paragraph. `w:jc="distribute"` justifies them too (distributing across characters), which is
  the East Asian behaviour Word exposes for Latin as well.
- Interaction with tabs and inline objects: a tab-created gap is **not** stretched, but the *spaces* in a
  line containing a tab are; an inline drawing is an unbreakable atom whose surrounding space stretches
  normally.
- `w:adjustRightInd` and grid snapping can pull the right edge off the margin when `w:docGrid` is active
  (LE-031) - the grid wins over justification.
- Edge cases: a line with **zero** space atoms (a single long word, or a line of one drawing) cannot be
  justified - it is set ragged (Word does the same) and, if it overflows, overflows; a line inside a table
  cell justifies against the **cell's** content width, not the page's; a line ending with a trailing space
  run collapses that run before distributing.

---

**LE-027 - Drop caps (exclusion-based)**
**Pass** P9/P10 (exclusion) + P11 · **OOXML** `w:framePr w:dropCap="drop"|"margin"`, `w:lines`,
`w:wrap`, `w:vAnchor`, `w:hAnchor` · **Pri** important · **Effort** M

- A drop cap is modelled as **an exclusion band for the first N lines of its paragraph**, reusing the float
  machinery (LE-056) rather than a bespoke implementation. `w:dropCap="drop"` indents those lines by the
  cap's width; `"margin"` places the cap in the margin and indents nothing.
- `w:lines="3"` sets the number of lines the cap spans; the cap's font size is **derived** from the line
  heights it must span (the engine computes the size, it does not trust a size in the file).
- The cap's first line shares the baseline of the first body line it sits beside.
- Edge cases: `w:lines` larger than the paragraph's line count (the cap spans the whole paragraph and its
  height defines the paragraph's height); a drop cap in a paragraph that is itself inside a table cell
  (supported, exclusion relative to the cell); a drop cap followed by a hard break (the break line is
  excluded too); a drop cap whose character is a ligature-forming pair (only the first character drops).

---

**LE-028 - Kashida justification (Arabic) - deferred**
**Pass** P12 · **OOXML** `w:jc="lowKashida"|"mediumKashida"|"highKashida"` · **Pri** later · **Effort** M

- Arabic-script documents justify by elongating connections (kashida) rather than only adding word space.
- Deferred because the target corpus (Romanian, Russian, English HR documents) does not exercise it; the
  `Shaper` interface and the P12 hook are present so it can be added without re-architecting.
- When implemented: kashida insertion points come from the shaper's justification opportunities, and the
  allotted elongation is distributed by priority (word space first up to a threshold, then kashida), which
  is Word's observed order.

---

**LE-029 - East Asian line breaking (kinsoku) - deferred**
**Pass** P9 · **OOXML** `w:kinsoku`, `w:overflowPunct`, `w:topLinePunct`, `w:autoSpaceDE`,
`w:autoSpaceDN`, `w:wordWrap` · **Pri** later · **Effort** M

- Rules for breaking between CJK characters, prohibiting a line start with closing punctuation and a line
  end with opening punctuation, and the `w:compat` flags that control hanging punctuation.
- Deferred with the interface in place: the breaker already consults a per-character break-class table, so
  the CJK classes are additive rather than structural.

---

**LE-030 - Trailing/leading whitespace and empty-line semantics**
**Pass** P9 · **OOXML** `w:p` with no runs, `w:r` with only `w:t` spaces, `w:sectPr` in `w:pPr` · **Pri** core ·
**Effort** S

- An empty paragraph produces exactly one line whose height is the paragraph mark's font line height (not
  zero, and not the paragraph's `w:spacing w:line` if that is smaller - Word uses `max(line, fontHeight)`
  for an empty paragraph with `auto` spacing).
- Leading and trailing spaces on an empty-but-for-spaces paragraph are preserved (they are why the line is
  not empty) but collapse at a soft break.
- Multi-space runs are preserved (never collapsed as HTML would); the previous implementation's HTML-shaped
  mental model is a trap here.
- A paragraph containing only a `w:sectPr` is not rendered as content but still participates in section
  splitting (LE-008, LE-041).
- Edge cases: a paragraph whose font is larger than the line spacing (`exact` line rule clipping the
  paragraph mark); an empty paragraph at the very start of a document with `suppressTopSpacing`.

---

**LE-031 - Deterministic behaviour when a constraint cannot be satisfied**
**Pass** P13 · **OOXML** `w:keepLines`, `w:keepNext`, `w:widowControl`, `w:cantSplit` · **Pri** core ·
**Effort** M

- Keeps are **preferences with defined fallbacks**, never hard constraints that can hang the layout. The
  fallback ladder, applied in order:
  1. If a paragraph with `w:keepLines` does not fit in the remaining space, move it whole to the next page.
  2. If it does not fit on an **empty** page (taller than the content box), ignore `keepLines` and break it,
     emitting `KEEP_UNSATISFIABLE`.
  3. `w:keepNext` chains: walk the chain forward; if the chain (transitively, including across tables) does
     not fit, move the whole chain to the next page. A chain longer than a page is broken at the last
     satisfiable point.
  4. `w:widowControl` requires ≥2 lines of a paragraph on each side of a break. If the paragraph has fewer
     than 2 lines total, the constraint is vacuous. If a paragraph cannot satisfy it on an empty page
     (impossible for ≥2-line paragraphs, possible for a 2-line paragraph with `exact` line rules), the
     constraint is dropped with a diagnostic.
- This pass is the reason `LayoutResult` carries `diagnostics`: an unsatisfiable constraint is **reported**,
  not silently resolved differently in two code paths.

---

**LE-032 - Widow and orphan control**
**Pass** P13 · **OOXML** `w:widowControl` (default **on**) · **Pri** core · **Effort** M

- With `w:widowControl` on: a page break may not leave fewer than **2 lines** of a paragraph on either side.
  Concretely, if the paragraph would be split such that 1 line lands on the current page, push the whole
  paragraph (or push one line) so that 2 remain; if the split would leave 1 line on the next page, pull one
  line back up.
- Implemented as a post-check inside the vertical machine with a bounded lookahead of one line, not as a
  global optimization.
- `w:widowControl w:val="false"` disables it for the paragraph; the document default comes from
  `docDefaults`/the Normal style and is **on** in every Word-generated document.
- Interaction with `keepLines`: if all lines must be together, widow control is trivially satisfied.
- Edge cases: a paragraph with exactly 2 lines where the second line does not fit (both lines move - the
  whole paragraph moves if it fits, otherwise the split happens anyway with a diagnostic); widow control
  across a column break (applies per column, not per page); widow control interacting with a following
  table's header row (the header row moves with at least one body row - LE-050).

---

**LE-033 - Keep-with-next and keep-lines-together**
**Pass** P13 · **OOXML** `w:keepNext`, `w:keepLines` · **Pri** core · **Effort** M

- `w:keepNext` keeps a paragraph with the **next** paragraph, requiring at least the next paragraph's first
  line (or, if the next is a table, its first row) to be on the same page. Chains are transitive: a heading
  with `keepNext` followed by three `keepNext` paragraphs moves as a unit.
- `w:keepLines` keeps **all** lines of the paragraph on one page (excluding the case where it does not fit
  on a page at all, LE-031).
- Both are honoured only when they can be satisfied by moving content forward; they never move content
  **backwards** onto a previous page.
- A heading with `keepNext` at the bottom of a page is the single most common Word-fidelity complaint in
  generated documents, so this pass ships with a golden test for the "heading + 3-paragraph chain at a page
  boundary" case.
- Edge cases: `keepNext` on the last paragraph of a document (no-op); `keepNext` on the last row of a table
  (keeps the table with the following paragraph, honoured by pulling the last row down - Word's behaviour);
  `keepNext` combined with an explicit `w:pageBreakBefore` on the following paragraph (the break wins, and
  the keep becomes vacuous - a diagnostic is emitted for the contradiction).

---

**LE-034 - Page-break-before / page-break-after and hard breaks**
**Pass** P13 · **OOXML** `w:pageBreakBefore`, `w:br w:type="page"`, `w:sectPr` break types · **Pri** core ·
**Effort** S

- `w:pageBreakBefore` forces the paragraph to the top of the next page. It does **not** apply to the first
  paragraph of a document or of a section's first page (Word suppresses a break that would create an empty
  leading page).
- A `w:br w:type="page"` hard break ends the current line and the current page; content after it starts at the
  top of the next page's content box (respecting the new page's header/even-odd differences - which means
  the content box for the *next* page kind must be known, hence P8's per-page-kind boxes).
- The paragraph containing a page break has its `w:spacing w:before` suppressed if
  `w:compat/w:suppressSpBfAfterPgBrk` is set, else honoured; this is a real difference between documents
  produced by different Word versions.
- Edge cases: two consecutive page breaks (one blank page - Word renders it, so we do); a page break inside a
  table cell (breaks the page, not the row - the row splits at that point); a page break at the very end of
  a document (does not create a trailing blank page in Word; must not here either).

---

### F. Paragraph vertical metrics, borders, shading

---

**LE-035 - Line height: auto, atLeast, exact, and multiple spacing**
**Pass** P11 · **OOXML** `w:spacing w:line`, `w:spacing w:lineRule`, `w:snapToGrid`, `w:docGrid` ·
**Pri** core · **Effort** M

- `w:lineRule="auto"` with `w:line` in 240ths of a line: 240 = single, 360 = 1.5, 480 = double. Single-line
  height is the font's line box (LE-014). The multiple is applied to that, **rounded once** per line.
- `w:lineRule="atLeast"`: the line is at least `w:line` twips tall, more if the content demands.
- `w:lineRule="exact"`: the line is exactly `w:line` tall; taller content **overflows** and is not clipped
  (Word lets it overlap the next line). The line's baseline is positioned from the font's ascent clipped to
  the exact height, which is why exact-spaced lines with big fonts overlap in Word and must overlap here.
- The line box is `max(content ascent+descent, line height from the rule)` - a large inline image or a
  superscript in a small line grows the line (for `auto`/`atLeast`), which is exactly how a document
  "grows" when an image is pasted in, and it is the reason line height cannot be computed from the paragraph
  style alone.
- Baseline placement: `baselineY = lineTop + max(ascent, (lineHeight − (ascent+descent))/2 + ascent)` per the
  rule; consistent between the engine and the renderer (LE-002) or glyphs sit at the wrong y.
- Edge cases: a line containing only an inline drawing (height from the object's extent, not the font);
  mixed font sizes on one line (the max ascent wins, per Word); `w:spacing w:line="0"` with `exact`
  (degenerate: zero-height line, Word renders it; we do too, diagnostic emitted).

---

**LE-036 - Paragraph spacing before/after, auto-spacing, contextual spacing**
**Pass** P13 · **OOXML** `w:spacing w:before`, `w:after`, `w:beforeLines`, `w:afterLines`,
`w:beforeAutospacing`, `w:afterAutospacing`, `w:contextualSpacing`, `w:compat` suppress flags · **Pri** core ·
**Effort** M

- **Word does not collapse margins like CSS.** Adjacent paragraphs' space-after and space-before **add**. The
  previous implementation's CSS-margin mental model collapsed them, which is one of the named divergences.
- Spacing is **not** applied before the first line at the top of a page's content box, and not before the
  first paragraph after a hard page break when `suppressSpBfAfterPgBrk` is set.
- `w:beforeLines`/`w:afterLines` are in hundredths of a line and are alternatives expressed in line units;
  when both are present the `Lines` form wins (Word's precedence), and the value is converted using the
  paragraph's own line height.
- `beforeAutospacing`/`afterAutospacing` (typically from a list style) suppress the spacing between two
  consecutive paragraphs that share the same style and are in the same list (`w:contextualSpacing` semantics
  apply to list paragraphs).
- Spacing is part of the page-fill calculation: a paragraph whose space-before does not fit but whose first
  line would fit is **moved** so that the space and the first line stay together (Word's behaviour, and
  another very visible one-line difference if missed).
- Edge cases: negative `w:after` (allowed, pulls up); the spacing of a paragraph with `keepNext` travelling
  with it; spacing on the last paragraph before a section break; spacing inside a table cell (applied, and it
  contributes to the row height because row height is content height); spacing on an empty paragraph.

---

**LE-037 - Grid snapping and document grid**
**Pass** P11 · **OOXML** `w:docGrid w:type`, `w:linePitch`, `w:charSpace`, `w:snapToGrid`,
`w:compat` grid flags · **Pri** later · **Effort** M

- `w:docGrid w:type="lines"|"linesAndChars"|"snapToChars"` with `w:linePitch` (twips) snaps each line's
  baseline to a grid derived from the content box height, which changes pagination on East-Asian-authored
  templates. `w:snapToGrid` per paragraph opts out.
- Word's rule: when snapping, the line advance is rounded **up** to a multiple of the pitch, and the first
  line is offset so the grid starts at the content box top.
- `w:charSpace` adds character grid pitch, which interacts with justification (`w:adjustRightInd`) and is the
  reason a CJK template's Latin text can look oddly spaced in Word.
- Marked `later` because the target corpus (ro/ru HR documents authored in Word default settings) rarely
  carries a document grid - but it is implemented as a separate, additive step in P11 so that turning it on
  cannot disturb the non-grid path.

---

**LE-038 - Paragraph borders**
**Pass** P11/P13 · **OOXML** `w:pBdr` (`w:top`, `w:left`, `w:bottom`, `w:right`, `w:between`, `w:bar`),
`w:sz` (eighths of a point), `w:space` (points), `w:val` (line style), `w:color`, `w:themeColor` ·
**Pri** important · **Effort** L

- Border geometry: `w:sz` → mp (×125); `w:space` is the offset in **points** from the text edge to the
  border, added to the paragraph's box. The border is drawn **inside** the indented text area (from the left
  indent to the right indent, extended by `w:space` on each side).
- **Collision between adjacent paragraphs:** Word merges identical borders - two consecutive paragraphs with
  identical `w:pBdr` render as one box with the `w:between` (if specified) as an internal separator; with
  *different* borders, both boxes are drawn and the space between them is the sum of the two `w:space`
  values plus the spacing. `w:bar` draws a vertical rule at the left of the paragraph without participating
  in the box.
- **Across a page break:** left and right borders are repeated on every fragment; the top border is drawn
  only on the first fragment and the bottom only on the last. `w:between` is drawn between fragments on the
  same page only.
- Line styles (`w:val`): single, double, dotted, dashed, dashDot, dotDash, triple, thinThickSmallGap,
  wave, doubleWave - rendered as vector primitives in both targets (the PDF writer draws the same primitives,
  LE-006). Dash patterns are defined in absolute units, not scaled to the border width.
- Edge cases: a border wider than the text area (clamp and diagnose); `w:sz="0"` (no line); a border on an
  empty paragraph (the box is drawn around the single empty line); borders in an RTL paragraph mirrored
  (LE-020); a paragraph border inside a table cell (relative to the cell content box).

---

**LE-039 - Paragraph and run shading**
**Pass** P11 (paragraph) / P3-P12 (run) · **OOXML** `w:shd w:val`, `w:fill`, `w:color`,
`w:themeFill`, `w:themeFillTint`, `w:themeFillShade`, `w:pPr/w:shd`, `w:rPr/w:shd` · **Pri** important ·
**Effort** M

- `w:val="clear"` fills with `w:fill`; the patterned values (`pct10`, `diagStripe`, …) fill with an
  alpha-blended `w:fill` over `w:color` at a defined ratio - implemented as a 2-colour blend at paint time
  (a `BoxFragment` with a blend descriptor) so no pattern bitmaps are needed.
- Paragraph shading spans the paragraph's **indented** text area, extends the full height of every line it
  covers including the line box (not just the glyphs), and continues across page breaks on both fragments.
  It does **not** include the space-before/after unless Word includes it - it does not; the shaded box is
  the line stack, and getting this wrong produces the "shading has gaps at the paragraph junction" artifact.
- Run shading spans the run's glyphs only, splits across line and page breaks, excludes trailing spaces at a
  soft break, and is drawn **behind** the text (a separate box fragment ordered before the run fragments).
- Theme colours resolve through the theme's colour scheme with tint/shade applied in HLS, matching Word's
  transformation (this is why `<w:themeFillTint="BF">` must not be treated as a plain hex).
- Edge cases: shading applied to the paragraph mark only (`w:rPr` on `w:pPr`) - Word shades the paragraph
  mark's line, which visually extends the previous paragraph's shading; a run shaded across a page break;
  shading inside a table cell (cell shading paints first, run shading on top).

---

### G. Pagination, columns, sections

---

**LE-040 - The vertical machine (block flow)**
**Pass** P13 · **OOXML** `w:p`, `w:tbl`, `w:sectPr` · **Pri** core · **Effort** L

- One state machine consumes the ordered block list for a section and produces page/column assignments:
  state = `{ pageIndex, pageKind, contentBox, cursorY, columnIndex, columnWidth, activeFloats, activeFootnotes,
  previousParagraphStyle }`.
- Blocks are dispatched by kind: paragraph (line stack), table (LE-045..LE-052), and float anchors (which
  register with the state rather than consuming height, except for `topAndBottom` wraps which do consume).
- The cursor advances by `space-before + line stack + space-after`, with the rules of LE-032, LE-033,
  LE-034, LE-036 applied at the boundaries.
- When the cursor passes the content box bottom, the state advances: next column (if the section has
  columns), else next page (with the appropriate page kind: first/even/odd per `w:settings`
  `evenAndOddHeaders` and `w:titlePg`).
- Backtracking is limited to the block being placed plus the keeps chain; there is no global optimization,
  which is what keeps the pass O(blocks) and incrementally re-runnable.
- Edge cases: a block that is taller than a full content box (split or overflow per the block's own rules);
  an empty section (a section break with no content produces no page); a section whose content box is
  negative-sized by absurd margins (clamp to 0, emit a diagnostic, do not throw).

---

**LE-041 - Section breaks and break types**
**Pass** P13/P15 · **OOXML** `w:sectPr` (`w:type` = nextPage/continuous/evenPage/oddPage,
`w:pgSz`, `w:pgMar`, `w:cols`, `w:titlePg`, `w:paperSrc`, `w:pgNumType`) · **Pri** core · **Effort** L

- `nextPage`: content after the break starts on a new page using the new section's page setup.
- `continuous`: content continues on the same page, but the new section's **page setup** applies - with
  Word's documented exception that a continuous break that changes page size or orientation forces a page
  break anyway (a very common real-world template with one landscape page; getting this wrong makes a
  contract's attachment land in the wrong orientation).
- `evenPage`/`oddPage`: forces the content onto the next even/odd page, inserting a **blank page** if needed,
  whose header/footer is still rendered (blank pages from `evenPage` breaks are real pages in Word and are
  counted by `NUMPAGES`).
- Margin and page-size changes take effect immediately at the section boundary; the gutter and mirror margins
  (LE-020) alternate per page.
- `w:pgNumType w:start` restarts page numbering for the section - this affects the `PAGE` field's *value*
  and thus its width and thus loop L3.
- Edge cases: a section break at the very end of the body (the body-level `w:sectPr` - the final section);
  multiple consecutive section breaks (a deliberately blank page); a section with `w:cols` and a
  `w:sectPr` change mid-document; a `w:sectPr` inside `w:pPr` on a table row (invalid, ignored with a
  diagnostic).

---

**LE-042 - Columns and column balancing**
**Pass** P15 (balance) / P13 (flow) · **OOXML** `w:cols`, `w:col w:w`, `w:space`, `w:equalWidth`,
`w:sep`, `w:br w:type="column"` · **Pri** important · **Effort** L

- Unequal columns: `w:col w:w` per column with `w:space` between; equal columns: `(contentWidth − (n−1) ×
  spacing) / n`, with the remainder distributed so columns sum exactly to the content width.
- `w:sep` draws a vertical separator line centred in each inter-column space, full content-box height.
- **Balancing** applies to the **last page** of a continuous section: lay the section's content out into an
  unbounded single strip to obtain the total height, then distribute into `ceil(total / columnCount)`-tall
  columns. Explicit `w:br w:type="column"` forces a column advance and resets balancing for what follows.
  A section ending in a `nextPage` break is **not** balanced (its last page simply ends).
- Ordering constraint: balancing needs the total height, so it runs after the vertical machine - this is the
  P15 edge in §2.2 and cannot be moved earlier without a throwaway layout.
- Edge cases: a column count of 0 or 1; a column narrower than the widest unbreakable word (overflow, Word
  overflows); a table wider than a column (the table's columns are resolved against the column width, which
  can make a table narrower than in the source document - Word does this too, and it is why tables in
  columns look different); footnotes in a multi-column section are placed at the bottom of the **column** by
  default (`w:footnotePr w:pos`), which is a real Word behaviour and a common surprise.

---

**LE-043 - Section vertical alignment of content**
**Pass** P15 · **OOXML** `w:vAlign` (top/center/both/bottom) · **Pri** later · **Effort** S

- `w:vAlign` shifts the section's content within the content box: `center` centres the content block,
  `bottom` pushes it to the bottom, `both` justifies the inter-paragraph spacing to fill the page.
- Applied per **section** at P15, after pagination, as a translation of every fragment on the affected pages
  - which is why it must run last and must invalidate caret geometry (LE-007 recomputes from fragments).
- Edge cases: a section spanning multiple pages (`vAlign` applies to each page independently, and for
  `both` distributes per page); `vAlign` with a footnote area (the area is excluded from the centring);
  `vAlign` interacting with the header displacement (LE-059) - the content box is the displaced one.

---

**LE-044 - Line numbering**
**Pass** P13 · **OOXML** `w:lnNumType` (`w:countBy`, `w:start`, `w:restart`, `w:distance`),
`w:suppressLineNumbers` · **Pri** later · **Effort** M

- Numbers are placed in the left margin at `w:distance` (twips) from the text edge, right-aligned toward the
  text, and are **outside** the content box (they do not shrink line width; a too-small margin makes them
  overlap the text exactly as Word does).
- `w:countBy="5"` numbers every 5th line; `w:restart="page"|"section"|"continuous"`; `w:start`.
- Only body text lines are counted - not header/footer lines, not table lines, not footnote lines, and not
  lines in a paragraph with `w:suppressLineNumbers`.
- Marked `later`: it appears in legal/contract templates (a plausible HR case for numbered clauses) but is
  absent from the MVP corpus.
- Edge cases: line numbers and a `w:br`-created line (counted as a line); line numbering in a multi-column
  section (each column's lines count continuously); RTL sections put the numbers in the right margin.

---

**LE-045 - Table grid resolution and column widths**
**Pass** P6 · **OOXML** `w:tblGrid`, `w:gridCol w:w`, `w:tblW`, `w:tblLayout w:type` (fixed/autofit),
`w:tcW`, `w:tblInd`, `w:jc` · **Pri** core · **Effort** XL

- **Fixed layout** (`w:tblLayout w:type="fixed"`): column widths come from `w:tblGrid`/`w:gridCol`, scaled if
  `w:tblW` demands a different total; cell `w:tcW` overrides the grid for that cell (and, per Word, can push
  the grid).
- **Autofit** (`type="autofit"`, the Word default): the algorithm is a min/preferred distribution:
  1. Compute each column's **preferred width** = the max unwrapped content width of its cells, and its
     **minimum width** = the widest unbreakable unit (the longest word, the widest inline object, the min
     width of a nested table) - both come from P5 and are the reason P5 exists as its own pass.
  2. Preferred widths are scaled down to fit the available width, proportionally, but **never below** each
     column's minimum.
  3. Columns that hit their minimum are frozen; the remaining deficit is redistributed over the unfrozen
     columns; iterate to a fixed point (bounded at `columnCount` iterations).
  4. If the sum of minima exceeds the available width, the table overflows the content width (Word lets it
     overflow; we do too, with a diagnostic).
- `w:tblW` with `w:type="pct"` (fiftieths of a percent - **not** the same scale as `a:srcRect`, see LE-057)
  sets the target total; `w:type="auto"` uses the preferred total clamped to the available width;
  `w:type="dxa"` is an absolute width, honoured even if it exceeds the content width.
- `w:tblInd` indents the table from the left margin (and from the right in an RTL table, LE-020);
  `w:jc` on `w:tblPr` (left/center/right) aligns the table within the content width and is applied **after**
  column widths are known - a table narrower than the content width is positioned by `w:jc`, not stretched.
- Edge cases: a missing `w:tblGrid` (derive from the first row's cells, diagnostic); more `w:gridCol` than
  cells or vice versa (reconcile to the maximum, diagnostic); a nested table's width contributing to its
  parent cell's minimum; a table inside a table inside a cell (each nesting level re-enters P6 with a
  narrower available width - depth-limited to Word's nesting limit, with a diagnostic beyond it).

---

**LE-046 - Cell measurement and recursive cell layout**
**Pass** P6 (widths) / P13 (heights) · **OOXML** `w:tc`, `w:tcPr`, `w:gridSpan`, `w:vMerge`,
`w:tcMar`, `w:textDirection`, `w:hideMark` · **Pri** core · **Effort** L

- A cell's content box = column width (or the span of columns for `w:gridSpan > 1`) − `w:tcMar`
  (per-cell margins, falling back to `w:tblCellMar`, falling back to the default 0.08 in left/right) −
  borders on each edge (border widths **do** consume space, half the border on each side of the grid line -
  a consistently missed detail that shifts every table's text by a fraction of a point).
- Cell content is laid out by **re-entering the block pipeline** (P9-P13) with the cell's content box as the
  constraint. The cell layout uses the same line breaker, the same justification, the same keeps - there is
  no separate "simple" path for table text, which is exactly where the previous implementation diverged.
- Row height = `max(cell content height for each cell in the row, w:trHeight)`, where a `vMerge` continuation
  cell inherits the height of its merged region rather than contributing its own.
- `w:textDirection` (`lrTb`, `tbRl`, `btLr`, `lrTbV`, `tbRlV`): `tbRl`/`btLr` rotate the cell's content box
  by 90°, swapping the width/height constraints - the line breaker receives a rotated box and the fragments
  carry a paint-only rotation (LE-002). Simplified vertical text (`w:textDirection` on a multi-line cell with
  `w:tcPr` rotation) is supported; full CJK vertical layout is `later`.
- `w:hideMark` affects the paragraph mark's visibility inside the cell, not its height contribution.
- Edge cases: an empty cell (height = the row's height, contributes the cell's minimum line height);
  a cell containing only a nested table; a cell whose content box height is negative (clamp, diagnostic);
  a cell with `w:gridSpan` extending beyond the last grid column (clamp, diagnostic).

---

**LE-047 - Cell and table borders with conflict resolution**
**Pass** P6/P13 (geometry) · **OOXML** `w:tblBorders`, `w:tcBorders`, `w:tblCellSpacing`,
`w:tcBorders` (`w:start`/`w:end`/`w:top`/`w:bottom`/`w:insideH`/`w:insideV`/`w:tl2br`/`w:tr2bl`),
`w:cnfStyle`, `w:tblStylePr` · **Pri** core · **Effort** L

- **Precedence:** `w:tcBorders` beats `w:tblBorders`; conditional table-style borders (`w:cnfStyle` /
  `w:tblStylePr` for firstRow/lastRow/firstCol/lastCol/banding) beat both when the corresponding `w:tblLook`
  bit is set; inside (H/V) borders are drawn by the table, outside by the outer cells.
- **Adjacent-cell conflict:** when two neighbouring cells specify different borders, Word resolves by
  "heavier wins" (larger `w:sz`), then by "line style beats none", then by the later-specified cell in
  document order. The rule is implemented once, in a single `resolveBorder(edgeA, edgeB)` function, and used
  for table borders, paragraph borders and page borders - three implementations of this rule is how
  renderers drift.
- Border widths consume layout space (half on each side of the grid line, LE-046), so border resolution must
  happen **before** cell content layout, not at paint time. Diagonal borders (`w:tl2br`, `w:tr2bl`) are paint
  only and do not consume space.
- `w:tblCellSpacing` (cell padding as a table-level gap) is supported: it pushes cells apart and inserts a
  background gap; the classic Word artefact of a 0.5 pt white gap between cells.
- Edge cases: a table with borders only on the outside (`w:tblBorders` with insideH/V `none`); a cell with
  `w:tcBorders` overriding only the bottom; borders on a table split across pages (the split edge is open -
  no border is drawn at the page break unless the row's own borders demand it, and the continuation row's top
  border is drawn); borders under a repeated header row (the header's bottom border is repeated).

---

**LE-048 - Row heights, row splitting across pages, cantSplit**
**Pass** P13 · **OOXML** `w:trHeight w:val`, `w:hRule` (auto/atLeast/exact), `w:cantSplit`,
`w:tblHeader` · **Pri** core · **Effort** L

- Row height: `auto` = content height; `atLeast` = max(content, `w:val`); `exact` = exactly `w:val` with
  content **clipped** (Word clips table cell overflow at the row height - unlike paragraph line spacing,
  where it overflows).
- **Splitting:** a row that does not fit in the remaining page space splits **only if** it is allowed to
  (`w:cantSplit` absent) **and** it can produce at least one line on each side. The split point is the
  boundary after the last line that fits, computed across all cells simultaneously: the split height is the
  maximum of the per-cell "lines that fit" heights, and shorter cells are padded - this is the rule that
  makes a split table look correct rather than ragged.
- `w:cantSplit` moves the whole row to the next page. If the row is taller than a full page's content box,
  Word splits it anyway (it has no choice) - we mirror that with a `ROW_UNSPLITTABLE` diagnostic.
- A row split across a page break: cell borders are drawn on the split edges per LE-047; cell shading
  continues on both fragments; a cell's text is clipped to its fragment (no repeated text).
- Row height for a row containing a `vMerge` continuation cell is driven by the merged region's total, not by
  the continuation's own content (LE-049).
- Edge cases: a row taller than the page (splits across more than two pages); a row with `exact` height
  taller than the page (overflow); a row whose split point would separate a paragraph's line from its
  `keepLines` partner (keeps are honoured within the row's own split where possible, and relaxed with a
  diagnostic when not).

---

**LE-049 - Merged cells: gridSpan and vMerge**
**Pass** P6/P13 · **OOXML** `w:gridSpan`, `w:vMerge w:val="restart"|"continue"`, `w:hMerge`
(Horizontals are `w:gridSpan` in WordprocessingML; legacy `w:hMerge` is mapped to it) · **Pri** core ·
**Effort** L

- `w:gridSpan` merges N grid columns into one cell whose width is the sum of the spanned columns plus the
  interior grid lines' border widths. The grid is authoritative: a `w:gridSpan` that does not match the
  following rows is reconciled to the maximum, with a diagnostic.
- `w:vMerge` - `restart` begins a region, `continue` extends it. Horisontal (`gridSpan`) and vertical merges
  compose. Cell **order in the XML** counts only cells that are actually present: a continuation cell is
  present and empty, and its content (if any) is ignored per the schema.
- A vertical merge region is laid out as **one content box** spanning the region's rows: the content is laid
  out once against the region's total height, and the individual rows' heights are driven by the region.
  Rendering: the spanned rows' shared borders are suppressed (the region's outer borders win) and the
  content is drawn once in the region's box, with per-row fragments for clipping.
- A vMerge region crossing a page break: the region's content is laid out against the region height; when the
  region's rows split across pages, the content is **clipped** at the page boundary and the continuation rows
  on the next page render the region's borders without repeating the content (Word's behaviour).
- Edge cases: `continue` with no preceding `restart` (treat as restart, diagnostic); a region that spans all
  rows of a table; vMerge combined with `w:cantSplit` on a row inside the region (the row moves, the region
  follows); a merged region whose content is taller than the region (clip, Word clips).

---

**LE-050 - Repeated header rows**
**Pass** P13 · **OOXML** `w:tblHeader` · **Pri** core · **Effort** M

- Rows with `w:tblHeader` are repeated at the top of every page the table continues onto, in the same order
  as they appear at the table's start.
- Repeating rows consume real page space, which can cascade: a repeated header can push the last row to
  another page, which adds another repeated header. The vertical machine must therefore treat header rows as
  part of the **row placement decision loop**, not as a pre-computed offset (this is the "table grows by one
  page when I add a header row" behaviour, and it must match Word).
- Word's constraints, mirrored: header rows are repeated only if they are the first rows of the table; a
  header row that is itself taller than a third of the page still repeats (Word does, producing very little
  room); header rows are not repeated when the table starts on a page and continues with fewer than the
  header's height remaining (the header block and at least one body row must fit together, else the whole
  group moves).
- Repeated header content is laid out once and copied as fragments (its layout does not depend on the page).
- Edge cases: a header row containing a footnote reference (the note is placed on the first page only -
  Word's behaviour, and a genuine fidelity corner); a header row with `w:cantSplit`; a table whose header is
  repeated on 40 pages (fragment reuse, not re-layout, for performance).

---

**LE-051 - Nested tables**
**Pass** P6/P13 (recursive) · **OOXML** `w:tbl` inside `w:tc` · **Pri** important · **Effort** M

- Nesting re-enters P5 → P6 → P9-P13 with the parent cell's content box as the constraint, at arbitrary
  depth (Word's practical limit; we cap at 20 with a diagnostic beyond).
- A nested table contributes to its parent cell's minimum and preferred widths (its min width is the sum of
  its columns' minima, its preferred is its resolved total width), which feeds the parent's autofit.
- Nested tables participate in pagination: a nested table can split across pages and can be the reason a
  parent row splits; repeated header rows work inside nested tables too.
- Edge cases: a nested table wider than its cell (overflow, Word overflows); a nested table inside a
  `vMerge` region; a nested table in a cell of a row that splits (the split propagates into the nested
  table's rows - the split point is the minimum across all nesting levels, which is where a naive
  implementation produces text overlapping a border).

---

**LE-052 - Floating tables (tblpPr) and table positioning**
**Pass** P10/P13 · **OOXML** `w:tblpPr` (`w:vertAnchor`, `w:horzAnchor`, `w:tblpX`, `w:tblpY`,
`w:tblpXSpec`, `w:tblpYSpec`, `w:leftFromText`, `w:rightFromText`, `w:topFromText`, `w:bottomFromText`),
`w:tblOverlap` · **Pri** later · **Effort** L

- A floating table is positioned against its anchor (page/margin/text/paragraph) with wrap distances, using
  the same anchor resolution as drawings (LE-056) and the same exclusion bands (LE-058), so a floated table
  displaces text exactly as a floated image does.
- `w:tblOverlap` (`never`/`overlap`) controls whether two floating tables may overlap; `never` requires the
  placement pass to push a table down past an overlapping one - a bounded loop within P10.
- Marked `later`: floating tables appear in marketing-style documents, not in the HR contract corpus, but
  they are common enough in templates imported from the wild to be worth keeping on the roadmap with the
  machinery already shared.
- Edge cases: a floating table anchored to a line inside a table cell; a floating table wider than the
  content area; two floating tables anchored to the same paragraph.

---

### H. Floats, drawings, text boxes, drop caps

---

**LE-053 - Image measurement: intrinsic size, EMU, cropping, fill and rotation**
**Pass** P6/P10 · **OOXML** `wp:extent`, `wp:effectExtent`, `a:xfrm`, `a:ext`, `a:srcRect`,
`a:stretch`/`a:fillRect`, `pic:spPr`, `w:drawing`, `w:pict`/`v:shape` (VML), `v:imagedata` · **Pri** core ·
**Effort** L

- **Unit:** `wp:extent cx/cy` and `a:xfrm` are **EMU** → mp via `round(emu × 1000 / 12700)`, applied once.
  The extent (not the image's pixel size, not its intrinsic resolution) determines the box on the page.
- If `wp:extent` is missing or zero (hand-written OOXML and some generators), the intrinsic size is derived
  from the image's pixel dimensions and DPI (from the PNG `pHYs` chunk / JPEG JFIF density / EXIF), falling
  back to 96 DPI - and the aspect ratio is preserved from the intrinsic size.
- `a:srcRect` (`l`, `t`, `r`, `b`) crops in **thousandths of a percent** (a different scale from table
  `pct`, which is fiftieths of a percent - normalised at ingest into fractions, and the single most common
  silent image bug). Cropping changes the **source rect**, not the destination extent: the remaining image is
  stretched into the same box, and the resulting effective aspect ratio is *not* preserved - Word stretches.
  Both behaviours are implemented, distinguished by whether the author used `srcRect` with `a:stretch`.
- `a:fillRect` with `a:stretch` (crop-to-fill) stretches uniformly with clipping, preserving aspect ratio.
- Rotation (`a:xfrm rot`, in 1/60000 degree) and flip (`flipH`/`flipV`) are **paint-only** transforms around
  the box centre and do **not** change layout - the box stays axis-aligned, which is Word's behaviour
  (rotated images overlap text rather than reflowing it).
- `wp:effectExtent` (shadow/glow bleed) expands the painted area but not the layout box.
- VML (`w:pict`/`v:shape`/`v:imagedata`) is the legacy path and is fully supported for reading, because
  real-world DOCX from older Word and from third-party generators is full of it; it is mapped into the same
  drawing model at ingest, including `v:shape` `style="width:...;height:..."` (in pt or in px - both occur,
  and the px form is a documented fidelity risk).
- Edge cases: an image whose `wp:extent` disagrees with `a:ext` (the drawing extent wins, diagnostic); a
  linked-not-embedded image (`r:link` with no embedded part) - a placeholder box at the extent with a
  diagnostic, never a network fetch; a missing image part (same); SVG (`a:blip` with an SVG extension) -
  sized from `wp:extent`, rasterised at paint time; an image inside a header or a footnote.

---

**LE-054 - Inline vs anchored drawings, and the block-level drawing paragraph**
**Pass** P3/P10 · **OOXML** `wp:inline`, `wp:anchor` (`wp:simplePos`, `wp:positionH`, `wp:positionV`,
`wp:relativeHeight`, `wp:behindDoc`, `wp:allowOverlap`, `wp:layoutInCell`, `wp:wrap*`, `wp:docPr`) ·
**Pri** core · **Effort** L

- `wp:inline` is an **inline atom**: it participates in line breaking, its height enters the line box (LE-035)
  and so its line's height, it can be pushed to the next line by breaking, and it can be the whole content of
  its line. This is the common case for an inserted photo and the one that must be exact.
- `wp:anchor` is removed from the inline flow (it is a `BoxFragment` placed by P10) but its **anchor** is the
  inline position where it appeared, which is why anchoring is resolved against a line/character/paragraph.
- `wp:layoutInCell` confines an anchored object to its table cell; without it, an anchored object in a cell
  is positioned relative to the page (a genuine Word quirk that produces drawings floating outside tables).
- A drawing that is the only content of a paragraph still produces a line (the paragraph mark's line), which
  is why an image followed by Enter is taller than the image.
- Edge cases: an anchored object whose anchor paragraph is on a different page than its position (Word allows
  it; the object is drawn on the page where its position lands, and does not affect that page's text unless
  it wraps); an inline drawing inside a hyperlink run; a drawing inside a `w:smartTag`/`w:sdt` wrapper
  (transparent to layout, LE-018).

---

**LE-055 - Wrap modes: square, tight, through, top-and-bottom, none, behind, in front**
**Pass** P10 · **OOXML** `wp:wrapSquare w:wrapText`, `wp:wrapTight`, `wp:wrapThrough`,
`wp:wrapTopAndBottom`, `wp:wrapNone`, `wp:behindDoc`, `wp:distT/distB/distL/distR`,
`wp:wrapPolygon` · **Pri** important · **Effort** XL

- **`wrapSquare`** - the object's box (expanded by `distL/distR/distT/distB`) excludes text on both sides, or
  only on the side given by `w:wrapText` (`bothSides`, `left`, `right`, `largest`). Lines whose vertical band
  intersects the object's band are shortened; lines that begin above or end below it are full width.
  `largest` chooses, per paragraph, the side with more available space - which requires evaluating the
  paragraph both ways, so it is the slowest mode and is implemented last within this feature.
- **`wrapTight`** - exclusion follows `wp:wrapPolygon` (a polygon in the object's coordinate space, scaled to
  the display box), so text may occupy the empty corner around an irregular shape. Implemented as per-line
  band intersection against the polygon, which is what Word approximates. A tight wrap with no polygon falls
  back to the bounding box (square).
- **`wrapThrough`** - same geometry as tight, but text is additionally allowed **over** the object where the
  polygon permits; the difference from tight is that through-wrapped text may sit on top of the image's
  transparent regions. Layout-wise it is identical to tight; paint-wise the object may be behind.
- **`wrapTopAndBottom`** - the object's band is empty of text: all lines below it start under `distB`. No
  line is shortened; the object pushes the following content down (and, if it is anchored to a line inside a
  paragraph, it splits that paragraph around itself - the paragraph's lines above are laid out full width,
  the lines below start after the object).
- **`wrapNone`** - the object floats over/under the text and displaces nothing. `wp:behindDoc="1"` puts it
  behind the text, otherwise in front.
- **Front/behind and z-order:** `wp:relativeHeight` orders objects; painting order is: all `behindDoc`
  objects ascending by `relativeHeight`, then the text and its shading, then non-`behindDoc` objects
  ascending. Objects with equal `relativeHeight` paint in document order. `wp:allowOverlap="0"` requests
  non-overlapping placement - Word treats it as advisory; we implement it as a bounded push-down in P10 and
  report when it cannot be satisfied.
- Edge cases: a square-wrapped object wider than the content box (exclusion band leaves zero width - the
  lines beside it become zero-width and are re-pushed below; Word's behaviour is to push text below the
  object when the remaining width is less than one character - that threshold is a constant in the engine and
  a golden-test case); an object anchored in a footnote overriding into the body (clipped to the note area,
  Word clips); a top-and-bottom object taller than the page (comment/diagnostic, it repeats on each page in
  Word, which we mirror by placing it once and reporting).

---

**LE-056 - Anchoring, relative-from and float placement**
**Pass** P10 · **OOXML** `wp:positionH/wp:positionV` (`wp:relativeFrom`, `wp:align`, `wp:posOffset`),
`wp:simplePos`, `w:framePr`, `wp:anchor` on a shape · **Pri** important · **Effort** L

- `relativeFrom` values: `page`, `margin`, `column`, `character`, `line`, `paragraph`, `topMargin`,
  `bottomMargin`, `insideMargin`, `outsideMargin`, `leftMargin`, `rightMargin`. Each resolves to a
  concrete edge in the current page/column context, **including mirror margins and RTL** (LE-020).
- `wp:align` (`left`/`center`/`right`/`top`/`inside`/`outside`) is resolved against the same edges;
  `posOffset` (EMU) is added after. `simplePos` (a single point with no relativeFrom) is honoured only when
  `wp:simplePos="1"`; otherwise alignment wins.
- **Placement loop (L1):** objects whose position is *text-independent* (relative to page/margin/column) are
  placed **before** the provisional break; objects relative to `line`/`paragraph`/`character` are placed
  after it, then their exclusion bands trigger a re-break of intersecting paragraphs (LE-058). Max 3
  iterations.
- Word's clamp: an object positioned outside the page is still painted outside the page (it is not clamped),
  and the renderer must clip at the page edge only for export, not for the on-screen page surface (where
  Word shows it, greyed, in the margin).
- Edge cases: a negative `posOffset`; `relativeFrom="character"` inside an RTL run; an object anchored to a
  paragraph that has moved to another page since the last layout (re-resolved every pass - never cached
  across a pagination change).

---

**LE-057 - Text boxes and legacy frames**
**Pass** P6/P10/P13 (recursive) · **OOXML** `w:txbxContent`, `wps:txbx`, `wps:bodyPr`
(`autofit`, `vertOverflow`, `horzOverflow`, `anchor`, `anchorCtr`, `spAutoFit`, `wrap`),
`v:textbox`, `w:framePr`, `w:framePr w:hRule` · **Pri** important · **Effort** L

- A text box is a **story**: layout runs the full pipeline (P3-P12) on its content with the box's content box
  as the constraint. Its content can contain its own floats, tables and footnotes (footnotes in a text box
  are forbidden by Word - diagnostic, note placed at the end).
- `wps:bodyPr autofit` (`spAutoFit`) sizes the box to the content **after** layout, which makes the box's
  height - and therefore the text it wraps - depend on its own content: a bounded inner fixed point inside
  P10 (max 2 iterations; content height rarely changes when the box grows because the width is fixed and
  wrapping is width-driven, so this converges immediately in practice).
- Vertical anchoring (`anchor=t|ctr|b`) and `anchorCtr` position the content inside the box; overflow
  (`vertOverflow=overflow|clip|ellipsis`) is honoured (clip and ellipsis both handled at paint time from the
  full layout, which still requires laying out the overflowing lines - clipping is a paint operation, not a
  layout one, so the layout result contains everything).
- `w:framePr` (legacy Word frames, still produced by some generators) is mapped to the same anchored-box model
  with drop-cap support (LE-027) and `w:framePr w:wrap` (`around`/`auto`/`none`/`notBeside`/`through`/`tight`)
  mapped onto LE-055's wrap modes.
- Edge cases: a text box anchored inside a table cell; a text box 1 pt wide (content overflows, Word does
  not reflow it); a text box with `w:txbxContent` containing a section break (invalid, ignored with a
  diagnostic); an empty text box (`spAutoFit` to zero height + padding).

---

### I. Headers, footers, notes

---

**LE-058 - Exclusion areas as one shared mechanism**
**Pass** P10 · **OOXML** derived · **Pri** core · **Effort** M

- A single model serves every construct that removes horizontal space from a line: square/tight/through
  floating objects, top-and-bottom objects (which remove *vertical* space), drop caps, and text boxes with
  `wrap`.
- `ExclusionSet` per (page, column): an ordered list of bands `{ yTop, yBottom, left, right, polygon?,
  sourceId, wrapMode }`. The line breaker queries `availableWidth(bandTop, bandBottom)` which subtracts
  intersecting bands; the vertical machine queries `pushDown(y)` for top-and-bottom bands.
- Because there is one mechanism, "text flows around it" is implemented once and cannot behave differently
  for an image and for a drop cap. It also makes the incremental invalidation tractable: an exclusion change
  invalidates exactly the paragraphs whose bands intersect it.
- Edge cases: two overlapping bands on the same side (deepest wins, i.e. the larger inset); a band that
  removes the entire width (line becomes zero-width and is pushed below the band, LE-055); a band that starts
  mid-line (the line's band is computed from its **whole** height, so a band starting midway down a line
  shortens the entire line - which is what Word does).

---

**LE-059 - Headers and footers: regions, page kinds, and height displacement**
**Pass** P7/P8 · **OOXML** `w:headerReference`, `w:footerReference`, `w:titlePg`,
`w:headerReference w:type="first"|"default"|"even"`, `w:header w:type`, `w:pgMar w:header`, `w:footer`,
`w:settings/evenAndOddHeaders`, `w:header w:type="even"` · **Pri** core · **Effort** L

- Per section, up to six regions: first/default/even × header/footer, resolved in the order first (if
  `w:titlePg`) → even/odd (if `evenAndOddHeaders`) → default. A missing region inherits from the **previous
  section** of the same kind (Word's inheritance rule: a section with no `w:headerReference` of a kind
  continues the previous section's of that kind) - and a section that "ends" inheritance must do it with an
  explicit empty header part, which is a real and commonly mis-implemented distinction.
- **Height displacement:** the header is laid out in the area starting `w:pgMar w:header` below the page
  edge. If `headerDistance + headerHeight > topMargin`, the body's content box top is displaced downward by
  the difference (Word pushes the text down rather than overlapping it). Same for the footer at the bottom.
  This is why the content box is a **per-page-kind** value (LE-008/P8) and why header layout must precede
  body pagination.
- A header containing a `PAGE`/`NUMPAGES` field whose width varies with the page number (1 vs 10 vs 100)
  changes the header height only if it wraps - but it changes *the field's own width*, which feeds L3.
- Headers and footers are **stories**: they support tables, images, borders, columns, and their own
  paragraphs, with all the same passes. They cannot contain footnotes or section breaks (diagnostic).
- Edge cases: a header whose content is taller than the whole page (Word lets it push the body off the page;
  we clamp the content box to a minimum of one line and emit a diagnostic); a different first-page header on
  a section that begins mid-page (a continuous section break does not get a first page - the `first` kind
  applies only to the section's actual first page); the footer on a page forced by an `evenPage` break.

---

**LE-060 - Page numbering and page-count-dependent fields (loop L3)**
**Pass** P16 · **OOXML** `w:pgNumType w:fmt`, `w:start`, `w:pgNumType w:chapStyle`, `PAGE`, `NUMPAGES`,
`SECTIONPAGES`, `SECTION` · **Pri** important · **Effort** M

- Field values are computed by the layout engine (it is the only component that knows page counts) and
  written into the `FldResult` atoms for the header/footer stories. Number formats: decimal, upper/lower
  Roman, upper/lower letter, and Romanian/Russian decimal forms (which are plain decimal) - `w:pgNumType
  w:fmt` drives it.
- `w:pgNumType w:start` restarts numbering at the section boundary; `SECTIONPAGES` counts the pages of the
  current section; `NUMPAGES` counts the document's pages (the sections' pages, and - matching Word -
  including blank pages inserted by even/odd breaks).
- **Convergence (L3):** a `NUMPAGES` field's digit count can change the header's height, which changes the
  content box, which changes pagination, which changes the page count. Re-run P7→P15 with the new count, max
  3 iterations; freeze and diagnose otherwise.
- Edge cases: a document where page count oscillates (9↔10 pages because the header grows by one line at 10)
  - the freeze rule must be deterministic (accept the **larger** count on oscillation, matching Word's
  conservative behaviour); `PAGE` in a footnote; a field in a header on a page that is otherwise blank.

---

**LE-061 - Footnotes: numbering, area, displacement**
**Pass** P14 (loop L2) · **OOXML** `w:footnotePr` (`w:pos`, `w:numFmt`, `w:numStart`, `w:numRestart`,
`w:numSpacing`), `w:footnote w:type`, `w:footnoteReference`, `w:footnoteRef`,
`w:separator`/`w:continuationSeparator`, `w:footnoteLayoutLikeWW8` (compat) · **Pri** important ·
**Effort** XL

- Numbering: per-document or per-section (`w:numRestart="eachSect"|"eachPage"|"continuous"`), formats
  (decimal, roman, letter, symbol variants). Restarting per page makes numbering depend on pagination, which
  is another reason notes are placed after the vertical machine, not during it.
- **Area position** `w:pos`: `pageBottom` (default), `beneathText` (immediately under the body text),
  `sectEnd` (end of section), `docEnd`. `beneathText` in particular means the note area moves with the text,
  which changes how many lines fit - a genuine circularity handled by loop L2.
- **Area sizing:** the note area holds the notes referenced on that page, each a full paragraph story with
  the footnote text's own styles (usually 10 pt with single spacing and a smaller line height). The area's
  height = sum of note heights + separator + spacing between notes.
- **Displacement (L2):** if body content + note area exceeds the content box, the **minimum number of body
  lines** moves to the next page, and **their notes move with them**; the note area is recomputed. Bounded at
  4 iterations per page; on exhaustion, overflow with `NOTE_OVERFLOW`. Notes taller than an entire page
  split across pages' note areas with the continuation separator - mirroring Word, which does exactly this.
- Separator (`w:separator`, default a short horizontal rule at the left of the note area, ~2 in wide) and
  `w:continuationSeparator` (a full-width rule) are laid out as blocks in the note story with their own
  geometry.
- Notes are **laid out once** and reused across iterations where possible (their width does not change), so
  L2's cost is dominated by the body re-flow.
- Edge cases: a note reference on the last line of a page whose note would not fit (the line moves - the
  most common footnote-fidelity case); three notes on one page referencing the same footnote (one note
  instance - a reference may repeat with `w:footnoteRef` custom marks); a footnote inside a table cell
  (placed in the page's note area, not the cell's); a note in a document with a two-column section
  (`w:pos=pageBottom` puts the area at the bottom of the **column** in Word - implemented and golden-tested).

---

**LE-062 - Endnotes, separators and note conversions**
**Pass** P14 · **OOXML** `w:endnotePr`, `w:endnote`, `w:endnoteReference`,
`w:footnotePr/w:numRestart`, `w:endnotePr w:pos` (sectEnd/docEnd) · **Pri** later · **Effort** M

- Endnotes are placed at the end of the section (`sectEnd`) or the document (`docEnd`) in their own area,
  numbered in a separate sequence with their own format, laid out with the same machinery as footnotes but
  with no body displacement (they are simply blocks at the end).
- Word's "convert to endnote/footnote" is an editing operation, not a layout one; the layout engine only
  consumes the resulting structure.
- Edge cases: an endnote area with its own separator (endnoteSeparator/endnoteContinuationSeparator) and its
  own heading; endnotes in a document with no sections beyond the body sectPr (`docEnd` = after the last
  section).

---

### J. Incremental relayout, rendering, verification

---

**LE-063 - Layout tree, fingerprints and invalidation**
**Pass** all · **OOXML** n/a · **Pri** core · **Effort** L

- A `LayoutNode` tree mirrors the model (story → section → block → paragraph/table → row → cell → line) and
  caches per node: the produced fragments, the node's own height, its `minWidth`/`preferredWidth`, and a
  **fingerprint** over everything that pass consumed (content hash, resolved style hash, available width,
  exclusion profile hash, font registry hash, breaker config).
- Invalidation walks ancestors from the edited node, marking nodes dirty; a node whose fingerprint is
  unchanged stops the walk (**early cut**). This is what prevents "edit one word in a 300-page contract"
  from re-laying-out the document.
- `documentHash` is a Merkle hash over the fingerprint tree, so a whole-document layout result is comparable
  across processes and runs (golden tests, worker/main-thread agreement, divergence detection).
- Edge cases: a fingerprint must include the **page-kind content box** (a header change invalidates body
  nodes on some page kinds but not others - modelled by including the content box, which varies per kind,
  so only the affected kinds' subtrees go dirty); an edit inside a cell invalidates the table's width pass
  only if the content's min/preferred width changed (checked cheaply from the shaped cache).

---

**LE-064 - Incremental relayout: rewind, re-run, resync**
**Pass** L4 · **OOXML** n/a · **Pri** core · **Effort** XL

- Algorithm for an edit at document position `p`:
  1. **Local re-run:** re-shape and re-break the affected paragraph (P3 → P9 → P11 → P12) synchronously. This
     is the only work on the critical path of a keystroke.
  2. **Rewind point:** the last fragment boundary before `p` at which the vertical state (page, cursorY,
     column, active floats, active notes, previous paragraph style) is identical to the previous layout's.
     Typically the start of the current paragraph, or the current page.
  3. **Re-run forward** from the rewind point through P13 (and P14-P17 as needed), in a worker, in time
     slices.
  4. **Resync:** stop as soon as a page's fragment set is **structurally identical** to the previous layout's
     (same fragment ids, same coordinates, same page). Everything after that page is reused by reference.
     Because pagination is quantized to page height, resync typically happens within 1-2 pages.
  5. **Publish:** swap in the new `LayoutResult` atomically. No intermediate state is ever painted.
- Structural sharing makes the publish cheap: unchanged pages are the *same objects*, so the renderer diffs by
  identity and repaints only changed pages.
- Caret stability: the caret is a document position, not a pixel, and its pixel geometry is re-derived from
  the new result - so a reflow never moves the caret. A selection is likewise re-derived.
- Edge cases: an edit that changes the page count (everything below the rewind point re-runs, but resync
  still applies); an edit that changes a **style** (a wider blast radius; the rewind point degrades to the
  section start); an undo/redo (the previous result is cached by `documentHash`, so a redo is often a cache
  hit); an edit during an in-flight layout (the in-flight run is cancelled and restarted from the newer
  rewind point - never queued, so a fast typist cannot build a backlog).

---

**LE-065 - Typing latency budget and worker scheduling**
**Pass** L4 · **OOXML** n/a · **Pri** core · **Effort** L

- Budget: the synchronous paragraph-local path must complete in **< 4 ms** for a typical paragraph
  (measured as p95 over a corpus of 200 real paragraphs) so that typing stays under one frame at 60 Hz.
- The worker runs P13+ with slices of ~6 ms, yielding between slices, prioritising: (1) the visible
  viewport and one page beyond, (2) pages above the viewport, (3) the remainder. A page not yet repaginated
  after a change is painted from the previous result **with its pagination marked provisional** - and the
  scroll container's total height uses the previous page count, so the scrollbar never jumps mid-typing.
- The engine is host-agnostic and must run in: the main thread (small documents, tests), a Web Worker (the
  default in browsers), and Node (golden tests, server-side PDF). All three produce identical results
  (LE-001) - asserted by a test that runs the same corpus in all three.
- A document below a size threshold (configurable, default ~50 pages and no floats) runs entirely
  synchronously, because the worker round-trip costs more than the layout.
- Edge cases: a worker that fails to start (fall back to the main thread, diagnostic, no crash); a document
  too large for the shaped-text cache (evict, re-shape, still correct); an edit landing during worker
  termination (cancel is idempotent).

---

**LE-066 - Page virtualization and painting**
**Pass** renderer · **OOXML** n/a · **Pri** important · **Effort** M

- Only pages intersecting the viewport (±1 page) are rendered to DOM. Non-rendered pages are placeholder
  elements with the exact size from `LayoutResult`, so scroll geometry and scrollbar are exact and stable.
- The DOM for a page is rebuilt only when that page's fragment identity changes (LE-064 structural sharing).
- Selection, caret and the find-highlight overlay are separate absolutely positioned layers above the page
  surfaces, built from fragment rects and repainted independently of page content - so a caret blink never
  touches the document DOM.
- Edge cases: scrolling fast produces out-of-order render requests (resolve by page index, drop stale
  responses); a page taller than the viewport (rendered whole, because sub-page virtualization costs more
  than it saves for ≤ A3); printing from the browser (a `@media print` path that renders all pages and
  applies a page-sized transform - the print path is a convenience, the PDF export is the real target).

---

**LE-067 - Fidelity harness: golden corpus, divergence tests, Word comparison**
**Pass** all · **OOXML** n/a · **Pri** core · **Effort** L

- **Corpus** of real DOCX documents (anonymised HR contracts, orders, letters, in ro/ru/en) plus synthetic
  cases for every feature above, stored with expected `LayoutResult` hashes and, for a subset, a
  human-verified golden PDF.
- **Golden tests** assert on the `LayoutResult`: line break positions, page breaks, line counts per page,
  table column widths, float boxes, note areas. Not on screenshots - screenshots are the last line of
  defence, not the first, because they are hard to diff and impossible to attribute.
- **Word comparison**: for each corpus document, a reference PDF produced by Word (checked in, with the
  Word version recorded) is compared to our PDF on page count, per-page line count, and the y of the first
  baseline of each page. Differences are recorded in a `fidelity-baseline.json` with a written reason; the
  test fails when a **new** difference appears or when a recorded one worsens. This turns "Word-faithful"
  into a metric instead of an aspiration.
- **Divergence tests:** headless Chrome + Firefox + WebKit render the corpus and run LE-005's detector;
  cross-engine page counts and line breaks must be identical.
- **Property tests:** right-edge landing of justified lines is exact for every line in the corpus; every
  fragment's geometry is inside its page; every fragment's document position maps to exactly one caret
  stop; every atom is covered by exactly one fragment (no gaps, no double coverage) - the invariants in
  §4.

---

## 4. Data model and invariants

### 4.1 Fragment types

```
PageFragment      { index, kind: 'first'|'even'|'odd', page: Rect, contentBox: Rect,
                    header?: StoryRef, footer?: StoryRef, noteArea?: Rect, column?: number }
BlockFragment     { id, kind, box: Rect, page, column, docRange, split: 'start'|'middle'|'end'|'whole',
                    children: LineFragment[] | RowFragment[] }
LineFragment      { id, box: Rect, baselineY, ascent, descent, lineHeight, atoms: AtomPlacement[],
                    caretStops: CaretStop[], justified: boolean, bidiLevels }
AtomPlacement     { atomId, x, width, source: DocRange }
BoxFragment       { id, kind: 'drawing'|'float'|'textbox'|'shading'|'border'|'dropcap'|'note-area'
                        |'separator', box: Rect, z, paintOnly?: { rotation, flip, clip } }
TableFragment     { id, box, grid: Mp[], rows: RowFragment[], headerRows: number[] }
RowFragment       { id, box, cells: CellFragment[], split, heightRule }
CellFragment      { id, box, contentBox, rowSpan, colSpan, vMerge: 'restart'|'continue'|'none' }
NoteFragment      { id, noteId, kind: 'footnote'|'endnote', mark, area: Rect, blocks: BlockFragment[] }
CaretStop         { docPos, x, baselineY, level, affinity: 'upstream'|'downstream' }
```

### 4.2 Invariants (asserted in `layout.invariants.test.ts`, always on)

1. Every `BlockFragment` lies inside its page's content box on the x axis (floats and negatives excepted and
   explicitly flagged).
2. Block fragments on a page do not overlap vertically, except: float boxes, `wrapNone`/behind objects,
   explicit overlaps Word permits (negative spacing), and a `vAlign` translation.
3. Every model position in a story maps to **exactly one** caret stop, and every caret stop maps to a valid
   model position.
4. Every inline atom is covered by exactly one fragment.
5. Sum over pages of content is the document: no block is dropped, no block is duplicated - except repeated
   table header rows, which are marked `repeat: true`.
6. A justified line's right edge equals the content-box right edge exactly (mp), within the line's own
   indents.
7. Every line's baselineY is ≥ its box top and ≤ its box bottom (except `exact` line rules with oversized
   content, which is flagged).
8. `documentHash` is stable across processes and engines for the same input (LE-001).
9. Pages are ordered, contiguous in y, and their count equals the value of `NUMPAGES` in the final iteration
   of L3.

---

## 5. Explicit non-goals (v1)

- **Complex-script shaping** (Arabic, Indic, Khmer, Thai) - the `Shaper` interface accommodates a
  HarfBuzz-wasm backend; the kashida justification and CJK kinsoku rules (LE-028, LE-029) are specified but
  deferred.
- **Math layout** (`w:oMath`): rendered as an opaque box with the cached `w:oMathPara` image if present,
  else a placeholder with a diagnostic. Not laid out.
- **Charts, SmartArt, OLE objects** (`w:object`): placeholder box at the stored extent, with the cached
  preview image when the document contains one.
- **Digital-signature and protection features, revision marks** are outside this domain (see
  `01-document-model` and `03-editing-commands`); revision marks affect layout only through "show/hide
  markup", which is a layout input flag (`w:settings`) and must be part of `documentHash`.
- **Ink annotations, 3D models, video/audio** (`w14`/`wp15` extensions): placeholder boxes.

---

## 6. Priority and effort summary

67 features: 45 core, 15 important, 7 later. Effort distribution: 8 S, 31 M, 24 L, 4 XL.

| Priority | Features | Why |
|---|---|---|
| **core** (45) | LE-001 - LE-012, LE-014 - LE-018, LE-021 - LE-024, LE-026, LE-030 - LE-036, LE-040, LE-041, LE-045 - LE-050, LE-053, LE-054, LE-058, LE-059, LE-063 - LE-065, LE-067 | Everything an HR contract needs: the truth model, text, spacing, keeps, pages, tables, images, headers, incremental typing, and the detector that proves the screen matches the PDF |
| **important** (15) | LE-013, LE-019, LE-020, LE-025, LE-027, LE-038, LE-039, LE-042, LE-051, LE-055 - LE-057, LE-060, LE-061, LE-066 | Embedded fonts, bidi, hyphenation, borders/shading, columns, wrap modes, text boxes, footnotes, virtualization |
| **later** (7) | LE-028, LE-029, LE-037, LE-043, LE-044, LE-052, LE-062 | Deferred by corpus frequency, with the interfaces in place so they are additive rather than structural |

**Sizing**, using this document's own effort definition (S < 1 week, M 1-3 weeks, L 3-6 weeks, XL > 6 weeks)
mapped to 0.2 / 0.5 / 1.1 / 3 engineer-months: **core ≈ 36, important ≈ 16, later ≈ 4 engineer-months** -
roughly 55 in total, i.e. two to three engineers for a year to the full catalogue, and the M1-M4 milestones
(§7) are the honest MVP. Layout engines are the most reliably underestimated component in document software,
so these are floors, not commitments.

The four XL features are LE-045 (table autofit), LE-055 (wrap modes), LE-061 (footnotes) and
LE-064 (incremental relayout). The last of those must be built *with* the passes, not after them:
retro-fitting invalidation onto a pipeline that was not designed for it means rewriting the pipeline.

## 7. Suggested build order (milestones)

1. **M1 - Truth model.** LE-001..LE-007: units, `LayoutResult`, renderer contract, zoom, divergence
   detector. No feature is worth building before the guardrail exists.
2. **M2 - Text to a page.** LE-008, LE-009, LE-012, LE-014, LE-015, LE-017, LE-018, LE-021, LE-023,
   LE-024, LE-026, LE-035, LE-036, and LE-040 for a single section. Deliverable: a paragraph lays out
   identically on screen and in PDF, and the detector says so.
3. **M3 - Real documents.** LE-011 (numbering), LE-030, LE-031, LE-032, LE-033, LE-034, LE-041,
   LE-045..LE-050 (tables), LE-053, LE-054, LE-058, LE-059. Deliverable: a real HR contract renders
   page-for-page against Word.
4. **M4 - Incremental.** LE-063, LE-064, LE-065, LE-066. Deliverable: typing at 60 Hz on a 100-page
   document. (Designed in M1, delivered here.)
5. **M5 - Fidelity depth.** LE-010, LE-013, LE-016, LE-019, LE-020, LE-022, LE-025, LE-027, LE-038, LE-039,
   LE-042, LE-051, LE-055..LE-057, LE-060..LE-062, LE-067. Deliverable: the corpus passes with zero
   unexplained differences. The `later` features (LE-028, LE-029, LE-037, LE-043, LE-044, LE-052) follow,
   each additive by construction.

Every milestone ends with the same question, which is the one the previous attempt could not answer:
**does the screen match the PDF, and does the detector prove it?**
