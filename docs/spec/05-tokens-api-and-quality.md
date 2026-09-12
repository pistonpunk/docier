# Spec 05 - Tokenization, Public API, and Cross-Cutting Quality

| | |
|---|---|
| **Spec id** | `docier/spec/05` |
| **Domain** | Tokenization module · public API / events / config / extensibility · cross-cutting quality |
| **Status** | Draft for review |
| **Depends on** | `01-ooxml-model`, `02-layout-engine`, `03-editing-surface`, `04-storage-and-io` (assumed; this spec only names their seams) |
| **Fixed by product** | DOCX (OOXML) is the native format · embeddable, one config object, commands + events, no framework dependency · tokenization is an optional in-library module toggled by config |
| **Audience** | Library implementers; the backend team implementing the token catalogue; the frontend team embedding docier |

## How to read this document

Every feature is one `###` heading:

- **id** - `TOK-nn` (tokenization), `API-nn` (public API), `QUA-nn` (cross-cutting quality).
- **priority** - `core` (cannot ship without it), `important` (ship within the first two minor releases), `later` (planned, explicitly out of the 1.0 gate).
- **effort** - `S` (≤2 days), `M` (≤1 week), `L` (≤3 weeks), `XL` (needs its own design pass and probably its own spec revision).
- **OOXML** - the elements and parts the feature reads or writes, where relevant.

TypeScript blocks are **normative**: they are the shape the host app and the token module both compile against. Blocks omit field-doc comments by project convention; the bullets after each block define every field.

---

# Part 1 - The tokenization / templating module

The module is inert until `config.tokenization.enabled === true`. With it off, none of the token commands are registered, no token UI is mounted, `w:sdt` elements in an opened DOCX are preserved verbatim as opaque content, and `docier.tokens` is `null`. **Nothing else in the library may depend on the module** - this is enforced by a lint rule on import boundaries.

## 1.1 Representation

### TOK-01 - Canonical token storage is a content control (`w:sdt`)

`core` · `XL` · OOXML: `w:sdt`, `w:sdtPr`, `w:tag`, `w:alias`, `w:id`, `w:sdtContent`

**Decision.** A token instance is stored as a Structured Document Tag. Run-level tokens are an `w:sdt` that is a direct child of a `w:p` (member of `EG_ContentRunContent`); block-level tokens are an `w:sdt` that is a sibling of `w:p` in the body, `w:tc`, `w:hdr`, `w:ftr`, or `w:footnote`. The token key lives in `w:sdtPr/w:tag`; the human-readable label in `w:sdtPr/w:alias`; a document-unique integer in `w:sdtPr/w:id`.

**Why not plain-text markers as the storage form.** The tradeoff, stated honestly:

| | `w:sdt` | plain-text marker (`{{key}}`) |
|---|---|---|
| Round-trips through Word | Yes - Word shows a control, edit is contained | Yes as text, but Word may split it across `w:r` |
| Survives reformatting/spellcheck in Word | Yes | No - run splitting breaks the marker |
| Lockable against editing | Yes (`w:sdtPr/w:lock`) | No |
| Rich values, block content, loops | Yes - content is arbitrary blocks | No |
| Works in LibreOffice / Google Docs | Degraded - often flattened to plain text | Yes |
| Diff noise in golden-file tests | Higher (ids, aliases) | Lower |
| Discoverable by a third-party consumer | Yes - explicit semantics | Only by convention |

`w:sdt` wins because docier's templates come back from Word round-trips (HR managers edit the template in Word and re-upload it) and because loops, conditionals and rich values need block content. Plain text cannot carry any of that.

**Rules.**
- Opening a document that contains `w:sdt` without a `docier`-namespaced tag leaves it entirely alone; such controls are *foreign* and read-only to the token module.
- A token instance is the `w:sdt` node. Its "value" area is `w:sdtContent`; the module reads the *first* `w:p` (run-level) or the whole block set (block-level) as the current content.
- `w:sdtPr/w:id` is assigned from the document's next free id and must stay unique across all parts; on paste, ids are re-minted.
- `w:lock` is written for locked tokens and protected regions (TOK-28).
- Unknown children of `w:sdtPr` are preserved on save.

**Edge cases.** An `w:sdt` that contains another `w:sdt` is legal and expected (loop containing field tokens); nesting depth is capped at 8, beyond which insertion is refused with a stated reason. An `w:sdt` spanning table rows is not representable in OOXML and must never be produced - block-level insertion inside a table is confined to a single `w:tc`. Tracked-change wrappers (`w:ins`/`w:del`) around an `w:sdt` are honoured: fill inside `w:del` is skipped.

### TOK-02 - Plain-text marker syntax as import and interchange form

`core` · `L` · OOXML: `w:t`, `w:r`, `w:proofState`

**Behaviour.** `{{key}}`, `{{key|format}}`, and configurable delimiter pairs (`markerSyntax.open` / `markerSyntax.close`, including `«` `»` for Russian-language templates and `[` `]`) are recognised as token syntax in three places: on document open (converted to `w:sdt`), in the "Convert markers to tokens" command, and in text pasted into the document.

**Rules.**
- Default `tokenization.storage` is `sdt`. Setting it to `text` keeps tokens as literal marker text for consumers that cannot read OOXML controls; in that mode loops and conditionals are still expanded at fill time, but rich values degrade to plain text and a startup warning is emitted.
- Conversion is a single undoable transaction per document part. Converted markers report through `docier:token:insert` with `trigger: 'import'`.
- Marker detection is bounded: a candidate must be ≤128 chars, contain no line break, and match `^[A-Za-z0-9_.\[\]-]+$` before the optional format segment. Anything else is left as text and reported as `marker-syntax-invalid`.
- A marker whose key is not in the catalogue is still converted (identity is preserved) and shows as unknown (TOK-23).

**Edge cases.** Escaping: `\{\{` renders a literal `{{` and is unescaped on export. A marker split across runs by Word's proofing must be coalesced first (TOK-04). Markers inside a field code (`w:instrText`) are never converted.

### TOK-03 - Token identity: key, instance, kind

`core` · `L` · OOXML: `w:sdtPr/w:tag`, `w:sdtPr/w:alias`

Two different identities, never conflated:
- **Token key** - the data path, e.g. `employee.lastName`, `contract.startDate`, `lines[].amount`. Many instances share one key.
- **Instance id** - the `w:sdtPr/w:id`, unique in the document. Commands, events, and selection all address instances.

`w:tag` carries `docier:<kind>:<key>` (e.g. `docier:field:employee.lastName`, `docier:loop:lines`, `docier:if:employee.isMinor`, `docier:image:employee.photo`). Backwards-compatible parsing accepts a bare key and treats it as `field`. `w:alias` carries the catalogue label in the *document* language, refreshed whenever the catalogue changes.

**Edge cases.** Renaming a catalogue key does not rewrite documents automatically; it produces an unknown-token issue with a suggested remap (TOK-23). Two instances with the same key may carry different formats - format is per-instance state stored in the tag payload, not only in the catalogue.

### TOK-04 - Run-splitting normalisation on import

`core` · `L` · OOXML: `w:r`, `w:rPr`, `w:t`

**Behaviour.** Before marker detection and before reading `w:sdtContent` as a value, adjacent runs whose `w:rPr` are equivalent are coalesced for *analysis only*. Word splits `{{employee.lastName}}` across up to five runs after a spellcheck pass; without normalisation every such template reads as three unknown tokens.

**Rules.**
- Coalescing for analysis is non-destructive: the document is not rewritten unless the user runs the conversion command, which then rewrites the runs for real inside one transaction.
- `w:rPr` equivalence is by canonical XML comparison of the properties, ignoring `w:rsid*` attributes and `w:lang` differences that affect nothing visually.
- `w:proofState`, `w:noProof`, and `w:highlight` do not block coalescing; `w:ins`/`w:del` boundaries do.
- A marker that survives analysis but spans more than 20 runs is reported as `marker-fragmented` and offered as a manual fix rather than auto-merged.

**Edge cases.** A `w:br`, `w:tab`, or `w:drawing` between runs makes the marker a non-match (correct - it was never one token). Soft hyphens and zero-width spaces inserted by Word's proofing tools are stripped inside a candidate marker.

## 1.2 Insertion

### TOK-05 - Insert from the token palette

`core` · `M`

The palette (`docier.command.token.openPalette`, default binding `Ctrl/Cmd+Alt+T`) lists catalogue entries grouped by catalogue `group`, virtualised, with keyboard-first navigation: type to filter (fuzzy on key and on label in the UI language), `↑`/`↓` to move, `Enter` to insert, `Esc` to close and restore focus.

**Rules.** Inserting a `field` at a collapsed caret inserts a run-level `w:sdt` and leaves the caret immediately after it. Inserting inside an existing token's `w:sdtContent` is refused with reason `inside-token`. Block kinds (`loop`, `image`, `if`) inserted with a collapsed selection inside a paragraph split the paragraph so the block sits between fragments; the palette shows a confirmation line ("Will be inserted as its own block") before the keystroke is honoured. Items already present are marked (`instanceCount`), not disabled - a template legitimately repeats a token.

**Edge cases.** Palette inside a table cell offers only run-level kinds plus `loop` over rows. Palette while a protected region is selected refuses with `region-protected`. Focus returns to the document surface on close, always, including on `Esc` and on blur-through-click-outside.

### TOK-06 - Type-trigger autocomplete

`core` · `L` · OOXML: `w:sdt`

**Behaviour.** Typing `{{` (configurable via `tokenization.trigger`) opens an inline suggestion list anchored to the caret. The list filters as the user types; `Enter`/`Tab` commits, `Esc` dismisses and leaves the literal text typed so far.

**Rules.**
- Commit replaces the typed trigger and query text with the token in one transaction; it never leaves `{{ais` behind.
- Query text is matched first on key prefix, then on key substring, then on label; results are grouped and capped at 50 with a "refine your search" footer.
- The trigger is suppressed while `config.tokenization.triggerEnabled === false` (hosts that own the key handling), inside code-ish content (none in docx), and while an IME composition is active (`compositionstart` … `compositionend`) - committing mid-composition is a known source of dropped text.
- The suggestion list is a `role="listbox"` with `aria-activedescendant` maintained on the caret-anchored list; each row's accessible name includes key, label, and kind.
- Suggestions are driven from the local catalogue snapshot; a stale catalogue (>5 min, configurable) triggers a background refresh, never a blocking fetch.

**Edge cases.** `Tab` commits where `config.editing.tabInsertsTab === false`. Typing the closing delimiter manually closes the list without inserting. Pasting text containing `{{` does not open the list.

### TOK-07 - Insert and edit via dialog

`important` · `M`

A dialog for token insertion with the full catalogue tree, per-kind fields, and a preview of the resolved value against current data. Doubles as the *edit* dialog for an existing instance (double-click a token, or `Alt+Enter` on the keyboard), where it also exposes format overrides, required-ness, and the unlink action.

**Rules.** The dialog is a focus trap; the first focusable control receives focus; `Esc` closes and restores focus to the token or caret that opened it; `Enter` confirms unless focus is in a multiline control. Every control is reachable by `Tab` in DOM order and every action has a keyboard equivalent - no drag-only or click-only affordances anywhere in the dialog. The dialog is rendered into `slots.dialogHost` when the host supplies one.

### TOK-08 - Display modes and the display/export agreement rule

`core` · `L` · OOXML: `w:sdtContent`, `w:showingPlcHdr`

**The rule this feature exists to enforce.** *Display is a projection; export is computed from the model and data, never scraped from the DOM.* Concretely: saving a document runs `fill(model, data)` over the document tree and serialises the result. The rendered DOM is never read back into the DOCX. Any implementation that serialises what is on screen is a defect.

Three modes, `config.tokenization.display`:

| Mode | Shows | Use |
|---|---|---|
| `placeholder` | Chip with the label, e.g. `Employee name` | Template authoring - the default |
| `fieldCode` | `{{employee.lastName}}` in a monospace-affecting run | Debugging / template review |
| `resolved` | The current value from bound data, or a dashed "unresolved" chip | Preview |

