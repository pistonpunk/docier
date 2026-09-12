# docier — Progress Tracker

Anchor document for long-running work. Read this first, update it last.

---

## Ultimate Goal

**docier** — a standalone, framework-agnostic **TypeScript** library for editing DOCX documents in the
browser, exposed on npm, as a credible open alternative to ONLYOFFICE for a document-template product
(HR contracts, orders, letters; Romanian and Russian as common document languages).

Success means: a host app mounts it into a DOM element, configures it with one config object, drives it
through commands, observes it through events, gets a real Word-compatible `.docx` in and out, and can turn
tokenization on or off by config. It must feel like Word to a non-technical HR manager, and it must be
pleasant to integrate for a developer.

**Repo:** `git@github.com:pistonpunk/docier.git` · local `/home/daniel/work/docier` · branch `main`
**Licence:** dual AGPL-3.0-only or commercial (D11) · **Runtime deps:** exactly one — `fflate`, taken for byte-deterministic compression (ADR-0003)

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
| D17 | **One engine, two painters.** The PDF exporter renders the *same* `LayoutResult` the screen renders — it is a second painter, never a DOCX→PDF conversion through LibreOffice or any external converter. | This is the Google Docs property and the whole point of D2. Routing print through a converter reintroduces a second layout engine, and the screen/print drift returns one step downstream. Two painters of one layout is what makes "exact" true rather than aspirational. Resolves ADR-0002. |
| D18 | **"Exact" means screen equals print, and both are faithful to the DOCX semantics — NOT pixel-identical to Microsoft Word.** | Nothing in a browser is pixel-identical to Word, including LibreOffice, ONLYOFFICE and Word Online. And it is not required here: templates are authored in docier, so Word is never in the loop and there is nothing to be exact *with* except ourselves. Setting the bar at Word-parity would mean chasing an impossible target for years. |

### Resolved product calls

The owner resolved the eleven ADR items that needed a product decision on 2026-09-12: licence and
i18n as D11–D12 above, mobile as D13, fonts and dictionary data as D14 (sidestepping both licensing
questions rather than answering them), and the remaining scope questions as engineering defaults —
Bézier node editing deferred to v2, section-move by drag is navigate-only in v1, connector re-routing
stays where drawn in v1, `altChunk` is preserved rather than flattened, and image compression defaults
to a PPI ladder that never downsamples below print resolution.

**PDF/A-2b is confirmed** as the archival profile (owner, 2026-09-12), configurable so a host can select
another. The profile choice is settled; whether the Romanian and Russian archiving regimes *accept* it for
a given filing remains a compliance verification the owner should confirm with whoever handles that, but
it no longer blocks any implementation work. **No product decisions remain open.**

---

## Build and verification — corrected 2026-09-12

**Node v22.22.1 and npm 9.2.0 are available** at `/usr/bin/node` and `/usr/bin/npm`. An earlier claim in
this file that they were absent was wrong; it was never re-checked and it shaped far too much for how long
it stood. The only part of that claim that held is Docker — the socket is permission-denied.

**What this means for the loop: it runs as written.** Verify after every change, locally:

```
cd /home/daniel/work/docier
npx tsc --noEmit -p tsconfig.json      # typecheck, exit 0
npx tsc --noEmit -p tsconfig.test.json # typecheck the tests, exit 0
npm run build                          # emit
npx vitest run                         # 44 files, 582 passed, 1 skipped
```

