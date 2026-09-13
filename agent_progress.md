# docier - Progress Tracker

Anchor document for long-running work. Read this first, update it last.

---

## Ultimate Goal

**docier** - a standalone, framework-agnostic **TypeScript** library for editing DOCX documents in the
browser, exposed on npm, as a credible open alternative to ONLYOFFICE for a document-template product
(HR contracts, orders, letters; Romanian and Russian as common document languages).

Success means: a host app mounts it into a DOM element, configures it with one config object, drives it
through commands, observes it through events, gets a real Word-compatible `.docx` in and out, and can turn
tokenization on or off by config. It must feel like Word to a non-technical HR manager, and it must be
pleasant to integrate for a developer.

**Repo:** `git@github.com:pistonpunk/docier.git` · local `/home/daniel/work/docier` · branch `main`
**Licence:** dual AGPL-3.0-only or commercial (D11) · **Runtime deps:** exactly one - `fflate`, taken for byte-deterministic compression (ADR-0003)

---

## Decisions made (do not re-litigate)

| # | Decision | Rationale |
|---|---|---|
| D1 | **DOCX (OOXML) is the native format.** Never "an HTML editor with docx export". | A specified format with a real model, and it round-trips through Word itself. |
| D2 | **The engine owns layout. The DOM only paints it.** Immutable millipoint `LayoutResult` is the only layout authority; the renderer positions one absolute box per run from engine coordinates; **no CSS participates in layout**; pt→px in exactly one function; zoom is a pure paint scale that never re-runs layout; a divergence detector compares rendered DOM to engine in dev and CI. | The previous in-app attempt failed precisely here: the browser laid text out and a hand-written CSS mirror chased the engine's constants, so screen and export silently disagreed. |
| D3 | **Everything is a command; every state change is an event.** One surface for actions and observation. | Makes the library drivable by any host, and makes the token module just another consumer. |
| D4 | **Tokenization is an optional module**, separate entry point (`docier/tokens`), off by default. | A plain DOCX editor must not pay for templating. |
| D5 | **Chrome is plain DOM in the core** + thin `docier/react` adapter. **Not custom elements.** | Matches how the field does it (CodeMirror, ProseMirror, Lexical, Tiptap). Custom elements fight SSR and give poor TS DX via attribute/property duality. |
| D6 | **Browser floor is capability-based:** `CompressionStream`, `Intl.Segmenter`, `Popover API`, `structuredClone`, ESM + top-level await. In practice Chrome/Edge 120+, Firefox 121+, Safari 17.4+. No polyfills for legacy. | `Intl.Segmenter` gives real locale-aware line and word breaking for ro/ru. Zero zip dependency via `CompressionStream`. |
| D7 | **Unicode is preserved, not normalised**, on save. No NFC. | Legal fidelity: a name's byte representation must not change because we re-saved the file. |
| D8 | **PDF export is a separate entry point** (`docier/pdf`), not in the core. | Keeps the core lean; PDF generation is large and not every consumer wants it. |
| D9 | **Unknown OOXML parts and markup are preserved, never dropped.** | Documents come from Word full of things we do not model. Re-saving must not destroy them. |
| D10 | **No comments in code.** Explanation lives in `docs/` and commit messages. | Owner preference. |