**Rules.**
- Switching mode is a view-only change: it does not mark the document dirty, does not create an undo entry, and does not alter `w:sdtContent`.
- `w:showingPlcHdr` is written **only** in `placeholder` mode on export of a *template* (see `SaveMode` below); it is never written in a document export.
- Two save modes, and they must not be confused: `SaveMode = 'template'` writes tokens as tokens (with `w:showingPlcHdr` in placeholder mode); `SaveMode = 'document'` writes filled content with the `w:sdt` wrappers removed unless `config.tokenization.keepControlsOnFill` is true.
- In `resolved` mode the value is *also* written into `w:sdtContent` as the last known value so a third-party open of the file shows something sensible before any fill; the fill engine overwrites it unconditionally.
- An unresolved token in `resolved` mode is rendered with a distinctly dashed outline **and** a text label - never by colour alone (QUA-07).

**Edge cases.** A `w:sdt` with `w:lock` set to `sdtContentLocked` still fills (fill is a programmatic operation, not a user edit). Changing display mode while an IME composition is active is deferred until composition ends.

### TOK-09 - Token chip interaction semantics

`core` · `M`

A token behaves as a single character-ish object for editing: `Backspace`/`Delete` adjacent to it removes the whole token (one undo entry), arrow keys step over it, `Shift+Arrow` selects it as a unit, double-click selects it, `Ctrl/Cmd+X` cuts it, `Ctrl/Cmd+C` copies it (as token, carrying key and format), `Ctrl/Cmd+V` pastes a token instance with a fresh `w:id`.

**Rules.** A token dragged within a document moves rather than copies on drop-with-modifier semantics (`Alt`-drag copies). Cut/copy place *both* a `text/plain` form (the field-code string) and an internal `application/x-docier-token` flavour on the clipboard so tokens survive a paste into another docier instance and degrade to text elsewhere. Dropping a token into a location where it is not permitted is refused with a visible cursor reason, not silently.

**Edge cases.** Deleting a loop's opening token deletes the whole loop container after a confirm ("This will remove the repeated section"). Copying a token whose key is not in the target document's catalogue pastes it as unknown (TOK-23).

## 1.3 Data binding and fill

### TOK-10 - The host data API: `setData`, `mergeData`, `getIssues`

`core` · `L`

This is the exact surface a host app uses to feed data in. Errors are never thrown for *data content* problems - they are reported as issues (TOK-19), because a missing value is a normal state in an HR workflow.

```ts
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
  refill?: boolean;
  source?: 'host' | 'user' | 'preview';
  signal?: AbortSignal;
}

export interface FillSummary {
  filled: number;
  unresolved: number;
  failed: number;
  loopsExpanded: number;
  issues: readonly DataIssue[];
  durationMs: number;
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

**Rules.**
- `setData` replaces the whole data object; `mergeData` is a deep merge at the leaf level with array replacement (arrays are never element-merged - a loop's rows are replaced wholesale).
- Both are async because they may fetch; both resolve after the fill pass completes and after `docier:fill:after`.
- Filling is **idempotent**: applying the same data twice produces the same document and does not grow the undo history beyond one entry per distinct data application.
- Applying data does not mark the document dirty in `SaveMode = 'template'` (data is not part of a template); it *does* dirty a document in `SaveMode = 'document'`.
- `refill: false` stores data without pushing it into the document - used by hosts that bind data purely to drive the issue panel and preview.

**Edge cases.** Concurrent `setData` calls are serialised; the later call's `AbortSignal` cancels the earlier in-flight fill and the earlier promise rejects with `DocierError` code `FILL_ABORTED`. `clearData()` returns every token to the placeholder state and leaves the document otherwise untouched.

### TOK-11 - The fill engine

`core` · `XL`

A single deterministic pass over the document tree, run in the same code path on the main thread and headless on a server.

**Rules.**
- Order: (1) resolve conditionals top-down, removing or keeping subtrees; (2) expand loops, outermost first, each expansion producing a fresh subtree clone with re-minted `w:id`s; (3) resolve scalar branches and images. This order is fixed so that a value can never be rendered twice and so that loop rows cannot reference a conditional that has already been collapsed.
- Resolution of a key is a path lookup against `TokenData` with `.` as the separator and `[]` for loop scope; within a loop body, keys resolve against the current row first, then the row's parent scope, then the root - an explicit `$root.` prefix always reaches the document root.
- The engine is pure: `fill(model, data, options) → { model, summary }`. No DOM, no timers, no globals. This is what makes QUA-21 (headless) and API-21 possible with one implementation.
- Per-token work is bounded: a fill pass over 5 000 tokens must complete in < 150 ms on the reference machine and is instrumented as such.
- Every resolved value is written as runs that inherit the surrounding `w:rPr`, with the token's own run properties appended (TOK-12).
- The engine never mutates catalogue or data objects; everything it touches is cloned.
- Failure of one token never aborts the pass: the token is left unresolved, an issue is recorded, and the pass continues.

**Edge cases.** A loop whose row count exceeds `tokenization.loops.maxRows` (default 10 000) stops at the cap, records `loop-truncated`, and keeps the document valid. A conditional whose expression cannot be evaluated keeps the `true` branch and records an issue (fail-open on content the author wrote) - this is a deliberate choice and must be documented for hosts.

### TOK-12 - Plain vs rich values and style inheritance

`core` · `L` · OOXML: `w:r`, `w:rPr`, `w:p`, `w:pPr`

**Plain value** - a string, number, boolean, or date. Written as one or more `w:r` carrying the token's stored `w:rPr` (captured at insertion time from the surrounding run).

**Rich value** - a structured form the host may supply:

```ts
export type RichValue =
  | { kind: 'text'; text: string; runs?: RichRun[] }
  | { kind: 'paragraphs'; paragraphs: RichParagraph[] }
  | { kind: 'html'; html: string; allowList?: HtmlAllowList }
  | { kind: 'image'; source: ImageSource; sizing?: ImageSizing; alt?: string }
  | { kind: 'docx'; bytes: Uint8Array };
```

**Rules.**
- `text` with `runs` maps 1:1 onto `w:r`/`w:rPr`; only a whitelisted property set is accepted (`bold`, `italic`, `underline`, `strike`, `color`, `fontSize`, `fontFamily`, `highlight`, `vertAlign`). Anything else is dropped and recorded as `rich-value-property-dropped`.
- `paragraphs` and `html` are accepted only where the token is block-level; a run-level token receiving them degrades to the concatenated plain text plus an issue.
- `html` is parsed by an allow-list sanitiser (no script, no event attributes, no `style` with `url()`, no external references) and mapped to docier nodes. A value failing sanitisation is rejected entirely with `rich-value-rejected` - never partially inserted.
- `docx` embeds the bytes' body content (`word/document.xml` body children) into the token's position, renumbering relationships and ids; unsupported parts produce `rich-value-part-skipped`.
- Style inheritance: the token's captured `w:rPr` at the *token start* is the base; rich runs override per property. Block values inherit the paragraph's `w:pPr` and the surrounding `w:numPr` is dropped (a multi-paragraph value inside a numbered list must not produce three numbered items).
- A rich value is subject to the same escaping and escaping rules as a plain one (TOK-13).

**Edge cases.** A rich value in a table cell may add paragraphs to that cell but never rows. A rich value whose content contains a token-like marker string is inserted as literal text and never re-parsed.

### TOK-13 - Value escaping and injection safety

`core` · `M` · OOXML: `w:t`, `w:instrText`, `w:fldChar`, `w:br`, `w:tab`

**Rules.**
- Every string value is XML-escaped (`&`, `<`, `>`, and `"` in attribute positions) before it becomes text.
- A value is split on newlines into `w:br` between `w:t` runs; tabs become `w:tab`; other control characters (`U+0000`-`U+0008`, `U+000B`, `U+000C`, `U+000E`-`U+001F`) are stripped and recorded as `value-control-char-stripped`.
- **Values are never interpreted as markup or field syntax.** A value of `</w:t><w:sdt>…` must appear literally in the output document. This is a hard test case in the security suite.
- Values are never written into `w:instrText` (field codes) - a value that would complete a `MERGEFIELD` instruction is impossible by construction.
- Values ending in a hyperlink-looking string are not auto-linked (no `w:hyperlink` wrapping) unless the catalogue entry declares `linkify: true`, and then only for `https:`/`mailto:` schemes with an allow-list.
- Bidirectional and zero-width characters in values are preserved; bidi isolates are added around a value whose direction differs from the paragraph base direction (QUA-10).
- Lone surrogates are replaced with `U+FFFD` and recorded.

### TOK-14 - Image tokens

`important` · `L` · OOXML: `w:drawing`, `wp:inline`, `a:blip r:embed`, `w:drawing/wp:docPr`

**Behaviour.** A token of kind `image` resolves to an inline drawing.

```ts
export type ImageSource =
  | { kind: 'url'; url: string; cacheKey?: string }
  | { kind: 'blob'; blob: Blob | Uint8Array; mimeType: string }
  | { kind: 'dataUri'; uri: string }
  | { kind: 'placeholderFrame' };

export interface ImageSizing {
  mode: 'natural' | 'fitWidth' | 'fitBox' | 'exact';
  width?: CssLengthPx;
  height?: CssLengthPx;
  maxWidthPx?: number;
  maxHeightPx?: number;
  keepAspectRatio?: boolean;
}
```

**Rules.**
- The drawing is `wp:inline` by default; `wp:anchor` (floating) is `later` and, when it lands, must never be produced by a plain image token automatically.
- Sizing: `fitWidth` clamps to the containing column width (cell width minus `w:tcMar`, or the page text width for body content); `natural` uses intrinsic pixels at `config.units.imageDpi` (default 96) converted to EMU. Aspect ratio is preserved unless `keepAspectRatio: false` and both dimensions are given.
- Accepted MIME types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml` (SVG is converted to a PNG fallback plus the original as an alternative part). Anything else fails with `image-unsupported-type`.
- Alt text comes from the catalogue label, the value, or `w:docPr/@descr`; a missing alt is a warning-level accessibility issue (QUA-01) and a required-field error in `config.a11y.requireAltText`.
- Media parts are written to `word/media/` with de-duplicated names; a repeated identical image (same hash) is one part referenced twice.
- `placeholderFrame` renders a dashed frame at the sizing box so a template author sees the reserved space.
- Fetch failures keep the previous image and record `image-load-failed`; they never blank the document.

**Edge cases.** An image inside a loop body is fetched once per distinct source, memoised by hash for the pass. An image token inside a table cell keeps its cell's width as the clamp. A 30 MP image is downsampled to `config.images.maxPixels` (default 8 MP) with `image-downsampled` recorded.

## 1.4 Structure: conditionals, loops

### TOK-15 - Date, number, and currency formatting per locale

`core` · `L` · OOXML: `w:rPr/w:lang`

```ts
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
```

**Rules.**
- Formatting uses `Intl.DateTimeFormat` / `Intl.NumberFormat` with the *token's* locale if set, else the document locale (`w:rPr/w:lang` on the token's run), else the UI locale.
- `pattern` supports a restricted subset of the Unicode/CLDR skeleton grammar (`yyyy-MM-dd`, `dd.MM.yyyy`, `#,##0.00`), never a free-form ICU format string, so a bad catalogue entry cannot produce garbage silently; an unparsable pattern falls back to `dateStyle`/`numberStyle` and records `format-pattern-invalid`.
- Input coercion: strings that parse as ISO dates or as locale-formatted dates (`dd.MM.yyyy` for `ro`, `dd.MM.yyyy` for `ru`) resolve to dates; anything else is used verbatim and records `format-type-mismatch`.
- Dates are formatted in the token's locale and, when the value carries a time zone, converted with `Intl` rules; date-only values are never shifted by the viewer's time zone (a `2026-01-01` contract date must read `01.01.2026` in every browser).
- Romanian defaults: `dd.MM.yyyy`, decimal comma, `.` thousands separator, currency suffix `RON` (`1.250,00 RON`).
- Russian defaults: `dd.MM.yyyy`, decimal comma, non-breaking-space thousands separator, currency suffix `₽` or `руб.` per catalogue config, month names in genitive in long dates (`12 января 2026 г.`).
- `caseTransform` applies **after** formatting, and `title`/`capitalize` must use locale-aware casing (Romanian `ș`/`ț` and Russian `ё` are handled).
- Number formatting never uses scientific notation unless explicitly requested.

