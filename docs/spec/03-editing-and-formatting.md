# 03 — Editing and Formatting

**Domain spec 3 of 5.** The editing surface (caret, selection, input, history, clipboard, find,
proofing, modes) and the formatting system (character, paragraph, styles, themes, lists).

---

## 0. Document control

| Field | Value |
| --- | --- |
| Spec ID | 03 |
| Status | Draft for review |
| Scope owner | Editing surface and formatting |
| Depends on | 01 (packaging / load / save / OOXML model), 02 (layout engine, hit testing, pagination) |
| Consumed by | 04 (review, revisions, comments, protection UI), 05 (tokens / data binding / host API) |
| Fixed constraints | DOCX (OOXML) is native; every user action is a **command**; every state change emits an **event**; tokenization is an optional module; layout is Word-faithful and must be invalidated correctly |

### 0.1 What this spec owns

Editing and formatting *behaviour*, the command/event surface for both, and the OOXML properties
they read and write (run properties `rPr`, paragraph properties `pPr`, `styles.xml`, `numbering.xml`,
`theme1.xml`, `settings.xml` as it relates to editing and formatting only).

### 0.2 What this spec does not own

| Concern | Owner |
| --- | --- |
| Package parts, content types, relationships, round-trip of unknown parts | 01 |
| Line breaking, pagination, hit testing, caret rectangles, table layout | 02 |
| Tracked revisions model, comment model, review pane, accept/reject | 04 |
| Token model, token data binding, template rendering | 05 |
| Section properties, page setup, headers/footers, columns | 01 / 02 |
| Table structure and table formatting UI (borders, cell margins, merge/split) | 01 (model) / this spec only for style resolution (FM-022) and selection (ED-004) |

---

## 1. Conventions

### 1.1 Feature entry format

Every feature has an id, a title, a priority, an effort, a command/event surface, the OOXML it maps
to, normative behaviour bullets, and edge cases. Normative statements use **must** / **must not**;
implementation latitude is marked *may*.

### 1.2 Priority

| Value | Meaning |
| --- | --- |
| **core** | Required for a usable product for the HR-manager persona (contracts, orders, letters). Ships in v1. |
| **important** | Required for "feels like Word" acceptance and for HR workflows, but v1 can ship without it. |
| **later** | Deferred; the data model must not be designed in a way that prevents it. |

### 1.3 Effort

**S** ≤ 3 days · **M** ≤ 2 weeks · **L** ≤ 6 weeks · **XL** > 6 weeks (one engineer, including tests).

### 1.4 Command and event contract

- Command ids are dotted lowercase namespaces: `edit.*`, `selection.*`, `history.*`, `clipboard.*`,
  `find.*`, `format.*`, `style.*`, `theme.*`, `list.*`, `view.*`, `proof.*`.
- Every command takes a single plain-object argument and returns a synchronous `CommandResult`
  (`{ ok: true, affectedRanges, layoutInvalidation } | { ok: false, code, message }`). Commands never
  throw for policy reasons; they return `ok: false` with a code and additionally emit
  `command.rejected` so a host can surface a message.
- Every command that changes document state emits exactly one `document.changed` event, plus
  property-specific events (`selection.changed`, `history.changed`, `format.changed`,
  `styles.changed`, `numbering.changed`, `theme.changed`, `proof.changed`, `view.changed`).
- Events are emitted **after** the mutation is complete and after layout invalidation has been
  declared, so a listener observing `document.changed` always sees a consistent document.
- Every mutating command must be invertible (see ED-023). A command that cannot be inverted must not
  exist.
- All commands are available programmatically with no DOM present (ED-039).

### 1.5 Addressing model

| Type | Shape | Notes |
| --- | --- | --- |
| `StoryId` | `'body' \| 'header' \| 'footer' \| 'footnote' \| 'endnote' \| 'comment' \| 'textbox'` | Plus the part instance id (e.g. `header:rId7`). |
| `TextPosition` | `{ story, paragraphId, offset, affinity }` | `offset` counts UTF-16 code units inside the paragraph's *logical text* (see 1.6). `affinity` is `'upstream' \| 'downstream'` and disambiguates soft-line-break and run-boundary positions. |
| `TextRange` | `{ anchor: TextPosition, focus: TextPosition }` | Order-independent; `isReversed` is derived. |
| `ObjectRef` | `{ story, kind, id }` | For drawings, tables, content controls, fields. |

Rule: positions are **stable across layout** and **invalidated by edits**. After any mutation the
library re-maps positions through the edit; a host must not cache a `TextPosition` across a command
it did not issue.

### 1.6 Logical text

Each paragraph exposes a *logical text*: all `w:t`/`w:delText` content plus one character per
structural inline (`\t` for `w:tab`, `\n` for `w:br`, `-` for `w:noBreakHyphen`, `­` for
`w:softHyphen`, U+FFFC for an inline object, U+0001 for a field-result boundary). All offsets,
find/replace, spellcheck and word segmentation operate on logical text. Field *codes*
(`w:instrText`) are **not** part of logical text; field *results* are (ED-032).

### 1.7 Layout invalidation contract

Every mutating command returns `layoutInvalidation`:

| Value | Meaning |
| --- | --- |
| `{ kind: 'none' }` | Nothing visual changed (e.g. `view.*` telemetry). |
| `{ kind: 'range', story, from, to }` | Re-flow from `from`; block-level batching allowed up to the next hard break. |
| `{ kind: 'paragraph', story, paragraphIds }` | Re-flow those paragraphs and re-break their containers. |
| `{ kind: 'container', story }` | Re-flow an entire story (table, text box, note). |
| `{ kind: 'document' }` | Re-paginate the whole document (style, theme, numbering, section changes). |

Rules: (a) a command that changes an `rPr`/`pPr` property must invalidate at least the affected
paragraph range — never `none`; (b) style/theme/numbering/`docDefaults` changes are always
`document`, because they can change any paragraph's metrics; (c) an edit inside a footnote, text box
or table cell must also invalidate the owning story's container (the anchor line, the table, the
page); (d) invalidation is computed by the command, not guessed by the caller; (e) commands that
change only *markers* (formatting marks ED-037, spellcheck decorations ED-036, selection ED-002)
declare `range` and must not alter text metrics (see ED-037 for the metric-neutral decoration rule).

### 1.8 Language and script routing (Romanian, Russian)

This is a correctness-critical area with a common failure mode; the rules are normative.

1. OOXML decomposes text by **script class**, not by language: `w:rFonts/@w:ascii` and `@w:hAnsi`
   cover Latin **and** Cyrillic; `@w:cs` covers *complex scripts* only (Arabic, Hebrew, Syriac,
   Thaana, Devanagari family, Thai, and other CTL scripts); `@w:eastAsia` covers CJK. Cyrillic is
   **not** a complex script.
2. Consequence: Russian text must be formatted through `ascii`/`hAnsi` and `w:sz`/`w:b`/`w:i`;
   `w:szCs`/`w:bCs`/`w:iCs` must **not** be applied to Cyrillic. Romanian diacritics
   (ă U+0103, â U+00E2, î U+00EE, ș U+0219, ț U+021B) are Latin Extended-A/B and are likewise
   `ascii`/`hAnsi`.
3. `w:rFonts/@w:hint` (`default | eastAsia | cs`) is the tie-breaker the renderer uses when a run
   contains more than one script class; it is written as `default` when set from the Font dialog's
   Latin field.
4. `w:lang` has one attribute per script class: `w:val` (Latin), `w:cs`, `w:eastAsia`, `w:bidi`.
   Proofing language for Romanian and Russian lives in `w:val`.
5. Font fallback (FM-025) is per-character and must consult the font that owns the character's
   script class. A display font without Cyrillic coverage degrades Russian text; the engine must fall
   back rather than render tofu.

### 1.9 Cross-cutting invariants

- **I1 — No unreachable state.** Every mutation goes through a command; no code path mutates the
  document model directly, including autocorrect, paste, drag-and-drop, IME commit and token
  insertion.
- **I2 — One gesture, one undo entry.** Any user gesture that produces a logically single change to
  an object produces exactly one undo entry (ED-025).
- **I3 — Effective formatting is computed, never stored.** The value shown for bold/font/size etc. is
  always derived by the resolution algorithms in FM-021/FM-022 from the current document state.
- **I4 — Round-trip silence.** A command that changes nothing must produce no `document.changed`
  event and no undo entry (e.g. clicking Bold on already-bold text with `set`, not `toggle`).
- **I5 — Protected content is rejected, not edited then reverted.** Policy is evaluated before the
  mutation (ED-038).
- **I6 — Locale completeness.** Every user-facing string, every typographic rule and every proofing
  path defined here must behave correctly for `ro-RO` and `ru-RU`; `en-US` is the fallback.
- **I7 — Accessibility.** The editing surface must expose caret/selection/formatting to assistive
  technology through a documented ARIA surface (`aria-activedescendant` over a virtual text
  representation, or the host's native editing bridge). Because the editor is a custom-rendered
  surface, this is a requirement, not a nicety: an HR manager using a screen reader must be able to
  read, navigate and format. Implementation approach is deferred but the contract is: commands and
  events in 1.4 must be sufficient to drive the editor with no pointer.

---

## 2. Editing and input

### 2.1 Caret and selection

#### ED-001 — Caret model: placement, hit testing, affinity, rendering, blink
**Priority:** core · **Effort:** L · **Depends:** 02 (hit testing, caret rectangles)

**Commands:** `selection.setCaret(position)`, `selection.moveCaret(direction, options)` ·
**Events:** `selection.changed`
**OOXML:** no document mapping (session state). Reads `w:rPr` of the run under the caret to answer
`format.query`.

**Behaviour**
- Click hit-testing is delegated to the layout engine, which returns the nearest `TextPosition` for a
  point. The caret must be placed at a **grapheme cluster** boundary, never inside one (an emoji ZWJ
  sequence, a combining mark, an `w:rPr`/`w:lang`-independent cluster).
- Inside a character cell, the left half places the caret before the cluster and the right half
  after; the split point is the cluster's midpoint, not the run's.
- Clicking to the right of the last character of a *visual* line places the caret at the end of that
  visual line, not at the start of the following one.
- Clicking in the left margin (the "selection bar" area, left of the text column) selects the line;
  double-clicking there selects the paragraph; triple-clicking selects the whole document. This is
  the Word margin behaviour and must work with drag.
- Clicking below the last paragraph of a story places the caret at the end of the story.
- Clicking inside a field *result*, a content control, a footnote reference, or an inline object
  must not enter or split the construct; the caret lands before/after it and the construct becomes
  selectable as a unit (ED-004).
- **Affinity.** A position at a soft line break, at a run boundary, or before/after an inline object
  is ambiguous. The caret carries `affinity`: `downstream` means "attached to the character to the
  right" (its `rPr` governs typing and the toolbar display), `upstream` means "attached to the
  character to the left". Up/Down movement preserves the affinity of the line it came from; End
  produces `upstream`, Home produces `downstream`.
- **Formatting display at a caret.** With a collapsed selection, the toolbar reflects the effective
  formatting at the caret's affinity-resolved character; on an empty paragraph it reflects the
  paragraph mark's `w:pPr/w:rPr` resolved through the cascade.
- **Rendering.** The caret is drawn by the editor surface, not the DOM: a 1 px (device-pixel
  aligned) rectangle at the caret's x/y from the layout engine, height = the line's ascent+descent.
  Caret height equals the *run* height at the caret, not the paragraph's line height. Blink is a
  530 ms half-period, suspended while composing (ED-016), while dragging, and when the window is
  unfocused (unfocused caret is drawn hollow or not at all, per `view.caretBlink`).
- The caret must be kept inside the viewport by scrolling the minimum amount when it moves by
  keyboard, and centered only for find/Go-To navigation.

**Edge cases**
- Clicking on the last (usually empty) paragraph mark of a table cell places the caret in the cell.
- A click on a decoration inserted by ED-037 or ED-036 must be routed to the underlying text.
- In a read-only document the caret is still movable and selectable (ED-038).

---

#### ED-002 — Selection model: anchor/focus, normalization, multi-range, persistence
**Priority:** core · **Effort:** L

**Commands:** `selection.set(range)`, `selection.collapse(to)`, `selection.clear()`,
`selection.setMulti(ranges)` · **Events:** `selection.changed (previous, current, reason)`
**OOXML:** none (session state).

**Behaviour**
- A selection is `{ anchor, focus }`; `anchor` is where the gesture started, `focus` is the moving
  end. Direction matters for shift-extension semantics (ED-003, ED-013).
- Normalization: `start`/`end` are derived (whichever is earlier in document order), and all range
  commands must operate on the normalized range.
- **Multi-range selection.** Word supports discontiguous selections (Ctrl+drag, or selecting several
  words with Ctrl). The model must be a list of ranges with exactly one *primary* range; commands
  that are not multi-range-aware must apply to all ranges (formatting, delete, copy) or be rejected
  (typing inserts only into the primary range and collapses the rest). A multi-range selection must
  always be convertible to a single spanning range for commands that require it.
- Cross-story selections are not representable; a command that would produce one is clamped to the
  focus's story, except for whole-document commands (`edit.selectAll`, `format.*` applied document
  wide via `style.applyToAll`).
- **Persistence.** The selection must survive: layout invalidation, pagination, zoom, undo/redo
  (restored to the selection that the undone command produced), and a document re-load (not
  persisted across sessions). After undo, the selection must be restored to the range the command
  affected, so that undo of a delete re-selects the restored text.
- The selection is exposed as a plain data structure so headless consumers can read and write it
  (ED-039).

**Edge cases**
- A collapsed selection has `anchor === focus` and both affinities; the pair must be preserved.
- Undo of a command whose affected range no longer exists (a later remote change) degrades the
  selection to the nearest surviving position and emits `selection.changed` with
  `reason: 'clamped'`.
- Selecting inside a table across cells must produce a rectangular cell selection, not a linear one
  (ED-004).

---

#### ED-003 — Selection gestures: multi-click ladder, drag-select, autoscroll, shift-click, Extend Mode
**Priority:** core · **Effort:** L · **Depends:** ED-001, ED-004, ED-008

**Commands:** `selection.extendTo(position, unit?)`, `selection.extendMode.set(on|off)`,
`selection.grow()`, `selection.shrink()` · **Events:** `selection.changed`
**OOXML:** none.

**Behaviour**
- **Multi-click ladder** (Word-compatible, with one documented extension):
  1 click → caret. 2 clicks → the word under the pointer. 3 clicks → the paragraph (including the
  paragraph mark). 4 clicks → the whole story (*library extension*; Word stops at the paragraph).
  Ctrl+click → the **sentence** (Word behaviour). Double-click-drag extends by whole words;
  triple-click-drag extends by whole paragraphs.
- A double-click must also select a following space when the click lands on the first word of a
  sentence? **No** — the selected word excludes trailing whitespace; the trailing space is included
  when driving with Ctrl+Shift+Right (ED-009), not with the mouse.
- **Drag-select.** Dragging extends from the anchor in the drag unit established by the initiating
  click count. Dragging beyond the window edge starts autoscroll: a proportional scroll rate that
  accelerates with distance (approximately `rate = k * (distance - threshold)`, clamped), with the
  selection extended to the position under the pointer at every animation frame. Releasing outside
  the window ends the gesture without cancelling it (no mouse-capture loss abort).
- Dragging over a table selects whole cells once the anchor and focus are in different cells.
- **Shift+click** extends the current selection from the existing anchor to the clicked position
  (not from the focus). Shift+double-click extends the selection to the clicked word.