| D11 | **Dual licence: AGPL-3.0-only + commercial.** Free for open source, paid for proprietary. `LICENSE`, `LICENSE.AGPL-3.0`, `COMMERCIAL.md`. | The field's standard shape for this (SuperDoc, ONLYOFFICE, Grafana). AGPL rather than GPL because it covers *network* use, so a SaaS cannot route around it. The owner holds copyright, so their own portal uses it freely. |
| D12 | **i18n: English is the only bundled language. Others are registered at runtime.** | A library should not ship three locales of strings nobody asked for. `registerLanguage(code, messages)`; the UI reads from the registry. |
| D13 | **Mobile shows an "unsupported" message.** No degraded mobile editing. | Explicitly the owner's call. Better a clear statement than a half-working surface. |
| D14 | **No fonts and no dictionary data are bundled.** Both are host-supplied through config. | Removes the font-licensing and the ro/ru dictionary-licensing problems entirely rather than negotiating them. Also keeps the package small. |
| D15 | **Unicode is preserved on save, not normalised** (D7 confirmed as the resolution of ADR-0001). | Legal fidelity. |
| D16 | **PDF/A-2b** as the archival profile, configurable. | The pragmatic archival choice, and it permits transparency that PDF/A-1b does not. The RO/RU compliance question remains open for the owner to confirm. |
| D17 | **One engine, two painters.** The PDF exporter renders the *same* `LayoutResult` the screen renders - it is a second painter, never a DOCX→PDF conversion through LibreOffice or any external converter. | This is the Google Docs property and the whole point of D2. Routing print through a converter reintroduces a second layout engine, and the screen/print drift returns one step downstream. Two painters of one layout is what makes "exact" true rather than aspirational. Resolves ADR-0002. |
| D18 | **"Exact" means screen equals print, and both are faithful to the DOCX semantics - NOT pixel-identical to Microsoft Word.** | Nothing in a browser is pixel-identical to Word, including LibreOffice, ONLYOFFICE and Word Online. And it is not required here: templates are authored in docier, so Word is never in the loop and there is nothing to be exact *with* except ourselves. Setting the bar at Word-parity would mean chasing an impossible target for years. |
| D19 | **The undo snapshot covers `numbering.xml`, and restoring it forgets the derived caches explicitly rather than keying them on content.** The part is captured copy-on-write (one shared clone, refreshed only when a numbering command's own before/after serialisation says the part changed) and restored as a minimal diff by `abstractNumId`/`numId`, so untouched definitions keep their parsed XML. `EditSession.changeNumbering` owns every numbering write and is the only thing that invalidates `NumberingPart`'s index maps and the `StyleResolver`. | A numbered clause is the commonest layout in the templates this library serves, and every `numbering.*` command was refused while the part sat outside the snapshot. Explicit forgetting over content-keying: a run's numbering depends on the whole `num → abstractNumId → abstractNum → lvl` chain plus the part's own key→object maps, so content-keying would mean serialising that chain per run in the layout hot path. The body still clones before every mutation - that clone is the pre-mutation state and cannot be shared. |
| D20 | **Header and footer regions reserve real space through a bounded fixpoint.** Regions are laid out once per (story, section, variant, page) so `PAGE` is right on every page; the body's content box is the section's box displaced to `max(topMargin, headerDistance + headerHeight)` at the top and `min(contentBox bottom, pageHeight − footerDistance − footerHeight)` at the bottom, clamped to at least one line with a `headerFooterTooTall` diagnostic; pagination then re-runs with the measured heights until the reserve map stops changing, at most 4 iterations (L3), after which `pageCountUnstable` is emitted and the last layout stands. Region lines are numbered in a negative id space. | Word's rule - the regions come out of the margins and a tall header pushes the body down rather than being overlapped by it - cannot be applied in one pass, because a `NUMPAGES` value's width can change a header's height, which changes the content box, which changes the page count. A bounded, deterministic loop beats an open convergence search, and the alternative (laying the body out first and shifting it afterwards) silently overlaps text. Negative line ids because the divergence detector keys on `data-docier-line`: a header line must never be mistaken for a body line. |

| D21 | **The undo snapshot covers every header and footer part, and one session addresses several stories through disjoint position ranges.** `EditSnapshot.regions` holds one copy-on-write clone per header/footer story (`partName` + root), refreshed only when a write inside `EditSession.changeRegions` says the part changed; restore applies a child-by-child minimal diff, so an untouched part keeps its parsed XML and round-trips byte for byte, and the cached views of a replaced subtree are forgotten. Restoring a region sets `regionsStale`, so the next snapshot re-captures instead of resurrecting an undone edit. Region paragraphs are addressable because `buildPositionIndex` rebases each region story's canonical instance into the same `DocPos` space after the body (story id `header:word/header1.xml`), so a position determines its story (`index.storyAt`) rather than a parallel "active story" flag; non-canonical instances (the same header on pages 2..n) contribute lines and stops but fold onto the canonical range. `insert.header`, `insert.footer` and `insert.closeHeaderFooter` are chrome commands that only move the caret; the editing verbs already work inside a story, and anything reaching across a story boundary is refused by `EditSession.crossing` with `CROSSES_STORY`. | The D19 reasoning exactly: a part outside the snapshot cannot be written by any command, because the edit could not be one undo entry. Position rebasing over per-story sessions keeps one selection, one history and one layout, and a caret is in exactly one story because the stories partition the position space - which is what makes "refuse to leave a story" a check on a number instead of on focus state that a click can desynchronise. |

### Resolved product calls

The owner resolved the eleven ADR items that needed a product decision on 2026-09-12: licence and
i18n as D11-D12 above, mobile as D13, fonts and dictionary data as D14 (sidestepping both licensing
questions rather than answering them), and the remaining scope questions as engineering defaults -
Bézier node editing deferred to v2, section-move by drag is navigate-only in v1, connector re-routing
stays where drawn in v1, `altChunk` is preserved rather than flattened, and image compression defaults
to a PPI ladder that never downsamples below print resolution.

**PDF/A-2b is confirmed** as the archival profile (owner, 2026-09-12), configurable so a host can select
another. The profile choice is settled; whether the Romanian and Russian archiving regimes *accept* it for
a given filing remains a compliance verification the owner should confirm with whoever handles that, but
it no longer blocks any implementation work. **No product decisions remain open.**

---

## Build and verification - corrected 2026-09-12

**Node v22.22.1 and npm 9.2.0 are available** at `/usr/bin/node` and `/usr/bin/npm`. An earlier claim in
this file that they were absent was wrong; it was never re-checked and it shaped far too much for how long
it stood. The only part of that claim that held is Docker - the socket is permission-denied.

**What this means for the loop: it runs as written.** Verify after every change, locally:

```
cd /home/daniel/work/docier
npx tsc --noEmit -p tsconfig.json      # typecheck, exit 0
npx tsc --noEmit -p tsconfig.test.json # typecheck the tests, exit 0
npm run build                          # emit
npx vitest run                         # 44 files, 582 passed, 1 skipped
```

Suite projects: `node` (`test/**` except `test/render`, `test/edit`, `test/api`) and `dom` (jsdom -
`test/render/**`, `test/edit/**`, `test/api/**`). Anything that touches the DOM belongs in the `dom`
project; adding a new DOM-touching directory means adding it to both the `dom` include and the `node`
exclude in `vitest.config.ts`, or it runs twice with no `document`.

CI runs the same thing on every push (`.github/workflows/ci.yml`), and the GitHub token now in the session
lets me read the run result and the failing log myself, so failures get fixed without a round trip through
Daniel.

**Do not describe work as unverifiable without having just tried to verify it.**

### Lesson, recorded because it cost a lot

The frontend editor (`hr-portal-frontend`) was developed for an entire session under the belief that
nothing could be compiled or run. It was stated to Daniel repeatedly, a blocker section was written around
it, and several bugs that a single `tsc` run would have caught were found late or by hand. A Node compile
cache dated three days before that session shows Node was in use on this machine the whole time.

The failure was not the bad check. It was never re-checking, and letting a claim about the environment
become a premise rather than a hypothesis. **Re-verify environment assumptions whenever they start to
constrain what can be done.**

---

## Deadlines, blockers and error log

| Date | Item | Status |
|---|---|---|
| 2026-09-12 | ~~No Node/npm in the sandbox~~ - **corrected: Node 22.22.1 and npm 9.2.0 are present.** Only Docker is denied. | **RESOLVED** |
| 2026-09-12 | CI added; GitHub token now lets me read run results and logs directly | **RESOLVED** |
| 2026-09-12 | Hyphenation/dictionary licensing for ro/ru | OPEN - product call |
| 2026-09-12 | PDF/A profile for RO/RU archiving | OPEN - product call |

---

## Task list

### Phase 0 - Foundations
- [x] Create the repo, scaffold `package.json` / `tsconfig.json` / `.gitignore`
- [x] Five parallel domain specifications in `docs/spec/` (~360 features)
- [ ] Consolidate into `docs/SPEC.md` + `docs/adr/`  *(agent running)*
- [ ] `src/units/` - EMU / twip / point / **millipoint** as branded types, exact round-trips  *(agent running)*
- [ ] `src/ooxml/` - .docx package layer: zip read/write, part registry, XML parse/serialise  *(agent running)*
- [ ] Add `.github/workflows/ci.yml`
- [ ] Decide the module boundary map from `docs/SPEC.md` and create the empty module folders

### Phase 1 - A document that survives a round trip  ✅ COMPLETE
- [x] `src/model/` - the OOXML-faithful document model. 37 files, ~8750 lines: paragraphs, runs, inline
      content, tables, sections, content controls, styles with the basedOn chain and direct-formatting
      precedence, numbering, settings. A typed view over the parsed XML tree that mutates in place, so
      unmodelled elements, attributes, comments and namespaces survive verbatim.
- [x] Parse a real Word `.docx` into the model
- [x] Serialise back; an untouched document is returned byte for byte, an edited one keeps its comments,
      smartTags, OMML, VML and vendor elements
- [x] Round-trip harness - 16 fixtures, validated externally with Python's `zipfile` and `minidom` rather
      than by the library checking itself
- [x] Styles resolution (7-level run cascade, 5-level paragraph cascade, Word's toggle semantics)
- [x] **ADR-0003 closed**: DEFLATE pinned with `fflate@0.8.3` at level 6, proven byte-identical across
      separate processes. `fflate` is docier's one runtime dependency, taken deliberately because
      byte-determinism cannot be met with the platform compressor.

**270 assertions, 12 suites, CI green (run #9).**

**The bug that justifies the whole approach:** `Part.document()` left the part marked `original`, so
`writePlan()` returned passthrough and **every model edit was silently dropped by `save()`**. An edit
would report success and the file would come back unchanged. Found only because the round-trip test
compared bytes. Two other agents independently flagged the neighbouring `markDirty()` trap; it is still
open and should be fixed in `src/ooxml/part.ts`.

### Phase 2 - Layout
- [x] `src/layout/` - the pass pipeline in dependency order, per spec 02
- [x] Font metrics and measurement (the single measurement seam)
- [x] Line breaking to millipoint `LayoutResult`
- [x] Pagination: page boxes, margins, breaks, widow/orphan, keep-with-next
- [x] The rendered-DOM-vs-engine divergence detector (`test/render/divergence.test.ts`)
- [x] Headers and footers: per-section default/first/even variants, link-to-previous inheritance,
      reserved region heights, displaced content box, painted by both painters
- [x] Page-number fields: `PAGE`, `NUMPAGES`, `SECTION`, `SECTIONPAGES` resolved end to end as laid-out
      text

**Headers, footers and page-number fields, as built.** `src/layout/header-footer.ts` resolves the plan -
`w:headerReference`/`w:footerReference` across `default`/`first`/`even`, `w:titlePg`,
`w:settings/evenAndOddHeaders`, and Word's inheritance rule where an absent reference continues the previous
section's region of that kind while an explicitly empty header part ends that inheritance - and lays one
region's story out with the same passes as the body. `src/layout/fields.ts` substitutes a field's text
before the paragraph is measured, so `PAGE` is a number the line breaker sees, not glyphs painted over the
page afterwards.

Every `PageFragment` now carries `header` and `footer` `HeaderFooterFragment`s: kind, story id, variant,
section, the `w:pgMar w:header`/`w:footer` distance, a page-absolute box and the laid-out blocks. The box is
the section's content width, its top at `headerDistance` below the page edge, and for a footer at
`pageHeight − footerDistance − footerHeight` - Word's geometry, so the distances are measured to the region's
near edge, not its far one. The body's content box is *displaced*, never overlapped: top =
`max(topMargin, headerDistance + headerHeight)`, bottom = `min(contentBox bottom, pageHeight − footerDistance
− footerHeight)`, clamped to at least one line with `headerFooterTooTall` when a region leaves no room (Word
pushes the body off the page there; we stop at one line and say so). Because a region's height can depend on
the page count through `NUMPAGES` and the page count depends on the content box, pagination runs as a bounded
fixpoint (L3, 4 iterations; `pageCountUnstable` and the last layout stands otherwise).

Region lines are renumbered into a negative id space, so a header line can never collide with a body line.
Both painters place a region container at the engine's own box - the DOM positions it with
`geometryAt(region.box, pageFrame)` and paints its blocks against `frameOf(region.box)`, the PDF paints the
same page-absolute block boxes through `pdfFrame` - and the divergence detector checks region blocks as well
as body blocks, so a header that drifts from the engine's millipoints fails in CI. A document with no
`sectPr` region references takes the pre-existing path untouched: content box, block boxes, every line box,
page kinds and story list were diffed byte-for-byte against the previous build.

Not done: a table inside a header or footer is skipped with `headerFooterTableNotLaidOut`; `w:pgNumType
w:start` and `w:fmt` are not read, so numbering starts at 1 and every format is decimal
(`fieldNumberFormatNotLaidOut` when the field carries a `\*` switch); footnotes in a region.
`LAYOUT_RESULT_VERSION` moved to 3 because `PageFragment` gained `header`, `footer` and `section`.

### Phase 3 - A visible, editable document
- [x] `src/render/` - paint-only DOM renderer from `LayoutResult`
- [x] `src/edit/` - caret, selection, keyboard, IME, undo/redo
- [x] `createEditor(el, config)` mount API and the command/event surface
- [ ] Minimum viable chrome so it is actually usable

**The editing surface, as built.** `src/edit/` is arithmetic over `LayoutResult` - it makes no layout
decisions. `src/edit/positions.ts` turns a `LayoutResult` into a `PositionIndex` (caret stops, line boxes,
paragraph spans); `caret.ts` maps a position to geometry and a pointer back to a position; `navigation.ts`
implements character/word/line/story movement including Word's Home/End semantics; `mutation.ts` edits the
model's XML in place; `actions.ts` composes those into named actions; `commands.ts` exposes them through the
command registry; `input.ts` bridges keyboard, pointer and native selection.

`src/api/` is the host surface: a command registry (`docier.command.<area>.<action>`, a closed
`COMMAND_AREAS` set), an event bus (`docier:<area>:<verb>`), history with coalescing, transactions, config
merging, `DocierError`, and `createEditor(element, config, options)`.

Five defects found and fixed while testing this surface, all in the new code: `contentLength` measured a
`w:t` by summing element children rather than text nodes, so every split inside a run silently produced an
empty paragraph; `partition` could not descend into a run, so a paragraph split never divided it;
`prepare()`'s shift-extend guard was inverted, making every shift-move a no-op; the first entry of a typing
run stored no coalescing key, so three keystrokes became two undo entries; and `redo` returned the entry's
selection *before* the change instead of after.

**Declared but not implemented:** `docier:issues:change` is never emitted (no issues subsystem yet), and the
spec's async `createDocier(options)` constructor - with plugins, tokens, theme, ui and renderers - is not
built; `createEditor` is the mount API this phase delivered.

**DOM painter parity with the PDF painter (D17).** The DOM painter now paints what the PDF painter paints,
from the same `LayoutResult`, with no new runtime dependency and no layout decision in `src/render/`.

Five gaps closed, each with a test that asserts the painted style rectangle against the engine's
millipoints *and* the derived pixels (jsdom has no layout engine, so `getBoundingClientRect` returns zeros
and the checks read the inline-style sums with `authoritative: false`, as the existing render tests do):

1. **Images.** `src/render/images.ts` holds bytes by id, dedupes by `sha256Hex` exactly as
   `src/pdf/images/registry.ts` does, and hands out `data:` URLs (jsdom has no `URL.createObjectURL`).
   `src/render/objects.ts` mirrors the PDF's `imageBox()` crop arithmetic and centre-preserving rotation
   and positions one container per object atom from `objectBoxOf` (engine `atom.x`,
   `line.baselineY - run.ascent`, `wp:extent`). Nothing is clipped, so crop overflow stays screen-equal to
   print. A source the host never supplied paints a visible placeholder at the engine box - dashed outline
   and label in host-token CSS variables - and is reported twice over: once through `onIssue` and in
   `rendered.issues` (`missingImage`, detail = relationship id), which is the failure mode the exercise was
   about.
2. **Per-run ascent, descent and shift.** The run box is now `baselineY - run.ascent` high by
   `ascent + descent`, so a superscript is raised by exactly its engine shift instead of sharing one
   paragraph-wide box. The run's highlight moved to its own band spanning `line.lineHeight`, which is what
   the PDF `fillRect`s.
3. **Per-atom resolved size.** `segmentsOf` splits a run wherever `atom.size` changes and
   `runFontSpecAt` uses that size, so a small-caps run paints two boxes at 10000 and 8000 mp with no CSS
   `font-variant` - the approximation is gone from the painter (the property stays in the allow-list).
4. **Paragraph decoration.** Shading and each border edge paint from `edgeBandOf`, in the PDF's order
   (shading, then borders, then lines).
5. **Page origin.** The renderer now *uses* `page.origin` in document coordinates and adds only its own
   uniform cosmetic gap on top: sheet *i* is placed at `(px(origin.x), px(origin.y) + gapPx * i)` and the
   pages layer is sized from the union of the engine rectangles. Chosen over owning the stacking itself
   because the engine already publishes page positions, and a painter that re-derives them from accumulated
   heights silently encodes a layout rule; the gap is the one thing the engine has no opinion about, so it
   stays a render option. For today's engine the two give identical pixels, which is why the detector
   checks the *relative* placement against the origins and infers the constant gap.

`RESULT_GAPS` is now `['fontFileHash']`, down from
`['fontFileHash', 'perRunAscentAndDescent', 'perAtomFontSize', 'verticalShift', 'pageOriginInDocument',
'imageSourceAndSize', 'paragraphDecorationRects']`. The six names that described the gaps above are gone
because they are painted, and `fontFileHash` stays because the renderer still cannot verify that the family
it resolves is the same font *file* the PDF embeds: CSS resolves families through the host, and no hash
reaches the DOM painter. `test/render/contract.test.ts` was extended, not weakened: it now pins the detector's divergence
kinds against a `Record<DivergenceKind, true>` so a new kind cannot be added silently, and asserts the gap
list stays disjoint from them, non-empty, non-duplicated and identifier-shaped.

The detector itself grew three checks and no longer skips a decoration it cannot find: an object the engine
places but the DOM does not paint is `missingImage` (also when a placeholder carries no visible label), a
moved object box or decoration is `objectBox` / `decoration`, a misplaced sheet is `pageOrigin`, and each
painted segment's `font-size` is compared to the atom size it came from (`runFontSize`). A decoration the
engine reports and the DOM has no node for is a divergence rather than a skip - the old code counted that
as "could not check", which is exactly how a silently absent rectangle hides.

**Both screen-vs-print differences this change left in `src/pdf/` are now closed.**

(a) `src/pdf/page.ts` `imageBox()` built `[cos, sin; -sin, cos]` for a positive `rotationMilliDegrees`,
which in PDF's y-up space rotates counter-clockwise, while OOXML `rot` and CSS `rotate()` are clockwise for
the same value - a rotated image printed mirrored in direction from how it painted on screen, and the
exporter emitted `0 20 -20 0 92 700 cm` for `rot="5400000"`. The writer now negates the sine, so the same
image emits `0 -40 20 0 82 730 cm` and the PDF matrix and the DOM's `rotate()` box land on the same four
corners. `test/render/rotation.test.ts` asserts
that agreement corner by corner at 90°, 180°, 30°, 217° and −45°, over a crop as well, and holds a
regression guard that the PDF corners are *not* the counter-clockwise ones (the old output is exactly the
centre-preserving rotation by −θ). `test/pdf/images.test.ts` rasterises the file with `pdftoppm` and checks
that the dark half of a 40×20 pt gradient lands in the top half of the rotated footprint the engine placed -
the old sign put it in the bottom half, 20 pt away.

(b) A missing image printed nothing. `paintMissingObject` now paints what the screen paints: the fill, the
dashed outline and the label, at `objectBoxOf` in the engine's coordinates, and the `missingImage` loss and
its new `detail` (the relationship id, matching the render issue payload) are kept. Both painters were
checked against the engine box rather than against each other: the DOM container's summed inline position
and the PDF's `re f` rectangle are both compared to `objectBoxOf(line, run, atom)`, and `pdftotext` extracts
`missing image: rId7` from the exported file.

Tests added: `test/render/images.test.ts` (12), plus image zoom cases in `test/render/zoom.test.ts`,
superscript/small-caps/decoration/gap cases in `test/render/divergence.test.ts`, including a document that
exercises every closed gap at once and a `detectDivergence` run over it that reports clean with
`checked.objects`, `checked.decorations` and `checked.fonts` non-zero. Verification:
`npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p tsconfig.test.json` and `npx vitest run`
(1046 passed, 2 skipped, 79 files) all green, up from 1028 passing before.

### Phase 4 - Word-like
- [ ] Formatting and the styles engine
- [x] Lists: `src/edit/list.ts` writes and reads bullet, decimal and multilevel definitions, and
      `docier.command.numbering.*` applies a list, removes it, sets the level, promotes/demotes,
      restarts and sets the format - one undo entry each, numbering part included (D19). Still
      refused: continuation, definition cloning, `w:lvlRestart`/`w:isLgl`, list styles, cleanup,
      list→text. The layout slice paints no numbering text or indent yet, so lists are model-complete
      and render-incomplete.
- [ ] Rulers (one per document, not per page), status bar, zoom
- [ ] Menu bar / ribbon, dialogs, context menus for every surface
- [ ] Floating selection controls
- [ ] Objects: images, shapes, z-order, handles, wrapping

### Phase 5 - Tokens
- [ ] `src/tokens/` as a separate entry point, off by default
- [ ] Content controls (`w:sdt`) as the token carrier
- [ ] Insert by palette / trigger-autocomplete / dialog
- [ ] Fill, preview, unresolved-value reporting, unlink

### Phase 6 - Output and release
- [x] `src/pdf/` - PDF export as its own entry point (`docier/pdf`, D8). `renderPdf(result, options)`
      serialises the millipoint `LayoutResult` the screen paints (D17): no second layout, no
      re-measure, no consultation of the model for positioning. One conversion point,
      `src/pdf/geometry.ts`, flips the engine's top-down points into the PDF's bottom-up user space.
      Fonts are embedded as Identity-H CIDFontType2 TrueType subsets whose glyph advances come from
      the measurer's cluster advances (the widths the engine laid out with), falling back to the
      embedded hmtx only when the measurer cannot supply the family - with `metricSourceMismatch`
      against the face id, and `metricMismatch` per atom when the layout's advance cannot be
      reproduced. A face the host has not supplied is reported, never silently swapped. PNG and JPEG
      images embed and dedupe per document. Deterministic by default: no wall clock, `/ID` and
      `xmpMM:DocumentID` from the document hash, pinned DEFLATE. PDF/A-2b, A-2u and A-3b with a
      built sRGB output intent; A-1b is refused citing ADR-0006. Not done: encryption and signing.
- [x] Print path and print preview
- [ ] Accessibility pass, i18n pass (en/ro/ru + RTL groundwork)
- [ ] Performance pass on a 200-page document
- [ ] `README.md`, API docs, examples, npm publish (`docier`)

**The print path, as built.** Two sessions, one per path the spec names (EXP-03), and neither
re-implements what the other owns. `beginPrint(rendered, options)` is the CSS path: it builds a stylesheet
from the same `LayoutResult` the screen painted, appends it to the document head, forces zoom 1, and calls
`window.print()` through an injected printer. `beginPdfPrint(bytes, options)` is the default path: it takes
the bytes `exportPdf` produced and prints them from a hidden blob `<iframe>`, which is what gives exact
pagination and exact page ranges. Ranges are parsed once, in `src/render/page-range.ts`, and shared with the
exporter, so `"1-3,5,8-"`, reverse ranges and the odd/even filters behave identically in print and in the
file (EXP-02). Print preview is our own renderer: `beginPrintPreview` is the same session with the rules
unwrapped from `@media print`, so the preview shows the sheets at paper size, in print order, with the range
applied - the browser's dialog is never the preview surface.

The CSS path does not re-lay-out anything, which is what D17 asks. Each sheet is already the engine's
`LayoutResult` painted at scale 1 into a fixed-size box, so the printed page *is* the screen page; the
stylesheet only takes away the screen positioning that the print engine cannot break across paper
(`position: absolute` on the sheets, the scale transform, the surface's fixed size), leaving the sheet
`position: relative` so it stays the containing block for the absolutely positioned content inside it. Each
sheet gets `@page { size: <w>pt <h>pt; margin: 0 }` from its own section's page size - every distinct size
gets a named `@page` and a `page:` declaration, so a landscape section in the middle of a portrait document
prints on landscape paper, and `margin: 0` is what leaves no room for chrome the browser would otherwise
add. One `break-after: page` on every sheet but the last in print order, plus `display: none` on the pages a
range excluded. Ordering is the one thing block flow cannot express, so a selection that is not in document
order switches the stack to a column flex container and gives each sheet its `order` - flex only then,
because block flow is the more reliable thing to fragment.

Diagnostics carry the limits rather than pretending: the browser owns the dialog's copies field, the
browser re-renders these sheets itself (so text is rasterised by the browser, not taken from the exported
file), a browser without named `@page` support prints every section at the first page size, and the dialog's
range field cannot be pre-set - which is why `exportPdf(result, { pageRange })` exists and why the file, not
the dialog, is how a range gets exact.

Tests: `test/render/print.test.ts` (17) asserts the stylesheet and both sessions, `test/render/page-range.test.ts`
(7) the shared grammar, `test/pdf/selection.test.ts` (5) the narrowed export and the per-section paper sizes,
`test/render/rotation.test.ts` (8) the two painters' agreement, and `test/pdf/images.test.ts` the two
round-trips above. Verification: `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p tsconfig.test.json`
and `npx vitest run` (1089 passed, 2 skipped, 82 files) all green.

**Not done, and not stubbed:** grayscale and background suppression are implemented in the CSS path
(`filter: grayscale(1)`, and a skip of the page/shading backgrounds) but *not* in the PDF writer, where
EXP-03 places them; `w:settings/w:printTwoOnOne` and `printerSettings/*.bin` are unparsed by this slice, so
two-up and printer-specific duplex/paper-source hints are neither honoured nor reported; `PRINTDATE` has no
engine support; nothing lays out headers or footers, so preview cannot show `PAGE`/`NUMPAGES` substitutions;
there is no annotation class in the layout for an annotation policy to select; and the API-level
`print({ mode })` dispatcher does not exist - `mode` is expressed by which session the host calls, because
D8 forbids `src/render` importing `src/pdf`, so the dispatcher belongs wherever both are importable.

---

## Diagnosed defects, all closed

The table column allocation defect and the `markDirty` trap were the last two open
here; both are fixed and verified. The full account is in `docs/UI-PROGRESS.md`
appendices A5 and A6.

**The table column.** `cellIntrinsic` in `src/layout/table-prepare.ts` derived a
cell's minimum and preferred widths from its paragraphs alone, while `contentWidth`
at the other end of the same comparison was a box width with the margins and border
halves already subtracted - so a column could be allocated less than its content
plus padding and the text overflowed into the next cell. Both figures now carry the
margins and the border halves. The four expectations the previous attempt could not
re-derive move by exactly `DEFAULT_CELL_MARGIN_MP * 2`, and the test derives each
one as content plus padding rather than pinning the observed number. Verified in the
browser: the sample's first column is 77.4px where the diagnosis asked for 78, and
no cell in the header row spills its text, where before the heading printed as
"ColumnEvidence".

**The `markDirty` trap.** `Part.markDirty()` set a flag `writePlan()` never read, so
marking an unread part dirty saved it as its original bytes and a caller could
believe it had edited a part that never changed. It now throws `PART_NOT_READ`.

---

## Micro-iteration loop

1. **Sync** - read this file before starting.
2. **Scope** - one file or one function.
3. **Verify** - `cd /home/daniel/work/docier` and run, in order:
   `npx tsc --noEmit -p tsconfig.json`, `npx tsc -p tsconfig.test.json --noEmit`,
   `npm run build`, `npx vitest run`. All four must be green. Node and npm are
   present; the old belief that they were not cost a whole session, and the
   correction is recorded above.
4. **Persist** - update this file and `docs/UI-PROGRESS.md`.
5. **Commit** - descriptive message, no co-author trailer.

**Infinite-loop protection:** if the same failure repeats three times, stop. Run
`git diff`, write the failure under Blockers, and change approach rather than
retrying.

---

## Current active sub-task

**The interface phases in `docs/UI-PROGRESS.md` are the live plan, not the numbered
phases above.** That file is the working record and the appendices there are the
findings log.

As of 2026-09-13 every interface phase is closed: A, B (B1-B4), C (C1-C5), D
(D1-D4), and E (E1-E3) complete and verified in a browser. Phase F delivered its
picture, hyperlink and symbol commands, verified live; five of its entries - comments,
footnote, header creation, text box and table of contents - remain refused, and
`docs/UI-PROGRESS.md` names for each one the subsystem it would need.

The diagnosed defects that sat under all of this are closed: the table column
allocation, the `markDirty` trap, the right-click that destroyed a selection, and
the missing Picture context menu. The account is in the appendices there.