**Edge cases.** `NaN`, infinities, and nullish values are not "0" - they are unresolved. An empty string formats as an empty string and is *not* an issue. Very large numbers (>2^53) supplied as strings are formatted digit-wise without lossy coercion.

### TOK-16 - Conditional content

`important` · `XL` · OOXML: `w:sdt` (block), `w:sdtPr/w:tag`

**Behaviour.** A block-level `w:sdt` tagged `docier:if:<expression>` wraps the conditional content. Optional companion `docier:else:<expression>` supplies the negation branch.

```ts
export type ConditionExpression =
  | { op: 'truthy'; key: string }
  | { op: 'eq' | 'neq'; key: string; value: string | number | boolean }
  | { op: 'gt' | 'gte' | 'lt' | 'lte'; key: string; value: number | IsoDate }
  | { op: 'in' | 'notIn'; key: string; values: readonly (string | number)[] }
  | { op: 'empty' | 'notEmpty'; key: string }
  | { op: 'and' | 'or'; operands: readonly ConditionExpression[] }
  | { op: 'not'; operand: ConditionExpression };
```

**Rules.**
- Expressions are a data structure, not a string evaluated at runtime. There is no `eval`, no function body, no template literal. The catalogue and the dialog both produce this structure; a hand-written `{{#if ...}}` marker form is parsed into it with a documented grammar and fails closed (kept content + issue) on parse error.
- Missing keys evaluate as `false` for `truthy`/`empty` and produce an `unresolved-condition` issue; a condition on a *missing* key is not silently `false` in the UI - it is flagged in the issue panel and blocks export under `issuePolicy: 'block'`.
- `eq` comparison is type-aware and locale-independent: `"1"` and `1` are equal; `"01.02.2026"` and `2026-02-01` are equal when the value is date-typed; never string-compare formatted output.
- Both branches may contain tokens, loops, and nested conditionals; evaluation is depth-first and the removed branch's tokens produce no issues (a condition is a legitimate way to hide a required field).
- Removing a branch removes the whole block including its paragraph mark; the alternative - an empty paragraph - is explicitly not acceptable and is a golden-file fixture.

**Edge cases.** Both branches true (author error) keeps `if` and records `condition-branch-conflict`. An `if` inside a table cell that would remove the cell's only paragraph leaves an empty paragraph (OOXML requires at least one `w:p` in `w:tc`). Nested conditionals sharing a key are evaluated independently.

### TOK-17 - Repeating sections and loops

`important` · `XL` · OOXML: `w:sdt`, `w:sdtPr/w:repeatingSection`, `w:sdtPr/w:repeatingSectionItem`, `w:tr`

**Behaviour.** A block-level `w:sdt` tagged `docier:loop:<key>` whose `w:sdtContent` contains exactly one *repeat unit*: either a whole `w:tr` (row loop) or one or more block elements (block loop). On fill, the unit is cloned once per row.

**Rules.**
- Repeat-unit detection: if `w:sdtContent` contains a `w:tr`, the unit is that row and the result is spliced into the parent `w:tbl` with `w:vMerge` recomputed and `w:gridSpan` preserved; otherwise the unit is the full block set.
- A nested loop inside a loop body expands per parent row, with the standard `maxRows` cap applied *per nesting level* and a global `maxTotalRows` (default 50 000) that stops the pass with `loop-limit-exceeded`.
- A loop with zero rows removes the entire unit and its container, including the paragraph mark - an empty repeating block must not leave a blank paragraph, and this is a golden-file fixture.
- Cloned content re-mints every `w:sdtPr/w:id`, `w:bookmarkStart/@w:id`, `w:docPr/@id`, and relationship id; failing to re-mint is the single most common source of corrupt output and is covered by a dedicated round-trip test.
- `w:sdtPr/w:repeatingSection` is written on export of a template **only** when `tokenization.loops.wordCompatibility === true` (default `false`), because Word's own repeating-section editing and docier's fill produce different results and mixing them confuses authors. When `true`, the round-trip limitations are documented in the file itself via `w:alias`.
- Loop rows may carry rich values; a row value that is an object with a nested array of the same name is rejected as `loop-row-recursive`.

**Edge cases.** A loop whose unit is the last element of the body keeps `w:sectPr` outside the loop. A loop immediately followed by a table: the clone must not merge into it. A row loop with a header row above it keeps the header unrepeated and repeat-header-on-each-page (`w:tblHeader`) intact.

### TOK-18 - Loop scope, metadata, and aggregation

`important` · `L`