- Shift+click in a table extends a cell-rectangle selection.
- **Extend Mode** (Word's F8): F8 turns extend mode on (status bar shows "Extend Selection"); a
  second F8 selects the current word, third the sentence, fourth the paragraph, fifth the story;
  Shift+F8 shrinks back one level; Esc cancels; any other key while in extend mode extends the
  selection rather than replacing it (including arrow keys, which become shift-arrows). Extend mode
  must be modelled as state on the selection, not as a keyboard-only emulation.
- Dragging an object (an image, an inline shape, a content control) is *not* a text selection; it is
  an object gesture (ED-007).

**Edge cases**
- A drag started in a read-only region and ended in a writable region produces a selection; the
  subsequent mutation is rejected by policy (ED-038).
- Autoscroll rate must be disabled under `prefers-reduced-motion`.
- A gesture that begins on a decoration (ED-037) anchors to the nearest real text position.

---

#### ED-004 — Selection units: character, word, sentence, line, paragraph, block, cell, row, column, object, all
**Priority:** core · **Effort:** M

**Commands:** `selection.selectUnit(position, unit)`, `selection.selectBlock(position)`,
`selection.selectCell(row, col, ...)`, `selection.selectRow(index)`,
`selection.selectColumn(index)`, `selection.selectTable()` · **Events:** `selection.changed`
**OOXML:** cell/row/column selection maps to a rectangular cell range; stored in the session model.
Table selection writes no OOXML by itself, but the resulting formatting commands write `w:tcPr`,
`w:trPr` (table spec) — this spec owns only the selection.

**Behaviour**
- Units that must exist and be reachable programmatically: `character`, `word`, `sentence`, `line`
  (visual line), `paragraph`, `block`, `cell`, `row`, `column`, `object`, `all`.
- **word** — same segmenter as ED-009 (one shared implementation; the two must never diverge).
- **sentence** — Word's definition: a maximal run ending at `.`, `!`, `?` (plus `…`, `?!`, `!.`)
  followed by whitespace or end of paragraph, or at a paragraph mark. Abbreviations are not
  special-cased (Word's behaviour); the unit is deterministic and documented.
- **line** — a *visual* line, delimited by soft line breaks produced by layout; requires the layout
  engine, and in headless mode without layout this unit fails with `LayoutUnavailableError`.
- **paragraph** — the `w:p` contents including its mark.
- **block** — the smallest enclosing structural node: a table cell's paragraph block, a whole table
  row, a text box's paragraph block, a list item, or the whole story body when the caret is at top
  level. This unit is what "select the current block" host commands use.
- **cell / row / column** — rectangular cell selections. A column selection is addressable even
  through vertically merged cells (`w:vMerge`): a column selection containing a merged cell must
  include the whole merged cell exactly once.
- **object** — a single inline object (`w:drawing`, `w:object`, `w:pict`, `m:oMath`), a field as a
  unit, a content control as a unit, a footnote/endnote reference, or a bookmark.
- **all** — the caret's story; in the body it is the body story only, excluding headers, footers and
  notes (see ED-006).

**Edge cases**
- Selecting a row that is the only row, or a table with a single column, must still be a valid cell
  selection.
- Selecting a unit that spans a tracked insertion (`w:ins`) boundary must not split the revision
  (04 owns revision integrity).
- A `paragraph` selection of a paragraph inside a content control does not include the control
  delimiters.

---

#### ED-005 — Block (column) selection
**Priority:** important · **Effort:** M

**Commands:** `selection.setColumnMode(on|off)`, `selection.setBlock(anchor, focus)`
**Events:** `selection.changed (kind: 'block')`
**OOXML:** none (session state). Edits derived from a block selection write ordinary `w:t`/`w:tab`
content and per-line `w:ind` where applicable.

**Behaviour**
- Entered by Alt+drag with the mouse, or by Ctrl+Shift+F8 followed by arrow-key extension (Word).
  Exited by Esc, by any non-extending key, or by a click outside the block.
- The selection is a **rectangular region**: for each visual line between the anchor and focus rows,
  the intersection of `[blockLeft, blockRight]` with that line, expressed in *x* coordinates from
  layout, then converted to text positions. The rectangle is defined in layout space, not by
  character counts.
- Typing into a block selection replaces the block on **every** line and pads shorter lines with
  spaces so that the replacement begins at the same x on each line (Word's behaviour). This is one
  undo entry (I2).
- Delete/Backspace over a block selection deletes the rectangle per line, preserving the rest of
  each line.
- Applying character formatting to a block selection applies it to the per-line rectangles only.
- Copy of a block selection produces text with one line per visual row in the block; pasting a block
  selection into a block selection distributes lines across rows.
- A block selection may not cross a paragraph boundary in table-cell content (it clamps to the cell).

**Edge cases**
- A block selection inside a table clamps to the cell rectangle and may be upgraded to a cell
  selection when it covers a full cell.
- A block selection must survive layout invalidation only if the invalidation did not re-flow the
  affected lines; otherwise it is converted to the equivalent linear selection.

---

#### ED-006 — Select All escalation (Ctrl+A)
**Priority:** core · **Effort:** S

**Commands:** `edit.selectAll()`, `edit.selectAllEscalated()` · **Events:** `selection.changed`
**OOXML:** none.

**Behaviour**
- Escalation ladder (Word): caret in a table cell → Ctrl+A selects the cell's contents; Ctrl+A again
  selects the whole table; Ctrl+A again selects the story body. Caret in a text box → Ctrl+A selects
  the text box contents, again selects the story. Caret in the body → Ctrl+A selects the body.
- Ctrl+A never selects into headers/footers, footnotes, comments or other stories: those stories are
  edited in their own context. `edit.selectAll` must be explicit about the story.
- In a story that contains only an empty paragraph, Ctrl+A selects that paragraph (not an empty
  range) and the selected range includes the paragraph mark.
- Ctrl+A on a document with a selection already covering the story is a no-op (I4).

**Edge cases**
- If the caret is inside a content control that is itself inside a table cell, the ladder is:
  control contents → cell contents → table → body.
- `edit.selectAll` used as a command target for formatting must apply to every paragraph of the
  story, including paragraphs inside tables and nested tables, but must skip paragraphs whose
  effective `w:lock`/protection state forbids editing (ED-038) and must not silently partially apply
  without reporting `affectedRanges`.

---

#### ED-007 — Object selection and manipulation gestures
**Priority:** core · **Effort:** M · **Depends:** 02 (object geometry)

**Commands:** `object.select(ref, { multi })`, `object.moveBy(dx, dy)`, `object.resize(handle, dx, dy)`,
`object.rotate(angleDeg)`, `object.setWrap(mode)`, `object.delete()` · **Events:**
`object.selectionChanged`, `document.changed`
**OOXML:** `w:drawing/wp:anchor` (floating) or `w:drawing/wp:inline` (inline): `wp:positionH`,
`wp:positionV` (`wp:posOffset` in EMU, or `wp:align`), `wp:extent cx/cy` (EMU), `wp:effectExtent`,
`wp:wrapNone|wrapSquare|wrapTight|wrapThrough|wrapTopAndBottom`, `wp:docPr/@id`, `@name`,
`wp:cNvGraphicFramePr`, and `a:xfrm/@rot` for rotation. Tables selected as objects use the table
spec's properties.

**Behaviour**
- Clicking an inline object selects it as a unit; the caret moves to before/after it. Arrow keys at
  the boundary of an inline object move **across** it (one press selects it, as Word does for
  an inline shape; a second press crosses it) — the object is a single step in linear navigation.
- Floating objects (anchored) are selected by clicking them; a selected floating object shows 8
  resize handles, a rotation handle and an anchor glyph at its anchor paragraph.
- **A single manipulation gesture is exactly one undo entry (I2, ED-025):** one drag-move (including
  its live preview), one resize drag, one rotation, one wrap-mode change, one nudge command.
  During a drag the object's live position is *transient* — no command is issued, no event is
  emitted, and no undo entry is created until pointer-up, which issues one `object.moveBy` command
  with the total delta. Keyboard nudges (arrow with an object selected) are separate commands and
  coalesce like typing (ED-024) while held.
- Arrow keys with an object selected move it by 1 px at 100 % zoom; Ctrl+arrow by 10 px; Shift+arrow
  resizes; the nudge step is expressed in EMU so it is zoom-independent.
- Position is written as `wp:posOffset` when the object was drag-positioned and `wp:align` when it
  was placed relative to a margin/column/page anchor; moving an object that used `wp:align` switches
  it to `wp:posOffset` and records the change in one undo entry.
- Deleting a floating object leaves its anchor paragraph intact; if that paragraph becomes empty it
  is **not** deleted automatically.
- Multi-select (Ctrl+click, or a marquee drag) is supported for floating objects: move/delete/align
  apply to all selected objects as one gesture and one undo entry; resize and rotate are disabled
  for a multi-selection.

**Edge cases**
- Resizing an inline object must preserve the aspect ratio unless Shift is held (Word: Shift
  constrains the ratio; the handles default to free resize) — the exact default is a host setting,
  the library default is constrained for corners.
- An object whose anchor is in a protected range may be selected but not moved (ED-038).
- Image resize must be written to `wp:extent` only; the intrinsic pixel size and DPI in
  `wp:docPr`/`a:blip` must be preserved so re-loading does not change the displayed size.

---

### 2.2 Keyboard navigation

#### ED-008 — Character and visual-line navigation (Left/Right/Up/Down, goal column)
**Priority:** core · **Effort:** M · **Depends:** 02 (line boxes)

**Commands:** `selection.moveLeft/Right/Up/Down({ extend, byWord, byParagraph, byPage })`
**Events:** `selection.changed`
**OOXML:** none.

**Behaviour**
- Left/Right move one **grapheme cluster** (not one UTF-16 code unit) and never cross a paragraph
  boundary into a different story. Right at the end of a paragraph moves to the start of the next
  paragraph (including into the next table cell in document order); Left at the start moves to the
  end of the previous paragraph.
- **Collapsing rule (Word):** pressing a non-extending Left/Up collapses a non-empty selection to the
  *start* of the selection (the anchor if the selection is forward, the focus if reversed); Right/Down
  collapse to the *end*. The collapse happens on the first press; the second press moves.
- Up/Down move by **visual line** within the paragraph, then to the adjacent visual line of the next
  or previous paragraph when the caret leaves the paragraph. Up on the first line of a paragraph
  moves to the last line of the previous paragraph (crossing a table boundary in document order).
- **Goal column.** Up/Down remember the caret's x-position in *layout space* within a run of
  consecutive Up/Down presses. The remembered x must be preserved across short lines and across
  paragraph boundaries (Word's "virtual x"), and reset by any other command, by a click, or after a
  timeout (default 0, i.e. reset immediately on non-vertical movement; a non-zero timeout is
  configurable for Word-like "sticky x").
- Up/Down move by *visual* line, so a wrapped paragraph is traversed correctly; End-of-line positions
  produce `upstream` affinity so that a Down from the end of a wrapped line lands at the end of the
  next visual line rather than the start of the following one.
- Navigation must be O(1) amortised per press: the layout engine exposes a bidirectional line
  iterator, and navigation must not re-measure the document.

**Edge cases**
- A visual line whose height changes because of a large inline object: the goal x is preserved, the
  goal *y* is not.
- Up/Down inside a table cell must not leave the cell when the cell has more content; when the caret
  is on the first line of the first paragraph of a cell, Up moves into the previous cell's last
  paragraph; on the first cell of a row, Up moves to the previous row's corresponding cell.
- Hidden text collapsed by `view.showHiddenText: false` must be skipped by Left/Right (it is not in
  the rendered text); when shown, it is navigable and moves the caret through it.
- Navigation while composing (ED-016) commits the composition before moving.

---

#### ED-009 — Word navigation (Ctrl+Left/Ctrl+Right, Word-exact)
**Priority:** core · **Effort:** M

**Commands:** `selection.moveWordLeft/Right({ extend })` · **Events:** `selection.changed`
**OOXML:** none.

**Behaviour**
- The word model is a **two-class segmentation** shared with ED-004 (`word` unit) and with
  Ctrl+Backspace/Ctrl+Delete (ED-014):
  - *Word characters*: Unicode categories `L*`, `M*`, `N*`, plus U+0027 `'`, U+2019 `’`, U+00AD,
    U+005F `_`, and U+002D `-` **when flanked by word characters on both sides** ("well-known" is one
    word, "well - known" is three).
  - A decimal point is a word character when both neighbours are digits ("3.5", "1.200,50" → "200" is
    its own word because the comma is not a word character; "3.5" is one word).
  - Everything else is a *separator* (spaces, punctuation, symbols, tabs, breaks, object
    placeholders).
- **Ctrl+Right** from position `p`:
  1. If `p` is inside a word group, advance to the end of that group.
  2. Advance past the following separator run.
  3. The caret stops at the **first character of the next word group**.
  4. If no word group follows in the paragraph, the caret moves to the paragraph end (after the
     mark); a further Ctrl+Right moves to the first word group of the next paragraph. Word
     navigation crosses paragraph and table-cell boundaries in document order.
  Consequences to test: from the start of "hello world", Ctrl+Right lands immediately before `w`, so
  Ctrl+Shift+Right selects `"hello "` **including the trailing space** — this is Word's trailing-space
  convention and is produced by step 2+3, not by a special case.
- **Ctrl+Left** is the mirror, with one asymmetry that must be preserved: it stops at the **first
  character of the current word group**; if the caret is already there, it moves to the first
  character of the previous word group (skipping the separator run between them). It does **not**
  stop inside the separator run.
- With Shift, the selection is `[anchor, destination]` using the same rule, so the trailing separator
  is included when extending right and excluded when extending left.
- Holding Ctrl+Shift+Arrow extends repeatedly by whole groups; each press is one `selection.changed`
  event, not an undo entry.
- Alt+Ctrl+Left/Right? Not defined by Word for text; the library must **not** bind Alt+Ctrl+arrows to
  navigation (they are reserved for host shortcuts).

**Edge cases**
- "e.g." with Ctrl+Right from the start: stops before `e`(2) i.e. after `"e."` — three presses cross
  `e`, `g`, and the word after. Deterministic under the two-class model; the exact stop count for
  multi-punctuation runs is fixed by the rules above and must be covered by tests, not left to the
  platform segmenter (`Intl.Segmenter` must **not** be used directly for this: its word model differs
  from Word's).
- Navigation over a tab character: the tab is a separator run; Ctrl+Right from before a tab lands at
  the next word after the tab.
- Navigation must skip a deleted revision's content when `view.showRevisions: 'final'` and include it
  when `'original'` (04 owns revisions; this spec owns the navigation contract).

---

#### ED-010 — Line and document edge navigation (Home/End, Ctrl+Home/Ctrl+End)
**Priority:** core · **Effort:** S

**Commands:** `selection.moveLineStart/LineEnd({ extend })`,
`selection.moveStoryStart/StoryEnd({ extend })` · **Events:** `selection.changed`
**OOXML:** none.

**Behaviour**
- **Home** moves to the start of the **visual line** (the position after the previous soft break),
  not the paragraph start. **End** moves to the end of the visual line (before the next soft break),
  or to the paragraph end on the last line.
- Pressing Home when the caret is already at the line start does not jump to the paragraph start
  (Word behaviour: repeated Home is idempotent). Same for End.
- **Ctrl+Home / Ctrl+End** move to the start / end of the **current story**, not the whole document.
  In a header, Ctrl+Home goes to the start of the header; in a footnote, to the start of the
  footnote's text (not its reference mark); in a comment, to the start of the comment text.
- Ctrl+End places the caret at the end of the story's last paragraph (after its last character,
  before the paragraph mark) — not after the mark.
- Shift variants extend: Shift+Home, Shift+End, Ctrl+Shift+Home, Ctrl+Shift+End. Ctrl+Shift+End from
  the document start must select the whole body including the final paragraph mark.
- Home/End honour the collapsing rule of ED-008 (Home collapses to the selection start, End to the
  selection end) before moving.
- Home/End must scroll the viewport the minimum amount when the target line is off-screen.

**Edge cases**
- On a line that begins with a tab, Home goes before the tab, not to the first tab stop.
- In a right-to-left paragraph (`w:bidi`), Home/End are logical, not visual: Home = the logical
  line start (which renders on the right). Visual-direction key mapping is governed by
  `w:bidi`/`w:rtl` and must not be hardcoded to LTR.
- Ctrl+End in a story whose last element is a table places the caret in the table's last cell's last
  paragraph, and not in the paragraph after the table unless one exists.

---

#### ED-011 — Paragraph, page, and history navigation (Ctrl+Up/Down, Page Up/Down, Go Back)
**Priority:** core · **Effort:** M

**Commands:** `selection.moveParagraphStart(-1|+1, { extend })`,
`selection.movePage(-1|+1, { extend })`, `view.goBack()` · **Events:** `selection.changed`
**OOXML:** none.

**Behaviour**
- **Ctrl+Up** moves to the start of the current paragraph; if the caret is already there, to the
  start of the previous paragraph. **Ctrl+Down** moves to the start of the next paragraph (Word's
  rule: always the next paragraph start, not the current paragraph end).
- Ctrl+Up at the first paragraph of a story stays put; Ctrl+Down at the last paragraph moves to the
  start of the last paragraph's *next* position only if one exists, otherwise stays.
- **Page Up/Page Down** scroll by one viewport height minus one line of overlap, and place the caret
  on the resulting line at the **goal column** (the caret's x before the move), clamped to the line
  length. In paginated view, the movement is by page/viewport with the same goal-column rule.
- Shift+Page Up/Down extends; Ctrl+Shift+Page Up/Down? Not bound (reserved for host).
- **Go Back** (`Shift+F5` and `Ctrl+Alt+Z`): moves the caret to the previous edit position. The
  library keeps a per-document ring of the last 3 *edit* positions (positions where a mutation was
  committed, recorded at commit time, including the selection that was in force), and Go Back cycles
  through them; pressing it repeatedly cycles. Go Back is **not** an undo and never changes the
  document, never emits `document.changed`, and never creates an undo entry.
- Go Back must also restore the *scroll position* that was in force at that edit.
- Navigation history is reset on document load and is not persisted.

**Edge cases**
- Ctrl+Up inside a table cell: start of the current paragraph, then start of the previous paragraph
  in the same cell, then the last paragraph of the previous cell (document order).
- Page Down at the last page clamps to the story end.
- A Go Back target inside a deleted range clamps to the nearest surviving position.

---

#### ED-012 — Insertion pipeline: typing, Tab contexts, overwrite, formatting inheritance
**Priority:** core · **Effort:** L

**Commands:** `edit.insertText(text, { typing: true })`, `edit.insertTab()`, `edit.setOverwrite(on|off)`
**Events:** `document.changed`, `format.changed`
**OOXML:** `w:r`/`w:t` (`xml:space="preserve"` when the text has leading/trailing spaces),
`w:tab`, `w:noBreakHyphen`, `w:softHyphen`, `w:lastRenderedPageBreak` must never be written;
`w:rPr` inherited as below; `w:ins` when tracking is on (04).

**Behaviour**
- **Run merging.** Typing must append to the preceding run when the required `rPr` is byte-identical;
  otherwise a new `w:r` is created with the inherited `rPr`. The library must never create one run
  per character.
- **Formatting inheritance** for inserted text:
  1. With a collapsed caret: the `rPr` of the character at the caret resolved by affinity (ED-001).
  2. At the very start of a paragraph: the `rPr` of the paragraph mark (`w:pPr/w:rPr`).
  3. In an empty paragraph: the paragraph mark's `rPr`, else the character style's `rPr`, else the
     paragraph style's, else `docDefaults`.
  4. With a non-empty selection: the `rPr` of the **first character of the replaced range** (Word's
     "smart cut and paste" rule), then the selection is deleted and the text inserted.
  5. Immediately after an inline object or field: the `rPr` of the following run if any, else the
     preceding.
- **Tab** is context-sensitive:
  - Body paragraph, collapsed caret: insert a `w:tab` character.
  - Body paragraph with a selection: Word does nothing; the library must reject the command with
    `code: 'no-op-selection'` and emit `command.rejected` (configurable: hosts may map it to
    "increase indent", which the HR default profile does).
  - Table cell, collapsed caret: move to the next cell; from the last cell of the last row, create a
    new row (one undo entry, containing both the row insertion and the caret move) copying the
    previous row's `w:trPr`. Shift+Tab moves to the previous cell (no row creation at the start).
  - Table cell, non-empty cell selection (multi-cell): clear the selection contents and move to the
    next cell (one undo entry).
  - Inside a table cell, **Ctrl+Tab** inserts a literal `w:tab`; **Alt+Tab**, **Ctrl+Shift+Tab** are
    host shortcuts and must not be consumed.
  - List paragraph: Tab demotes one level (ilvl+1) without inserting a tab character; Shift+Tab
    promotes (FM-028).
  - Read-only or protected: Tab moves focus out of the editor (standard focus traversal).
- **Overwrite mode** (Insert key): typed characters replace the character at the caret; the mode is
  surface state, shown in the status bar, reset per session, and overwriting a selection behaves as
  a normal replace. Overwrite must never split a grapheme cluster or an inline object.
- Typing must be O(1) in document size: no re-measure of untouched paragraphs (see 1.7) and no
  re-serialisation of the OOXML tree on every keystroke (the model is mutated in place, serialised on
  demand).

**Edge cases**
- Typing a character that requires a font change (e.g. Cyrillic typed into a Latin run) must, per
  1.8, either keep `w:rFonts` unchanged (because `hAnsi` covers Cyrillic) or split the run when the
  keyboard language changes the proofing language (ED-018). It must not write `w:cs` properties.
- Typing inside a `w:sdt` with `w:lock w:val="sdtContentLocked"` is rejected (ED-038).
- Typing must never insert into `w:instrText`; if the caret is inside a field code (only reachable in
  "show field codes" mode) the command is rejected.
- Autocorrect may rewrite the just-typed text within the same undo entry (ED-019).

---

#### ED-013 — Paragraph split (Enter) and break insertion (Shift+Enter, page/column)
**Priority:** core · **Effort:** M

**Commands:** `edit.splitParagraph()`, `edit.insertLineBreak()`, `edit.insertPageBreak()`,
`edit.insertColumnBreak()` · **Events:** `document.changed`
**OOXML:** new `w:p` with copied `w:pPr`; `w:br` (`w:type="textWrapping"` default, `w:type="page"`,
`w:type="column"`, `w:type="lastRenderedPageBreak"` never written), `w:pPr/w:pageBreakBefore`,
`w:lastRenderedPageBreak` must be stripped on save (01).

**Behaviour**
- **Enter** splits the current paragraph at the caret into two `w:p` elements:
  - The first paragraph keeps the paragraph's `w:pPr`, its content up to the caret, and its
    `w:pPr/w:rPr` (the paragraph mark formatting).
  - The second paragraph receives a **copy of the first's `w:pPr`** with these modifications:
    `w:pageBreakBefore` and `w:keepNext` are **removed** from the new paragraph and remain on the
    first; `w:numPr` is retained so a list continues; `w:pStyle` is set to the style's `w:next`
    (`w:style/w:next`) if and only if the caret was at the **very end** of the paragraph (Word's
    rule), otherwise the same style is kept.
  - Direct conditional-formatting elements (`w:pPrChange`) are not copied (04).
  - The new paragraph's mark `rPr` is the copy of the original mark's `rPr`.
- Enter with a non-empty selection deletes the selection first, in the **same** undo entry.
- Enter inside a list item creates a new item at the same `ilvl`; Enter on an **empty** list item
  terminates the list: `w:numPr` is removed from the new paragraph and the left indent is reduced by
  one level's `w:ind` (FM-028), in the same undo entry.
- Enter inside a table cell adds a paragraph inside the cell and never exits the cell.
- Enter carries the caret to the start of the new paragraph, and the caret inherits the new
  paragraph's mark formatting (so subsequent typing matches).
- **Shift+Enter** inserts `w:br` (a manual line break) instead of a paragraph: no new paragraph, no
  style/`next` behaviour, `w:pPr` unchanged. A `w:br` must be deletable as a unit (ED-014) and
  displayed as `↲` when formatting marks are on (ED-037).
- **Ctrl+Enter** inserts a page break. Two encodings must be supported and preserved:
  a `w:br w:type="page"` run (what Word writes from Ctrl+Enter) and the paragraph property
  `w:pPr/w:pageBreakBefore`. The command writes `w:br w:type="page"` by default;
  `format.paragraph.pageBreakBefore` (FM-016) writes the property. Converting between the two is an
  explicit command (`edit.convertPageBreakEncoding`) with one undo entry.
- **Ctrl+Shift+Enter** inserts a column break (`w:br w:type="column"`); if the section has one column
  the command is a no-op with `command.rejected`.
- Section breaks are inserted as a separate command (`edit.insertSectionBreak`, owned by 01/02) and
  must not be reachable by accident from Enter.

**Edge cases**
- Enter at the end of the last paragraph of the body creates a paragraph that inherits the mark's
  formatting; the document always ends with a paragraph mark (01).
- Enter at the start of a paragraph with a character style applied: the character style must be
  preserved on the following text (the split copies the run containing the caret, splitting its
  `rPr` faithfully).
- Enter inside a content control whose `w:sdtPr` is block-level adds the paragraph **inside** the
  control; Enter at the end of the control's last paragraph stays inside (Word).
- Enter inside a `w:ins` when tracking is on must produce `w:ins`-wrapped paragraphs consistently for
  both halves (04).

---

#### ED-014 — Deletion: Backspace/Delete merge rules and word/line deletion
**Priority:** core · **Effort:** M

**Commands:** `edit.backspace()`, `edit.deleteForward()`, `edit.deleteWordBackward()`,
`edit.deleteWordForward()`, `edit.deleteSelection()` · **Events:** `document.changed`
**OOXML:** removal of `w:r`/`w:t` content; removal of `w:p` (paragraph merge) which also removes the
mark's `w:pPr/w:rPr`; removal of `w:br`, `w:tab`, `w:softHyphen`, `w:noBreakHyphen`, inline objects,
content-control boundaries; `w:del` when tracking (04).

**Behaviour**
- Backspace with a non-empty selection deletes the selection (one entry).
- **Paragraph merge (Backspace at offset 0 of a paragraph, or Delete at the end of a paragraph):**
  the paragraph mark is removed, the two paragraphs become one. The merged paragraph keeps the
  **first** paragraph's `w:pPr`; the second paragraph's runs keep their own `w:rPr`. A run in the
  second paragraph that has no explicit `rPr` takes the deleted mark's `rPr`, so that text which
  relied on the second paragraph's style/mark formatting does not silently change appearance beyond
  what the merge implies. (See §5 open item OI-3 for the exact Word parity of this reconciliation.)
- Backspace at the start of the first paragraph of the body, or Delete at the end of the last, is a
  no-op (`ok: false, code: 'document-boundary'`, no event, no undo entry).
- **Structural deletions, each one unit and one undo entry:**
  - Backspace immediately after a `w:tab` deletes the tab (not a single space).
  - Backspace immediately after `w:br` deletes the break; a page/column break deletes as one unit.
  - Backspace at the start of a paragraph immediately following a table deletes into the last cell
    of that table (Word behaviour) — the two blocks merge inside the cell.
  - Backspace at the start of the **first** paragraph of a table cell merges that cell's first
    paragraph with the previous cell's last paragraph — Word refuses across a cell boundary and
    instead deletes nothing; the library must follow Word and refuse, emitting `command.rejected`.
  - Backspace when the caret is at the very start of a content control and the control is empty
    deletes the whole control (one undo entry, `document.changed`).
  - Backspace when the caret is immediately after an inline object selects and deletes the object
    (first press selects, second deletes) — matching ED-007's two-step rule.
- **Ctrl+Backspace / Ctrl+Delete** delete to the previous / next word boundary using the ED-009 word
  model. Ctrl+Backspace must delete the separator run **and** the preceding word, matching Word
  (Ctrl+Backspace after "hello world|" deletes "world" and leaves "hello "). Ctrl+Delete deletes the
  next word and the separator run before it.
- Ctrl+Shift+Backspace is not bound by Word; the library must not bind it.
- Deleting a selection that ends at a paragraph mark deletes the mark, which merges the paragraphs
  (the selection's end position is respected literally).
- Deletion inside protected content is rejected before mutation (ED-038, I5).
- Coalescing: a contiguous run of deletions by the same author coalesces into one undo entry under
  the same rules as typing (ED-024).

**Edge cases**
- Backspace at the start of a footnote's first paragraph does nothing (no merge into the reference).
- Deleting the last remaining content of a table cell leaves one empty paragraph in the cell; a cell
  may not become empty of paragraphs.
- Backspace across a bookmark boundary must not orphan `w:bookmarkStart`/`w:bookmarkEnd`; the pair
  must be deleted together if the whole bookmark range is removed.
- Deleting text that is the result of a field must be rejected in "protect fields" mode and, when
  allowed, must convert the field to its literal result (the `w:fldChar` triple is unwrapped and the
  result runs are kept) rather than leaving a broken field.

---

#### ED-015 — Character input beyond typing: Insert Symbol, Alt+X, dead keys, combining marks, normalization
**Priority:** important · **Effort:** M

**Commands:** `edit.insertSymbol(codepoint, { font })`,
`edit.toggleUnicodeCodePoint()` (Alt+X), `edit.insertSpecial(kind)` ·
**Events:** `document.changed`
**OOXML:** plain `w:t` for a Unicode scalar; **elements** for the OOXML-native specials:
`w:noBreakHyphen` (Ctrl+Shift+-), `w:softHyphen` (Ctrl+-), `w:tab`, `w:br`;
`w:sym` for an inserted symbol that must render through a symbol font (Word inserts
`<w:sym w:font="Wingdings" w:char="F0E0"/>`, not a `w:t`).

**Behaviour**
- **Insert Symbol** dialog: Unicode subranges, a "recently used" list, and a Special Characters tab
  containing at minimum: non-breaking space, non-breaking hyphen, optional hyphen, em dash, en dash,
  ellipsis, copyright, registered, trademark, section, paragraph mark, degree.
  - Characters inserted from the symbol grid whose glyph is only reachable in a symbol font
    (Wingdings/Webdings/Symbol PUA) must be inserted as `w:sym` with `w:font` and `w:char`; ordinary
    Unicode characters must be inserted as `w:t` with the font applied to the run's `w:rFonts`.
  - The dialog must show the character's code point (`U+0219`) and its name where available, and must
    accept direct hex entry.
- **Alt+X** converts the hex code immediately before the caret into the character and back (Word):
  typing `0219` then Alt+X yields `ș`; Alt+X again on that character yields `0219` (uppercase hex,
  no `U+`). If no valid hex precedes the caret the command is rejected and nothing changes.
- **Dead keys** (Windows/`ro-RO` and `ru-RU` layouts, macOS option-key layouts): a dead key produces
  a combining mark that must be combined with the preceding base character, and the result
  **normalized to NFC**. The pipeline order is: composition → NFC → combine with the previous
  character if the platform delivered a standalone combining mark → insert.
- **Normalization policy:** all text *typed* or *pasted* into the document is normalized to NFC.
  Text *loaded* from a DOCX is preserved byte-for-byte (§5 open item OI-2 records this as a
  deliberate asymmetry so that a load-save round trip is lossless).
- Combining-mark editing: a base character plus combining marks form one grapheme cluster; Left/Right
  (ED-008) must move over the whole cluster, Backspace must delete the whole cluster, and the caret
  must never be drawn between the base and its mark.
- `edit.insertSpecial('nonBreakingSpace')` inserts U+00A0 as a `w:t` character (Word does the same);
  `'nonBreakingHyphen'` inserts `w:noBreakHyphen`; `'optionalHyphen'` inserts `w:softHyphen`. This
  asymmetry is deliberate and mirrors OOXML.

**Edge cases**
- Inserting a combining mark with no preceding base character inserts the mark alone (no error), and
  it forms a cluster with whatever precedes it after layout.
- Alt+X inside a field code must be rejected.
- `w:sym` characters must be excluded from spellcheck and from find/replace text (they are not
  Unicode text); copying them must round-trip as `w:sym` (ED-028).

---

#### ED-016 — IME composition
**Priority:** core · **Effort:** L

**Commands:** `edit.beginComposition()`, `edit.updateComposition(text, { cursor, segments })`,
`edit.commitComposition(finalText)`, `edit.cancelComposition()` ·
**Events:** `composition.changed`, `document.changed` (on commit only)
**OOXML:** on commit only: a normal text insertion per ED-012, with the run split at the boundaries
of a segment change when the IME marks a segment with different formatting.

**Behaviour**
- The composition is held in a **composition buffer** that is part of the editing surface, not the
  document: while composing, the document model must not contain the in-progress text, so that undo,
  events and serialisation never observe a half-composed state.
- Composition text is rendered as a *preview overlay* by the layout engine at the caret position,
  with the caret placed at the composition cursor within the preview. The preview must participate in
  hit testing (clicking elsewhere commits) and must be included in the caret-rectangle computation so
  the OS candidate window is positioned correctly.
- The candidate window is positioned from `getCaretRect()` of the composition cursor; the library
  must expose the rect and let the host position native UI, and must re-position on scroll, zoom,
  layout change, and window resize.
- On **compositionend**, the composed text is inserted as one undo entry (ED-024 must not coalesce it
  with the surrounding typing run).
- **Autocorrect (ED-019) must not run** on the intermediate text, and must run on the committed text
  only, in the same undo entry. Smart quotes (ED-021) must not fire on IME text.
- A composition started over a selection deletes the selection at commit time, in the same entry.
- `Esc` cancels the composition and restores the pre-composition text and selection; cancellation
  must not create an undo entry (I4).
- The composition must survive layout invalidation: an async re-layout triggered by another actor (a
  remote edit, a token refresh) must not cancel or relocate a live composition; the buffer is
  re-anchored to the same logical position.

**Edge cases**
- Composing across a run boundary: the committed text takes the `rPr` of the position where the
  composition began.
- Composing in a position where insertion is forbidden (protected content) must not start; the
  command is rejected and the IME is suppressed for that caret.
- Composition over a soft line break must re-flow as the preview grows (the preview is not part of
  the model, but the *rendered* lines must account for its advance width, or the caret will drift).
- Cyrillic IMEs (e.g. a phonetic Russian IME) commit multi-character strings; the whole commit is one
  run, one undo entry, one `document.changed`.

---

#### ED-017 — Romanian diacritics and legacy cedilla handling
**Priority:** core · **Effort:** M · **Depends:** ED-012, ED-015, ED-036

**Commands:** `edit.normalizeRomanianDiacritics({ scope })`,
`view.setRomanianDiacriticMode('standard'|'legacy-compat')`, `format.lang.set(lang)`
**Events:** `document.changed`, `settings.changed`
**OOXML:** the characters themselves in `w:t` (ș U+0219, ț U+021B, Ș U+0218, Ț U+021A vs the legacy
comma-less forms ş U+015F, ţ U+0163, Ş U+015E, Ţ U+0162); the language in `w:rPr/w:lang/@w:val`
(`ro-RO`); the legacy/standard choice is **not expressible in OOXML** and is stored in the library's
document-settings extension part, from which the proofing and typographic rules are selected.

**Behaviour**
- Romanian uses the comma-below forms ș/ț (U+0219/U+021B) as the standard. The **legacy** forms are
  the cedilla forms ş/ţ produced by old "Romanian (Legacy)" keyboard layouts and by some legacy
  documents. The library must never silently rewrite one into the other on load or on save.
- `edit.normalizeRomanianDiacritics` converts legacy forms to standard (and back with an option)
  across the requested scope (selection, story, document), and additionally normalizes the
  ambiguous `ă`/`â`/`î` composed-with-combining-mark forms to the precomposed characters
  (U+0103, U+00E2, U+00EE) via NFC. One undo entry for the whole document operation; the count of
  characters changed is reported in `document.changed` and emitted as a `romanian.normalized` event.
- **Case mapping**: uppercase of ș/ț is Ș/Ț. Commands that change case (FM-005) and case-insensitive
  find/collation (ED-032) must use locale-aware case mapping with `locale: 'ro'`.
- **Collation and search equivalence**: when the document contains legacy forms, find/replace,
  spellcheck and comparison must treat ş≡ș and ţ≡ț under an explicit `ignoreDiacriticLegacyForms`
  option (default: on for search, so that an HR manager searching "Ploiești" typed on a modern layout
  finds a legacy-encoded document; off for exact-match operations).
- **Proofing language**: Romanian runs carry `w:lang w:val="ro-RO"`. The "Romanian (Legacy)" proofing
  language is a Word concept with no OOXML encoding; the library's document-settings extension stores
  `romanianDiacriticMode` and the proofing layer uses `ro-RO` either way.
- **Diacritic-restore assist** (*important*): a command that takes a word typed without diacritics
  ("Ploiesti", "Bucuresti", "antreprenor" → "antreprenör" no) and offers the diacritic-correct form
  from a Romanian word list, applied to the current word or selection. This requires the tokenizer /
  dictionary module and is therefore *later*, but the command id and event must be reserved now so
  the host UI can be built once.
- Importing text from an external source (ED-029, ED-030) must classify the document's diacritic
  encoding and surface a single, dismissible notice when legacy forms are detected ("This document
  uses old-style Romanian diacritics. Convert?"), which invokes
  `edit.normalizeRomanianDiacritics`.

**Edge cases**
- The characters ș/ț must not be decomposed by NFC (they have no canonical decomposition); a
  "normalize" operation must not alter them beyond the legacy-to-standard replacement.
- A document mixing both encodings must be handled per-run, not per-document.
- Font coverage: some display fonts lack U+0219/U+021B while containing U+015F/U+0163. When a run's
  font lacks the standard form, the layout engine falls back per character (1.8 rule 5, FM-025) and
  the editor must not rewrite the character to make it render.

---

#### ED-018 — Russian/Cyrillic input and script switching
**Priority:** core · **Effort:** M

**Commands:** `edit.insertText(text)` (script-switch aware), `format.lang.set(lang, script?)`
**Events:** `document.changed`, `format.changed`
**OOXML:** `w:rPr/w:lang/@w:val` (Cyrillic uses the Latin-script language slot — **not** `w:cs`;
see 1.8), `w:rFonts/@w:ascii`, `@w:hAnsi`, `@w:hint`; a Cyrillic-specific theme font via
`a:fontScheme/a:majorFont/a:font[@script="Cyrl"]` (FM-025).

**Behaviour**
- Typing Cyrillic must not write `w:cs`, `w:szCs`, `w:bCs` or `w:iCs`. Applying bold to Cyrillic text
  must write `w:b`; the "Complex Scripts" fields in the Font dialog (FM-002) are for Arabic/Hebrew
  and must be hidden for a document whose only non-Latin script is Cyrillic (a host setting;
  default hidden).
- **Script-switch run splitting**: when the keyboard language/script changes while typing (Latin →
  Cyrillic or back), the library must start a new run whose `w:lang/@w:val` is the keyboard language
  and whose `w:rFonts` keeps `ascii`/`hAnsi` (a Cyrillic-capable font is chosen by fallback if the
  current run's font lacks coverage). It must not split when the script does not change (typing a
  Romanian `ș` inside a Russian run stays in the same run if the run's `w:lang` is `ro-RO`).
- **ё handling.** Russian documents frequently drop the diaeresis. Find/replace, proofing and
  comparison must support an explicit `treatYoAsYe` option (default **off** for exact-match
  operations, **on** for find/replace and spellcheck), so searching "все" also finds "всё" and vice
  versa when enabled. Case mapping: ё↔Ё, and `toUpperCase` must use `locale: 'ru'` (the Russian
  "two-dot i" and the locale-specific capitalisation rules must come from the locale, not from a
  hand-written table).
- **Russian typography** (rules owned by ED-021, listed here because they are language-specific):
  - Quotes: «…» outer, „…" inner. The conversion is driven by the run's `w:lang`, not by the UI
    locale.
  - Dashes: an em dash `—` with spaces on both sides; a numeral range (1-5, 1990-2000) uses an en
    dash or hyphen per the configured rule.
  - A non-breaking space must be insertable before a dash and after short (one- and two-letter)
    prepositions and conjunctions (в, и, с, к, о, а, у, на, по, из, от, до) — this is offered as an
    opt-in typography rule (`typography.ru.noBreakAfterShortWords`), priority *later*, because it
    requires word lists and can surprise users.
- Spellcheck (ED-036) for `ru-RU` must use a Russian dictionary and hyphenation (FM-016) must use a
  Russian hyphenation dictionary; both are data dependencies (see §5 open item OI-5).
- Mixed Romanian/Russian documents (a real HR case: a Romanian contract with a Russian annex) must
  work: proofing language is per-run, quotes are per-run, hyphenation is per-paragraph-language, and
  the UI language is independent of both.

**Edge cases**
- Pasting Russian text (ED-028/ED-029) must not strip `w:lang` unless the paste option says so.
- A run containing both Latin and Cyrillic must be split at the script boundary by an explicit
  normalisation command (`edit.splitRunsByScript()`), *not* automatically on load, so a round trip of
  a Word-authored file is unchanged.
- Uppercase conversion of a Cyrillic run must not change `w:rFonts`.

---

### 2.3 Autocorrect, autoformat, typography

#### ED-019 — Autocorrect
**Priority:** important · **Effort:** L

**Commands:** `autocorrect.setRules(rules)`, `autocorrect.addRule(from, to, { plainText })`,
`autocorrect.removeRule(id)`, `autocorrect.setExceptions(list)`,
`autocorrect.apply()` · **Events:** `autocorrect.applied`, `document.changed`
**OOXML:** the corrected text in `w:t`; a correction that produces a symbol writes `w:sym` (ED-015);
a correction that produces formatted text (e.g. `(c)` → ©) may set `w:rPr` on the inserted run.

**Behaviour**
- **Trigger**: a rule fires when the typed text ends with a match at a word boundary. The boundary is
  a space, tab, break, paragraph mark, or a punctuation character that is not part of the word
  (per ED-009's model), and the match must begin at a word start or after a non-word character.
- **Scope of the rewrite**: only text typed since the last caret relocation may be replaced, so an
  autocorrection can never rewrite pre-existing document text. If the matched text straddles a run
  boundary, the correction replaces across runs and adopts the first run's `rPr`.
- **Undo**: the correction and the triggering typing must be one undo entry: undo restores both the
  typed text and removes the correction (Word's behaviour for the "undo the autocorrection only"
  path — pressing Ctrl+Z once after a correction must undo the correction only, restoring the typed
  text, and a second Ctrl+Z undoes the typing run; the library implements this by making the
  correction a *sub-entry* of the typing entry, and `history.undo` pops the sub-entry first).
- **Exceptions**: a per-rule exception list and a global "do not correct this word" list; an
  exception applies to the matched word, with the matched case preserved. Exceptions are matched
  case-insensitively but only when the rule is case-insensitive.
- **Rule sets shipped**: a built-in base set (the common `(c)`, `(r)`, `(tm)`, `-->`, `<--`, `:-)`,
  `:-(`, `;-)`, `...` — note that `...` conflicts with smart ellipsis, see below), a Romanian set
  (the common word corrections: "esut"? the plan is: common misspellings from the RO dictionary
  project, `atit`→`atât`, `aint`→`ain't` no — the RO set is: common diacritic-missing words handled
  by ED-017 instead, plus `neserios`→`neserios`; the concrete set is a data file, see OI-5), and a
  Russian set (ё restoration on words where ё is mandatory, plus common typos, driven by a data file).
- **Conflict resolution**: only one correction per typed character; the order is
  (1) capitalisation rules (ED-021), (2) smart typography (ED-021), (3) autocorrect text rules,
  (4) AutoFormat (ED-020). A correction must never re-trigger another rule on its own output
  (no cascading), which is enforced by marking the inserted text as rule-produced.
- **Never fire in**: a field code (`w:instrText`), a protected/locked range, a content control with
  `w:lock`, an active IME composition (ED-016), a block/column selection, or when
  `autocorrect.enabled` is false. It *does* fire in comments, footnotes and text boxes.
- The applied correction emits `autocorrect.applied (ruleId, before, after, range)` so the host can
  offer "undo autocorrect" in a context menu.
- Rule storage: a shared application-level set and a document-level set, merged at runtime. The
  DOCX format has no place for these, so the document-level set is stored in the library's
  settings extension part; on export to a plain DOCX the rules are dropped (documented).

**Edge cases**
- A correction at the end of the document must not create a new paragraph.
- Correcting text inside a tracked insertion must produce a tracked replacement (04).
- A correction that would delete a bookmark or content-control boundary must be suppressed.
- Multi-character rules must match the longest first (`-->` before `->`).

---

#### ED-020 — AutoFormat As You Type
**Priority:** important · **Effort:** L

**Commands:** `autoformat.setOptions(options)`, `autoformat.applyAtCaret()` ·
**Events:** `document.changed`, `styles.changed`, `numbering.changed`
**OOXML:** paragraph borders `w:pPr/w:pBdr`; list creation `w:pPr/w:numPr` plus new
`w:abstractNum`/`w:num` in `numbering.xml`; hyperlinks `w:hyperlink` with a relationship; bold/italic
`w:rPr/w:b`, `w:i`; superscript `w:rPr/w:vertAlign w:val="superscript"`; fractions via
`w:rPr` + `w:t` reconstruction; indentation `w:pPr/w:ind`.

**Behaviour**
- Options (all individually switchable, all default on except where noted, matching Word's
  AutoFormat As You Type tab):
  1. **Straight quotes with smart quotes** → ED-021.
  2. **Ordinals (1st) with superscript** → typing `1st` followed by a boundary rewrites to `1` +
     `st` with `w:vertAlign="superscript"`.
  3. **Fractions (1/2) with fraction character** → `1/2` → `½`, `1/4` → `¼`, `3/4` → `¾` (and the
     RO/RU equivalents where the glyph exists). Only these three, matching Word.
  4. **Hyphens (--) with dash (—)** and **Hyphens (-) with en dash (–)** per ED-021.
  5. **Bold and italic with real formatting**: `*text*` → bold, `_text_` → italic, applied to the
     matched span; must not fire inside a word (`a*b*c` is left alone) and must not fire inside a
     formula or a field.
  6. **Internet and network paths with hyperlinks** → a URL/email typed and terminated by a boundary
     becomes `w:hyperlink` with an external relationship (`r:id`); this requires the host's link
     policy (a token/data-bound document may forbid link creation) and is therefore gated by
     `autoformat.linkPolicy`.
  7. **Automatic bulleted lists** → typing `*`, `-`, `•`, or `o` followed by a space at a paragraph
     start converts the paragraph to a bullet list at level 1 (creating the abstract numbering
     definition on demand, FM-032).
  8. **Automatic numbered lists** → typing `1.`, `1)`, `(1)`, `a.`, `i.`, or `I.` followed by a space
     converts the paragraph to a numbered list with the matching `w:numFmt`, and continues the
     previous list's numbering when the paragraph above is a list of the same format, else starts
     at 1.
  9. **Border lines** → a paragraph consisting only of `---`, `===`, `___`, `***`, `~~~`, `###`
     followed by Enter converts the paragraph to one with `w:pBdr` (single/double/thick/thin/dotted,
     bottom only) and removes the typed characters; the mapping table must be documented
     (`---` → single 0.5 pt, `===` → double, `___` → single 1.5 pt thick, `***` → dotted,
     `~~~` → wavy, `###` → dashed).
 10. **Format beginning of list item like the one before it** — a new list item inherits the
     previous item's character formatting **up to the first run break** (Word applies the previous
     item's leading formatting to the item's first word only).
 11. **Set left- and first-indent with tabs and backspaces** — Tab at the start of a paragraph with
     no tab stop sets `w:ind/@w:firstLine`, Shift+Tab sets a negative first-line/hanging indent by
     a fixed step (720 twips = 0.5 in).
 12. **Define styles based on your formatting** — when a paragraph is formatted directly and the
     same combination repeats, Word offers to create a style; the library must **not** do this
     silently: it emits `style.suggestion` and the host decides.
- AutoFormat follows the same undo, exception and "never in a field/protected range" rules as
  ED-019, and the whole conversion (text rewrite + property writes + numbering creation) is **one**
  undo entry; undoing a list creation must also remove the `w:num`/`w:abstractNum` created for it if
  no other paragraph references it.
- `autoformat.applyAtCaret()` runs the same rules on demand over the current paragraph.

**Edge cases**
- The border-line rule must not fire inside a table cell's last paragraph if it would convert to a
  border on the cell's paragraph instead of the table (Word converts the *paragraph*; the library
  does the same and documents it).
- A numbered-list conversion inside a content control must stay inside the control.
- The list-continuation rule must respect `w:lvlRestart` and must not continue a list whose
  `w:numFmt` differs.

---

#### ED-021 — Smart typography: quotes, dashes, ellipsis, capitalization correction
**Priority:** core · **Effort:** M

**Commands:** `typography.applyAtCaret()`, `typography.setOptions(options)`,
`format.changeCase(mode)` (see FM-005) · **Events:** `document.changed`
**OOXML:** the characters in `w:t` (U+201E, U+201C, U+201D, U+00AB, U+00BB, U+2013, U+2014, U+2026,
U+2019); `w:rPr/w:vanish` never; `w:rPr/w:caps`, `w:smallCaps` for case commands (FM-005).

**Behaviour**
- **Quotes** are chosen by the run's effective `w:lang` (1.8), not by the UI locale:

  | Language | Primary pair | Nested pair |
  | --- | --- | --- |
  | `ro-RO` | „ (U+201E) … " (U+201D) | « (U+00AB) … » (U+00BB) |
  | `ru-RU` | « (U+00AB) … » (U+00BB) | „ (U+201E) … " (U+201C) |
  | `en-US`, other | " (U+201C) … " (U+201D) | ' (U+2018) … ' (U+2019) |

  Opening vs closing is decided by context: a quote preceded by whitespace, an opening bracket or
  the paragraph start is an opening quote; a quote preceded by a word character is a closing quote.
  Nesting depth is tracked per paragraph so the second-level pair is used inside a first-level pair.
- Apostrophes are converted to U+2019 only inside a word ("don't", "Serghei's") and never as the
  first character of a word.
- **Dashes**: `--` between words → em dash. Spacing follows the language rule: Russian and Romanian
  use `word — word` (spaces around); English uses `word—word` (no spaces) as a Word option. `-`
  between digits → en dash. `--` when both neighbours are digits → en dash.
- **Ellipsis**: `...` → U+2026, and `....` → `.` + U+2026 (Word's rule).
- **Capitalisation correction** (all individually switchable):
  - Capitalise the first letter of a sentence (after `.`, `!`, `?`, `…`, a paragraph start, and after
    a field result at the start of a paragraph).
  - "Correct TWo INitial CApitals": an initial two capitals followed by a lowercase letter becomes
    `Xx` (`HEllo` → `Hello`).
  - Capitalise names of days and months in RO (luni, marți, …) and RU (понедельник, …) when typed
    lowercase — the RO rule must respect that Romanian does **not** capitalise month names in normal
    prose; the library's default is therefore **off** for month/day capitalisation in `ro-RO` and
    **on** for `ru-RU` (where it is wrong to lowercase them at the start of a sentence only). The
    default is a documented decision, host-overridable.
  - "Correct accidental use of cAPS LOCK": if the first two typed characters are uppercase and the
    remainder lowercase, invert the case of the whole word.
- All corrections obey ED-019's trigger, scope, undo and never-fire rules. The typography pass runs
  **before** the autocorrect rules so that a rule matching `"` sees the converted character.
- `typography.applyAtCaret()` and `typography.applyToRange(range)` run the same rules on demand
  (the range form must be safe to run on existing text and is one undo entry).

**Edge cases**
- Quotes inside a `w:instrText` field code are untouched (field code syntax uses straight quotes).
- A straight quote typed inside an existing smart-quoted span must be normalised consistently with
  the surrounding span (closing if it follows a word, opening if it precedes one).
- The cAPS LOCK rule must not fire on a two-letter acronym followed by lowercase in a language where
  that is valid (`AŞa`); it requires the word to be ≥ 4 characters.
- Corrections must not fire across a revision boundary (an insertion inside a deletion).

---

#### ED-022 — Token recognition triggers (tokenization module integration)
**Priority:** important · **Effort:** S · **Depends:** 05

**Commands:** `tokens.recognizeAt(position)`, `tokens.setTriggers(options)`;
**Events:** `tokens.recognized`, `document.changed`
**OOXML:** none by itself; a recognised token becomes a content control (`w:sdt`) or a run with the
token's `rPr`, per spec 05.

**Behaviour**
- Tokenization is an **optional module**; when it is not installed, every trigger in this feature is
  inert and no token-related command exists.
- The editing surface is responsible for *triggering* recognition, never for the token model:
  - After an insertion that ends at a token delimiter (configurable; default: `{{`, `}}`, `<<`,
    `>>`, `%%`, and a host-supplied delimiter set) with a debounce of 150 ms.
  - After a paste, per inserted paragraph.
  - After load, once per document (on the background queue).
  - Explicitly, via `tokens.recognizeAt`.
- Token recognition must never mutate text inside a field code, inside a `w:sdt` with
  `w:lock`/`w:tag` reserved by the token module, inside a comment's author field, or in a deleted
  revision.
- Recognition results are cached per paragraph revision id and invalidated by the paragraph's
  `document.changed` ranges.
- The token module may claim an undo entry only for explicit user commands (e.g. "insert token",
  "convert to token"); background recognition must be undo-transparent and must not create undo
  entries (I4).

**Edge cases**
- A half-typed token (`{{na|`) must not be reported as an error; only complete delimiters produce a
  recognition event.
- A token spanning a paragraph boundary is invalid and reported as `unclosed` rather than matched.

---

### 2.4 History

#### ED-023 — Undo/redo stack, bounds, save point, dirty flag, async and remote changes
**Priority:** core · **Effort:** XL · **Depends:** 01 (model), all mutating commands

**Commands:** `history.undo()`, `history.redo()`, `history.beginBatch(label)`,
`history.endBatch()`, `history.abortBatch()`, `history.clear()`, `history.markSavePoint()`
**Events:** `history.changed (canUndo, canRedo, depth, isDirty, label)`, `document.changed`
**OOXML:** none (in-memory).

**Behaviour**
- Every mutating command produces an **inverse operation** built at apply time. Inverses are
  *structural* (they reference stable node ids and carry the removed nodes/attributes verbatim), not
  textual diffs, so that undo restores `w:rsid`, `w:sdtPr`, unknown-extension XML and `w:pPr`
  ordering exactly. Commands whose inverse cannot be expressed structurally (a whole-document
  operation such as theme application or a large Replace All) may use a **compressed snapshot** of
  the affected parts as their inverse; the snapshot threshold and the affected-part set must be
  declared by the command.
- The stack is **per document**, not per view; two views of the same document share one history.
- `history.undo()` also restores: the selection in force after the command (ED-002), the scroll
  position of the story, the caret affinity, and the spelling/formatting decorations for the
  invalidated ranges (they are recomputed from the invalidation, not restored).
- **Redo** is cleared by any new mutating command (after the undo stack is truncated at the current
  position). Redo itself is redoable (undo of an undo).
- **Save point and dirty flag.** `history.markSavePoint()` records the current stack position. The
  document is dirty iff the current position differs from the save point. Undo back to the save point
  must clear the dirty flag (Word's behaviour). Saving must **not** clear the stack (an HR manager
  must be able to undo past a save).
- **Bounds.** Defaults: maximum 100 entries and a 32 MB inverse-payload budget per document,
  whichever is hit first (both configurable). On overflow, the oldest entries are dropped and
  `history.changed` is emitted; dropping entries must never drop part of a batch. Snapshot-based
  entries are dropped first when the memory budget is hit.
- **Batching.** `history.beginBatch` opens a compound entry: all commands applied inside are one undo
  entry (this is the mechanism behind I2). Nested batches are supported and the label of the outermost
  is the entry label shown in the host UI ("Move image"). An exception inside a batch must be handled
  by `history.abortBatch()`, which reverts everything applied since `beginBatch` without creating an
  entry. A batch left open by a thrown error must not corrupt the stack: the editor surface must
  close batches in a `finally`.
- **Async and remote changes.** A remote/collaborative change (from another user or a background
  job) is applied through the same model but is **not** pushed to the local history by default, so
  local undo must skip over it. Consequence: undoing a local command whose position was shifted by a
  remote change must be applied as an *operational transform* against the current document; when the
  transform is not possible (the target node was deleted remotely), the entry is dropped, a
  `history.entryDropped` event is emitted, and the undo continues with the next entry rather than
  failing silently.
- **Suspension.** `history.setSuspended(true)` is used for operations that must not be undoable
  (initial load, applying a server-side merge, the host's own programmatic bulk load). Suspension
  must be visible in `history.changed` so a host cannot accidentally leave it on.

**Edge cases**
- Undo of a command that created a `w:num`/`w:abstractNum` must remove them and re-point nothing
  (nothing else references them), and must restore `settings.xml`'s numbering counter if the command
  advanced it.
- Undo of the first command in a document (load) is impossible; `canUndo` is false.
- Undo while a composition is live (ED-016) commits the composition first.
- Undo while an object drag is in progress cancels the drag and then performs the undo.
- Undoing across a protection change must re-apply the protection state as it was *before* the undone
  command (protection state is part of the inverse payload).

---

#### ED-024 — Typing-run coalescing
**Priority:** core · **Effort:** M

**Commands:** (none; behaviour of `history` + `edit.*`) · **Events:** `history.changed`
**OOXML:** none.

**Behaviour**
- Consecutive text insertions by the same author merge into one undo entry until **any** of these
  breaks occur:
  1. a pending pause longer than `undo.typingPauseMs` (default 1000 ms) between keystrokes;
  2. a caret relocation that is not contiguous with the previous insertion (any click, any
     navigation command, any selection change that is not caused by the insertion itself);
  3. a non-typing command of any kind (formatting, paste, autocorrect-produced structural change);
  4. a deletion (deletions coalesce *separately* from typing, and mixing the two ends the run);
  5. a composition boundary (ED-016);
  6. the run reaching `undo.typingRunMaxChars` (default 200) or a single entry reaching
     `undo.typingRunMaxMs` (default 30 000 ms);
  7. a tracked-revision boundary (04);
  8. the paragraph changing (an Enter always ends the run).
- Deletions coalesce with the same rules into their own entries (consecutive Backspace presses are
  one entry), and `undo.typingRunMaxChars` applies to the number of deleted characters.
- The coalescing state must be resettable by the host (`history.breakTypingRun()`), which the editor
  surface calls on blur, on window focus loss and after a paste.
- Coalescing must be observable: `history.changed` must report the current entry's growth, so a host
  can display an accurate undo label.

**Edge cases**
- Typing at the end of an existing undo entry's range after undoing another entry must not merge into
  a stale entry.
- An autocorrect sub-entry (ED-019) is a child of the typing entry and must not break coalescing of
  the surrounding typing.
- Overwrite-mode typing (ED-012) coalesces as an overwrite run, not an insertion run, so undo does
  not restore text in the wrong order.

---

#### ED-025 — One undo entry per object-manipulation gesture
**Priority:** core · **Effort:** M · **Depends:** ED-007, ED-023

**Commands:** all `object.*`, `table.*` (structural), `style.*`, `theme.*`, `list.*`
**Events:** `history.changed`
**OOXML:** whatever the underlying command writes.

**Behaviour**
- A user gesture that manipulates an object is exactly one undo entry, regardless of how many
  model-level mutations it produces. The gesture set that must be covered, with the mutations they
  fold together:

  | Gesture | Mutations folded into one entry |
  | --- | --- |
  | Move an image (drag) | `wp:posOffset` x and y (or `wp:align` → `wp:posOffset` conversion) |
  | Resize an image (drag) | `wp:extent` cx, cy, `wp:effectExtent`, `a:ext` |
  | Rotate | `a:xfrm/@rot` |
  | Change wrap | `wp:wrap*` element replacement (+ `wp:positionV` if the anchor changes) |
  | Drag-and-drop text | source deletion + target insertion + paragraph/`w:br` normalisation |
  | Apply a style via the gallery | `w:pStyle`/`w:rStyle` for every paragraph/run in the selection, plus `w:pPr/w:rPr` of each paragraph mark |
  | Apply a theme | theme part + any `w:themeColor`-dependent rewrite + settings |
  | Modify a style ("OK" in the Modify Style dialog) | the style definition + all dependent styles' resolution (no document edits) — one entry |
  | Format painter application | one entry **per application** (per painted selection); painting a multi-range selection is one entry |
  | Scale a table column (drag) | `w:tblGrid/w:gridCol/@w:w` for the dragged column and the compensated neighbour |
  | Insert a table row via repeated Tab | one entry per row creation (later, group by gesture end) |
  | "Set Numbering Value" | `w:num/w:lvlOverride/w:startOverride` (+ a new `w:num` if none) |
- During a drag, no command and therefore no undo entry is created until pointer-up (ED-007). The
  preview is transient state owned by the surface.
- A gesture that is *aborted* (Esc during a drag, pointer capture lost) must leave the document
  untouched and create no entry.
- A gesture that spans a re-layout in the middle (async pagination) must still produce one entry:
  the batch is opened at gesture start and closed at gesture end, and the layout engine's own
  re-entrancy must not interleave another command inside the batch.
- The library must expose the batch as the *only* supported way to group: `history.beginBatch` is
  not for host use outside gestures; the host API offers `editor.withGesture(label, fn)`.

**Edge cases**
- Dragging an object and then pressing Ctrl+Z must restore the original position, extent and anchor
  in one step, and must restore the object selection (not the text caret).
- Two rapid gestures (drag, then drag again) must be two entries even if they complete within the
  typing-pause window (object gestures never coalesce).
- A gesture that ends with zero net change (drag back to the origin) must not create an entry (I4).

---

### 2.5 Clipboard and drag-and-drop

#### ED-026 — Copy and cut payload construction
**Priority:** core · **Effort:** M

**Commands:** `clipboard.copy({ format })`, `clipboard.cut()`, `clipboard.copyAsText()`
**Events:** `clipboard.copied (flavours)`, `document.changed` (cut only)
**OOXML:** the payload contains a serialised OOXML fragment (a standalone, well-formed sequence of
`w:p`/`w:tbl`/runs with a minimal `w:document` wrapper and a private identifier); cut is
`clipboard.copy` + `edit.deleteSelection` in one batch.

**Behaviour**
- Flavours written, in this order of preference for a consuming docier instance:
  1. `application/x-docier.fragment+json` — the internal representation: the OOXML fragment plus a
     document identity (`documentId`, `revision`), the source story, and the source's style/
     numbering/theme identifiers needed to preserve appearance.
  2. `application/vnd.openxmlformats-officedocument.wordprocessingml.document` — a full minimal DOCX
     (two parts: `word/document.xml` + `word/_rels`) for Word/ONLYOFFICE/LibreOffice consumers
     (*important*; the packaging is provided by spec 01).
  3. `text/html` — the HTML rendering with a `<meta name="Generator" content="docier">` marker and
     inline styles, so a docier instance pasting from an external app can recognise and adapt it.
  4. `application/rtf` (*later*).
  5. `text/plain` — the layout-flattened text.
- **text/plain construction rules** (they matter because the HR manager's *other* destination is a
  plain email or a spreadsheet):
  - paragraph marks → `\n`; `w:br` → `\n`; `w:tab` → `\t`;
  - `w:noBreakHyphen` → `-`; `w:softHyphen` → `` (nothing); U+00A0 → a plain space;
  - table: cells separated by `\t`, rows by `\n`, no border characters; a nested table's rows are
    flattened into the parent cell's line with `\t` separators and a warning is not raised;
  - fields → their **result** text; a field with no cached result → nothing;
  - content controls → their contents (never their placeholder);
  - inline objects → U+FFFC, and the object is dropped from the plain flavour;
  - footnote/endnote references → the note number in brackets, and the note text is appended at the
    end separated by a rule of `-` characters (Word does not do this; the library's default is to
    omit the note text and emit `clipboard.degraded { reason: 'footnote' }` — see OI-4);
  - smart quotes/typography characters are preserved (do not "downgrade" them to ASCII).
- **Paragraph-mark inclusion rule:** if the selection covers whole paragraphs, the copy includes the
  trailing paragraph mark of the last paragraph, and the pasted content creates new paragraphs. If
  the selection ends before the mark, the copy is inline and pasting inserts inline content into the
  current paragraph. This distinction is encoded explicitly in the internal flavour
  (`includesParagraphMark: true|false`) so a cross-document paste does not have to re-derive it.
- Copy of a content control is all-or-nothing: a selection that exactly covers the control copies the
  control (`w:sdt` with `w:sdtPr`); a selection that partially covers it copies the contents and
  emits `clipboard.degraded { reason: 'partial-sdt' }`.
- Cutting always copies first; if the clipboard write fails, the delete must not happen (atomicity).
- Copying a **table cell selection** produces a fragment whose root is the cell contents with a
  `cellCount` descriptor; pasting into a cell selection of a different shape distributes the rows and
  columns (ED-028).
- The payload must be validated on read as well as write: a hostile or malformed fragment must be
  rejected by a schema check before it reaches the model (ED-029).

**Edge cases**
- Copy with no selection is a no-op (`ok: false, code: 'empty-selection'`).
- Copy must include `w:bookmarkStart`/`w:bookmarkEnd` pairs only when both ends are inside the
  selection; a half-covered bookmark is dropped (with a `degraded` event).
- Copy of a floating object that overlaps the selection but is not anchored inside it must not be
  included (Word includes only inline content and objects whose anchor is in the range).
- Copy from a document with `w:documentProtection` in read-only mode is allowed; cut is rejected.

---

#### ED-027 — Paste pipeline: flavours, Paste Special, cross-document
**Priority:** core · **Effort:** XL · **Depends:** 01, ED-026

**Commands:** `clipboard.paste({ flavour, mode })`, `clipboard.pasteSpecial(flavour)`,
`clipboard.pasteWithoutFormatting()` · **Events:** `document.changed`, `clipboard.degraded`,
`styles.changed`, `numbering.changed`

**Behaviour**
- **Flavour negotiation order** (highest available wins): internal docier fragment → OOXML (DOCX)
  → HTML → RTF → plain text. A host may force a flavour with `pasteSpecial`.
- **Modes** (the Paste Options button after a paste, and the corresponding commands):
  - `keepSource` (default): the pasted content keeps its appearance exactly. Implementation: for
    internal and OOXML sources, the source's style definitions, numbering definitions and theme are
    *imported and renamed on collision* (a new `styleId` suffix), and each pasted `w:pStyle`/
    `w:rStyle` is re-pointed at the imported copy. This is the only mode that may grow
    `styles.xml`/`numbering.xml`.
  - `mergeFormatting`: the pasted runs adopt the **destination's** effective paragraph and character
    properties, except that the emphasis toggles present in the source (`w:b`, `w:i`, `w:u`,
    `w:strike`) are re-applied on top; lists, tables and objects keep their structure. This is
    Word's "Merge Formatting" semantics and must be implemented as a resolved-property diff, not as
    "strip everything".
  - `textOnly`: insert `text/plain` semantics: newlines become paragraphs, tabs become `w:tab`, and
    the inserted runs take the destination's formatting (ED-012 inheritance).
  - `mergeLists`: an additional option on any mode controlling whether the pasted list continues the
    destination list of the same `w:numFmt`/level structure or starts its own (FM-029).
- **Cross-document paste** (same library, different document instance, or a different revision of the
  same document) is the same pipeline: the source fragment identifies its origin so that a paste into
  the *same* document can reuse existing style and numbering identities by reference instead of
  importing copies. Pasting into the same document must never duplicate a style that already exists
  with the same `styleId` and identical definition.
- **Same-document paste** must additionally:
  - allocate a new `w:id` for every pasted `w:sdt` (ids must be unique in the document) and keep
    `w:tag`/`w:alias`;
  - rename duplicate bookmark names with a numeric suffix and update the paired
    `w:bookmarkStart`/`w:bookmarkEnd`, emitting `clipboard.degraded { reason: 'bookmark-renamed' }`
    and listing `REF` fields that now point at the old name;
  - create new relationships for `r:id`/`r:embed` references (hyperlinks, images, OLE), copying the
    media parts and deduplicating identical media by content hash;
  - allocate new `w:docPr/@id` values for pasted drawings (unique within the document);
  - strip `w:rsid` attributes from the pasted subtree and stamp the current `w:rsid` (01) so that
    revision attribution is correct.
- **Paste into a table cell** of a fragment containing a table inserts a **nested table** (Word),
  and pasting a cell/row selection into a cell selection maps rows/columns onto the destination
  rectangle, expanding it when the source is larger (new rows/columns are created) and truncating
  with a `degraded` event when the destination is protected.
- Pasting a whole-document selection into an empty document must replace the body (including
  `w:sectPr` handling: the destination keeps its own section properties; the source's are dropped
  with a `degraded` event, because section properties are not paste-able in Word either).
- Pasting into a list paragraph continues the destination list unless the source carries its own
  numbering identity (FM-029).
- Pasting a fragment that would place a block element (table, paragraph with `w:pBdr`?) inside a
  context that forbids it (e.g. a table cell's run-level position, a text box with
  `w:txbxContent` restrictions) must be normalised to the nearest legal structure, and the
  adjustment reported through `clipboard.degraded`.
- Paste is one undo entry **per paste operation**, no matter how many nodes it creates, and must not
  coalesce with the surrounding typing run.
- The `text/html` and `text/plain` flavours must be produced from the model at paste time, never
  round-tripped through the DOM.

**Edge cases**
- A paste that exceeds `paste.maxNodes` (default 20 000) must be chunked so the UI stays responsive,
  with progress events and a cancel that leaves the applied portion as one undo entry.
- A paste whose source document is in a language not installed for proofing must not change the
  proofing language of the destination (the pasted `w:lang` is preserved, per 1.8).
- Pasting while a selection spans multiple ranges (ED-002) pastes the payload once per range or,
  when the ranges are not structurally equivalent, collapses to the primary range and reports it.
- Pasting into protected content is rejected before any mutation (I5).

---

#### ED-028 — Clipboard round-trip fidelity: fields, content controls, bookmarks, comments, notes
**Priority:** core · **Effort:** L

**Commands:** `clipboard.copy`, `clipboard.paste` (behaviour); `document.queryFidelity(range)`
**Events:** `clipboard.degraded (reason, range, detail)`
**OOXML:** `w:fldSimple`, `w:fldChar`/`w:instrText`, `w:sdt`/`w:sdtPr`/`w:sdtContent`,
`w:bookmarkStart`/`w:bookmarkEnd`, `w:commentRangeStart`/`w:commentRangeEnd`/`w:commentReference`,
`w:footnoteReference`/`w:endnoteReference`, `w:hyperlink`.

**Behaviour**
- **Fields.** Both encodings must round-trip: simple (`w:fldSimple w:instr=" MERGEFIELD Name "`) and
  complex (the `w:fldChar` begin/separate/end triple with `w:instrText` code runs). A selection that
  covers a whole field copies the field; a selection that covers only the result copies the result
  text and drops the field, emitting `clipboard.degraded { reason: 'field-partial' }`. Fields whose
  code references an external entity (`REF bookmark`, `INCLUDETEXT`, `MERGEFIELD`) are copied
  verbatim; dangling references are not repaired (Word does not repair them either), but a
  `field.dangling` diagnostic is emitted for the host.
- **Content controls.** A copied `w:sdt` keeps `w:sdtPr` (type, `w:alias`, `w:tag`, `w:lock`,
  `w:placeholder`, `w:dataBinding`, `w:date`, `w:dropDownList`), gets a new `w:id`, and keeps its
  content. A `w:dataBinding` pointing at a custom XML part must be dropped when the destination
  document has no such part (`degraded { reason: 'dataBinding-dropped' }`) — silently keeping it
  produces a control that cannot refresh.
- **Bookmarks.** Copied as pairs; on collision the copy is renamed (`Name` → `Name_2`, then `_3`…),
  scanned against all existing names and the copy's own names. Renaming must be reflected in a
  `degraded` event so the host can warn that `REF` fields may break.
- **Comments.** A selection that covers a comment range copies the anchored range, and pasting
  within the same document re-creates the comment with a new `w:id` and the same author/initials/date
  (Word's behaviour for an in-document copy). Cross-document paste **drops** the comment bodies and
  keeps only the text, emitting `degraded { reason: 'comments-dropped' }`, because the comment parts
  and their relationships are document-scoped. The exact Word parity for the cross-document case is
  §5 open item OI-6.
- **Tracked revisions** (`w:ins`/`w:del`/`w:moveFrom`/`w:moveTo`, `w:rPrChange`, `w:pPrChange`) are
  copied verbatim and pasted as revisions attributed to the pasting author (04 owns the attribution
  rules). Pasted deletions (`w:del`) must be preserved so that accept/reject still works.
- **Footnotes/endnotes.** A copied reference creates a new note in the destination with a new id and
  the same content, and the reference is re-pointed; a note reference whose body is not included in
  the selection degrades to its number as plain text. Copying an entire note's text does **not**
  create a new note (Word's behaviour).
- **Hyperlinks.** `w:hyperlink` keeps `w:anchor` (internal) intact and re-creates the external
  relationship (`w:history`, `r:id` → a new relationship with `TargetMode="External"`).
- **Objects.** Images/`w:drawing`/`w:object`/`m:oMath` are copied with their parts and get new
  relationship ids and new `wp:docPr/@id`; a copied chart keeps its embedded workbook part.
- **Styles and numbering** references are always resolvable after paste: any `w:pStyle`/`w:rStyle`/
  `w:numId`/`w:tblStyle` in the fragment that cannot be resolved in the destination is either
  imported (in `keepSource` mode) or dropped to direct formatting (in the other modes), never left
  dangling.
- `document.queryFidelity(range)` is a read-only diagnostic that reports which constructs in a range
  are clipboard-safe, so a host can warn before a copy ("This selection contains a linked image that
  will be pasted as a picture").

**Edge cases**
- A `w:fldSimple` inside a `w:sdt` inside a table cell must round-trip through all three nesting
  levels.
- A content control whose `w:sdtPr` contains a `w15:repeatingSection` must be preserved; its
  `w15:repeatingSectionItem` children are independent items and must keep their relative order.
- Pasting a footnote reference with no matching note in the source (a corrupt file) must insert the
  number as text and report the corruption.

---

#### ED-029 — External HTML import (Word, Google Docs) and sanitization
**Priority:** important · **Effort:** L · **Depends:** ED-027

**Commands:** `clipboard.paste({ flavour: 'html' })` (behaviour); `paste.setHtmlPolicy(policy)`
**Events:** `clipboard.degraded`, `document.changed`
**OOXML:** produces `w:p`/`w:r`/`w:t`, `w:rPr` (`w:b`, `w:i`, `w:u`, `w:strike`, `w:vertAlign`,
`w:color`, `w:highlight`, `w:sz`, `w:rFonts`), `w:pPr` (`w:jc`, `w:ind`, `w:spacing`, `w:pStyle`),
`w:tbl`/`w:tr`/`w:tc` (`w:gridSpan`, `w:vMerge`, `w:tblGrid`), `w:hyperlink`, `w:drawing` for
images, `w:numPr` for `mso-list`-style lists.

**Behaviour**
- HTML paste support is **lossy by design and must say so**: every construct that cannot be mapped
  produces a `clipboard.degraded` entry with the source construct and the chosen fallback.
- Mapping rules that must be implemented:
  - Word's HTML uses `mso-*` CSS and `<o:p>`/`<!--[if gte mso 9]>` conditional comments: the
    conditional comment blocks (which carry the *real* Word markup) must be parsed, because that is
    where Word puts the paragraph properties and list information. Ignoring them is the single
    biggest cause of "pasted from Word and it looks wrong".
  - `mso-list:l0 level1 lfo1` plus `<ol>/<ul>` reconstructs `w:numPr` with a matching `w:numFmt`
    derived from the CSS `list-style-type` and the list's `@list` definition block in the `<style>`
    element.
  - `margin-left` / `text-indent` in `pt`/`in`/`px` convert to `w:ind` twips (1 pt = 20 twips,
    1 in = 1440, 1 px = 15 at 96 dpi but must use the declared DPI when present).
  - Google Docs uses `<b style="font-weight:normal">` wrappers, `font-size` in `pt`, and a
    table-based layout for some content; a `<b>`/`<i>`/`<u>` tag must set the corresponding toggle
    regardless of the accompanying style, and the `font-weight:normal` style must clear it.
  - `<span style="background:...">` → `w:highlight` when the colour is in the 16-colour highlight
    palette, otherwise `w:shd`.
  - `<sup>`/`<sub>` → `w:vertAlign`; `<s>`, `<strike>`, `text-decoration:line-through` → `w:strike`.
  - White-space handling per CSS `white-space`: consecutive spaces preserved as `xml:space="preserve"`.
  - `<br>` → `w:br`; `<div>`/`<p>` → `w:p`; `<table>` → `w:tbl` with a synthesised `w:tblGrid` from
    the first row's cell widths (a `w:tblGrid` is mandatory; its absence is the other big cause of
    broken pasted tables).
  - Images: `data:` URIs are decoded and embedded; remote `src` URLs are **not** fetched eagerly —
    the image is inserted as a link placeholder and resolved by the host's image policy
    (`paste.remoteImages: 'block' | 'placeholder' | 'fetch'`, default `'placeholder'`).
- **Sanitization** is mandatory and applies before any model mutation:
  - strip `<script>`, `<style>` beyond the imported rules, `<iframe>`, `<object>`, `<embed>`,
    `<link>`, `<meta>`, all `on*` attributes, `javascript:`/`vbscript:`/`data:text/html` URLs,
    and CSS `expression()`/`behavior:`/`url(javascript:...)`;
  - every `href` is passed through the host's URL policy and anything rejected becomes plain text
    with a `degraded` event;
  - the total node count and the nesting depth are bounded (`paste.maxNodes`, `paste.maxDepth`,
    defaults 20 000 and 100) and exceeding them truncates with a `degraded` event rather than
    hanging.
- The HTML parser must be a library-local, spec-conformant fragment parser (no `innerHTML` on the
  live document), must never execute script, and must run off the main thread when the payload
  exceeds `paste.parseOnWorkerBytes` (default 256 KB).

**Edge cases**
- A Word paste containing a nested table with vertically merged cells must reproduce the merges
  (`w:vMerge` with `w:val="restart"` on the first cell of the merge).
- A paste containing an ordered list restarting at a non-1 value (`<ol start="5">`) must produce
  `w:num/w:lvlOverride/w:startOverride`.
- A paste from a spreadsheet (a `<table>` with no widths at all) must produce a table whose columns
  divide the available width proportionally rather than a zero-width grid.

---

#### ED-030 — Images, embedded objects, and file paste
**Priority:** core · **Effort:** M · **Depends:** 01 (media parts)

**Commands:** `edit.insertImage(source, options)`, `edit.insertObject(file)`,
`edit.insertHyperlink(url, text?)` · **Events:** `document.changed`
**OOXML:** `w:drawing` with `wp:inline` (default) or `wp:anchor`; `a:blip r:embed` → a relationship to
`word/media/*`; `wp:docPr` (`@id`, `@name`, `@descr` for alt text); `wp:extent` and `a:ext` in EMU
(1 px = 9525 EMU at 96 dpi); `w:object` with a `v:shape` fallback for embedded objects.

**Behaviour**
- `edit.insertImage` accepts a `Blob`/`File`/`ArrayBuffer`/URL plus intrinsic size, DPI and alt text.
  Default sizing: if the pixel size at the file's declared DPI exceeds the text column width, the
  image is scaled down to fit the column preserving the aspect ratio; if it is smaller, it is
  inserted at its natural size. The intrinsic size must be stored in `wp:docPr`'s `a:ext` so that
  re-loading does not change the displayed size (ED-007 edge case).
- Insert as inline by default; `options.wrap` inserts a floating anchor with `wp:positionH/V`
  relative to `column`/`margin`/`page` and `wp:align` (not `wp:posOffset`) so it survives
  re-pagination on a different paper size.
- Alt text is required for accessibility (I7): `wp:docPr/@descr` must be settable and the insert
  dialog must offer the field; an image with no alt text emits a diagnostic.
- **Formats**: PNG/JPEG/GIF/WebP/SVG insert directly. An unsupported format (HEIC from a phone) must
  be converted by the host's image service; the library reports `edit.imageUnsupported` rather than
  inserting a broken part.
- **File paste**: a pasted `File` from the OS is routed by type — image → image insert; `.docx`/`.rtf`
  /`.txt` → content insert (ED-027); anything else → an embedded object placeholder: a `w:object`
  with a `v:shape` rendering an icon (from the host's icon provider), the file stored as an
  embedded part with a relationship, and a caption naming the file. Real OLE embedding is not
  possible in the browser; the placeholder must be clearly labelled and must round-trip as an
  unknown-part-preserving object (01) so that opening the file in Word shows what Word can show.
- `edit.insertHyperlink` writes `w:hyperlink w:anchor` for internal targets and an external
  relationship otherwise, applies the `Hyperlink` character style (creating it if absent), and is one
  undo entry. Ctrl+click on a link follows it; a plain click places the caret (Word behaviour).
- Insert is always one undo entry, including the relationship creation and the media part write.

**Edge cases**
- Inserting an image into a table cell: the image is scaled to the *cell's* content width, not the
  page's.
- Inserting into a paragraph that is inside a content control keeps the image inside the control.
- An SVG must be stored as an image part with a PNG fallback in `a:blip`'s `a:extLst`/`svgBlip`
  extension so that Word renders something.
- A very large image must be resized at insert time only when `options.downscale: true`; otherwise
  the original bytes are preserved and the display size is set by `wp:extent`.

---

#### ED-031 — Drag-and-drop of text and files
**Priority:** important · **Effort:** L · **Depends:** ED-026, ED-027, 02

**Commands:** `edit.moveRange(range, target)`, `edit.copyRangeTo(range, target)`,
`edit.dropFiles(files, target)`, `dropTarget.setIndicator(spec)` · **Events:** `document.changed`,
`drop.hover`, `drop.leave`, `clipboard.degraded`
**OOXML:** as ED-027 (move = delete + insert with style/numbering re-identification).

**Behaviour**
- **Text drag**: dragging a selection moves it (cut + paste) as **one** undo entry (I2, ED-025). Ctrl
  held during the drop copies instead. Shift+Alt+drag? not bound. The drag must start only after a
  small movement threshold (default 4 px) so that a click is never misread as a drag.
- **Drop target computation** must be a single, testable function shared by drag-and-drop and the
  paste-at-point path: given a point, it returns a *drop position* with a kind —
  `inline` (between characters, indicator a vertical caret-height bar), `paragraph-boundary`
  (indicator a full-width horizontal rule at the paragraph edge), `cell` (indicator highlights the
  target cell), `object-anchor` (indicator the anchor paragraph), or `rejected` (indicator a
  diagonal-bar cursor).
- Snapping: the target snaps to the nearest legal position using the same rules as paste
  normalisation (a block cannot land inside a run; a cell selection lands only on a cell target).
- **Auto-scroll** during a drag uses the same rate function as ED-003.
- **Dropping files from the OS**: the drop target's kind decides the outcome — dropped onto the text
  area, an image is inserted at the drop position and a DOCX is inserted as content; dropped anywhere
  else in the editor's region (or with the drop-kind `rejected`), the files are passed to the host's
  "attach as object" flow (ED-030).
- Drag-and-drop must work between two docier instances in the same page and between two browser
  windows, by writing the same payload as ED-026 to `DataTransfer` and preferring the internal
  flavour on read.
- A drag whose drop is rejected (protected content, illegal structure) must produce **no** document
  change at all: the move must be validated before the source is deleted.
- Drag from a docier instance to an external application and back must degrade to the HTML/plain
  flavours exactly as a copy would.
- Dragging **out** of the editor (to the OS) must export the same payload; the auto-delete-on-move
  behaviour of some platforms (`effectAllowed: 'move'` + `dropEffect: 'move'`) must be handled: if
  the external target reports a move, the source range is deleted as one undo entry **after** the
  drag completes, and if the drop is cancelled (Esc / no drop) nothing is deleted.

**Edge cases**
- A drag that begins in a read-only region may still copy out.
- Dragging a floating object is object movement (ED-007), not text drag; the drop position for an
  object is a point, not a text offset.
- A drag of a range containing a bookmark must not duplicate the bookmark name (ED-028).
- Re-dropping a range onto itself (or a drop whose target is inside the source range) is a no-op.

---

### 2.6 Find and replace

#### ED-032 — Find bar, search index, and search scope
**Priority:** core · **Effort:** L

**Commands:** `find.open()`, `find.set(query)`, `find.next()`, `find.previous()`, `find.findAll()`,
`find.clearHighlight()`, `find.setScope(scope)`, `find.setOptions(options)` ·
**Events:** `find.changed (matchCount, activeIndex)`, `selection.changed`
**OOXML:** none (search reads the logical text of `w:t`/`w:delText`/`w:tab`/`w:br` and the results of
fields; it never reads `w:instrText` unless "search in field codes" is on).

**Behaviour**
- The search operates on a lazily built **text index** per story that maps every logical character to
  `(part, paragraphId, offset, runId)`. The index is invalidated by the `layoutInvalidation` ranges
  of the commands that changed the document, which is why every mutating command must report them
  (1.7). A full rebuild is O(n) and must be avoided during typing (an insertion invalidates only its
  paragraph).
- **Incremental search**: typing in the find box searches forward from the caret and selects the
  first match as you type (Word's "find as you type" behaviour is *off* by default in Word; the
  library's default is on for the find bar and off for the dialog, host-configurable). All matches
  are highlighted (a "Reading Highlight" that persists until cleared).
- Highlighting must be non-destructive and metric-neutral: match highlights are drawn as decorations
  by the layout engine and must not affect the text metrics or the hit-test offsets (the same rule as
  ED-037).
- Navigation: Enter / `find.next` moves to the next match and selects it (a real selection, so that
  typing replaces it); Shift+Enter / `find.previous` goes back; wrap-around is on by default and is
  announced through `find.changed`. F3 / Shift+F3 are the keyboard bindings outside the find bar.
  Ctrl+F opens the find bar, Ctrl+H opens replace (ED-035), Esc closes and restores the selection
  that was in force when the bar opened.
- **Options**: match case; whole word only; ignore white space; ignore punctuation; ignore
  diacritics (our addition, needed for Romanian documents typed on a legacy layout, ED-017);
  `treatYoAsYe` (ED-018); "match prefix"/"match suffix"; "sounds like" is **not** supported (we have
  no English phonetic engine) and must be absent from the UI rather than present-and-broken.
- **Scope** options: current story (default), whole document (all stories), selection only,
  including headers/footers, including footnotes/endnotes, including comments, including text boxes,
  and "inside content controls". The scope determines which indexes are consulted, and the result
  list is ordered in document order across stories (body first, then headers/footers, then notes,
  then comments).
- Searching **inside** a field result works by default; searching inside a field **code** requires
  the explicit `searchInFieldCodes` option, and matches there are shown in "show field codes" mode
  (ED-037's sibling view).
- Searching must be linear in the story length per query and must be cancellable; a query over a
  large document must not block typing (chunk the scan, with a yield budget of ~8 ms per slice).
- `find.findAll` selects all matches as a multi-range selection (ED-002) so that a subsequent
  formatting command applies to every match — this is the mechanism behind "find all and format".

**Edge cases**
- Matching must not cross a paragraph mark unless the query contains an explicit paragraph mark
  (ED-035's `^p`).
- A match inside a deleted revision is included when `view.showRevisions: 'original'` and excluded
  when `'final'` (04).
- A match inside an empty paragraph mark (a zero-length search, an empty query) is not a match;
  `find.set({ query: '' })` clears the results and emits `find.changed` with `matchCount: 0`.
- The find bar must not steal the DOM selection from the editor surface; focus returns to the editor
  when the bar closes.

---

#### ED-033 — Formatting-aware find
**Priority:** important · **Effort:** M

**Commands:** `find.setFormatCriteria(criteria)`, `find.setReplaceFormatCriteria(criteria)` ·
**Events:** `find.changed`
**OOXML:** criteria are expressed as a partial `rPr`/`pPr` and matched against the **resolved**
effective formatting (FM-021/FM-022) or, in `directOnly` mode, against the run's direct `w:rPr`
only.

**Behaviour**
- Criteria that must be supported: font family (including theme font slots), font size (with a
  range), bold/italic/underline (+ underline style and colour), strikethrough, superscript/
  subscript, small caps/all caps, colour, highlight, character style, paragraph style, language
  (proofing language), paragraph alignment, indentation (left/first-line/hanging), line spacing,
  spacing before/after, paragraph borders, and "any style"/"no style".
- A criterion is a *partial* match: unspecified properties are wildcards. A property set to
  "not bold" is a negative criterion and must be distinguishable from "unspecified".
- With an empty find text and non-empty criteria, the search matches the next run (or paragraph)
  whose formatting matches — Word's formatting-only find.
- Matching against **resolved** formatting is the default because that is what a user means; it is
  also the more expensive path, so the implementation must first narrow candidates with cheap
  predicates (the style id, the direct properties) before resolving.
- The find bar must show a compact, human-readable summary of the active criteria ("Bold, 12 pt,
  Times New Roman") with a one-click clear, because a lingering format criterion is the classic
  "find is broken" bug report.
- `find.setReplaceFormatCriteria` applies formatting to the replacement text (Word's "Replace with
  Format"): the replacement runs are created with the criteria's direct properties.
- Criteria are session state, not document state; they must be cleared when the find bar is closed
  unless the host pins them (Word keeps them until "No Formatting" is clicked).

**Edge cases**
- A criterion on a property that is inherited from `docDefaults` matches text where no style or
  direct formatting specifies it, because the resolved value is that default.
- Font-family matching must compare the resolved font for the character's script class (1.8): a
  criterion of "Arial" matches a Cyrillic run whose `w:hAnsi` is Arial even if `w:cs` is empty.
- Theme-font criteria must be matched by slot (major/minor) *and*, optionally, by resolved family.

---

#### ED-034 — Regex and wildcard find and replace
**Priority:** important · **Effort:** L

**Commands:** `find.setMode('literal'|'regex'|'wordWildcards')`, `find.setOptions(...)` ·
**Events:** `find.changed`, `document.changed` (replace)

**Behaviour**
- Three modes:
  1. `literal` — the default; all characters are literal.
  2. `regex` — JavaScript `RegExp` semantics with the `u` flag, applied to the *logical text of one
     paragraph at a time* (matching never crosses a paragraph mark unless the pattern explicitly
     contains `\n`). The `g` flag is used for find-all; the `y` flag is used for next/previous
     (sticky, from the caret). Patterns that can match an empty string are rejected at compile time
     with `code: 'empty-match'` so that Replace All cannot loop forever. Backreferences `$1`…`$9`,
     `$&`, `$$` in the replacement.
  3. `wordWildcards` — Word's wildcard syntax, translated to a regex by the library. The translation
     table is normative and must be documented in the user-facing help:

     | Word wildcard | Meaning | Regex |
     | --- | --- | --- |
     | `?` | any single character | `.` |
     | `*` | any string | `.*?` (lazy, so the surrounding literal text anchors the match) |
     | `[abc]` | one of | `[abc]` |
     | `[!abc]` | none of | `[^abc]` |
     | `[a-z]` | range | `[a-z]` |
     | `{n}` | exactly n of the previous | `{n}` |
     | `{n,}` | n or more | `{n,}` |
     | `{n,m}` | between | `{n,m}` |
     | `@` | one or more of the previous | `+` |
     | `<` `>` | start / end of word | `\b` at the appropriate side |
     | `\1`…`\9` | backreference (find and replace) | `\1`…`\9` (find) / `$1`…`$9` (replace) |
     | `^p` etc. | special characters | see ED-035 |
     | `\?`, `\*`, `\\` | literal | escaped literal |

     Characters with no wildcard meaning are literal, and literal `?`/`*` in text must be typed as
     `\?`/`\*` — matching Word.
- Both non-literal modes must be applied to the **logical text**, with matches mapped back to text
  positions through the index of ED-032. A match that starts or ends in the middle of a grapheme
  cluster, an inline object, or a field boundary is rejected (a `find.rejectedMatch` diagnostic) and
  the scan continues; a match may not span a run boundary in a way that would require splitting a
  `w:sdt` — if it would, the match is rejected rather than silently mangling the control.
- Replace in a non-literal mode reconstructs the runs: the matched range's formatting is applied to
  the replacement (Word's behaviour: the replacement text takes the formatting of the found text),
  and the replacement's structure (paragraph marks inserted by `^p`) is built through the normal
  insertion pipeline (ED-012/ED-013) so that numbering, styles and revisions are handled correctly.
- Replace All in any mode is **one undo entry** (I2), chunked for responsiveness with a progress
  event and cancellation that keeps the applied portion as one entry.
- The mode and options are session state and must be reported by `find.changed`.

**Edge cases**
- A regex with catastrophic backtracking must be bounded: a per-match step budget aborts the scan
  with `code: 'pattern-too-complex'` rather than freezing the editor.
- A pattern matching inside a table cell must not produce a replacement that crosses a cell boundary.
- Wildcard `*` at the start of a pattern is greedy-lazy and can produce surprising matches; the
  library must document that Word's `*` does not match across paragraph marks and enforce it.
- A replacement containing `\n` in regex mode inserts a paragraph break; in wildcard mode only `^p`
  does.

---

#### ED-035 — Replace, Replace All, and special character codes
**Priority:** core · **Effort:** M

**Commands:** `find.replace()`, `find.replaceAll({ scope, limit })`, `find.replaceAndFindNext()`
**Events:** `find.changed`, `document.changed`

**Behaviour**
- Replace replaces the current match with the replacement text (plus
  `find.setReplaceFormatCriteria`'s formatting) and selects the result, then moves to the next match
  if `replaceAndFindNext` is used. The replacement takes the **formatting of the found text** unless
  replacement formatting criteria are set (Word's rule).
- Replace All runs over the scope (ED-032), reports the number of replacements through
  `find.changed`, and is one undo entry. It must be cancellable, and a cancelled Replace All must
  leave the applied portion in the document as one undoable entry with the count actually applied.
- **Special character codes** for both the find and the replace field (Word's set, restricted to the
  codes with a well-defined OOXML mapping):

  | Code | Meaning | Matches / writes |
  | --- | --- | --- |
  | `^p` | paragraph mark | end of paragraph; in replace, splits the paragraph |
  | `^l` | manual line break | `w:br` |
  | `^t` | tab | `w:tab` |
  | `^m` | manual page break | `w:br w:type="page"` (and `w:pPr/w:pageBreakBefore` when it is the only content) |
  | `^b` | section break | `w:sectPr` boundary (replace is rejected; a section break cannot be inserted by Replace) |
  | `^w` | white space (space, tab, non-breaking space) | any of them |
  | `^s` | non-breaking space | U+00A0 |
  | `^~` | non-breaking hyphen | `w:noBreakHyphen` |
  | `^-` | optional hyphen | `w:softHyphen` |
  | `^^` | caret | literal `^` |
  | `^#` | any digit | `[0-9]` (plus any Unicode decimal digit in `[[:Nd:]]` terms) |
  | `^$` | any letter | a Unicode letter |
  | `^?` | any character | any single character |
  | `^g` | graphic | any inline object |
  | `^d` | field | any field (both encodings) |
  | `^f` | footnote mark | a footnote reference |
  | `^e` | endnote mark | an endnote reference |
  | `^a` | comment mark | a comment range boundary |
  | `^&` | (replace only) the find-what text | the matched text |
  | `^c` | (replace only) clipboard contents | the current clipboard's plain-text flavour |

- Codes that require a specific construct to exist in the document, and constructs the search cannot
  reach (a section break, a footnote inside a note body when the scope excludes notes), must produce
  `code: 'special-unavailable'` with a clear message rather than silently matching nothing.
- Searching for `^p` matches a paragraph mark; the match is a zero-width position at the paragraph
  boundary, and replacing it with text merges the paragraph with the following one (`^p` → nothing)
  or splits (`text^p`). This must go through ED-013/ED-014's merge/split rules so numbering and
  styles behave, not through raw string surgery.

**Edge cases**
- `^p` in a table cell does not match the end-of-cell mark (the cell mark is not a paragraph mark);
  Word's behaviour is that `^p` does not match the cell mark, and the library follows it and emits
  a `find.changed` note when the scope contains cells.
- Replace All with a replacement shorter than the find text must not leave orphaned revision ranges
  (04).
- `^c` (clipboard) in a replace is read synchronously from the host clipboard adapter; in a headless
  consumer (ED-039) it comes from the injected adapter and is an error if none is configured.
- Codes are only recognised in `literal` and `wordWildcards` modes; in `regex` mode `^` is the regex
  anchor and the codes are **not** available (documented, and the UI must disable the Special menu).

---

### 2.7 Proofing, view, and modes

#### ED-036 — Spellcheck integration and proof state
**Priority:** important · **Effort:** L

**Commands:** `proof.setProvider(provider)`, `proof.recheck({ scope })`,
`proof.addToDictionary(word, lang)`, `proof.ignore(word, { scope })`,
`proof.setLanguages(langs)`, `proof.setOptions(options)` ·
**Events:** `proof.changed (issues, revision)`, `document.changed` (for `w:proofState` changes)
**OOXML:** `w:rPr/w:lang` (per script class, 1.8), `w:noProof` (skip proofing), `w:proofState`
(`w:spelling="clean|dirty"`, `w:grammar="clean|dirty"`), and `w:settings/w:hideSpellingErrors` /
`w:hideGrammaticalErrors`.

**Behaviour**
- The provider interface is the only coupling point:

  ```ts
  interface SpellcheckProvider {
    languages(): string[];
    check(request: { text: string; lang: string; offset: number }): Promise<ProofIssue[]>;
    suggest(word: string, lang: string): Promise<string[]>;
    addWord(word: string, lang: string): Promise<void>;
    ignoreWord(word: string, lang: string): Promise<void>;
  }
  interface ProofIssue { start: number; end: number; kind: 'spelling' | 'grammar' | 'style'; suggestions?: string[]; message?: string }
  ```

  When no provider is set, no underlines are produced, no context-menu proofing entries appear, and
  the native browser spellcheck must be **disabled** on the editing surface (`spellcheck="false"`) so
  the two engines never draw two different squiggles.
- **Scope of checking**: only paragraphs that are (a) in the visible viewport plus a margin of one
  page, (b) whose effective `w:lang` is one of the configured languages, (c) not `w:noProof`, (d) not
  `w:proofState/w:spelling="clean"`, (e) not inside a field code, (f) not inside a locked content
  control, and (g) not inside a deleted revision. Checks run asynchronously after a debounce
  (default 300 ms after typing stops) and are cached per paragraph revision id.
- Results are rendered as decorations (a red wavy underline for spelling, blue/green for grammar per
  the host's theme) that are **metric-neutral** (same rule as ED-037): the underline must not change
  line breaking, and hit testing must route clicks to the text.
- The context menu offers: suggestions (up to 5, in order), "Ignore Once", "Ignore All",
  "Add to Dictionary", "Spelling…" (opens the provider's dialog if it has one), and "Recheck
  Document". Choosing a suggestion replaces the misspelled range as one undo entry, adopting the
  word's original capitalisation pattern (first-letter capitalised, all caps, all lower).
- **Languages**: `ro-RO` and `ru-RU` are the priority dictionaries; `en-US` is bundled as a
  fallback. Per-run `w:lang` decides, with the document's `w:themeFontLang` and the host's default
  language as the fallbacks. The hyphenation used for line breaking (`w:autoHyphenation`, FM-016)
  must use the same language resolution.
- "Recheck Document" writes `w:proofState/@w:spelling="dirty"` and
  `@w:grammar="dirty"` on the affected runs (Word's mechanism) and re-runs the check.
- Adding to the dictionary is host-persisted (not document state); the document-level custom
  dictionary is stored in the library's settings extension and is documented as non-standard.

**Edge cases**
- A word that is misspelled in one language and correct in another (a Romanian contract with a
  Russian annex) must not be flagged when both languages are configured — the check runs per run
  language, not per document.
- All-caps words, words containing digits, and mixed-script words are controlled by options
  (`ignoreWordsInUppercase`, `ignoreWordsWithNumbers`, `ignoreMixedScript`, defaults matching Word:
  uppercase ignored, digits ignored, mixed script checked).
- A typed word that is mid-composition (ED-016) is not checked.
- `w:noProof` on the paragraph mark must apply to the whole paragraph (the mark's `rPr` is part of
  the paragraph's effective run properties, FM-022).
- A provider that is slow (a server round trip) must not block typing, and out-of-order responses
  for the same paragraph must be discarded by revision id.

---

#### ED-037 — Show formatting marks
**Priority:** important · **Effort:** S

**Commands:** `view.setFormattingMarks(options)` · **Events:** `view.changed`, layout `range`
invalidation only
**OOXML:** none — this is a view setting. It must **not** be written to the document, and it must not
round-trip through save/load (Word stores it as an application setting tied to the user, not in the
file).

**Behaviour**
- Individual toggles (Word's list) and a "Show all" master:
  - **paragraph marks** — a `¶` glyph rendered at the end of every `w:p`, including the paragraph
    mark of an empty paragraph and including table-cell paragraphs and note paragraphs.
  - **spaces** — a middle dot `·` at each space (including U+00A0, which Word renders as `°`).
  - **tabs** — a right arrow `→` at each `w:tab`.
  - **optional hyphens** — `¬` at each `w:softHyphen`.
  - **non-breaking hyphens** — a raised `-` at each `w:noBreakHyphen`.
  - **manual line breaks** — `↲` at each `w:br`.
  - **section breaks** — a double dotted line with the label "Section Break (Next Page)" and friends,
    placed at the section boundary (`w:sectPr`).
  - **end-of-cell / end-of-row marks** — a distinct glyph at the end of each `w:tc` and at the row
    end, so that the table structure is visible. Exact glyph is themeable; the default must be
    visually distinct from `¶`.
  - **hidden text** (`w:vanish`) — hidden text is not rendered at all by default; when shown
    (`view.showHiddenText`), it is rendered with a dotted underline.
  - **object anchors** — an anchor glyph in the margin at the anchor paragraph of a floating object.
  - **bookmarks** — grey `[` `]` brackets around bookmark ranges.
  - **field shading** — a grey background over field results (Word's "Field shading: always/never/when
    selected"). This is a shading, not a mark, and is listed here because it lives in the same UI.
- **Rendering rule (normative):** marks are inserted into the line layout as *decorations* with a
  zero-width advance and a non-zero painted glyph. They must not change: the line's break points,
  the caret rectangle for a text position, the selection rectangles, the text offsets, or the
  copy/paste text. Hit testing must map a click on a decoration to the nearest real text position
  (ED-001 edge case). This rule exists because the natural implementation (injecting characters into
  the run text) breaks every one of those things.
- A paragraph mark decoration must be positioned *after* the last character and *before* the
  paragraph's trailing indent, so it does not push the caret.
- Toggling marks invalidates layout as `range` for the visible viewport only, and must not trigger a
  re-pagination of the document.
- The setting is per view (two views of the same document may differ) and is persisted per host, not
  per document.

**Edge cases**
- A space at a line-break opportunity must still render its dot on the correct line.
- Marks inside a `w:sdt` with hidden content? A content control with `w:showingPlcHdr` shows the
  placeholder; marks must not be drawn inside the placeholder.
- With marks on, copied text must be identical to the copy with marks off (verified by the
  conformance suite of ED-039).

---

#### ED-038 — Read-only, document protection, and range-level exceptions
**Priority:** core · **Effort:** L

**Commands:** `document.setReadOnly(on|off)`, `document.setProtection({ mode, password? })`,
`document.addEditableRange(range, { editor })`, `document.removeEditableRange(id)`,
`editor.canExecute(commandId)` · **Events:** `protection.changed`, `command.rejected (code, range)`
**OOXML:** `w:settings/w:documentProtection` (`w:edit="readOnly|comments|trackedChanges|forms"`,
`w:enforcement="1|0"`, `w:algorithmName`, `w:hash`, `w:salt`, `w:spinCount`),
`w:permStart`/`w:permEnd` (`w:id`, `w:ed`, `w:edGrp`, `w:perm`, `w:colFirst`, `w:colLast`),
`w:sdtPr/w:lock` (`w:val="sdtLocked|contentLocked|sdtContentLocked|unlocked"`),
`w:settings/w:writeProtection` (`w:recommended`), legacy form fields (`w:fldChar` + `w:ffData`).

**Behaviour**
- **Restriction sources** are evaluated in this precedence order, and the *most restrictive
  applicable* wins:
  1. the library's API-level read-only flag (per document or per story), which is never written to
     the file;
  2. `w:documentProtection` with `w:enforcement="1"` — `readOnly` blocks all mutations;
     `comments` allows comment insertion/editing and nothing else; `trackedChanges` allows all edits
     but forces every edit to be recorded as a revision (04); `forms` allows edits only inside form
     fields and content controls whose `w:lock` permits it;
  3. `w:permStart`/`w:permEnd` ranges: inside a range whose `w:edGrp` includes the current user's
     group (or `w:ed="0"` meaning "everyone"), editing is allowed even when the document is
     protected; `w:colFirst`/`w:colLast` restrict the exception to a table column range;
  4. `w:sdtPr/w:lock` on a content control: `contentLocked` prevents editing the contents but allows
     deleting the control, `sdtLocked` prevents deleting the control but allows editing the contents,
     `sdtContentLocked` prevents both;
  5. `w:writeProtection w:recommended="1"` — advisory only: the UI prompts, the library allows
     editing when the host opts in.
- **Enforcement point.** Policy is evaluated by a guard *before* a command mutates anything (I5), and
  the result is `{ ok: false, code: 'protected', range, mode }` plus a `command.rejected` event.
  Commands that only affect the view (`view.*`, `find.*`, `selection.*`) always succeed. A rejected
  command must produce no document change, no undo entry and no partial application — including
  compound commands, which must be validated as a whole before any part is applied.
- `editor.canExecute(commandId, args)` must answer the same question synchronously so the host can
  disable toolbar buttons and menu items; it must be cheap (memoised per protection revision).
- **Allowed in read-only**: navigation, selection, copy, find, proofing display, zoom, formatting
  marks display, opening dialogs in a read-only state (the dialog's OK is disabled), and
  `print`/`export`. **Blocked**: everything that mutates text, formatting, structure, numbering,
  styles, themes, sections, or the protection state itself.
- **Comments mode** allows creating a comment on a selection and editing or deleting existing
  comments (the comment story is treated as editable; the body is not). It must not allow replying
  to a comment if the reply would alter the body (it does not).
- **Forms mode** allows editing only inside legacy form fields (`w:fldChar w:fldCharType="begin"`
  with `w:ffData`) and inside content controls whose `w:lock` allows it. Tab must traverse the form
  fields (Word's behaviour) rather than insert a tab.
- **Password handling.** The protection hash attributes must be **preserved verbatim** on load and
  save (`w:algorithmName`, `w:hash`, `w:salt`, `w:spinCount`) so an unprotected-then-saved file is
  not corrupted. The library must implement the documented OOXML password hash verification
  (ISO/IEC 29500-1 §17.15.1.29 and the Word 2010 extension) for "unprotect with password"; the
  default document-protection hash used by Word 2007 is a weaker scheme and must be supported for
  verification only. Verifying a password is a host-visible operation with a rate limit; the
  library must never silently drop `w:enforcement`.
- Protection changes are themselves commands, are undoable while protection is off, and are part of
  the undo payload so that undoing a protection change restores the previous state (ED-023 edge
  case).
- Restricted editing interacts with the clipboard: cut and drag-out of a protected range are
  rejected; copy is allowed; paste into a protected range is rejected with the same code. A paste
  that *straddles* a protected boundary must be split into the permitted parts and rejected for the
  rest, with the rejection reported — never silently partial.

**Edge cases**
- A `w:permStart` with no matching `w:permEnd` (a corrupt file) must be treated as ending at the
  story end and a diagnostic emitted.
- Overlapping editable ranges with different editors: the union is editable for a user who is in any
  of the groups.
- An editable range inside a table with `w:colFirst`/`w:colLast` must map to a cell rectangle, and a
  selection that partially covers it is split.
- Read-only mode must suppress the caret? No — the caret must remain, because selection and copy must
  work.
- The host may set an API-level read-only that is *stricter* than the file's protection; the reverse
  (allowing editing of a password-protected file) requires an explicit host opt-in
  (`document.setProtectionBypass(true)`) which must be auditable and is never the default.

---

#### ED-039 — Headless / no-DOM mutation driving
**Priority:** core · **Effort:** L · **Depends:** 01, 02

**Commands:** every command, plus `editor.setEnvironment(env)` ·
**Events:** every event; the emitter is the same implementation with no DOM dependency.
**OOXML:** as elsewhere.

**Behaviour**
- The core package entry point must contain **no** references to `window`, `document`, `navigator`,
  `getSelection`, `Range`, `ClipboardEvent`, `requestAnimationFrame`, `ResizeObserver`, or
  `IntersectionObserver`. Those live in the DOM layer, which is a separate entry point that injects
  an `Environment`:

  ```ts
  interface Environment {
    layout: LayoutEngine;                 // 02, may be a headless implementation
    clipboard?: ClipboardAdapter;         // optional; paste/copy commands need it
    clock: { now(): number; setTimeout; clearTimeout };
    host: { resolveUrl(u: string): string | null; confirm?(q: string): Promise<boolean> };
    fonts?: FontProvider;
  }
  ```

  The library must construct and operate with only `{ layout, clock, host }` supplied.
- Everything a pointer would do must be expressible as a command with an explicit target:
  selection, typing at an explicit `TextPosition`, formatting a `TextRange`, structural edits
  addressed by paragraph/table ids. No command may require "the current DOM selection".
- **Layout dependency.** Commands that inherently need layout (Up/Down, Page navigation, `line`
  selection units, object geometry, hit testing) must fail with a typed `LayoutUnavailableError`
  when the injected layout engine is the null implementation, and must succeed with a headless
  layout implementation (02 provides one that computes metrics without a renderer). Commands that
  need layout for invalidation only must work regardless and simply report invalidation.
- **Event parity.** The same commands, events, invalidation declarations, undo entries and
  `CommandResult`s must be produced in both environments. This is enforced by a **conformance suite**
  that replays a scripted command sequence against the DOM build and the headless build and compares:
  the serialised `document.xml`/`styles.xml`/`numbering.xml` (normalised for `w:rsid`, relationship
  ids and part ordering), the event journal, the undo stack depth and labels, and the final
  selection.
- Headless consumers must be able to drive the same *high-level* flows, not only primitives:
  token substitution (05), merge-field updates, table row generation, and format application —
  meaning those flows may not be implemented inside the DOM layer.
- Bulk/headless operation must support `history.setSuspended(true)` for performance, and must still
  produce valid, Word-openable output.
- Determinism: a headless run with a fixed seed and a fixed clock must produce byte-identical OOXML
  across runs and platforms (no time-dependent ids, no map-iteration-order-dependent id allocation).
  Id allocation (relationship ids, `wp:docPr/@id`, `w:sdt/@w:id`, numbering ids) must use a
  deterministic counter, not randomness — this is the one place where determinism and the
  randomness used for `w:numIdMacAtCleanup`-style counters conflict, and the counter must win.

**Edge cases**
- Clipboard commands in headless mode without a `ClipboardAdapter` return
  `code: 'clipboard-unavailable'` rather than throwing.
- Timers in headless mode need not be real: the debounce in ED-019/ED-036 must be controllable by
  the injected clock so tests are not wall-clock dependent.
- A headless consumer that never calls a layout-invalidating read must still get correct
  serialisation (invalidation is a rendering concern only).

<!-- PART3 -->