Suite projects: `node` (`test/**` except `test/render`, `test/edit`, `test/api`) and `dom` (jsdom —
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
| 2026-09-12 | ~~No Node/npm in the sandbox~~ — **corrected: Node 22.22.1 and npm 9.2.0 are present.** Only Docker is denied. | **RESOLVED** |
| 2026-09-12 | CI added; GitHub token now lets me read run results and logs directly | **RESOLVED** |
| 2026-09-12 | Hyphenation/dictionary licensing for ro/ru | OPEN — product call |
| 2026-09-12 | PDF/A profile for RO/RU archiving | OPEN — product call |

---

## Task list

### Phase 0 — Foundations
- [x] Create the repo, scaffold `package.json` / `tsconfig.json` / `.gitignore`
- [x] Five parallel domain specifications in `docs/spec/` (~360 features)
- [ ] Consolidate into `docs/SPEC.md` + `docs/adr/`  *(agent running)*
- [ ] `src/units/` — EMU / twip / point / **millipoint** as branded types, exact round-trips  *(agent running)*
- [ ] `src/ooxml/` — .docx package layer: zip read/write, part registry, XML parse/serialise  *(agent running)*
- [ ] Add `.github/workflows/ci.yml`
- [ ] Decide the module boundary map from `docs/SPEC.md` and create the empty module folders

### Phase 1 — A document that survives a round trip  ✅ COMPLETE
- [x] `src/model/` — the OOXML-faithful document model. 37 files, ~8750 lines: paragraphs, runs, inline
      content, tables, sections, content controls, styles with the basedOn chain and direct-formatting
      precedence, numbering, settings. A typed view over the parsed XML tree that mutates in place, so
      unmodelled elements, attributes, comments and namespaces survive verbatim.
- [x] Parse a real Word `.docx` into the model
- [x] Serialise back; an untouched document is returned byte for byte, an edited one keeps its comments,
      smartTags, OMML, VML and vendor elements
- [x] Round-trip harness — 16 fixtures, validated externally with Python's `zipfile` and `minidom` rather
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

### Phase 2 — Layout
- [x] `src/layout/` — the pass pipeline in dependency order, per spec 02
- [x] Font metrics and measurement (the single measurement seam)
- [x] Line breaking to millipoint `LayoutResult`
- [x] Pagination: page boxes, margins, breaks, widow/orphan, keep-with-next
- [x] The rendered-DOM-vs-engine divergence detector (`test/render/divergence.test.ts`)

### Phase 3 — A visible, editable document
- [x] `src/render/` — paint-only DOM renderer from `LayoutResult`
- [x] `src/edit/` — caret, selection, keyboard, IME, undo/redo
- [x] `createEditor(el, config)` mount API and the command/event surface
- [ ] Minimum viable chrome so it is actually usable

**The editing surface, as built.** `src/edit/` is arithmetic over `LayoutResult` — it makes no layout
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
spec's async `createDocier(options)` constructor — with plugins, tokens, theme, ui and renderers — is not
built; `createEditor` is the mount API this phase delivered.

### Phase 4 — Word-like
- [ ] Formatting and the styles engine
- [ ] Rulers (one per document, not per page), status bar, zoom
- [ ] Menu bar / ribbon, dialogs, context menus for every surface
- [ ] Floating selection controls
- [ ] Objects: images, shapes, z-order, handles, wrapping

### Phase 5 — Tokens
- [ ] `src/tokens/` as a separate entry point, off by default
- [ ] Content controls (`w:sdt`) as the token carrier
- [ ] Insert by palette / trigger-autocomplete / dialog
- [ ] Fill, preview, unresolved-value reporting, unlink

### Phase 6 — Output and release
- [ ] `src/pdf/` — PDF export, separate entry point
- [ ] Print path and print preview
- [ ] Accessibility pass, i18n pass (en/ro/ru + RTL groundwork)
- [ ] Performance pass on a 200-page document
- [ ] `README.md`, API docs, examples, npm publish (`docier`)

---

## Micro-iteration loop (adapted for a no-compiler environment)

1. **Sync** — read this file before starting.
2. **Scope** — one file or one function. No multi-file rewrites in a single step.
3. **Verify** — there is no local build. Substitute: re-read the changed file in full, check every import
   resolves, every type is satisfied by hand, and no unused symbol remains. Then push, and ask for CI or a
   local `npm run typecheck` when the change is large enough to be worth a round trip.
4. **Persist** — update this file: check off what is done, record what is now active.
5. **Commit** — concise, descriptive message.

**Infinite-loop protection:** if the same failure repeats three times, stop. Run `git diff`, write the
failure under Blockers, and change approach rather than retrying.

---

## Current active sub-task

**Phase 3's editing surface and public API are complete and verified; Phase 3's chrome is not started.**
Next action: build the minimum viable chrome (toolbar, status bar, context menu, selection handles) on top
of `commands.list()` for enablement and `commands.execute()` for dispatch, then close Phase 3. All 49 ids in
`editCommandIds` are registered and none is declared-but-unimplemented; the empty areas a toolbar will
reach for are `insert`, `table`, `clipboard`, `view` and `style`, which `COMMAND_AREAS` reserves but
nothing registers into yet.