Inside a loop body, tokens resolve against the current row first. Additional synthetic keys are always available: `_index` (0-based), `_number` (1-based), `_isFirst`, `_isLast`, `_isEven`, `_count`, and `_key` (the loop's own key). They are declared in the catalogue as reserved and cannot be used as user keys.

**Rules.** After the loop, an aggregation token (`docier:agg:<key>`) may consume the loop's rows: `sum`, `count`, `min`, `max`, `avg`, `join(sep)`. Aggregations are computed over the *raw* row values, before formatting, so a currency total is `1234.5` not `1.234,50 RON`.

**Edge cases.** `join` on a loop of objects requires an explicit sub-key (`join(employee.lastName, ", ")`). Aggregation over an empty loop yields `0` for `sum`/`count` and unresolved for `avg`/`min`/`max`. Sorting: `loops.sort` in the catalogue entry supports a key and direction with locale-aware collation (QUA-14, QUA-15).

## 1.5 Correctness before export

### TOK-19 - The data-issue model

`core` · `L`

```ts
export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCode =
  | 'unknown-token'
  | 'value-missing'
  | 'value-null'
  | 'value-empty-required'
  | 'value-invalid-format'
  | 'value-invalid-rule'
  | 'value-type-mismatch'
  | 'condition-unresolved'
  | 'loop-empty-required'
  | 'loop-row-missing'
  | 'image-unresolved'
  | 'catalogue-stale'
  | 'catalogue-missing';

export interface DataIssue {
  code: IssueCode;
  severity: IssueSeverity;
  message: LocalizedString;
  key?: string;
  format?: string;
  instances?: readonly TokenInstanceRef[];
  partName?: string;
  location?: { paragraphIndex: number; runIndex: number; pageHint?: number };
  value?: unknown;
  suggestion?: { action: 'remap'; key: string } | { action: 'provide'; key: string } | { action: 'unlink' };
  detail?: string;
}
```

**Rules.** `unknown-token` and `catalogue-missing` are errors; `value-missing`/`value-null` are errors by default and downgradable per catalogue entry (`allowEmpty: true` → info). Every issue carries enough `instances` to jump to the first one, and every issue is expected to be actionable - an issue with no action is a spec bug in the catalogue, not a valid state.

### TOK-20 - Surfacing unresolved and missing values before export

`core` · `M`

**Behaviour.** Before any export or print, the module runs a preflight that produces the full issue set. Three surfacing channels, all present:

1. **Inline** - in `resolved` display mode, unresolved tokens render a dashed chip with the key visible; in other modes the token chip carries a small marker and a tooltip with the reason.
2. **Panel** - `docier.command.token.openIssuesPanel` lists issues grouped by severity, with a click-to-navigate to the instance, and a bulk "unlink all unresolved" action.
3. **Events and API** - `docier:issues:change` on every recomputation, `data.getIssues()` for pull, `data.subscribeIssues()` for the host's own banner.

**Export gate.** `config.tokenization.issuePolicy`:
- `'block'` (default) - export refuses when any `error`-severity issue exists; `docier:export:blocked` fires with the issue list; the command returns `CommandResult.blocked`.
- `'warn'` - export proceeds; the host is expected to confirm.
- `'ignore'` - export proceeds silently; unknown tokens are dropped, unresolved tokens export their placeholder text.

**Rules.** Preflight runs on: export, print, preview open, and any data change (debounced 250 ms). Results are cached keyed by `(documentRevision, dataRevision, catalogueRevision)` so a repeated call is free.

### TOK-21 - Unlink / freeze a token to plain text

`important` · `M` · OOXML: `w:sdt`, `w:sdtContent`, `w:rPr`

**Behaviour.** `tokens.unlink(ref | refs)` replaces the `w:sdt` with its `w:sdtContent` children, preserving all run properties exactly, and drops token semantics permanently. A "freeze" variant resolves the value first, then unlinks - the operation HR managers actually want when a contract is final.

**Rules.** One transaction for a multi-select unlink, one undo entry, undo restores full token semantics including `w:tag`, `w:alias`, and `w:id` values. Events: `docier:token:unlink` with the instances. Unlinking a loop container unlinks all contained tokens and warns with the count first. Unlinking a `placeholder`-mode token whose content is only a placeholder produces a warning - it is almost always a mistake.

**Edge cases.** Unlinking a locked token is allowed (the lock protects against *editing*, not against the author's own freeze command) but requires `config.tokenization.lockBypassOnUnlink === true`. Unlinking inside `w:ins` keeps the revision wrapper.

### TOK-22 - The token catalogue contract with the backend

`core` · `L`

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
  loop?: { rowType: 'object' | 'scalar'; fields: readonly string[]; maxRows?: number; sort?: { key: string; direction: 'asc' | 'desc'; collation?: string } };
  permissions?: { read?: boolean; write?: boolean };
  deprecated?: { since: string; replacement?: string };
}

export interface ValidationRule {
  type: 'required' | 'regex' | 'minLength' | 'maxLength' | 'min' | 'max' | 'dateRange' | 'enum' | 'custom';
  value?: unknown;
  pattern?: string;
  flags?: string;
  message?: LocalizedString;
  validate?: (value: unknown, ctx: ValidationContext) => ValidationResult;
}
```

**Rules.**
- The catalogue is fetched once at mount when `tokenization.catalogue` is a URL, cached in memory and (optionally) in the storage adapter, and re-fetched on `config.tokenization.cataloguePollSeconds` if set. A fetch failure never blocks mount: the editor starts with a stale or empty catalogue and records `catalogue-stale`/`catalogue-missing`.
- The catalogue is validated on receipt: duplicate keys, a loop entry whose `loop.fields` are absent, an entry whose `kind` requires a format that is missing - all produce `DOC_CATALOGUE_INVALID` diagnostics and the offending entries are skipped.
- Unknown fields on an entry are preserved and passed through, so the backend can ship ahead of the library.
- Labels are `LocalizedString` and resolved with the fallback chain (QUA-09).
- The catalogue is the *only* source of truth for what may be inserted; the palette never invents an entry.
- The host may supply the catalogue inline (`tokenization.catalogue: TokenCatalogue`) for offline and test use.

### TOK-23 - Unknown-token validation and remap

`core` · `M`

**Behaviour.** On open, paste, and catalogue change, every token instance's key is checked against the catalogue. Unknown keys are reported (`unknown-token`, error), rendered distinctly in `resolved` mode, and offered a remap.

**Rules.** Remapping replays one key onto all instances of a former key in a single transaction, preserving format and instance identity. A remap is suggested automatically when the unknown key is a case-insensitive, diacritic-insensitive match for a catalogue key, or when an entry's `deprecated.replacement` names it. Unknown tokens are preserved through save/load losslessly, so a template edited with a stale catalogue is never damaged.

**Edge cases.** A key that exists but with a different `kind` is a conflict, not an unknown - reported as `unknown-token` with detail `kind-mismatch` and offered "convert to <kind>" or remap. Tokens whose key matches a *reserved* synthetic name (`_index`, …) outside a loop are errors.

### TOK-24 - Legacy field import: MERGEFIELD, DOCVARIABLE, REF, IF

`later` · `M` · OOXML: `w:fldSimple`, `w:fldChar`, `w:instrText`

**Behaviour.** Mail-merge templates from Word carry `MERGEFIELD` fields. On open (when `tokenization.importLegacyFields === true`, default `true`), a simple field is converted to a `field` token; a `REF` bookmark field becomes a token bound to the bookmark, `DOCVARIABLE` to a variable key, and a Word `IF` field is translated into a `ConditionExpression`. The original instruction is preserved in `w:sdtPr/w:tag` as a fallback and the document is marked with a one-time, dismissible notice.

**Rules.** Conversion is per-part and undoable; the converted run keeps its `w:rPr` including `w:rStyle`. Unconvertible constructs (`NEXT`, `NEXTIF`, `SKIPIF`, `INCLUDETEXT`, nested field-in-field) are left untouched and listed with a "cannot convert" reason - never silently dropped. Dynamic fields (`PAGE`, `NUMPAGES`, `DATE`, `REF` to a live style, `TOC`, `SEQ`) are **never** converted: they are Word's own, they must remain live, and docier must keep them as fields.

### TOK-25 - Preview mode with real data

`important` · `L`

**Behaviour.** `config.preview.enabled` adds a view mode that renders the document as a filled *document* (not a template), with real data when connected or sample data otherwise. Toggling preview is view-only and does not mutate the stored template.

```ts
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

**Rules.** Preview is produced by the same fill engine and the same layout engine - it is not a separate renderer. In preview the editing surface is read-only unless `readOnly: false`; tokens are still selectable and a click opens "which token is this" inspector. Sample data comes from each entry's `sampleValue` plus deterministic generators for images and dates (`tokenization.preview.sampleDateBase`), so previews are reproducible and snapshot-testable. Preview reports issues but never blocks (it is where you look at them).

## 1.6 Protection

### TOK-26 - Value validation rules

`important` · `M`

Rules from `entry.validation` are evaluated on data application and on user entry (the token palette's quick-fill popover, and the token dialog). Results appear as issues (`value-invalid-rule`, `value-invalid-format`), inline on the token, and in the issue panel. `custom` validators are host-supplied functions scoped to a plugin and are subject to the plugin error boundary.

**Rules.** A failing validation never blocks `setData`; it always blocks export under `issuePolicy: 'block'`. Regexes are compiled once per catalogue revision and are protected against catastrophic backtracking by a wall-clock budget (10 ms per value) after which the rule fails with `value-invalid-rule` and detail `validator-timeout`. Romanian-specific validators shipped in the default catalogue: CNP checksum, IBAN (RO), CUI/CIF, `ro-MD` IDNP. Russian ones: INN, SNILS, OGRN, passport series/number masks.

### TOK-27 - Locked tokens and protected regions

`important` · `M` · OOXML: `w:sdtPr/w:lock`, `w:documentProtection`, `w:permStart`, `w:permEnd`

**Behaviour.** An individual token may be locked (`contentLocked`), and a block may be a *protected region* - a block-level token of kind `region` that refuses user edits inside while still allowing fill.

**Rules.** Attempts to edit a locked token are refused with a visible, non-modal reason ("Contract number is locked"), and the same reason is the `disabledReason` on the relevant command so toolbars and menus explain themselves (API-08). Locked tokens remain selectable, copyable, and navigable by keyboard and screen reader - locking is not the same as hiding. `w:documentProtection` with `w:enforcement="1"` and an editing restriction (`readOnly`, `comments`, `forms`) is honoured on open; docier never removes document protection silently and offers "unprotect" only when the host enables it via config, because it cannot verify the password hash for anything but the legacy algorithm.

---

# Part 2 - Public API, events, configuration and extensibility

## 2.1 Mount and lifecycle

### API-01 - `createDocier()` and the instance lifecycle

`core` · `L`

```ts
export type InstanceState = 'created' | 'mounting' | 'ready' | 'reconfiguring' | 'destroyed';

export function createDocier(options: DocierOptions): Promise<DocierInstance>;

export interface DocierOptions {
  config?: DocierConfigPatch;
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
  readonly tokens: TokenController | null;
  readonly plugins: PluginHost;
  readonly theme: ThemeController;
  readonly ui: UIRegistry;
  whenReady(): Promise<void>;
  mount(target?: HTMLElement | string, options?: MountOptions): Promise<void>;
  updateConfig(patch: DocierConfigPatch): Promise<void>;
  getDiagnostics(): Diagnostics;
  destroy(options?: DestroyOptions): Promise<void>;
}
```

**Rules.** `createDocier` is async because it validates config and loads non-DOM resources; it performs **no DOM work** when `container` is absent (SSR safety, API-22). `state` is a monotic progression except during `reconfiguring`. `whenReady()` resolves once after `ready`, and rejects if the instance is destroyed first. Multiple instances on one page are fully isolated - separate `w:id` allocators, separate event buses, separate undo stacks, separate storage namespaces keyed by instance id - and there is a hard cap (`config.maxInstancesPerPage`, default 8) beyond which creation fails with `INSTANCE_LIMIT`.

**Edge cases.** Calling `mount()` twice with the same target moves the instance rather than throwing. `destroy()` is idempotent; it disposes plugins in reverse installation order, aborts in-flight fetches, flushes autosave, and removes every listener. Every `DocierInstance` method called after `destroy()` rejects with `INSTANCE_DESTROYED` rather than throwing synchronously - a difference that matters to `useEffect` cleanup code.

### API-02 - Mounting and mount options

`core` · `M`

```ts
export interface MountOptions {
  replaceContent?: boolean;
  inheritStyles?: boolean;
  height?: CSSLength;
  minHeight?: CSSLength;
  ariaLabel?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  autoFocus?: boolean;
}
```

**Rules.** The target element must be in the document; a detached target rejects with `MOUNT_TARGET_DETACHED`. Unless `replaceContent`, docier appends a root `<div class="docier-root">` and leaves sibling content alone. `inheritStyles: true` copies computed font-family/size from the target as the default document font - the behaviour hosts expect when embedding into an existing page. `ariaLabel` defaults to the document title or the localised "Document". `dir` is applied to the root and drives UI chrome mirroring (QUA-10).

### API-03 - The configuration object, in full

`core` · `XL`

One flat-ish object with grouped sub-objects. Every option has a default; `DocierConfigPatch` is a deep-partial of `DocierConfig` and is the only accepted type for `createDocier` and `updateConfig`.

```ts
export interface DocierConfig {
  locale: LocaleCode;
  fallbackLocale: LocaleCode;
  messages?: MessagesOverride;
  document: DocumentConfig;
  editing: EditingConfig;
  permissions: PermissionsConfig;
  tokenization: TokenizationConfig;
  a11y: A11yConfig;
  performance: PerformanceConfig;
  storage: StorageConfig;
  export: ExportConfig;
  theme: ThemeConfig;
  ui: UiConfig;
  keyboard: KeyboardConfig;
  telemetry: TelemetryConfig;
  plugins: PluginConfig;
  debug: DebugConfig;
}

export interface TokenizationConfig {
  enabled: boolean;
  storage: 'sdt' | 'text';
  display: 'placeholder' | 'fieldCode' | 'resolved';
  trigger: string;
  triggerEnabled: boolean;
  markerSyntax: { open: string; close: string; extraPairs?: readonly [string, string][] };
  catalogue: TokenCatalogue | string | null;
  cataloguePollSeconds: number | null;
  importLegacyFields: boolean;
  issuePolicy: 'block' | 'warn' | 'ignore';
  keepControlsOnFill: boolean;
  lockBypassOnUnlink: boolean;
  loops: { wordCompatibility: boolean; maxRows: number; maxTotalRows: number; allowNested: boolean };
  preview: { enabled: boolean; sampleDateBase: IsoDate; defaultData?: TokenData };
  autoUnresolvedHighlight: boolean;
  palette: { groups: boolean; virtualizeAfter: number; recentCount: number };
  dialog: { enabled: boolean; showPreview: boolean };
}

export interface PermissionsConfig {
  readOnly: boolean;
  allow: readonly ('edit' | 'format' | 'insert' | 'insertToken' | 'editToken' | 'paste' | 'fillData' | 'export' | 'saveTemplate' | 'unlinkToken')[];
  deny?: readonly string[];
  regionEnforcement: boolean;
  canEdit?(ctx: PermissionContext): boolean;
}
```

**Rules.** Unknown keys produce a `config-validation` warning in `getDiagnostics()` and are otherwise ignored - never a hard throw, because a host shipping ahead of the library must not break. Wrongly *typed* keys are a hard `CONFIG_INVALID` rejection; silently coercing `enabled: "true"` has caused more bugs than it has prevented. `permissions.readOnly` is a UI-level guard and is documented as such: it is not a security boundary, and any host that needs one must not trust the client.

### API-04 - Config merge, validation, and migration

`important` · `M`

Merging is deep for plain objects, replace for arrays, and function-valued options always win outright. `config.version` may be supplied; the library applies ordered migrations from that version to the current default, records each applied migration in diagnostics, and refuses to load a config from a *newer* major with `CONFIG_VERSION_NEWER`. Migrations never silently change a value the host explicitly set.

### API-05 - Runtime reconfiguration

`important` · `M` · event: `docier:configchange`

`updateConfig(patch)` applies a patch atomically: either the whole patch validates and applies, or nothing changes. Some options are live (locale, theme, display mode, autosave interval, permissions); others are `requiresReload` (document source, storage adapter, shadow DOM) and applying them returns a `ConfigApplyReport` listing them rather than half-applying. `updateConfig` never resets scroll position or selection, and never clears undo history - a reconfiguration that dirties the document is a defect.

## 2.2 Commands

### API-06 - Command shape and naming convention

`core` · `L`

```ts
export interface CommandRegistry {
  register<A, R>(definition: CommandDefinition<A, R>): Disposable;
  get(id: string): CommandDefinition | undefined;
  list(filter?: CommandFilter): readonly CommandDescriptor[];
  execute<A, R>(id: string, args?: A, options?: ExecuteOptions): Promise<CommandResult<R>>;
  isEnabled(id: string, args?: unknown): boolean;
  disabledReason(id: string, args?: unknown): LocalizedString | undefined;
  isActive(id: string, args?: unknown): boolean;
}

export interface CommandDefinition<A = void, R = void> {
  id: CommandId;
  label: LocalizedString;
  category: CommandCategory;
  description?: LocalizedString;
  icon?: IconRef;
  keywords?: readonly string[];
  bindings?: readonly KeyBinding[];
  layer?: 'document' | 'chrome' | 'global';
  undoable?: boolean;
  repeatable?: boolean;
  isEnabled?(ctx: CommandContext<A>): boolean;
  isVisible?(ctx: CommandContext<A>): boolean;
  isActive?(ctx: CommandContext<A>): boolean;
  disabledReason?(ctx: CommandContext<A>): LocalizedString | undefined;
  execute(args: A, ctx: CommandContext<A>): R | Promise<R>;
}
```

**Naming.** `docier.command.<area>.<action>` in lowerCamelCase, always: `docier.command.format.bold`, `docier.command.token.insert`, `docier.command.doc.save`, `docier.command.table.insertRow`. Plugins use their own namespace and may not squat in `docier.command.*`: a plugin command id is `<pluginId>.<area>.<action>` with a required dotted prefix. Areas are a closed set (`doc`, `edit`, `format`, `insert`, `table`, `token`, `data`, `view`, `history`, `a11y`, `dev`) so a host can build a menu from the registry without a curated list. Ids are stable forever; renaming is a breaking change (API-25).

**Results.** `execute` never throws for expected refusals. `CommandResult<R> = { status: 'ok'; value: R } | { status: 'blocked'; reason: LocalizedString; code: string } | { status: 'noop' } | { status: 'failed'; error: DocierError }`. `status: 'blocked'` is what a disabled command returns when invoked programmatically through a stale UI, so a host's stale toolbar button produces an explanation instead of a silent nothing.

**Edge cases.** Commands are stateless and re-entrant-safe: executing a command from inside `docier:command:beforeexecute` for the same id is refused with `REENTRANT_COMMAND`, which prevents the classic recursion through a listener that re-triggers its own command. Unknown command ids return `failed` with `COMMAND_NOT_FOUND`.

### API-07 - Grouping and placement metadata for host-built UI

`core` · `M`

Each command declares `category`, `group`, `order`, and optional `toolbar`/`menu` placement hints (`{ surface: 'toolbar' | 'overflow' | 'contextMenu' | 'palette'; slot?: CssClass; priority: number }`). `commands.list()` returns descriptors with resolved labels and current enabled/active state so a host can render its own toolbar without reading internals. Descriptor objects are cheap snapshots and must be re-read after `docier:command:...` or `docier:selection:change` - they are not live bindings, and the docs must say so plainly.

### API-08 - Availability, visibility, and disabled reasons

`core` · `M`

Three distinct questions, and conflating them is a defect:
- `isVisible` - should it exist in this UI at all (e.g. token commands when tokenization is off).
- `isEnabled` - can it run right now.
- `isActive` - is it a toggled-on state (bold, preview mode).

A disabled command **must** supply a `disabledReason`, and that reason must be localised and specific ("Select text to format", not "Unavailable"). The built-in UI renders it as a tooltip *and* as the accessible description, and does not rely on hover for discovery - keyboard focus shows the same string in the status bar. `ExecuteOptions.force` bypasses `isEnabled` for host-driven automation but is refused for `permissions`-derived blocks.

### API-09 - Transactions and batching

`core` · `L`

```ts
export interface TransactionController {
  run<T>(name: string, fn: (tx: Transaction) => T | Promise<T>, options?: TransactionOptions): Promise<T>;
  batch<T>(fn: () => T, options?: TransactionOptions): T;
}
export interface TransactionOptions {
  undoable?: boolean;
  coalesceKey?: string;
  label?: LocalizedString;
  selectionAfter?: SelectionTarget;
}
```

**Rules.** A transaction is the unit of undo, the unit of `docier:doc:change`, and the unit of layout invalidation. Nested transactions join the outer one (only the outermost commits). A transaction that throws rolls back all mutations made inside it and re-throws as a `DocierError` with the original as `cause`; the document is left exactly as before. `afterCommit`/`afterRollback` hooks exist on the transaction object for plugin cleanup. `coalesceKey` merges consecutive transactions sharing a key within `editing.coalesceWindowMs` (default 400 ms) into one undo entry - this is how typing produces one undo step per word-ish run rather than one per keystroke. `batch` is the synchronous, lightweight variant for pure-model mutations from a plugin.

**Edge cases.** A transaction may not be committed across an `await` boundary if the document has been mutated by someone else - that fails with `TRANSACTION_STALE` and rolls back, rather than silently merging divergent edits.

### API-10 - Undo, redo, and how commands interact with history

`core` · `L`

**Rules.** History is per-instance, bounded by both entry count (`editing.undoDepth`, default 200) and memory (`editing.undoMemoryMb`, default 64), evicting oldest-first. `undoable: false` commands (view changes, display mode, preview toggle, selection-only commands) never enter history. A command that runs inside a transaction is one entry; a command that mutates and then reverts is required to be inside one transaction, or it will produce two entries and be reported as a lint violation in dev mode. Data application from the host (`setData`) is undoable as a single entry when `tokenization.keepControlsOnFill` is used; it is *not* undoable in `SaveMode = 'document'` because that path does not mutate the template. Undo across a data change restores the previous values in the document but does not call back into the host's data - the host is told via `docier:history:change` and can react.

**Edge cases.** Undo after a loop expansion restores the loop unexpanded in a single step. Undo while an IME composition is active is deferred. History is cleared on `load()` of a new document, and the clearing is reported so a host can disable its own undo button.

## 2.3 Events

### API-11 - Event bus shape and typing

`core` · `L`

```ts
export interface EventBus<M extends EventMap> {
  on<K extends keyof M>(type: K, listener: (event: M[K]) => void, options?: ListenerOptions): Unsubscribe;
  once<K extends keyof M>(type: K, listener: (event: M[K]) => void): Unsubscribe;
  off<K extends keyof M>(type: K, listener: (event: M[K]) => void): void;
  onAny(listener: (type: keyof M, event: unknown) => void): Unsubscribe;
}

export interface ListenerOptions {
  deferred?: boolean;
  signal?: AbortSignal;
  priority?: number;
}

export interface DocierCancellableEvent<T> {
  payload: T;
  preventDefault(): void;
  readonly defaultPrevented: boolean;
}

export type LocalizedString = string | Readonly<Partial<Record<LocaleCode, string>>>;
export type CommandId = string & { readonly __brand: 'CommandId' };
export type TokenKey = string & { readonly __brand: 'TokenKey' };
export type TokenInstanceId = number & { readonly __brand: 'TokenInstanceId' };
```

**Rules.** Listeners run in registration order unless `priority` is set. A listener that throws is caught, reported as `docier:error` with context naming the listener, and never propagates into the caller - a buggy host listener must not corrupt a document edit. `onAny` is intended for logging and dev tooling only; it is excluded from the type-narrowing guarantees and documented as such.

### API-12 - Event catalogue

`core` · `XL`

Every event is `docier:<area>:<verb>`. Notifications use the past tense; cancellable requests use `before<Verb>` and carry `DocierCancellableEvent`.

| Event | Payload (abridged) | Sync | Cancellable |
|---|---|---|---|
| `docier:ready` | `{ instanceId }` | yes | no |
| `docier:error` | `{ error: DocierError; fatal: boolean; context: ErrorContext }` | yes | no |
| `docier:configchange` | `{ patch, config, requiresReload }` | yes | no |
| `docier:doc:load` | `{ sourceKind, durationMs, warnings }` | yes | no |
| `docier:doc:loadfailed` | `{ error }` | yes | no |
| `docier:doc:beforechange` | `{ cause, transactionId }` | yes | **yes** |
| `docier:doc:change` | `{ transactionId, cause, dirty, patches }` | yes | no |
| `docier:doc:dirty` | `{ dirty, reason }` | yes | no |
| `docier:doc:beforeunload` | `{ dirty }` | yes | **yes** |
| `docier:doc:save` | `{ bytes, byteLength, mode, revision }` | no | no |
| `docier:selection:change` | `{ previous, current, source }` | yes | no |
| `docier:selection:beforechange` | `{ next, source }` | yes | **yes** |
| `docier:focus:change` | `{ previous, current, source }` | yes | no |
| `docier:history:change` | `{ canUndo, canRedo, depth, memoryBytes, cleared }` | yes | no |
| `docier:command:beforeexecute` | `{ id, args }` | yes | **yes** |
| `docier:command:execute` | `{ id, args, result, durationMs }` | yes | no |
| `docier:command:blocked` | `{ id, code, reason }` | yes | no |
| `docier:token:beforeinsert` | `{ input }` | yes | **yes** |
| `docier:token:insert` | `{ instance, trigger }` | yes | no |
| `docier:token:change` | `{ instance, previous }` | yes | no |
| `docier:token:remove` | `{ instance, cause }` | yes | no |
| `docier:token:unlink` | `{ instances }` | yes | no |
| `docier:token:unknown` | `{ keys, catalogueRevision }` | yes | no |
| `docier:token:trigger` | `{ query, anchor }` | yes | no |
| `docier:data:change` | `{ paths, data }` | yes | no |
| `docier:data:load` | `{ sourceId, paths, durationMs }` | no | no |
| `docier:data:error` | `{ sourceId, error }` | yes | no |
| `docier:fill:before` | `{ data, mode }` | yes | **yes** |
| `docier:fill:after` | `FillSummary & { durationMs }` | yes | no |
| `docier:issues:change` | `{ issues, counts }` | yes | no |
| `docier:export:before` | `{ mode, options }` | yes | **yes** |
| `docier:export:blocked` | `{ issues }` | yes | no |
| `docier:export:after` | `{ bytes, byteLength, mode }` | no | no |
| `docier:render:layoutstart` | `{ dirtyPages, reason }` | yes | no |
| `docier:render:layoutend` | `{ durationMs, pagesRelayouted, totalPages }` | yes | no |
| `docier:render:page` | `{ pageIndex, rect }` | no | no |
| `docier:autosave:state` | `{ state, revision, at }` | yes | no |
| `docier:autosave:recovered` | `{ revision, at }` | yes | no |
| `docier:plugin:installed` / `docier:plugin:error` | `{ pluginId }` / `{ pluginId, error }` | yes | no |
| `docier:ui:dialogopen` / `docier:ui:dialogclose` | `{ dialog, reason }` | yes | no |

**Rules.** `docier:doc:change` includes a compact `patches` array (node id, op, before/after lengths) sufficient for a collaborator or an audit log without shipping the whole document. `docier:doc:save` and `docier:export:after` are async notifications (the bytes are already produced; the listener is not in the critical path) and their listeners are not awaited.

### API-13 - Event ordering and synchronicity guarantees

`core` · `L`

For one command execution the order is fixed and tested as a golden trace:

```
command:beforeexecute → doc:beforechange → [mutation] → doc:change → history:change
  → selection:change → issues:change (if recomputed) → render:layoutend → command:execute
```

**Rules.** Cancellable events are dispatched **synchronously** and the caller inspects `defaultPrevented` immediately after dispatch. Notification events are also dispatched synchronously by default so that a listener reading `instance.document` sees consistent state - the exception is a listener registered with `deferred: true`, which is queued to a microtask (this is the escape hatch for expensive host work, and the built-in UI uses it). Nested emission from within a listener is refused for cancellable events (a listener may not cancel the same event it is responding to) and allowed-but-must-re-enter-cleanly for notifications. The trace is asserted in tests for a representative command from each category.

## 2.4 Extensibility

### API-14 - Plugin API: install, dispose, isolation

`core` · `L`

```ts
export interface DocierPlugin {
  id: string;
  version?: string;
  docier?: string;
  optional?: boolean;
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

export interface PluginHost {
  install(plugin: DocierPlugin): Promise<Disposable>;
  uninstall(id: string): Promise<void>;
  list(): readonly { id: string; version?: string; state: 'installing' | 'active' | 'failed' | 'disposed' }[];
}
```

**Rules.** A plugin is installed at most once per instance; a second `install` of the same id is refused. Everything a plugin registers is tracked in `ctx.disposables` and released on uninstall - plugins never receive a raw registry they could leak. A plugin that throws in `install` fails alone: the editor reports `docier:plugin:error`, marks it `failed` in `list()`, rolls back its registrations, and continues unless `optional: false`, in which case the mount rejects. A plugin that throws during an *event handler* or a *command* is contained the same way (API-26). `docier` is a semver range checked against the running version; a mismatch makes the plugin fail with a clear reason instead of misbehaving.

### API-15 - Extending: adding a command

`core` · `S`

`ctx.commands.register({ id: 'acme.contract.seal', … })` inside `install`. The host's own namespace, its own label and bindings, and it appears in `commands.list()` alongside built-ins so a host-built toolbar and the command palette pick it up with no extra wiring. Bindings registered by a plugin are checked for collisions; a collision is a diagnostic warning and the existing binding wins.

### API-16 - Extending: adding a UI control and slots

`important` · `M`

```ts
export interface UIRegistry {
  registerSlot(slot: SlotId, renderer: SlotRenderer, options?: SlotOptions): Disposable;
  registerControl(control: UIControlDefinition): Disposable;
  openDialog(dialog: DialogDefinition): DialogHandle;
  notify(notification: NotificationSpec): NotificationHandle;
}
export type SlotRenderer<P = SlotProps> = (props: P) => SlotContent;
export type SlotContent = HTMLElement | DocumentFragment | string | null | void;
```

Built-in slots: `toolbar.start`, `toolbar.center`, `toolbar.end`, `sidebar.panels`, `statusbar.start`, `statusbar.end`, `contextMenu.items`, `page.overlay`, `tokenPalette.header`, `tokenPalette.item`, `tokenPalette.empty`, `tokenPalette.footer`, `tokenChip.render`, `emptyState`, `notification.host`, `dialog.host`. Renderers return DOM - docier does not impose a virtual DOM on plugin authors, and a React/Vue host wraps its own renderer around a portal container passed in `props.container`.

**Rules.** Slots render in `priority` order then registration order. A renderer that throws is replaced by an inline error placeholder in that slot, and the failure is reported once per slot (`SLOT_RENDERER_FAILED`) so a broken plugin does not blank the toolbar. Slot props include the instance, current selection snapshot, resolved locale, and an `emit` helper that routes back through the event bus. `tokenChip.render` is the supported way for a host to style tokens its own way, and receives `{ instance, displayMode, resolved, issue }`.

### API-17 - Extending: custom renderers

`important` · `M`

```ts
export interface RendererRegistry {
  registerTokenRenderer(kind: string, renderer: TokenRenderer): Disposable;
  registerNodeRenderer(nodeType: string, renderer: NodeRenderer): Disposable;
  registerValueFormatter(type: string, formatter: ValueFormatter): Disposable;
}
export interface TokenRenderer {
  id: string;
  measure?(instance: TokenInstance, ctx: RenderContext): MeasureResult;
  render(instance: TokenInstance, ctx: RenderContext): RenderResult;
  editable?: boolean;
  handlesInput?(event: InputEventLike, ctx: RenderContext): boolean;
}
```

Used for host-specific token kinds (a signature block, a QR code, a chart), for custom value formatting not expressible as a `TokenFormat`, and for node types introduced by plugins. A renderer's `measure` result participates in layout, so a renderer that reports the wrong height is a layout-correctness bug the plugin owns; the registry validates that `render` and `measure` agree in dev mode and reports a mismatch.

### API-18 - Extending: document features

`later` · `XL`

`ctx.features.register({ nodeType, schema, parse, serialize, commands, keyboard, renderer })` allows a plugin to introduce a document feature end to end: a ProseMirror-style node in the document model, its `w:*` mapping for save/load, its commands, and its rendering. This is the most powerful and most dangerous extension point: it can produce documents Word cannot open. Guarded by `config.plugins.allowDocumentFeatures` (default `false`), and any serialised output from an extended document is validated against a relaxed OOXML check before save, with a warning naming the plugin when the check fails.

## 2.5 Theming, slots, headless, typing, versioning, errors

### API-19 - Theming and CSS customisation

`core` · `M`

A documented CSS custom-property contract is the theming API; class names are not. Prefix `--docier-`:

`--docier-color-bg`, `--docier-color-fg`, `--docier-color-muted`, `--docier-color-border`, `--docier-color-accent`, `--docier-color-accent-fg`, `--docier-color-hover`, `--docier-color-selected`, `--docier-color-token-bg`, `--docier-color-token-fg`, `--docier-color-token-border`, `--docier-color-token-unresolved`, `--docier-color-token-locked`, `--docier-color-danger`, `--docier-color-warning`, `--docier-color-success`, `--docier-page-bg`, `--docier-page-border`, `--docier-page-shadow`, `--docier-page-gap`, `--docier-font-ui`, `--docier-font-document`, `--docier-font-mono`, `--docier-font-size-ui`, `--docier-radius-sm|md|lg`, `--docier-space-1..8`, `--docier-shadow-1..3`, `--docier-focus-ring`, `--docier-focus-ring-offset`, `--docier-z-page|toolbar|popover|dialog|toast`, `--docier-motion-duration`, `--docier-hit-target-min`.

**Rules.** `theme.mode: 'light' | 'dark' | 'auto'` sets the values on the root; `theme.vars` applies host overrides; `theme.classes` toggles a `docier-theme-<name>` class for hosts that prefer class-based theming. Styles ship as `docier/styles.css` and are **not** injected at import time (SSR safety); `injectStyles()` is opt-in, or a host imports the CSS itself. Increasingly specific internal selectors are not part of the contract and may change in a minor - documented explicitly so hosts do not build on them.

### API-20 - Slots and render overrides for host-owned chrome

`important` · `M`

Beyond plugin slots, the host can replace whole surfaces: `ui.override({ toolbar: null })` to hide the built-in toolbar and build its own from `commands.list()`; `ui.override({ statusbar: MyStatusBar })`; `ui.override({ tokenPalette: MyPalette })`. Overriding a surface is all-or-nothing per surface - partial replacement of built-in internals is not supported, because it would freeze internals into the public contract.

### API-21 - Headless / server-side use

`important` · `L`

```ts
export function createDocierCore(options: CoreOptions): DocierCore;

export interface FillTemplateInput {
  template: Uint8Array | ArrayBuffer;
  data: TokenData;
  catalogue?: TokenCatalogue;
  locale?: LocaleCode;
  mode: 'document' | 'template';
  onIssue?: 'collect' | 'throw';
  timeZone?: string;
  preserveUnresolved?: boolean;
}

export interface FillTemplateResult {
  bytes: Uint8Array;
  summary: FillSummary;
  issues: readonly DataIssue[];
  warnings: readonly Diagnostic[];
}

export function fillTemplate(input: FillTemplateInput): Promise<FillTemplateResult>;
export function listTemplateTokens(template: Uint8Array): Promise<readonly TokenInstance[]>;
```

**Rules.** `docier/server` (and the core entry) import no DOM at all - enforced by a build assertion that the server bundle contains no reference to `document`, `window`, or `navigator`. The fill engine, the token parser, formatting, and DOCX read/write are the same modules the browser uses; the split is at the layout/render boundary. Server fill is the recommended path for bulk document generation (a batch of 5 000 contracts), with an optional worker pool the host drives - the library never spawns workers itself.

### API-22 - SSR safety

`important` · `M`

**Guarantees, all asserted by tests run in a Node environment with no DOM shims:**
- Importing any entry point has no side effects: no `window`, `document`, `navigator`, `localStorage`, `matchMedia`, or `ResizeObserver` is touched at module scope.
- `createDocier()` without `container` resolves without touching the DOM.
- DOM-only code is behind dynamic `import()` inside `mount()`.
- No global CSS injection, no global error handler installation, no patching of `Element.prototype` or `document.execCommand`.
- `import { isServer } from 'docier'` is exported for hosts that need the same branching.
- The React binding's `<DocierEditor>` renders a container element on the server and mounts in an effect, so hydration does not mismatch.

### API-23 - Framework bindings

`important` · `L`

Thin, lifecycle-only wrappers, published as separate packages so the core has zero framework dependencies:

```ts
export function useDocier(options: DocierOptions): {
  ref: RefObject<HTMLElement>;
  instance: DocierInstance | null;
  ready: boolean;
  error: DocierError | null;
};
export function DocierEditor(props: DocierOptions & { className?: string; style?: CSSProperties }): JSX.Element;
```

**Rules for all bindings.** The binding owns exactly three things: element ref, instance creation on mount, disposal on unmount. It does not re-render on document change (the editor owns its own DOM), does not pass reactive props through as config except through an explicit `config` prop, and never re-creates the instance on a prop change (that is `updateConfig`). Vue: `<DocierEditor>` with a `defineExpose`d `instance`. Svelte: an `action` plus a component. Plain JS: the core API alone, with a documented 20-line example.

### API-24 - Public TypeScript typing strategy

`core` · `M`

- One public entry `docier` plus `docier/server`, `docier/plugins/…`, `docier/testing`. Nothing else is importable; deep imports outside `package.json#exports` are a build error for consumers using `moduleResolution: node16/bundler`.
- No `any` and no `unknown` in *input* positions of public signatures except where a value genuinely is arbitrary (`TokenData` leaves). `unknown` *is* used in output positions that the consumer must narrow, and that is deliberate.
- Branded types for ids (`CommandId`, `TokenKey`, `TokenInstanceId`, `PartName`) so a key cannot be passed where an id is expected.
- Discriminated unions everywhere a value has variants (`TokenKind`, `TokenFormat`, `RichValue`, `DataIssue.code`, `CommandResult`, `ConditionExpression`); consumers narrow with `switch` and the compiler catches missed cases via a `never` check documented in the type guide.
- Options types are the *same* types the runtime validates against - no hand-maintained duplicate.
- `readonly` on every array and object in an input or output position; mutable variants are named explicitly.
- `.d.ts` is rolled up with API Extractor; `api-report.md` is committed and diffed in CI as a build gate, so an accidental signature change cannot ship unnoticed.
- `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` are on for the library itself and stated as the consumer expectation.

### API-25 - Versioning and backwards compatibility

`core` · `M`

Pre-1.0: minor versions may break, and every break is listed under "Breaking" in `CHANGELOG.md` with a codemod note. Post-1.0: semver with these commitments - command ids, event names, config option names, and CSS custom properties are stable; adding an option is a minor; removing or re-typing one is a major; **renaming an event is a major**. Deprecation: `@deprecated` JSDoc plus a one-time runtime warning per deprecated surface per session, and removal no earlier than one major and at least 6 months after deprecation. Format compatibility is versioned separately: a document saved by docier N must open in N+1 with no content loss, and the file records `docier:version` in an extended property (a `docProps/app.xml` custom property, not a proprietary part) so a host can detect a too-new file and warn.

### API-26 - Errors, error codes, and the boundary

`core` · `L`

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
  partName?: string;
  pluginId?: string;
  documentRevision: number;
}

export type DocierErrorCode =
  | 'CONFIG_INVALID' | 'CONFIG_VERSION_NEWER' | 'INSTANCE_DESTROYED' | 'INSTANCE_LIMIT'
  | 'MOUNT_TARGET_MISSING' | 'MOUNT_TARGET_DETACHED' | 'COMMAND_NOT_FOUND' | 'REENTRANT_COMMAND'
  | 'TRANSACTION_STALE' | 'DOC_LOAD_FAILED' | 'DOC_UNSUPPORTED' | 'DOC_CORRUPT'
  | 'DOC_CATALOGUE_INVALID' | 'DOC_TOO_LARGE' | 'SAVE_FAILED' | 'EXPORT_BLOCKED'
  | 'FILL_ABORTED' | 'DATA_SOURCE_FAILED' | 'STORAGE_UNAVAILABLE' | 'STORAGE_QUOTA'
  | 'PLUGIN_FAILED' | 'PLUGIN_VERSION_MISMATCH' | 'SLOT_RENDERER_FAILED' | 'AUTOSAVE_FAILED'
  | 'NOT_SUPPORTED_BROWSER' | 'INTERNAL';
```

**Rules.** Every error thrown or rejected by the library is a `DocierError` with a code from the closed set - a raw `TypeError` reaching a host is a bug. `recoverable` tells a host whether retrying or continuing is sane. The boundary: user-triggered operations (open, save, export, insert) surface failures as events plus a localised UI notification; programmatic calls reject with the error. Nothing fails silently - every caught internal error ends up in `getDiagnostics().errors` at minimum. `config.onError` may observe all errors and may replace the user-facing message, but may not swallow the diagnostic.

### API-27 - Diagnostics, logging, debug mode

`important` · `M`

```ts
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
  performance: { lastLayoutMs: number; lastFillMs: number; lastExportMs: number; pages: number; heapBytes?: number };
}
```

`debug: { enabled, level: 'error'|'warn'|'info'|'debug'|'trace', logPerformance, logMutations, exposeGlobal }` gates logging. `exposeGlobal` attaches the instance to `window.__docier` for host debugging in dev builds only. A `docier:diagnostics` command copies the payload as JSON to the clipboard, which is the support-report path. Logging never includes token *values* unless `debug.includeValues === true` - HR contracts contain personal data and the default must not leak it into a console or a bug report.

---

# Part 3 - Cross-cutting quality

## 3.1 Accessibility

### QUA-01 - Document surface roles, names, and accessible structure

`core` · `M`

**Rules.** The editor root is a `<div class="docier-root">` with `role="application"` **only** where key handling is fully custom (documented per surface); the document area itself is `role="document"` with `aria-multiline="true"`, `contenteditable="true"`, `aria-label` from `MountOptions.ariaLabel` or the document title, and `aria-roledescription` set to the localised "document". The toolbar is `role="toolbar"` with `aria-orientation="horizontal"` and full roving-tabindex arrow-key navigation. The page container is `role="region"` per page with `aria-label` "Page 3 of 40" in the document locale. Headers and footers are labelled regions inside their page. Tables expose real grid semantics: `role="table"`/`role="row"`/`role="columnheader"`/`role="cell"` with `aria-rowindex`, `aria-colindex`, and `aria-rowcount`/`aria-colcount`, because a paginated, absolutely-positioned layout carries no implicit table semantics and a screen reader would otherwise read a contract's payment schedule as an undifferentiated stream.

### QUA-02 - Screen-reader behaviour on paginated content

`core` · `L`

**The problem.** Pagination splits one logical text flow across multiple absolutely-positioned page boxes, which breaks screen-reader reading order, "read from here", and selection. Colour, position, and DOM order no longer agree.

**Solution.** An accessibility mirror: an off-screen, linearly ordered text projection of the document (`.docier-a11y-layer`, visually hidden, not `aria-hidden`, `role="document"`), regenerated from the model and kept in sync within one frame of the visible layer. Pointer/selection operations on the visible layer update the mirror's selection, and "read from here" actions in the mirror scroll and select the visible equivalent. When a screen reader is detected (`config.a11y.mirror: 'auto'`), the mirror is the primary accessibility tree and the visible layer is marked `aria-hidden="true"` - one representation, never two competing ones. Under `'off'` the visible layer is exposed directly with `aria-rowcount`-style corrections where they do not lie. This is a decision with a cost (a second DOM representation and a sync path); the alternative, exposing the paginated layer, is not usable, and this must be validated with NVDA, JAWS, and VoiceOver in the release checklist rather than assumed.

### QUA-03 - Keyboard-only operation of every feature

`core` · `L`

**Rule.** Every command in `commands.list()` has a keyboard path, and this is enforced by a test that enumerates the registry and asserts an entry in the keyboard map (or a documented dialog path) for each.

Specifically including the features that are usually mouse-only in editors of this class:
- **Creating objects**: insert token (palette `Ctrl/Cmd+Alt+T`, trigger `{{`, dialog), insert table, insert image, insert page break, insert section break, insert field, insert conditional block, insert repeating section.
- **Selecting objects**: `Esc` moves focus from the document body to the enclosing object (table → tile → document), `Ctrl/Cmd+A` twice selects the object then the container, `Tab` moves between cells, `Alt+↑/↓` moves a row, `Ctrl/Cmd+Shift+↑/↓` moves a paragraph.
- **Token operations**: navigate instance-to-instance (`Ctrl/Cmd+Alt+↓`), open the edit dialog (`Alt+Enter`), unlink (`Ctrl/Cmd+Shift+U`), open the issues panel.
- **Panels and dialogs**: `F6` cycles regions (document, toolbar, sidebar, statusbar), all dialogs are traps with a defined initial focus and an `Esc` exit.
- **Formatting a selection without a mouse**: the format toolbar is reachable from the document without losing the selection (`Alt+F10`-style toolbar focus with selection preserved, which must be tested because it is easy to lose).

### QUA-04 - Focus management and restoration

`core` · `M`

**Rules.** Focus is a single, tracked value: `document.focus(target?)`, `document.getFocus()`, and `docier:focus:change` with `source: 'user' | 'api' | 'restore' | 'mount'`. Every dialog, popover, palette, and context menu records the focus origin and restores it on close - including when the origin was *inside the document* (caret position restored as a selection, not just a node). Closing a dialog never leaves focus on `body`. Focus is not stolen on `updateConfig`, on data application, or on an incoming autosave state; focus *is* taken on `mount()` when `autoFocus` is true (default true only when the target is empty). Destroying the instance returns focus to the element that had it before mount, if that element is still connected.

### QUA-05 - Live regions and status announcements

`important` · `M`

One polite `aria-live` region and one assertive region per instance, rendered in the root. Announced (polite): save state changes, data applied with counts, autosave recovered, issue count changes, layout-in-progress start/end for documents over 50 pages, token inserted with its label. Announced (assertive): export blocked with the count of errors, document load failure, unsaved-work loss risk. Not announced: every keystroke, selection change, or per-token fill. Announcements are debounced to at most one per 500 ms with coalescing so a 200-token fill does not produce 200 utterances.

### QUA-06 - Object selection semantics for assistive technology

`important` · `M`

A selected token, image, table, or repeating section is exposed with an accessible name and a state, not just a highlight: `role="group"` (or the appropriate role) with `aria-label` from the catalogue label, `aria-describedby` pointing at the issue description when unresolved, and `aria-invalid="true"` on an unresolved required token. Moving an object with the keyboard announces the move ("Moved after paragraph 12") - a spatial change with no announcement is invisible to a screen reader user.

### QUA-07 - High contrast, forced colors, and non-colour encoding

`important` · `M`

**Rules.** `@media (forced-colors: active)`: token chips gain `1px solid CanvasText` borders instead of fill, unresolved tokens gain a distinct border *style* (dashed) plus a text marker (`!` glyph in the label) rather than a colour, selection uses `Highlight`/`HighlightText` system colours, focus rings use `CanvasText` and are never removed. `forced-color-adjust: none` is used only where a system colour is wrong and only with explicit system-colour fallbacks. In normal mode, contrast is verified at ≥4.5:1 for text and ≥3:1 for UI borders in both light and dark themes, and every state distinguishable by colour is *also* distinguishable by shape, weight, or text. No state in the entire UI is conveyed by colour alone.

### QUA-08 - Hit targets, zoom and reflow, motion

`important` · `S`

Minimum interactive target 24×24 CSS px (WCAG 2.2 AA) with 44×44 for any control that is primarily touch (mobile layout), and at least 8 px spacing between adjacent targets. Layout reflows without horizontal scrolling to 400% zoom at a 1280 px viewport for all chrome (the document canvas zooms its content instead, which is the correct behaviour for a page-based editor and must be stated so nobody "fixes" it). `prefers-reduced-motion: reduce` disables all non-essential transitions and the caret-blink override is preserved for users who rely on it.

## 3.2 Internationalisation

### QUA-09 - UI localisation, plural rules, and the message contract

`core` · `M`

```ts
export type LocaleCode = string;
export type Messages = Readonly<Record<string, string>>;
```

**Rules.** UI strings live in message catalogues keyed by a stable id (`command.format.bold.label`, `issue.value-missing.message`). Lookup order: instance locale → `fallbackLocale` → `en`. Locale negotiation normalises `ro-MD` → `ro` → `en` and `ru-MD` → `ru` → `en`, and the *resolved* locale is exposed in diagnostics and on `docier:ready`. Plurals use `Intl.PluralRules` with full category support: Romanian `one`/`few`/`other` ("1 token", "2 tokeni", "20 de tokenuri"); Russian `one`/`few`/`many`/`other` ("1 токен", "2 токена", "5 токенов"). Messages support named substitution only - no runtime expression evaluation. Missing keys fall back and are counted in diagnostics, and a CI check asserts that the shipped `ro` and `ru` catalogues have every key the `en` catalogue has, with a documented, shrinking allow-list of exceptions. Number and date formatting inside messages goes through the same formatter as token values (TOK-15) so "3 issues" and a token's count never disagree.

### QUA-10 - RTL and bidirectional text

`important` · `L`

**Rules.** The UI chrome mirrors under `dir="rtl"` using CSS logical properties throughout (`margin-inline`, `padding-inline`, `inset-inline-start`) - no `left`/`right` in library CSS. The *document* direction is independent of the UI direction and comes from `w:bidi`/`w:rtl` in `w:sectPr` and `w:pPr`; a right-to-left UI must never flip a left-to-right contract. Text runs carrying a direction opposite to the paragraph get Unicode bidi isolates (`U+2068`/`U+2069`) on insertion of a value, so a Romanian name inside an Arabic paragraph does not scramble. Cursor movement, selection extension, word segmentation (via `Intl.Segmenter`), and Home/End honour visual vs logical order correctly; arrow keys move logically within a run and skip-run at direction boundaries. Mixed-direction text in a single paragraph is laid out with the full UBA, not a simplified model, and tab stops, indents, table column order, and list markers mirror correctly. Even though neither Romanian nor Russian is RTL, RTL is in scope because the backend template product is multi-tenant and Arabic/Hebrew templates must not corrupt the document when opened, even before full UI support ships.

### QUA-11 - CJK and complex-script text handling

`later` · `L`

**Rules.** Line breaking follows the script's rules (`line-break: strict` for CJK, with kinsoku shori prohibitions honoured), no space-based justification, punctuation compression optional, and correct handling of full-width forms. Font fallback chains are per-script and configurable (`theme.fontFallback: { cjk, arabic, devanagari }`) because a Calibri-only document must still render CJK without tofu. `Intl.Segmenter` drives word segmentation for double-click and word-wise navigation. Ruby/furigana and vertical writing are explicitly out of scope for 1.x and are listed so nobody assumes they work. IME composition (`compositionstart`/`compositionupdate`/`compositionend`) never produces a spurious document change per intermediate string: composition text updates the surface without committing to the model until `compositionend`, and this is tested with at least Japanese and Korean IMEs plus Vietnamese Telex.

### QUA-12 - Locale-aware dates, numbers, and the shared formatter

`core` · `M`

One formatter module, used by token fill, by the UI (issue counts, page numbers, save timestamps), and by the testing fixtures, so a value formatted in the UI and the same value filled into the document can never disagree. It exposes `formatDate`, `formatNumber`, `formatCurrency`, `formatRelative`, `parseLocalized`, and a `FormatterCache` keyed by `(locale, options)` because constructing `Intl` objects is expensive and doing it per token during a fill is a measurable cost. Results are deterministic for a given ICU version; CI pins the Node and browser versions used for golden tests and any locale-data version difference is reported as a fixture failure with a clear cause.

### QUA-13 - Document language vs UI language

`core` · `M`

Three distinct languages, kept distinct: **UI language** (`config.locale` - menus, dialogs, error messages), **document language** (`w:rPr/w:lang` per run, `w:lang` defaults from `w:styles.xml` and `w:themeFontLang` in `w:settings.xml`; drives spellcheck, hyphenation, and token formatting), and **catalogue language** (which `LocalizedString` variants of labels and messages are shown).

**Rules.** Opening a Russian contract while the UI is Romanian must not change the UI language, and must not rewrite the document's `w:lang`. Changing the UI language must not mark the document dirty. The document language is settable (`docier.command.doc.setLanguage`) and applies to the selection or the whole document, writing `w:rPr/w:lang` with all three attributes (`w:val`, `w:eastAsia`, `w:bidi`) where known. Formatting a date uses the document language unless the token overrides it - a Romanian contract with a German date format is what the author asked for, not a bug.

### QUA-14 - Romanian specifics

`core` · `M`

- **Diacritics.** The correct characters are `ș` `Ș` `U+0219`/`U+0218` and `ț` `Ț` `U+021B`/`U+021A` (comma below), not the cedilla lookalikes `ş` `U+015F` and `ţ` `U+0163` that legacy fonts and old templates use. Search, validation, and comparison normalise both forms to the comma-below form; on open, a document using cedilla forms gets a non-destructive suggestion, never a silent rewrite; on token-value entry the library normalises to the correct form and reports what it changed.
- **Collation.** `ă`, `â`, `î`, `ș`, `ț` sort immediately after their base letters per the Romanian rules, not at the end of the alphabet - used by loop sorting, token palette ordering, and issue lists.
- **Search.** Diacritic-insensitive and comma/cedilla-insensitive matching by default, with a "match diacritics" toggle in find-and-replace.
- **Formatting defaults.** `dd.MM.yyyy`; decimal comma; `.` thousands separator; currency `RON` after the amount with a non-breaking space (`1.250,00 RON`); CNP/IBAN/CUI validators in the default catalogue (TOK-26).
- **Locales.** `ro-RO` and `ro-MD` supported distinctly; `ro-MD` implies the IDNP validator and can be pinned by config.

### QUA-15 - Russian specifics

`core` · `M`

- **Homoglyphs.** Cyrillic `а в е к м н о р с т у х` are visually identical to Latin letters. Token keys and catalogue keys must be validated as ASCII and refuse (or loudly warn on) Cyrillic lookalikes, because a key typed with a Cyrillic `а` silently never resolves - a real and common support ticket. The palette flags such entries at catalogue validation time.
- **`ё`.** Search and collation treat `е` and `ё` as equivalent by default (`ё` sorts with `е`, per the standard Russian collation), with strict mode available for dictionaries of names.
- **Collation and case.** Full Cyrillic collation with correct `Intl.Collator('ru')` usage, and locale-aware casing for `caseTransform` (TOK-15).
- **Formatting defaults.** `dd.MM.yyyy`; decimal comma; non-breaking-space thousands separator; ruble `₽` or `руб.` per catalogue config; long dates in genitive with the `г.` suffix (`12 января 2026 г.`); "N дней" plural agreement in messages (QUA-09).
- **Validators.** INN (10/12 digits with checksum), SNILS, OGRN/OGRNIP, KPP, and passport series/number masks in the default catalogue.
- **Locales.** `ru-RU` and `ru-MD` supported distinctly, including `MD` IDNP where applicable.

## 3.3 Performance

### QUA-16 - Typing latency budget and the layout policy

`core` · `XL`

**Budgets, measured on the reference machine (mid-range laptop, Chromium) and enforced in CI for the fixture corpus:**

| Operation | p95 | p99 |
|---|---|---|
| Keystroke → paint (200-page document, plain paragraph) | 16 ms | 33 ms |
| Keystroke → paint (inside a table on page 87) | 24 ms | 50 ms |
| Selection change → paint (keyboard) | 16 ms | 33 ms |
| Command (bold on a 3-page selection) | 50 ms | 120 ms |
| Fill of 5 000 tokens | 150 ms | 300 ms |
| Export (200 pages) | 1.5 s | 3 s |
| Cold open (5 MB DOCX) | 1.5 s | 3 s |
| Page flip during scroll | 16 ms | 33 ms |

**Layout policy, which is how those budgets are met:**
- A keystroke marks exactly one *dirty anchor* (the affected line). Relayout is incremental from that anchor forward, stopping at the first line whose break position and page position are unchanged - the standard early-out, and without it a keystroke at the top of a contract relayouts 200 pages.
- Pagination is debounced to `performance.paginationDebounceMs` (default 150 ms) after typing stops. While it is pending the pages are shown at their previous break, with the current page's content reflowed optimistically; the user never sees a stale caret.
- The caret is anchored to a `(nodeId, offset)` model position, never to a pixel coordinate, so any relayout that happens under it cannot move the text the cursor is in.
- Only the visible page and its immediate neighbours are laid out at full fidelity; pages beyond that are laid out to a cheaper "height estimate" until scrolled near, with estimation error bounded and corrected on approach. Estimated vs exact heights are asserted to converge within 1 px on the fixture corpus.
- Font metrics are measured once per `(font, size, features)` and cached, using canvas `measureText` for bulk measurement and the real DOM only for verification in dev mode.
- `document.getStats()` and `docier:render:layoutend` expose the numbers; `performance.reportToHost` forwards measurements so a host can alert on its own budget.
- Long tasks (>50 ms) are broken at safe points: layout is chunked with `requestIdleCallback` when the remaining work exceeds `performance.chunkBudgetMs`, and a subtle "laying out…" status is announced (QUA-05) rather than freezing the UI silently.

### QUA-17 - Virtualisation, large documents, and memory

`core` · `XL`

**Rules.** The visible DOM contains only the pages in view plus one page of overscan each side; a 200-page contract with 12 000 paragraphs keeps under ~3 000 live elements. Page DOM is recycled and rebuilt from the layout model on re-entry, and the *layout model* for all pages is retained (it is compact - the model, not the DOM, is the source of truth for positions). Undo history is bounded by memory as well as depth (API-10), and history entries store structural patches rather than full-document copies. Image/media parts are held as blobs with `URL.revokeObjectURL` on unload and on document close; a leak here is a common and severe regression, so it is asserted in tests by counting live object URLs. Document model, layout model, and undo stack sizes are reported by `document.getStats()` and `getMemoryStats()`, and the fixture suite asserts a ceiling for the 200-page corpus so a regression fails CI. Very large documents (>200 pages / >50 MB) trigger a documented degradation mode: pagination is opt-in ("continuous scroll" default), thumbnails off, and a one-time notice, rather than an unusable editor that silently swaps pages for half a second.

### QUA-18 - Autosave, recovery, and crash safety

`core` · `L`

**Rules.**
- Autosave writes the full DOCX (not a DOM snapshot) through the storage adapter, debounced on change (`storage.autosaveDebounceMs`, default 2 s) and on a maximum interval (`storage.autosaveIntervalMs`, default 30 s), plus immediately on visibility change to hidden and on `pagehide` - the last one via a synchronous-capable path, because an async write there is routinely lost.
- The default adapter is IndexedDB, namespaced per instance and document id, retaining the last `storage.retainRevisions` (default 3) revisions plus a labelled recovery point. A host may supply its own adapter implementing the same interface.
- Recovery: on mount with a matching document id and a newer autosave, the host is told via `docier:autosave:recovered` and must choose; the built-in UI offers "Restore unsaved changes from 14:32" with a diff summary (pages, words, changed tokens). Restoring is one transaction and one undo entry, so "no, not that" is one keystroke away.
- Crash safety: an uncaught error during layout or render of a page shows that page as an error placeholder with a "reload page" action while the rest of the document stays usable; the document model is never left half-mutated because all mutations go through transactions (API-09). A render error never triggers a document save.
- Quota exhaustion (`QuotaExceededError`) is reported as `STORAGE_QUOTA`, is never fatal, and degrades to a single retained revision.
- `beforeunload` prompts when the document is dirty and not autosaved, unless `storage.warnOnUnload === false`; a host that already has its own guard can disable it and take `docier:doc:beforeunload` instead.
- The original uploaded bytes are always retained for the session, so even a catastrophic model failure lets the user download what they started from.

### QUA-19 - The same document open twice

`important` · `L`

**Behaviour.** Two docier instances (same page, another tab, another device) editing one document must not silently overwrite each other.

**Rules.** Document identity comes from `config.document.docId` if the host supplies it, else from a content hash of the original bytes plus the file name. On mount, the instance takes a soft lease in the storage adapter (`ownerInstanceId`, heartbeat, TTL 30 s). A second instance finds a live lease and opens in **read-only mode** with a banner naming the situation and offering "Take over editing" (which invalidates the other lease) or "Open a copy". If the docier collaboration module is enabled, the second instance joins as a collaborator instead and the banner does not appear. A stale lease (no heartbeat within TTL) is taken over silently with a logged diagnostic. Two instances on the *same* page with different roots and the same `docId` behave identically - the rule is about the document, not the tab. Finally, if a save is detected to be overwriting a file whose bytes changed since load (last-write-wins risk), the host is warned through `docier:doc:save` metadata rather than having its work overwritten.

## 3.4 Testing and browsers

### QUA-20 - Testing strategy

`core` · `XL`

**Unit.** Vitest, Node environment, no DOM. Covers: marker parsing and run coalescing, catalogue validation, condition evaluation, loop expansion (including id re-minting), the fill engine, locale formatting, validators (with the ro/ru checksum vectors), config merge and migration, event ordering, command registry semantics, and error-code coverage (every code in the union has a test that produces it).

**Golden-file layout fixtures.** Directory per case: `input.docx`, `data.json`, `layout.json` (page count, page boxes, line boxes, run positions with a stated float tolerance of 0.5 px, and a text-content hash), `expected/*.png` for visual regression, and `meta.json` (locale, fonts, feature flags). The corpus is deliberately adversarial for this product: a 200-page Romanian employment contract; a Russian order with a header/footer, footnotes, and a signature table; a nested table with merged cells; a document with tracked changes; a loop over 500 rows; an image-heavy letter; a document with legacy `MERGEFIELD`s; a malformed-DOCX set. Determinism requires pinned metric-compatible fonts (Carlito/Caladea/Liberation) shipped in the repo, device pixel ratio 1, fixed viewport, subpixel positioning off, and pinned Node/browser versions - otherwise golden tests become flaky and get disabled, which is worse than not having them. `pnpm test:layout --update` regenerates and the diff is reviewed in the PR with a checklist ("is the change a real layout change or a font/dependency drift?").

**DOCX round-trip.** Three levels, all in CI. (1) **Semantic round-trip**: parse → model → serialise → parse yields an equal model, via property-based tests over generated documents. (2) **Preservation round-trip**: opening and saving without edits leaves every part byte-identical except the parts allowed to change (ids, timestamps), and every part docier does not understand is preserved byte-for-byte - `customXml`, `word/theme`, `word/webSettings`, `w:altChunk` relationships, `docProps/custom.xml`, and embedded objects. Macro-enabled files (`.docm`, `vbaProject.bin`) are loaded with a warning and can only be saved as `.docm`, never silently downgraded to `.docx`. (3) **Interop round-trip**: a fixture matrix opened in Word 2016/2019/365 and LibreOffice, compared against our own render, run manually per release against a documented checklist and automatically (headless LibreOffice conversion to PDF + diff) where licensing permits. Plus fuzzing of the ZIP and XML parsers - the parser must never crash, must never loop unboundedly (zip-bomb limits), and must always return a diagnostics list on malformed input.

### QUA-21 - Browser support

`core` · `M`

**Supported:** Chromium (Chrome, Edge) current and previous major; Firefox current and previous; Safari 16.4+ and iOS Safari 16.4+; Android Chrome current. Roughly the last two years of evergreen browsers, with Safari 16.4 chosen as the floor because it is where `Intl.Segmenter`, `structuredClone`, and the required CSS `:has()`/container-query features that the layout engine leans on are all present together. No IE, no legacy Edge, no Opera Mini.

**Required platform features** (a startup probe checks them and refuses to mount with `NOT_SUPPORTED_BROWSER` and a clear message rather than misbehaving): `contenteditable` with a working `beforeinput`, `Intl.DateTimeFormat`/`NumberFormat`/`PluralRules`/`Segmenter`/`Collator`, `ResizeObserver`, `IntersectionObserver`, `structuredClone`, async clipboard, and `AbortController`. Optional with graceful fallback: `OffscreenCanvas` (metrics cache falls back to a detached canvas), File System Access API (`showSaveFilePicker`; falls back to blob download), `showOpenFilePicker` (falls back to `<input type=file>`), Web Workers for export (falls back to the main thread with a progress indication), `navigator.storage.persist` (autosave falls back to IndexedDB best-effort), and `CompressionStream` (unused if absent).

**Decisions recorded:** docier does **not** use `document.execCommand`; all mutation goes through the input pipeline and transactions, because `execCommand` is deprecated, inconsistent, and silently rewrites undo history. Mobile is supported for viewing, filling and light editing, with the touch target floor (QUA-08) and an on-screen keyboard-aware scroll-into-view; heavy template authoring on phones is not a supported workflow and is documented as such.

### QUA-22 - Quality gates in CI

`important` · `M`

The following fail the build, not just the report: the golden-file layout and visual regression suites; DOCX round-trip and preservation suites; the fuzz corpus; axe-core accessibility checks on every fixture and every dialog state (zero serious/critical violations); keyboard-reachability assertion over the command registry (QUA-03); performance benchmarks against the budgets in QUA-16 on the reference runner with a documented noise margin (fail on >20% regression over a rolling median rather than an absolute, to avoid a flaky gate); bundle-size ceilings per entry point, with the tokenization module's weight reported separately because it must stay optional; and the `api-report.md` diff, which requires an explicit reviewer acknowledgement for any public signature change (API-24).
