# 03 - Editing and Formatting

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
paragraph range - never `none`; (b) style/theme/numbering/`docDefaults` changes are always
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

- **I1 - No unreachable state.** Every mutation goes through a command; no code path mutates the
  document model directly, including autocorrect, paste, drag-and-drop, IME commit and token
  insertion.
- **I2 - One gesture, one undo entry.** Any user gesture that produces a logically single change to
  an object produces exactly one undo entry (ED-025).
- **I3 - Effective formatting is computed, never stored.** The value shown for bold/font/size etc. is
  always derived by the resolution algorithms in FM-021/FM-022 from the current document state.
- **I4 - Round-trip silence.** A command that changes nothing must produce no `document.changed`
  event and no undo entry (e.g. clicking Bold on already-bold text with `set`, not `toggle`).
- **I5 - Protected content is rejected, not edited then reverted.** Policy is evaluated before the
  mutation (ED-038).
- **I6 - Locale completeness.** Every user-facing string, every typographic rule and every proofing
  path defined here must behave correctly for `ro-RO` and `ru-RU`; `en-US` is the fallback.
- **I7 - Accessibility.** The editing surface must expose caret/selection/formatting to assistive
  technology through a documented ARIA surface (`aria-activedescendant` over a virtual text
  representation, or the host's native editing bridge). Because the editor is a custom-rendered
  surface, this is a requirement, not a nicety: an HR manager using a screen reader must be able to
  read, navigate and format. Implementation approach is deferred but the contract is: commands and
  events in 1.4 must be sufficient to drive the editor with no pointer.

---

## 2. Editing and input

### 2.1 Caret and selection

#### ED-001 - Caret model: placement, hit testing, affinity, rendering, blink
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

#### ED-002 - Selection model: anchor/focus, normalization, multi-range, persistence
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

#### ED-003 - Selection gestures: multi-click ladder, drag-select, autoscroll, shift-click, Extend Mode
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
  sentence? **No** - the selected word excludes trailing whitespace; the trailing space is included
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

#### ED-004 - Selection units: character, word, sentence, line, paragraph, block, cell, row, column, object, all
**Priority:** core · **Effort:** M

**Commands:** `selection.selectUnit(position, unit)`, `selection.selectBlock(position)`,
`selection.selectCell(row, col, ...)`, `selection.selectRow(index)`,
`selection.selectColumn(index)`, `selection.selectTable()` · **Events:** `selection.changed`
**OOXML:** cell/row/column selection maps to a rectangular cell range; stored in the session model.
Table selection writes no OOXML by itself, but the resulting formatting commands write `w:tcPr`,
`w:trPr` (table spec) - this spec owns only the selection.

**Behaviour**
- Units that must exist and be reachable programmatically: `character`, `word`, `sentence`, `line`
  (visual line), `paragraph`, `block`, `cell`, `row`, `column`, `object`, `all`.
- **word** - same segmenter as ED-009 (one shared implementation; the two must never diverge).
- **sentence** - Word's definition: a maximal run ending at `.`, `!`, `?` (plus `…`, `?!`, `!.`)
  followed by whitespace or end of paragraph, or at a paragraph mark. Abbreviations are not
  special-cased (Word's behaviour); the unit is deterministic and documented.
- **line** - a *visual* line, delimited by soft line breaks produced by layout; requires the layout
  engine, and in headless mode without layout this unit fails with `LayoutUnavailableError`.
- **paragraph** - the `w:p` contents including its mark.
- **block** - the smallest enclosing structural node: a table cell's paragraph block, a whole table
  row, a text box's paragraph block, a list item, or the whole story body when the caret is at top
  level. This unit is what "select the current block" host commands use.
- **cell / row / column** - rectangular cell selections. A column selection is addressable even
  through vertically merged cells (`w:vMerge`): a column selection containing a merged cell must
  include the whole merged cell exactly once.
- **object** - a single inline object (`w:drawing`, `w:object`, `w:pict`, `m:oMath`), a field as a
  unit, a content control as a unit, a footnote/endnote reference, or a bookmark.
- **all** - the caret's story; in the body it is the body story only, excluding headers, footers and
  notes (see ED-006).

**Edge cases**
- Selecting a row that is the only row, or a table with a single column, must still be a valid cell
  selection.
- Selecting a unit that spans a tracked insertion (`w:ins`) boundary must not split the revision
  (04 owns revision integrity).
- A `paragraph` selection of a paragraph inside a content control does not include the control
  delimiters.

---

#### ED-005 - Block (column) selection
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

#### ED-006 - Select All escalation (Ctrl+A)
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

#### ED-007 - Object selection and manipulation gestures
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
  an inline shape; a second press crosses it) - the object is a single step in linear navigation.
- Floating objects (anchored) are selected by clicking them; a selected floating object shows 8
  resize handles, a rotation handle and an anchor glyph at its anchor paragraph.
- **A single manipulation gesture is exactly one undo entry (I2, ED-025):** one drag-move (including
  its live preview), one resize drag, one rotation, one wrap-mode change, one nudge command.
  During a drag the object's live position is *transient* - no command is issued, no event is
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
  constrains the ratio; the handles default to free resize) - the exact default is a host setting,
  the library default is constrained for corners.
- An object whose anchor is in a protected range may be selected but not moved (ED-038).
- Image resize must be written to `wp:extent` only; the intrinsic pixel size and DPI in
  `wp:docPr`/`a:blip` must be preserved so re-loading does not change the displayed size.

---

### 2.2 Keyboard navigation

#### ED-008 - Character and visual-line navigation (Left/Right/Up/Down, goal column)
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

#### ED-009 - Word navigation (Ctrl+Left/Ctrl+Right, Word-exact)
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
  Ctrl+Shift+Right selects `"hello "` **including the trailing space** - this is Word's trailing-space
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
- "e.g." with Ctrl+Right from the start: stops before `e`(2) i.e. after `"e."` - three presses cross
  `e`, `g`, and the word after. Deterministic under the two-class model; the exact stop count for
  multi-punctuation runs is fixed by the rules above and must be covered by tests, not left to the
  platform segmenter (`Intl.Segmenter` must **not** be used directly for this: its word model differs
  from Word's).
- Navigation over a tab character: the tab is a separator run; Ctrl+Right from before a tab lands at
  the next word after the tab.
- Navigation must skip a deleted revision's content when `view.showRevisions: 'final'` and include it
  when `'original'` (04 owns revisions; this spec owns the navigation contract).

---

#### ED-010 - Line and document edge navigation (Home/End, Ctrl+Home/Ctrl+End)
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
  before the paragraph mark) - not after the mark.
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

#### ED-011 - Paragraph, page, and history navigation (Ctrl+Up/Down, Page Up/Down, Go Back)
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

#### ED-012 - Insertion pipeline: typing, Tab contexts, overwrite, formatting inheritance
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

#### ED-013 - Paragraph split (Enter) and break insertion (Shift+Enter, page/column)
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

#### ED-014 - Deletion: Backspace/Delete merge rules and word/line deletion
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
    of that table (Word behaviour) - the two blocks merge inside the cell.
  - Backspace at the start of the **first** paragraph of a table cell merges that cell's first
    paragraph with the previous cell's last paragraph - Word refuses across a cell boundary and
    instead deletes nothing; the library must follow Word and refuse, emitting `command.rejected`.
  - Backspace when the caret is at the very start of a content control and the control is empty
    deletes the whole control (one undo entry, `document.changed`).
  - Backspace when the caret is immediately after an inline object selects and deletes the object
    (first press selects, second deletes) - matching ED-007's two-step rule.
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

#### ED-015 - Character input beyond typing: Insert Symbol, Alt+X, dead keys, combining marks, normalization
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

#### ED-016 - IME composition
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

#### ED-017 - Romanian diacritics and legacy cedilla handling
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

#### ED-018 - Russian/Cyrillic input and script switching
**Priority:** core · **Effort:** M

**Commands:** `edit.insertText(text)` (script-switch aware), `format.lang.set(lang, script?)`
**Events:** `document.changed`, `format.changed`
**OOXML:** `w:rPr/w:lang/@w:val` (Cyrillic uses the Latin-script language slot - **not** `w:cs`;
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
  - Dashes: an em dash `-` with spaces on both sides; a numeral range (1-5, 1990-2000) uses an en
    dash or hyphen per the configured rule.
  - A non-breaking space must be insertable before a dash and after short (one- and two-letter)
    prepositions and conjunctions (в, и, с, к, о, а, у, на, по, из, от, до) - this is offered as an
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

#### ED-019 - Autocorrect
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
  path - pressing Ctrl+Z once after a correction must undo the correction only, restoring the typed
  text, and a second Ctrl+Z undoes the typing run; the library implements this by making the
  correction a *sub-entry* of the typing entry, and `history.undo` pops the sub-entry first).
- **Exceptions**: a per-rule exception list and a global "do not correct this word" list; an
  exception applies to the matched word, with the matched case preserved. Exceptions are matched
  case-insensitively but only when the rule is case-insensitive.
- **Rule sets shipped**: a built-in base set (the common `(c)`, `(r)`, `(tm)`, `-->`, `<--`, `:-)`,
  `:-(`, `;-)`, `...` - note that `...` conflicts with smart ellipsis, see below), a Romanian set
  (the common word corrections: "esut"? the plan is: common misspellings from the RO dictionary
  project, `atit`→`atât`, `aint`→`ain't` no - the RO set is: common diacritic-missing words handled
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

#### ED-020 - AutoFormat As You Type
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
  4. **Hyphens (--) with dash (-)** and **Hyphens (-) with en dash (-)** per ED-021.
  5. **Bold and italic with real formatting**: `*text*` → bold, `_text_` → italic, applied to the
     matched span; must not fire inside a word (`a*b*c` is left alone) and must not fire inside a
     formula or a field.
  6. **Internet and network paths with hyperlinks** → a URL/email typed and terminated by a boundary
     becomes `w:hyperlink` with an external relationship (`r:id`); this requires the host's link
     policy (a token/data-bound document may forbid link creation) and is therefore gated by
     `autoformat.linkPolicy`.
  7. **Automatic bulleted lists** → typing `*`, `-`, `•`, or `o` followed by a space at a paragraph
     start converts the paragraph to a bullet list at level 1 (creating the abstract numbering
     definition on demand, FM-031).
  8. **Automatic numbered lists** → typing `1.`, `1)`, `(1)`, `a.`, `i.`, or `I.` followed by a space
     converts the paragraph to a numbered list with the matching `w:numFmt`, and continues the
     previous list's numbering when the paragraph above is a list of the same format, else starts
     at 1.
  9. **Border lines** → a paragraph consisting only of `---`, `===`, `___`, `***`, `~~~`, `###`
     followed by Enter converts the paragraph to one with `w:pBdr` (single/double/thick/thin/dotted,
     bottom only) and removes the typed characters; the mapping table must be documented
     (`---` → single 0.5 pt, `===` → double, `___` → single 1.5 pt thick, `***` → dotted,
     `~~~` → wavy, `###` → dashed).
 10. **Format beginning of list item like the one before it** - a new list item inherits the
     previous item's character formatting **up to the first run break** (Word applies the previous
     item's leading formatting to the item's first word only).
 11. **Set left- and first-indent with tabs and backspaces** - Tab at the start of a paragraph with
     no tab stop sets `w:ind/@w:firstLine`, Shift+Tab sets a negative first-line/hanging indent by
     a fixed step (720 twips = 0.5 in).
 12. **Define styles based on your formatting** - when a paragraph is formatted directly and the
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

#### ED-021 - Smart typography: quotes, dashes, ellipsis, capitalization correction
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
  use `word - word` (spaces around); English uses `word-word` (no spaces) as a Word option. `-`
  between digits → en dash. `--` when both neighbours are digits → en dash.
- **Ellipsis**: `...` → U+2026, and `....` → `.` + U+2026 (Word's rule).
- **Capitalisation correction** (all individually switchable):
  - Capitalise the first letter of a sentence (after `.`, `!`, `?`, `…`, a paragraph start, and after
    a field result at the start of a paragraph).
  - "Correct TWo INitial CApitals": an initial two capitals followed by a lowercase letter becomes
    `Xx` (`HEllo` → `Hello`).
  - Capitalise names of days and months in RO (luni, marți, …) and RU (понедельник, …) when typed
    lowercase - the RO rule must respect that Romanian does **not** capitalise month names in normal
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

#### ED-022 - Token recognition triggers (tokenization module integration)
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

#### ED-023 - Undo/redo stack, bounds, save point, dirty flag, async and remote changes
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

#### ED-024 - Typing-run coalescing
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

#### ED-025 - One undo entry per object-manipulation gesture
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
  | Modify a style ("OK" in the Modify Style dialog) | the style definition + all dependent styles' resolution (no document edits) - one entry |
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

#### ED-026 - Copy and cut payload construction
**Priority:** core · **Effort:** M

**Commands:** `clipboard.copy({ format })`, `clipboard.cut()`, `clipboard.copyAsText()`
**Events:** `clipboard.copied (flavours)`, `document.changed` (cut only)
**OOXML:** the payload contains a serialised OOXML fragment (a standalone, well-formed sequence of
`w:p`/`w:tbl`/runs with a minimal `w:document` wrapper and a private identifier); cut is
`clipboard.copy` + `edit.deleteSelection` in one batch.

**Behaviour**
- Flavours written, in this order of preference for a consuming docier instance:
  1. `application/x-docier.fragment+json` - the internal representation: the OOXML fragment plus a
     document identity (`documentId`, `revision`), the source story, and the source's style/
     numbering/theme identifiers needed to preserve appearance.
  2. `application/vnd.openxmlformats-officedocument.wordprocessingml.document` - a full minimal DOCX
     (two parts: `word/document.xml` + `word/_rels`) for Word/ONLYOFFICE/LibreOffice consumers
     (*important*; the packaging is provided by spec 01).
  3. `text/html` - the HTML rendering with a `<meta name="Generator" content="docier">` marker and
     inline styles, so a docier instance pasting from an external app can recognise and adapt it.
  4. `application/rtf` (*later*).
  5. `text/plain` - the layout-flattened text.
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
    omit the note text and emit `clipboard.degraded { reason: 'footnote' }` - see OI-4);
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

#### ED-027 - Paste pipeline: flavours, Paste Special, cross-document
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

#### ED-028 - Clipboard round-trip fidelity: fields, content controls, bookmarks, comments, notes
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
  document has no such part (`degraded { reason: 'dataBinding-dropped' }`) - silently keeping it
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

#### ED-029 - External HTML import (Word, Google Docs) and sanitization
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
  - Images: `data:` URIs are decoded and embedded; remote `src` URLs are **not** fetched eagerly -
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

#### ED-030 - Images, embedded objects, and file paste
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
- **File paste**: a pasted `File` from the OS is routed by type - image → image insert; `.docx`/`.rtf`
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

#### ED-031 - Drag-and-drop of text and files
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
  paste-at-point path: given a point, it returns a *drop position* with a kind -
  `inline` (between characters, indicator a vertical caret-height bar), `paragraph-boundary`
  (indicator a full-width horizontal rule at the paragraph edge), `cell` (indicator highlights the
  target cell), `object-anchor` (indicator the anchor paragraph), or `rejected` (indicator a
  diagonal-bar cursor).
- Snapping: the target snaps to the nearest legal position using the same rules as paste
  normalisation (a block cannot land inside a run; a cell selection lands only on a cell target).
- **Auto-scroll** during a drag uses the same rate function as ED-003.
- **Dropping files from the OS**: the drop target's kind decides the outcome - dropped onto the text
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

#### ED-032 - Find bar, search index, and search scope
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
  formatting command applies to every match - this is the mechanism behind "find all and format".

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

#### ED-033 - Formatting-aware find
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
  whose formatting matches - Word's formatting-only find.
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

#### ED-034 - Regex and wildcard find and replace
**Priority:** important · **Effort:** L

**Commands:** `find.setMode('literal'|'regex'|'wordWildcards')`, `find.setOptions(...)` ·
**Events:** `find.changed`, `document.changed` (replace)

**Behaviour**
- Three modes:
  1. `literal` - the default; all characters are literal.
  2. `regex` - JavaScript `RegExp` semantics with the `u` flag, applied to the *logical text of one
     paragraph at a time* (matching never crosses a paragraph mark unless the pattern explicitly
     contains `\n`). The `g` flag is used for find-all; the `y` flag is used for next/previous
     (sticky, from the caret). Patterns that can match an empty string are rejected at compile time
     with `code: 'empty-match'` so that Replace All cannot loop forever. Backreferences `$1`…`$9`,
     `$&`, `$$` in the replacement.
  3. `wordWildcards` - Word's wildcard syntax, translated to a regex by the library. The translation
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
     `\?`/`\*` - matching Word.
- Both non-literal modes must be applied to the **logical text**, with matches mapped back to text
  positions through the index of ED-032. A match that starts or ends in the middle of a grapheme
  cluster, an inline object, or a field boundary is rejected (a `find.rejectedMatch` diagnostic) and
  the scan continues; a match may not span a run boundary in a way that would require splitting a
  `w:sdt` - if it would, the match is rejected rather than silently mangling the control.
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

#### ED-035 - Replace, Replace All, and special character codes
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

#### ED-036 - Spellcheck integration and proof state
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
  Russian annex) must not be flagged when both languages are configured - the check runs per run
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

#### ED-037 - Show formatting marks
**Priority:** important · **Effort:** S

**Commands:** `view.setFormattingMarks(options)` · **Events:** `view.changed`, layout `range`
invalidation only
**OOXML:** none - this is a view setting. It must **not** be written to the document, and it must not
round-trip through save/load (Word stores it as an application setting tied to the user, not in the
file).

**Behaviour**
- Individual toggles (Word's list) and a "Show all" master:
  - **paragraph marks** - a `¶` glyph rendered at the end of every `w:p`, including the paragraph
    mark of an empty paragraph and including table-cell paragraphs and note paragraphs.
  - **spaces** - a middle dot `·` at each space (including U+00A0, which Word renders as `°`).
  - **tabs** - a right arrow `→` at each `w:tab`.
  - **optional hyphens** - `¬` at each `w:softHyphen`.
  - **non-breaking hyphens** - a raised `-` at each `w:noBreakHyphen`.
  - **manual line breaks** - `↲` at each `w:br`.
  - **section breaks** - a double dotted line with the label "Section Break (Next Page)" and friends,
    placed at the section boundary (`w:sectPr`).
  - **end-of-cell / end-of-row marks** - a distinct glyph at the end of each `w:tc` and at the row
    end, so that the table structure is visible. Exact glyph is themeable; the default must be
    visually distinct from `¶`.
  - **hidden text** (`w:vanish`) - hidden text is not rendered at all by default; when shown
    (`view.showHiddenText`), it is rendered with a dotted underline.
  - **object anchors** - an anchor glyph in the margin at the anchor paragraph of a floating object.
  - **bookmarks** - grey `[` `]` brackets around bookmark ranges.
  - **field shading** - a grey background over field results (Word's "Field shading: always/never/when
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

#### ED-038 - Read-only, document protection, and range-level exceptions
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
  2. `w:documentProtection` with `w:enforcement="1"` - `readOnly` blocks all mutations;
     `comments` allows comment insertion/editing and nothing else; `trackedChanges` allows all edits
     but forces every edit to be recorded as a revision (04); `forms` allows edits only inside form
     fields and content controls whose `w:lock` permits it;
  3. `w:permStart`/`w:permEnd` ranges: inside a range whose `w:edGrp` includes the current user's
     group (or `w:ed="0"` meaning "everyone"), editing is allowed even when the document is
     protected; `w:colFirst`/`w:colLast` restrict the exception to a table column range;
  4. `w:sdtPr/w:lock` on a content control: `contentLocked` prevents editing the contents but allows
     deleting the control, `sdtLocked` prevents deleting the control but allows editing the contents,
     `sdtContentLocked` prevents both;
  5. `w:writeProtection w:recommended="1"` - advisory only: the UI prompts, the library allows
     editing when the host opts in.
- **Enforcement point.** Policy is evaluated by a guard *before* a command mutates anything (I5), and
  the result is `{ ok: false, code: 'protected', range, mode }` plus a `command.rejected` event.
  Commands that only affect the view (`view.*`, `find.*`, `selection.*`) always succeed. A rejected
  command must produce no document change, no undo entry and no partial application - including
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
  rest, with the rejection reported - never silently partial.

**Edge cases**
- A `w:permStart` with no matching `w:permEnd` (a corrupt file) must be treated as ending at the
  story end and a diagnostic emitted.
- Overlapping editable ranges with different editors: the union is editable for a user who is in any
  of the groups.
- An editable range inside a table with `w:colFirst`/`w:colLast` must map to a cell rectangle, and a
  selection that partially covers it is split.
- Read-only mode must suppress the caret? No - the caret must remain, because selection and copy must
  work.
- The host may set an API-level read-only that is *stricter* than the file's protection; the reverse
  (allowing editing of a password-protected file) requires an explicit host opt-in
  (`document.setProtectionBypass(true)`) which must be auditable and is never the default.

---

#### ED-039 - Headless / no-DOM mutation driving
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
  token substitution (05), merge-field updates, table row generation, and format application -
  meaning those flows may not be implemented inside the DOM layer.
- Bulk/headless operation must support `history.setSuspended(true)` for performance, and must still
  produce valid, Word-openable output.
- Determinism: a headless run with a fixed seed and a fixed clock must produce byte-identical OOXML
  across runs and platforms (no time-dependent ids, no map-iteration-order-dependent id allocation).
  Id allocation (relationship ids, `wp:docPr/@id`, `w:sdt/@w:id`, numbering ids) must use a
  deterministic counter, not randomness - this is the one place where determinism and the
  randomness used for `w:numIdMacAtCleanup`-style counters conflict, and the counter must win.

**Edge cases**
- Clipboard commands in headless mode without a `ClipboardAdapter` return
  `code: 'clipboard-unavailable'` rather than throwing.
- Timers in headless mode need not be real: the debounce in ED-019/ED-036 must be controllable by
  the injected clock so tests are not wall-clock dependent.
- A headless consumer that never calls a layout-invalidating read must still get correct
  serialisation (invalidation is a rendering concern only).

---

## 3. Formatting and styles

### 3.1 Character formatting

#### FM-001 - Character toggles: bold, italic, underline, strike, superscript/subscript
**Priority:** core · **Effort:** L

**Commands:** `format.bold.toggle()`, `format.bold.set(on)`, `format.italic.*`, `format.underline.*`,
`format.strike.toggle()`, `format.underline.style.set(style)`, `format.vertAlign.set(...)`
**Events:** `format.changed`, `document.changed`
**OOXML:** `w:b`, `w:i`, `w:u` (`w:val` = `single|words|double|thick|dotted|dottedHeavy|dash|dashedHeavy|dashLong|dashLongHeavy|dotDash|dashDotHeavy|dotDotDash|dashDotDotHeavy|wave|wavyHeavy|wavyDouble|none`, `w:color`, `w:themeColor`), `w:strike`, `w:dstrike`, `w:vertAlign`
(`w:val="superscript|subscript|baseline"`), and the complex-script twins `w:bCs`, `w:iCs`, `w:szCs`.

**Behaviour**
- **State resolution for a selection (I3):** a property is `on` iff every character in the selection
  has it on, `off` iff every character has it off, and `mixed` otherwise. `mixed` is reported to the
  host so the toolbar can render an indeterminate state (Word renders mixed as *not* pressed).
- **Toggle on a mixed selection applies "on"** to the whole selection (Word). Toggle on an `off`
  selection applies on; on an `on` selection applies off. `set` is absolute and idempotent (I4: no
  event, no undo entry if nothing changes).
- A collapsed caret toggle applies to the **caret's typing context** (ED-012's inheritance), not to
  any existing text, and the change must be visible in `format.changed` so the toolbar and the
  "next typed text" preview update.
- Toggling with a paragraph-wide selection must also write the **paragraph mark's** `rPr`
  (`w:pPr/w:rPr`) for every wholly-selected paragraph - otherwise pressing Enter at the end of the
  paragraph produces text without the formatting (the classic Word bug that the library must not
  reproduce).
- Bold/italic are **toggle properties** in the style hierarchy (FM-021). The command writes direct
  formatting; it must never rewrite a style. The consequence - a paragraph whose style is bold and
  whose direct `w:b` is applied becomes *not* bold under XOR - is inherent to Word's model and must
  be preserved and documented in the UI (the toolbar shows the resolved value, not the direct one).
- Complex-script synchronisation: if a run contains complex-script text (`w:cs`/`w:rtl` present),
  the toggle must also write `w:bCs`/`w:iCs`/`w:szCs` so Arabic/Hebrew inside a mostly-Latin
  document stays consistent. Cyrillic and Romanian **must not** get these (1.8).
- Underline: the toolbar's underline button uses `single` and remembers the last non-single style
  chosen in the Font dialog for the session; `w:u w:val="none"` is written when removing an
  underline that a style supplies (rather than deleting the element), because deleting it would let
  the style's underline resurface.
- Superscript/subscript: written as `w:vertAlign`; `w:sz` is **not** changed (the renderer scales by
  65 %, and the file must match what Word writes). Applying one clears the other. `baseline` clears
  both.
- Strike vs double-strike are distinct (`w:strike` / `w:dstrike`); the toolbar toggles `w:strike`
  only, and the Font dialog exposes double strike.

**Edge cases**
- A selection that includes an inline object, a footnote reference or a field: the formatting applies
  to the surrounding runs; an object's `rPr` (inner formatting) must not be touched unless the object
  is wholly inside the selection, in which case its drawing properties are unaffected but its
  neighbouring runs are.
- Applying bold to a selection inside a `w:sdt` must not modify the `w:sdtPr`'s `w:rPr` (the
  control's own formatting applies to the placeholder only).
- A run whose content is only a `w:tab` or `w:br` accepts character formatting (it matters for the
  mark) and the property must be written even though the glyph does not change.
- `format.*` with an empty selection is a no-op except in the caret-typing-context case above.

---

#### FM-002 - Fonts: family, theme fonts, script routing, size, grow/shrink
**Priority:** core · **Effort:** L · **Depends:** FM-025, 1.8

**Commands:** `format.font.set({ family, script, theme })`, `format.font.size.set(pt)`,
`format.font.size.grow()`, `format.font.size.shrink()`, `format.font.setComplex({ family, size })`
**Events:** `format.changed`, `document.changed`, `fonts.substituted`
**OOXML:** `w:rFonts` (`@w:ascii`, `@w:hAnsi`, `@w:cs`, `@w:eastAsia`, `@w:asciiTheme`,
`@w:hAnsiTheme`, `@w:cstheme`, `@w:eastAsiaTheme`, `@w:hint`), `w:sz`, `w:szCs`;
`word/fontTable.xml` (`w:font/@w:name`, `w:altName`, `w:panose1`, `w:charset`, `w:family`,
`w:pitch`, `w:sig`).

**Behaviour**
- **Script routing (normative, 1.8):** the Font dialog's "Latin text" font field writes
  `w:ascii` **and** `w:hAnsi`; the "Complex scripts" field writes `w:cs`. Romanian and Russian are
  served by the Latin fields. The UI must not present the complex-script fields as the way to change
  a Russian font.
- Theme fonts: choosing a theme slot writes `w:asciiTheme`/`w:hAnsiTheme` (e.g.
  `majorHAnsi`, `minorHAnsi`, `majorBidi`, `minorEastAsia`) **instead of** a literal family, and
  removes `w:ascii`/`w:hAnsi`. Choosing a literal family removes the theme attributes. A run must
  never carry both.
- Font list sources, in order: the document's `fontTable.xml`, the theme's major/minor fonts, the
  recently used fonts, fonts available in the environment (via `FontProvider`), and the full
  configured list. Each entry shows a real preview rendered in that font where the font is
  available and marked as substituted where it is not.
- **Missing fonts**: a run referencing a font not available in the environment renders through the
  fallback chain (per script class): `w:rFonts` for the character's script → the theme's
  corresponding font → `fontTable.xml`'s `w:altName` → the environment's per-script default → a
  bundled metric-compatible set → last-resort. A `fonts.substituted (requested, used, runs)` event
  lists every substitution so the host can warn ("Times New Roman is not installed; documents will
  be laid out with Liberation Serif"). Substitution must be **metric-compatible** where possible
  (Liberation/Carlito/Caladea) because layout-faithful pagination depends on it (02).
- **Size** is stored in half-points in `w:sz` (and `w:szCs`); the dialog accepts 0.5 pt steps and any
  value from 1 to 1638 pt (`w:sz` max 3276). The toolbar size control writes both `w:sz` and
  `w:szCs` (documented decision, see §5 OI-7) so a mixed-script run does not end up with two sizes;
  the complex-script field of the dialog writes `w:szCs` alone.
- Grow/shrink (Ctrl+]) / Ctrl+[) step through the standard ladder
  `[8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]`; a size that is not in the
  ladder snaps to the next ladder value in the direction of travel, and the ladder is configurable.
  Grow/shrink coalesce into one undo entry while held (same rule as typing, ED-024).
- Font size changes (and font family changes) must invalidate layout as `document` if the change
  applies to more than one paragraph or to a style; as `paragraph` otherwise (1.7).
- `w:hint` is written as `default` when the family is set from the Latin field; it must be preserved
  when no font change is made.

**Edge cases**
- Changing the font of a selection that includes a `w:sym` run (ED-015) must not change the symbol's
  font, because that font is what makes the glyph render; the command skips `w:sym` runs and reports
  it.
- A font name containing spaces or non-ASCII characters must be preserved exactly (no
  normalisation); `w:rFonts/@w:ascii` must equal the `w:font/@w:name` in `fontTable.xml`, and the
  font table must be extended when a new family is used (01 owns the part; this spec declares the
  need).
- Applying a font to an empty paragraph must write the paragraph mark's `rPr` (FM-001's rule).
- A font that lacks Cyrillic must trigger the fallback *per character* while keeping `w:rFonts` as
  the user chose; the editor must not rewrite the run's font to make text render (mirrors ED-017).

---

#### FM-003 - Character colour, highlight, text effects, borders, and shading
**Priority:** core · **Effort:** L

**Commands:** `format.color.set(color)`, `format.highlight.set(color|null)`,
`format.effects.set(effects)`, `format.charBorder.set(spec|null)`, `format.charShading.set(spec|null)`,
`format.clearHighlight()` · **Events:** `format.changed`, `document.changed`
**OOXML:** `w:color` (`@w:val`, `@w:themeColor`, `@w:themeTint`, `@w:themeShade`), `w:highlight`
(`w:val` from the 16-colour set: `black, blue, cyan, green, magenta, red, yellow, white, darkBlue,
darkCyan, darkGreen, darkMagenta, darkRed, darkYellow, darkGray, lightGray`, plus `none`),
`w:shd` (`@w:val` patterns, `@w:color`, `@w:fill`, `@w:themeFill*`), `w:bdr` (`@w:val`, `@w:sz`,
`@w:space`, `@w:color`, `@w:themeColor`, `@w:shadow`, `@w:frame`), `w:effect`, `w:outline`,
`w:shadow`, `w:emboss`, `w:imprint`, and modern text effects in the `w14` extension
(`w14:textOutline`, `w14:textFill`, `w14:glow`, `w14:shadow`, `w14:reflection`, `w14:textEffect`).

**Behaviour**
- **Colour** may be a literal sRGB value (`w:val="1F4E79"`, uppercase hex, no `#`) or a theme colour
  slot (`w:themeColor="accent1"` ± `w:themeTint`/`w:themeShade`). The picker must present: theme
  colours (following the theme, so a theme change updates them), standard colours, and a custom
  colour dialog with hex/RGB/HSL entry and an alpha-less 24-bit value. Choosing "Automatic" writes
  `w:val="auto"` (which means "follow the theme's text colour" - it is not black).
- **Highlight** is a *separate* property from shading and is deliberately restricted to the fixed
  palette (OOXML has no free-colour highlight). The picker must therefore show those 16 colours plus
  "No Colour" (`w:highlight w:val="none"`). Removing a highlight with a selection that inherits one
  from a style writes `none` rather than deleting the element (same reasoning as FM-001's underline).
- **Shading** is the free-colour fill (`w:shd`), which is drawn *under* the highlight. The dialog
  exposes the pattern (`clear` for a solid fill, plus the pattern set) and the foreground/background
  colours that OOXML actually stores. A user choosing a "background colour" gets
  `w:shd w:val="clear" w:color="auto" w:fill="RRGGBB"`.
- **Text effects** are split by generation: the legacy toggles (`w:outline`, `w:shadow`, `w:emboss`,
  `w:imprint`, `w:effect w:val="blink|lights|ants"`) are read, written and shown; the modern effects
  (outline, gradient fill, glow, shadow, reflection) are stored in `w14` and require the
  `mc:AlternateContent` wrapper so that Word 2007 degrades gracefully. Writing modern effects must
  produce the `mc:AlternateContent` with a `w14` branch and a legacy fallback branch.
- **Character borders** (`w:bdr`) support box/shadow/3-D/four-sided styles, width (in eighths of a
  point), spacing between text and border (in points), and colour; `w:frame` is preserved when read
  but never written by the UI (it is a Word 5.0 legacy feature).
- Applying any of these to a selection applies to every run in it, including the paragraph marks of
  wholly-selected paragraphs (FM-001).
- Clearing: `format.clearHighlight` and the dialog's "No Colour"/"None" options write the explicit
  "none" values; the *element* is deleted only by FM-006 (Clear Formatting).

**Edge cases**
- `w:highlight` on a run inside a table with a table-style shading: the highlight wins visually
  (drawn on top) and the model keeps both; the UI must not attempt to reconcile them.
- `w:shd` with a `w:val` pattern other than `clear` uses `w:color` as the *pattern* colour and
  `w:fill` as the background; a naive implementation that swaps them produces visibly wrong output.
- A theme colour with both tint and shade is invalid in practice; the library writes at most one and
  normalises on read (tint wins, with a diagnostic).
- Highlight colour does not follow the theme (it is a fixed palette) and must not be offered as a
  theme-aware swatch.

---

#### FM-004 - Character spacing: spacing, kerning, scaling, position, fit text, OpenType features
**Priority:** important · **Effort:** M

**Commands:** `format.charSpacing.set({ spacing, kerning, scale, position, fitText })`,
`format.openType.set({ ligatures, numberForm, numberSpacing, stylisticSet })`
**Events:** `format.changed`, `document.changed` (layout `paragraph`/`document`)
**OOXML:** `w:spacing` (twentieths of a point, signed), `w:kern` (minimum font size in half-points
below which kerning is skipped; `0` disables), `w:w` (horizontal scaling percentage, 1-600),
`w:position` (half-points, signed vertical offset), `w:fitText` (`@w:val` in twips, `@w:id` unique
per run), `w:eastAsianLayout`, `w:snapToGrid`, `w:noProof`, `w:rtl`, `w:cs`, `w:em`, `w:lang`,
`w:vanish`, `w:webHidden`, `w14:ligatures`, `w14:numForm`, `w14:numSpacing`, `w14:stylisticSet`.

**Behaviour**
- The Advanced tab of the Font dialog maps one-to-one onto the properties above, in the same order,
  with the same units as Word's UI (points for spacing/position, points for the kerning threshold).
- **Layout consequence (normative):** every one of these properties changes the run's advance width
  or offset and therefore **must** be reflected by the layout engine (02). The formatting layer's
  obligation is to declare invalidation `paragraph` (or `document` for a style-level change) - an
  implementation that writes `w:spacing` without invalidating produces a caret that visibly drifts.
- `w:fitText` requires a **unique `@w:id` per run** within the document; the allocator must issue one
  (deterministic counter, ED-039) and must preserve existing ids on load.
- The legacy toggles (`w:vanish` hidden text, `w:webHidden`, `w:em` emphasis mark, `w:rtl`,
  `w:cs`, `w:snapToGrid`, `w:noProof`, `w:lang`) are exposed in this dialog too, because Word's Font
  dialog has them there; `w:noProof` and `w:lang` are shared with ED-036 and must be written through
  one code path.
- OpenType feature settings are written in the `w14` extension with the same
  `mc:AlternateContent` discipline as FM-003's modern text effects.
- Removing a value writes the property with its neutral value (`w:spacing w:val="0"`,
  `w:w w:val="100"`, `w:position w:val="0"`, `w:kern w:val="0"`) rather than deleting the element
  when the property is explicitly reset from the dialog, so that a style-supplied value does not
  resurface (the same rule as FM-001/FM-003).

**Edge cases**
- `w:kern` semantics are "kern only if the font size is at least this value"; a value of `0` or a
  missing element both mean *no kerning* in Word's default template. The UI label must say "Kerning
  for fonts of size X and above" and the off state must write `w:kern w:val="0"`.
- Negative `w:spacing` (condensed) is common for fitting a long contract title on one line and must
  be supported with the same precision as positive.
- `w:fitText` on a run inside a text box is where Word uses it; the library supports it anywhere but
  must warn that Word's rendering of fit-text outside a text box is inconsistent.
- A scaled (`w:w != 100`) run must still report its effective font size correctly in the toolbar (the
  size is not scaled).

---

#### FM-005 - Case commands and the Change Case dialog
**Priority:** important · **Effort:** S

**Commands:** `format.changeCase(mode)`, `format.caps.set(on)`, `format.smallCaps.set(on)`
**Events:** `format.changed`, `document.changed`
**OOXML:** `w:caps` and `w:smallCaps` (display-only properties that do **not** change the stored
text) vs the **text-transforming** Change Case command which rewrites `w:t` content; `w:rPr/w:caps`
and `w:smallCaps` are mutually exclusive in the UI (Word allows both to be set; the library
normalises to the last one applied).

**Behaviour**
- Two mechanisms, and the distinction is normative:
  1. **All Caps / Small Caps** are character *formatting*: the stored text keeps its original case
     and `w:caps`/`w:smallCaps` change only the rendering. The stored case is what find/replace,
     spellcheck and copy operate on. The toolbar's All Caps button (`Shift+F3` cycles the text, it
     does not toggle `w:caps`) must be clearly distinct from the Font dialog's "All caps" checkbox.
  2. **Change Case** (`format.changeCase`) rewrites the text: `sentence`, `lower`, `upper`, `title`,
     `toggle`. It transforms `w:t` content in place and is one undo entry.
- Case transformations must be **locale-aware** (I6): Romanian uses `locale: 'ro'` (ș/ț ↔ Ș/Ț, and
  the special handling of `â`/`î` in title case), Russian uses `locale: 'ru'`. Turkish-style dotted-i
  behaviour must come from the locale, not from a hand-written table, so that adding a language later
  does not require code changes.
- `sentence` mode capitalises the first letter of each sentence and lowercases the rest - it must not
  lowercase proper nouns in a way that destroys a contract's party names; the library's default for
  `sentence` is therefore "capitalise the first letter, leave the rest unchanged", with the
  Word-compatible behaviour (lowercase the rest) behind an option (`changeCase.sentenceLowercases:
  false` default). This is a deliberate, documented divergence from Word, chosen for the template
  use case; hosts may opt in to Word's behaviour.
- `title` mode capitalises the first letter of each word; for Romanian and Russian it must not
  capitalise after a hyphen-blind split ("într-o" must not become "Într-O" - the rule is: capitalise
  the first letter of the word and of a word after a space, not after a hyphen or an apostrophe).
- `toggle` mode: all-lowercase → all-uppercase, all-uppercase → lowercase with the first letter
  capitalised, mixed → lowercase (Word's cycle).
- The transformation must preserve run boundaries and formatting: transforming a mixed-format run
  keeps every run's `rPr` and only rewrites characters. A transformation that changes a character's
  script (not possible for case) or length (e.g. the German ß) must adjust the offsets correctly;
  Romanian/Russian are length-stable, but the implementation must not assume so.
- Text inside field codes, `w:sym` runs, `w:instrText` and locked content controls is not
  transformed.
- Shift+F3 cycles through the modes over the selection as one undo entry per press (and coalesces
  into one entry while the key is repeated within the typing window).

**Edge cases**
- `w:caps` and `w:smallCaps` must be preserved on round-trip even though the UI may not show both.
- Change Case over text containing a bookmark must keep the bookmark range valid (the endpoints are
  textual positions; a length change moves the end).
- Locale-aware lowercase of the Romanian "Î" at the start of a word: `lower` produces `î`, and
  `sentence` re-capitalises to `Î` (not `Â`).

---

#### FM-006 - Clear character formatting
**Priority:** core · **Effort:** S

**Commands:** `format.clearCharacterFormatting()` (Word's Ctrl+Space),
`format.clearParagraphFormatting()` (Ctrl+Q), `format.clearAllFormatting()` (the eraser button)
**Events:** `format.changed`, `document.changed`
**OOXML:** removes direct `w:r/w:rPr` children and/or `w:p/w:pPr` children according to the rules
below; never touches `w:rStyle`/`w:pStyle` (that is the style's job, and Ctrl+Space keeps the style).

**Behaviour**
- **Ctrl+Space (clear character formatting)** removes the *direct* `rPr` properties from every run in
  the selection, leaving the character style (`w:rStyle`) and paragraph style intact. The result is
  that the text reverts to its style's appearance. It must also clear the paragraph mark's `rPr` for
  wholly-selected paragraphs (FM-001's rule) - otherwise typing at the end of the paragraph is still
  bold and the user reports the feature as broken.
- Properties that must be **preserved** because they are not "character formatting" in Word's sense:
  `w:rStyle` (the character style), `w:lang` (proofing language - clearing it would silently change
  spelling), `w:noProof`, `w:vanish` (hidden text), `w:rsid*`, and `w:rPrChange` (revision history,
  04). The exact preservation list is normative; getting it wrong either loses user data or leaves
  the feature visibly ineffective.
- **Ctrl+Q (clear paragraph formatting)** removes direct `pPr` properties, leaving `w:pStyle`,
  `w:numPr` (list membership), `w:sectPr` (the section properties attached to the last paragraph -
  removing them would destroy the section!), `w:pPrChange`, and `w:rPr` (the mark's formatting is
  character formatting).
- **The eraser button** (Word's "Clear All Formatting") removes direct `rPr` **and** `pPr` **and**
  resets the paragraph style to the default paragraph style and the character style to the default
  character style; it keeps list membership. This is the "make this look like body text" command and
  is what the HR persona actually reaches for.
- All three are one undo entry, are no-ops (I4) when nothing would change, and invalidate layout
  `paragraph` per affected paragraph, or `document` when a style reset is involved.
- Clearing formatting inside a `w:sdt` must not remove the control's `w:sdtPr/w:rPr` (the control's
  own formatting), only the content runs' formatting.

**Edge cases**
- A run whose only `rPr` children are preserved properties keeps its `w:rPr` element (never leave an
  empty `w:rPr`, and never delete one that still carries `w:lang`).
- Clearing in a table cell must not touch `w:tcPr` (cell formatting), `w:trPr`, or the table style.
- Clearing inside a footnote keeps the reference's own character style (Word applies
  `FootnoteReference` to the mark; clearing the note text must not clear the mark's style).
- Clearing a selection that spans paragraphs clears each paragraph's direct `pPr` and each run, but
  must not unify numbering.

---

#### FM-007 - Format painter
**Priority:** important · **Effort:** M

**Commands:** `formatPainter.pick({ includeParagraph, includeStyle, includeNumbering, mode })`,
`formatPainter.paint(range | objectRef | cellRange)`, `formatPainter.cancel()`
**Events:** `formatPainter.changed (active, source, mode)`, `document.changed`
**OOXML:** writes the copied direct `w:rPr` and `w:pPr` properties; **never** copies `w:rsid*`,
`w:pPrChange`, `w:rPrChange`, `w:sectPr`, `w:numPr` (unless `includeNumbering`), or unknown
extension elements verbatim (they are filtered by an allow-list, because copying an unknown
extension can carry a foreign document's identity into the target).

**Behaviour**
- **What is copied** (the normative definition, because "the format" is ambiguous): the source's
  **resolved** character and paragraph formatting minus everything that comes from a style, i.e. the
  *direct-formatting differential*, recomputed as explicit direct properties. Copying the resolved
  values as direct formatting is what makes "paint onto a Heading 1 paragraph" produce the visual
  result the user expects rather than a no-op.
- Options, and their defaults for the HR profile:
  - `includeParagraph` (default **on**): copy paragraph properties, not only character properties.
    Single-click picks character + paragraph; the Word behaviour for a click on a paragraph with no
    selection.
  - `includeStyle` (default **off**): also apply the source's paragraph and character style ids. Off
    by default because copying a style turns a painted contract clause into a Heading 2, which the HR
    persona does not want; Word's format painter does not copy the paragraph style either.
  - `includeNumbering` (default **off**): also copy `w:numPr` (making the painted paragraph join the
    source's list). Off by default; the option exists because "paint this list formatting onto these
    paragraphs" is a real template-authoring task.
  - `mode: 'once' | 'sticky'` (default `'once'` for a single click, `'sticky'` for a double-click on
    the button and for Ctrl+Shift+C/V-style use).
- **One application = one undo entry** (I2, ED-025). Applying to a multi-range selection is one
  entry. In sticky mode every application is its own entry, and Esc cancels the mode.
- Painting onto an object (an image, a table, a shape) applies the source's *object-appropriate*
  subset: character formatting has no meaning on a drawing, so painting text formatting onto an
  object is rejected with `code: 'incompatible-target'` rather than silently doing nothing; painting
  onto a **table cell** applies character + paragraph formatting to the cell's paragraphs.
- Painting must be validated before mutation (I5): a target containing protected content is rejected
  as a whole rather than partially painted.
- The copies must go through the same resolution code as FM-021, so a change in the resolution
  algorithm cannot make the painter and the dialogs disagree.

**Edge cases**
- Painting a paragraph property (e.g. `w:keepNext`) into a table cell applies it to the cell's
  paragraphs, and to the cell mark's paragraph as well.
- Painting with a source that is an empty paragraph uses the paragraph mark's resolved formatting.
- Painting onto a collapsed caret sets the typing context (ED-012) rather than mutating text, so
  "paint then type" works.
- The painter must not copy `w:lang` by default (it would silently change the proofing language of
  the target); `includeLanguage` is an explicit option, default off.

---

#### FM-008 - Reveal formatting / inspect effective formatting
**Priority:** important · **Effort:** M · **Depends:** FM-021, FM-022

**Commands:** `format.inspect(range)`, `view.setRevealFormatting(on|off)`
**Events:** `view.changed`
**OOXML:** read-only presentation of resolved `rPr`/`pPr` plus their provenance. No writes.

**Behaviour**
- `format.inspect(range)` returns, for the selection (or the caret), two complete property maps -
  character and paragraph - where each property carries `{ value, source, overridden }`:
  - `source` is one of `{ kind: 'direct' }`, `{ kind: 'characterStyle', styleId }`,
    `{ kind: 'paragraphStyle', styleId }`, `{ kind: 'numbering', numId, ilvl }`,
    `{ kind: 'tableStyle', styleId, conditional }`, `{ kind: 'docDefaults' }`,
    `{ kind: 'defaultStyle', styleId }`.
  - `overridden` lists the values that a higher-priority level shadowed, so the pane can show
    "Bold (from Heading 1) - overridden by direct formatting: off", which is the single most useful
    diagnostic for the "why is my text not bold" support question.
- The Reveal Formatting pane (Word's Shift+F1) shows this as sections - Font, Paragraph, Section -
  with the source of each property marked, a "Distinguish style source" toggle that shows the
  style/level names inline, and a "Show all formatting marks" link that turns on ED-037.
- The pane must also show the **applied styles** list (paragraph style, character style, table
  style, numbering definition) with clickable links to open the Modify Style dialog, matching Word.
- With a mixed selection the pane reports each property as mixed unless all characters agree; a
  `styleAppliedToRange` summary reports which styles are in use and their counts.
- The pane is a *view*, so it must never mutate; every action taken inside it is an explicit command
  (a link to Modify Style, a click to turn marks on).
- The pane must update on every `document.changed` affecting the inspected range, and must be cheap:
  `format.inspect` on a large selection must resolve only the first paragraph plus a
  "mixed" summary rather than resolving every character.

**Edge cases**
- Inspecting a position inside a field result reports the field's result runs; inspecting a folded
  field reports the field's own `rPr`.
- Inspecting a paragraph inside a table must include the conditional table-style level that applies
  (`firstRow`, `band1Horz`, …) so the user can see why the header row is bold.
- Inspecting a `w:sym` run reports the symbol font and the code point.
- Inspecting in headless mode (ED-039) must work with no DOM and return the same structure.

---

### 3.2 Paragraph formatting

#### FM-009 - Alignment, justification, and text direction
**Priority:** core · **Effort:** M

**Commands:** `format.alignment.set(left|center|right|justify|distribute)`,
`format.textDirection.set(...)`, `format.rtl.set(on)`, `format.textAlignment.set(...)`
**Events:** `format.changed`, `document.changed`
**OOXML:** `w:pPr/w:jc` (`left|center|right|both|distribute|start|end|mediumKashida|highKashida|lowKashida|thaiDistribute|numTab`), `w:pPr/w:bidi`, `w:pPr/w:textDirection`
(`lrTb|tbRl|btLr|lrTbV|tbRlV|tbLrV`), `w:pPr/w:textAlignment`
(`auto|top|center|baseline|bottom`), `w:rtl` on runs.

**Behaviour**
- Justify writes `w:jc w:val="both"`; the "Distributed" variant (which justifies the last line too)
  writes `distribute`. The UI must not conflate them: Romanian and Russian contracts commonly use
  `both`, and `distribute` is the correct choice for justifying a short line of a form field.
- The last line of a justified paragraph is not stretched - that is layout's job (02), but this spec
  must declare that a trailing `w:br` forces the *preceding* text to be treated as a full line and
  therefore stretched, which is Word's behaviour and a frequent layout complaint.
- `w:jc` and justification must interact correctly with the East Asian `distribute`/`kashida` values
  on load: they must be preserved and shown as-is even though the RO/RU UI cannot produce them.
- **Text direction** in Word has three distinct things that must not be conflated:
  1. paragraph direction `w:bidi` (right-to-left paragraph) + run-level `w:rtl` - the "RTL/LTR"
     buttons;
  2. text *flow* direction `w:textDirection` (vertical text, `tbRl` etc.) - the "Text Direction"
     dialog;
  3. vertical text alignment within a line `w:textAlignment`.
  All three are exposed with Word's names and all three must round-trip. For an RO/RU product the
  first is the only one the HR persona will use, but the model must carry the other two.
- Alignment applies to whole paragraphs (a partial-paragraph selection aligns the whole paragraph, as
  in Word). Setting alignment with a multi-paragraph selection applies to every paragraph in it.
- Layout invalidation: `paragraph` for the affected paragraphs; `document` if the alignment change
  alters line breaking in a way that can move a page break? Alignment alone cannot change the number
  of lines, except for `distribute` on a single-word line (which is impossible) - so `paragraph` is
  sufficient, except that justification changes line *content* positions and thus the pixel positions
  of every line, so the invalidation must cover the whole paragraph range.
- Alignment must be preserved on empty paragraphs (an empty centred paragraph keeps its `w:jc`) -
  trivially true if the property is on the paragraph, but it must be visible in the toolbar when the
  caret is in an empty paragraph (I3).

**Edge cases**
- `w:jc w:val="start"`/`"end"` (ISO strict) and `left`/`right` (transitional) must be read as
  equivalent and written in the document's own conformance mode (01 owns the mode; this spec must
  not hardcode one spelling).
- A paragraph with `w:bidi` and `w:jc w:val="left"` is right-aligned visually; the toolbar must show
  the *logical* value ("Left") as Word does, and the reveal pane must show the logical value.
- Alignment inside a text box with `w:textDirection` vertical must still write `w:jc` (Word does).

---

#### FM-010 - Line spacing
**Priority:** core · **Effort:** M

**Commands:** `format.lineSpacing.set({ rule, value })` · **Events:** `format.changed`,
`document.changed`
**OOXML:** `w:pPr/w:spacing/@w:line` + `@w:lineRule` (`auto` = multiple, `atLeast`, `exact`);
`@w:before`/`@w:after` (twips), `@w:beforeLines`/`@w:afterLines` (hundredths of a line, for East
Asian layout).

**Behaviour**
- The three Word line-spacing rules and their storage:

  | UI | `w:lineRule` | `w:line` |
  | --- | --- | --- |
  | Single | `auto` | 240 |
  | 1.5 lines | `auto` | 360 |
  | Double | `auto` | 480 |
  | Multiple N | `auto` | `round(N * 240)` |
  | At least X pt | `atLeast` | `round(X * 20)` |
  | Exactly X pt | `exact` | `round(X * 20)` |

- Any multiple is allowed (Word's UI offers 0.5-3 plus the standard list); the library accepts
  0.05-132 and stores the rounded product, preserving the user's decimal in the UI model (not in the
  file, which has only integer twips).
- "At least" and "Exactly" are line *heights*, not distances between baselines, and their interaction
  with a large inline image is a layout rule (02): with `exact`, a line taller than the exact height
  is clipped; with `atLeast`, the line grows. The formatting layer must invalidate `document` for
  `atLeast`/`exact` changes because pagination is affected, and `paragraph` for `auto` changes with
  the same `w:line` (rare).
- Changing line spacing must never change `w:before`/`w:after` (they are independent - a common bug
  when a UI conflates "line spacing" with "paragraph spacing").
- `w:snapToGrid` (FM-016) interacts: with a document grid and `w:snapToGrid` on, `w:lineRule="auto"`
  line heights are rounded to the grid. The library must not "simplify" by disabling the grid.
- Spacing applies per paragraph; a paragraph's spacing must be visible and editable when the caret is
  in an empty paragraph.

**Edge cases**
- `w:lineRule="auto"` with `w:line` missing means single spacing; a missing `w:lineRule` with a
  `w:line` present is treated as `auto` (Word's tolerance for hand-edited files).
- A paragraph with `w:spacing/@w:beforeLines` (East Asian) uses the "lines" value in preference to
  `w:before`; both must be preserved and the UI must show the one that applies.
- Line spacing inside a table cell interacts with the cell's `w:tcMar`; the library must not fold
  cell margins into line spacing.

---

#### FM-011 - Paragraph spacing before/after and contextual spacing
**Priority:** core · **Effort:** M

**Commands:** `format.spaceBefore.set(pt)`, `format.spaceAfter.set(pt)`,
`format.contextualSpacing.set(on)`, `format.spacing.set({ before, after })`
**Events:** `format.changed`, `document.changed`
**OOXML:** `w:spacing/@w:before`, `@w:after` (twips), `@w:beforeAutospacing`, `@w:afterAutospacing`
(auto spacing for HTML-ish content), `w:contextualSpacing` (the toggle property implementing "Don't
add space between paragraphs of the same style" - note it is a **toggle property**, FM-021).

**Behaviour**
- Before/after are in points in the UI and twips in the file (1 pt = 20 twips); the dialog accepts
  0-1584 pt and stores the rounded value, preserving the user's decimal in the UI model.
- The distinction the UI must make: **line spacing** (within a paragraph) vs **spacing before/after**
  (between paragraphs) - the toolbars present them separately, and the dialog's "Spacing" group has
  both, as Word does.
- **`w:contextualSpacing`** means "do not add the before/after space between this paragraph and an
  adjacent paragraph that has the *same* paragraph style". Consequences that must be implemented:
  - the suppression is evaluated against the paragraph's **effective style id**, not against the
    resolved property values;
  - it applies between the two paragraphs, so a run of 5 identical paragraphs has internal spacing 0
    and external spacing before/after;
  - the toggle XOR rule applies (FM-021), so a style with `w:contextualSpacing` plus a paragraph with
    `w:contextualSpacing` resolves to *off* - a real Word oddity that the library must reproduce and
    the reveal pane (FM-008) must explain.
- Word's "Space Before/After" quick presets (0, 6, 12, 18, 24 pt; and the "Add space before/after
  paragraph" buttons) are UI shortcuts over the same properties and must not introduce new storage.
- Pagination-time suppression: whether space-before is applied at the top of a page and space-after
  at the bottom is controlled by `w:compat` settings (`suppressTopSpacing`, and the Word 2013+
  "suppress space before after a hard page or column break" option). The formatting layer must read
  and write the compat flag; the *decision* belongs to layout (02) - see §5 OI-8.
- `w:beforeAutospacing`/`w:afterAutospacing` (written by Word for HTML-ish pasted content) must be
  preserved, must suppress the numeric before/after while set, and must be clearable by the user
  editing the value (which writes the numeric value and clears the flag).

**Edge cases**
- Spacing between a paragraph and a table is applied (the table is not a paragraph); spacing between
  a paragraph and a content control is applied to the control's first/last paragraph, not to the
  control's boundary.
- A paragraph with spacing at the start of a table cell: Word drops the space before the first
  paragraph of a cell only when `w:tblCellSpacing`? No - Word *does* apply it. The library applies
  it and lets layout decide (02); this must be tested because it is a common "the cell has a gap"
  complaint.
- Setting spacing on a wholly-selected paragraph writes the paragraph's `w:spacing`; it must **not**
  write the paragraph mark's `rPr` (spacing is not character formatting).

---

#### FM-012 - Indentation: left, right, first line, hanging, mirror indents
**Priority:** core · **Effort:** M

**Commands:** `format.indent.set({ left, right, firstLine, hanging, mirror })`,
`format.indent.increase()`, `format.indent.decrease()` · **Events:** `format.changed`,
`document.changed`
**OOXML:** `w:pPr/w:ind/@w:left` (transitional) / `@w:start` (ISO strict), `@w:right`/`@w:end`,
`@w:firstLine`, `@w:hanging`, `@w:leftChars`/`@w:firstLineChars`/`@w:hangingChars` (hundredths of a
character, East Asian); `w:pPr/w:mirrorIndents`; `w:pPr/w:adjustRightInd`; `w:pPr/w:suppressOverlap`.

**Behaviour**
- The dialog's "Before text" = `w:left`, "After text" = `w:right`, "Special: First line" =
  `w:firstLine`, "Special: Hanging" = `w:hanging`. `w:firstLine` and `w:hanging` are mutually
  exclusive (both present is invalid; on read the later one in schema order wins and a diagnostic is
  emitted).
- The two quick buttons (Increase/Decrease Indent) step by **720 twips (0.5 in)** and must preserve
  the *relation* between the left indent and the special indent: if the paragraph was hanging, the
  hanging is preserved and only the left/`firstLine` pair moves together (this is
  `w:ind/@w:firstLine = w:left + hanging` bookkeeping and getting it wrong breaks bullets, which are
  hanging-indent paragraphs).
- **Integration with lists (normative):** a list paragraph's indents come from the numbering level's
  `w:pPr/w:ind` (which is a hanging indent). Increase/Decrease Indent on a list paragraph changes the
  **level** (FM-028), not the direct indent; the direct-indent buttons must not fight the numbering.
  A direct `w:ind` on a list paragraph overrides the level's indent for that paragraph only, and the
  UI must make that visible in the reveal pane.
- **Mirror indents** (`w:mirrorIndents`): when on, `w:left` becomes the indent on the *inside* edge
  and `w:right` the outside edge of facing pages. Required for the HR contract with mirrored binding
  margins; must be preserved and applied by layout (02).
- Character-unit indents (`w:leftChars` etc.) are preserved on read; the UI in an RO/RU product only
  writes twips absent East Asian content.
- Indent changes invalidate layout `paragraph` per paragraph, `document` when the paragraph is the
  last in a section or when `w:mirrorIndents` is toggled (it changes every paragraph in the section).

**Edge cases**
- A negative `w:left` is legal (text hangs into the margin) and must be accepted; a negative
  `w:firstLine` is not (that is what `w:hanging` is for) and must be rejected by the dialog.
- Tab stops (FM-013) are positioned relative to the **left indent**, not the page margin; moving the
  indent moves the stops' effective positions.
- Indentation inside a table cell is measured from the cell's text boundary (inside `w:tcMar`), not
  from the page; the reveal pane must state which.
- A paragraph inside a text box indents from the text box's content area.

---

#### FM-013 - Tab stops: default interval, explicit stops, leaders
**Priority:** important · **Effort:** M

**Commands:** `format.tabs.set(stops)`, `format.tabs.add(stop)`, `format.tabs.clearAll()`,
`format.tabs.defaultInterval.set(twips)` · **Events:** `format.changed`, `document.changed`
**OOXML:** `w:pPr/w:tabs/w:tab` (`@w:val` = `left|center|right|decimal|bar|clear|num|start|end`,
`@w:pos` in twips relative to the left indent, `@w:leader` = `none|dot|hyphen|underscore|heavy|middleDot`),
`w:settings/w:defaultTabStop` (the document-level default interval, in twips).

**Behaviour**
- The Tabs dialog lists explicit stops (position, alignment, leader), the default interval, and
  Set/Clear/Clear All. `@w:pos` is relative to the **left indent**; the dialog shows absolute
  positions from the margin (Word's UI) and converts - this conversion is a frequent source of
  off-by-an-indent bugs and must be done in one place.
- `w:val="clear"` is a real, meaningful value: it clears a tab stop **inherited from a style** at
  that position. Clearing an inherited stop must write `clear`, not delete a nonexistent element.
- Default interval from `w:settings/w:defaultTabStop` (Word's default 720 twips = 0.5 in). Changing
  it is a document-level setting, not a paragraph property, and must re-flow the entire document.
- `bar` tab stops draw a vertical rule and consume no advancing width; `decimal` stops align the
  decimal separator and must use the **paragraph's language decimal separator** (`.` in RO and
  Russian is `,` - the Russian and Romanian decimal separator is `,`), which is why the language of
  the paragraph must be consulted; alignment happens at the separator, with the text before it
  right-aligned and after it left-aligned (the classic column-of-numbers case in a price list).
- Tab stops interact with the default interval: typing a tab when no explicit stop lies ahead
  advances to the next *default* stop, and the tab's rendered width depends on where the previous
  tab ended (Word's rule: the default stops are a grid from the left indent, and each default tab
  advances to the next grid position strictly after the current pen position).
- `w:ind/@w:firstLine` with tabs and the AutoFormat rule (ED-020 item 11) write the same properties
  through one code path.
- The toolbar's ruler, when present, must render stop markers and allow drag/move/delete with one
  undo entry per gesture (I2).

**Edge cases**
- A tab stop beyond the right margin is legal and must be preserved and rendered (text runs past the
  margin).
- Two stops at the same position: the last one in schema order wins, and the dialog must de-duplicate
  on write.
- Tab stops in a paragraph inside a table are measured from the cell's text boundary.
- `w:tab` in a paragraph with a `bar` stop: the bar is drawn but the text does not advance; a tab
  immediately followed by another tab must still advance once per tab.

---

#### FM-014 - Paragraph borders and shading
**Priority:** important · **Effort:** M

**Commands:** `format.paragraphBorder.set(spec|null)`, `format.paragraphShading.set(spec|null)`,
`format.paragraphBorder.applyPreset(name)`, `format.paragraphBorder.clear()` ·
**Events:** `format.changed`, `document.changed`
**OOXML:** `w:pPr/w:pBdr` (`w:top`, `w:left`, `w:bottom`, `w:right`, `w:between`, `w:bar` - each with
`@w:val`, `@w:sz` in eighths of a point, `@w:space` in points, `@w:color`, `@w:themeColor`,
`@w:shadow`, `@w:frame`), `w:pPr/w:shd` (`@w:val`, `@w:color`, `@w:fill`, theme variants).

**Behaviour**
- Four sides plus **between** (borders between consecutive paragraphs with the same border
  definition - Word's "between" for a bordered block) and **bar** (a vertical bar at the paragraph's
  left, used with `w:ind` for a change-bar look, which is exactly the "contract clause" visual that
  HR templates use).
- Border width in the UI is in points (0.25-6 pt) and stored in eighths of a point; the dialog must
  offer Word's standard ladder (0.5, 0.75, 1.5, 2.25, 3, 4.5, 6 pt) plus "custom".
- The 24 border styles of OOXML must be supported (`single`, `double`, `dotted`, `dashed`,
  `triple`, `thinThickSmallGap`, `thickThinSmallGap`, `wave`, `doubleWave`, `dashSmallGap`,
  `dotDash`, `dotDotDash`, `threeDEmboss`, `threeDEngrave`, `outset`, `inset`, `nil`, `none`, …).
  `w:val="none"` and `w:val="nil"` are different: `nil` draws nothing and is the explicit
  "no border"; `none` means "no border *and* do not inherit one". Both must be preserved, and
  clearing an inherited border must write `nil` (otherwise the style's border resurfaces).
- **Box vs custom**: applying a preset box writes all four sides; the dialog's preview must show a
  per-side state and the "Settings: Custom" state must be entered whenever the sides differ.
- The border-offset (`@w:space`, 0-31 pt) is the gap between the text and the border; the UI exposes
  it as "Options → Distance from text".
- **`w:shd` for a paragraph is drawn behind the text and spans the full paragraph extent including
  the indent**; the UI must note that a paragraph shading with a hanging indent covers the indent
  too, because that is what users expect of a "highlighted clause".
- Shading patterns behave exactly as FM-003's character shading (pattern colour vs fill colour).
- `w:pBdr` and the table's `w:tblBorders` are independent: a paragraph inside a table may have its
  own borders, and clearing the paragraph's borders must not touch the table's.

**Edge cases**
- `w:between` only renders between paragraphs that share the same border set; the reveal pane must
  say "between (applies to consecutive paragraphs with the same borders)".
- Borders on the first/last paragraph of a table cell: `w:top` on the first paragraph renders at the
  cell's top; the library writes what the user asked and does not attempt to normalise to
  `w:tblBorders`.
- A paragraph border interacts with pagination: borders are repeated across a page break depending on
  `w:pBdr` and the "surround" behaviour; that is layout's decision (02), but the formatting layer
  must not strip borders when a paragraph splits.
- Applying shading to a paragraph with a `w:br`-separated "line" does not shade a rectangle - shading
  is per paragraph. The UI must not promise "shade this line" for a line created with Shift+Enter.

---

#### FM-015 - Paragraph dialog: Indents and Spacing, Line and Page Breaks, Tabs
**Priority:** core · **Effort:** L

**Commands:** `view.openParagraphDialog()`, `format.paragraph.applyChanges(delta)` ·
**Events:** `format.changed`, `document.changed`
**OOXML:** writes any of `w:pPr`'s children: `w:jc`, `w:outlineLvl`, `w:ind`, `w:spacing`,
`w:contextualSpacing`, `w:keepNext`, `w:keepLines`, `w:pageBreakBefore`, `w:widowControl`,
`w:suppressLineNumbers`, `w:suppressAutoHyphens`, `w:snapToGrid`, `w:tabs`, `w:pBdr`, `w:shd`,
`w:textboxTightWrap`, `w:framePr`.

**Behaviour**
- Tabs and their fields, matching Word:
  - **Indents and Spacing**: Alignment, Outline level, Indentation (Left, Right, Special
    `(none)|First line|Hanging` + By), Spacing (Before, After, "Don't add space between paragraphs of
    the same style" = `w:contextualSpacing`, Line spacing + At).
  - **Line and Page Breaks**: Pagination (Widow/Orphan control = `w:widowControl`, Keep with next =
    `w:keepNext`, Keep lines together = `w:keepLines`, Page break before = `w:pageBreakBefore`);
    Formatting exceptions (Suppress line numbers = `w:suppressLineNumbers`, Don't hyphenate =
    `w:suppressAutoHyphens`); Textbox (Wrap text / Do not wrap = `w:textboxTightWrap` values
    `none|allLines|firstAndLastLine|firstLineOnly|lastLineOnly`, and "Fit text to shape" - a text box
    property owned by 02/01, shown here for completeness and written through the drawing layer).
  - **Tabs**: as FM-013.
- **The dialog is differential (normative).** It shows the *resolved* value for a uniform selection
  and a blank/mixed state for a mixed one. Fields the user does not touch are **not** written. This
  is what makes the dialog usable with a mixed selection and it is the main difference between a
  correct implementation and one that flattens the selection's formatting on OK.
- **Mixed-state semantics**: a blank field with a mixed selection, left untouched, writes nothing; a
  blank field the user *fills in* writes that value to every paragraph in the selection; a field the
  user clears (to empty) writes the property's neutral value as direct formatting.
- **Outline level** (`w:outlineLvl`, 0-8 for Level 1-9, 9/Body text): a direct property that
  overrides the style's outline level and is the mechanism behind the Navigation pane and the TOC.
  The dialog's list must show "Body Text" for `w:outlineLvl w:val="9"` and must write the property,
  noting in the help text that using a Heading style is the recommended route.
- **OK is one undo entry** (I2); Cancel writes nothing; the unit-of-measure setting (inches, cm, mm,
  pt, picas) comes from the host's locale settings and must convert on read/write without changing
  the stored twips (never round-trip through a formatted string and back - that loses precision and
  is a visible bug when a paragraph's indent drifts by 1 twip on every open/OK).
- The dialog must reflect a live preview where the layout engine supports it (02): changes are
  previewed transiently and committed on OK as one entry, and Cancel reverts the preview without
  touching the undo stack (this is exactly ED-025's transient-gesture rule applied to a dialog).
- Validation: mutually exclusive fields (First line vs Hanging), ranges (indent −31680..31680 twips,
  spacing 0..31680, line spacing 0.05..132 or 1..1584 pt), and errors are reported inline with OK
  disabled rather than writing a clamped value silently.

**Edge cases**
- The dialog opened on a selection that spans a table boundary must show the union of the
  paragraphs' states and apply to every paragraph, including cell paragraphs.
- The dialog's "Page break before" writes `w:pageBreakBefore`, which is a *different* encoding from
  Ctrl+Enter's `w:br w:type="page"` (ED-013); the UI must not pretend they are the same, and the
  reveal pane must show both.
- The dialog is fully usable in read-only mode with all inputs disabled and a note explaining why
  (ED-038's canExecute contract drives the disabled states).
- Applying changes when nothing changed does not create an undo entry (I4).

---

#### FM-016 - Pagination and line-break rules: keepNext, keepLines, pageBreakBefore, widowControl, hyphenation, snap to grid
**Priority:** core · **Effort:** M

**Commands:** `format.pagination.set({ keepNext, keepLines, pageBreakBefore, widowControl })`,
`format.hyphenation.set({ auto, zone, limit, doNotHyphenateCaps })`,
`format.hyphenation.manual()` (*later*), `format.snapToGrid.set(on)`
**Events:** `format.changed`, `document.changed`
**OOXML:** `w:pPr/w:keepNext`, `w:keepLines`, `w:pageBreakBefore`, `w:widowControl`,
`w:suppressLineNumbers`, `w:suppressAutoHyphens`, `w:snapToGrid`, `w:kinsoku`, `w:wordWrap`,
`w:overflowPunct`, `w:topLinePunct`, `w:autoSpaceDE`, `w:autoSpaceDN`, `w:suppressOverlap`;
document level: `w:settings/w:autoHyphenation`, `w:hyphenationZone`, `w:consecutiveHyphenLimit`,
`w:doNotHyphenateCaps`, `w:evenAndOddHeaders`, `w:characterSpacingControl`;
`w:softHyphen` for manual breaks.

**Behaviour**
- The four pagination toggles are tri-state in the UI (on / off / mixed) but are **not** toggle
  properties in the resolution sense for `w:keepNext`/`w:keepLines`/`w:pageBreakBefore`: they are
  ordinary booleans where "absent" means off. `w:widowControl` is the exception: its **default is
  on**, so `w:widowControl w:val="0"` disables it and the absence of the element means on. The UI
  must therefore write `w:widowControl w:val="0"` for "off" and *remove* the element for "on" only
  when the style does not supply it - otherwise the user cannot turn widow control back on.
- `w:keepNext`/`w:keepLines` would appear to be toggle properties; per ECMA-376 they are **not** in
  the toggle list (FM-021) and must be resolved as ordinary booleans with the highest level winning.
  This must be verified against Word (§5 OI-1) because a wrong choice here produces keep-with-next
  that mysteriously turns off when a style sets it.
- Applying `w:keepNext` to a whole selection of paragraphs is correct and common ("keep this clause
  together"); applying it only to the last paragraph before a table is the other common case.
- **Hyphenation** settings are document-level (`w:settings`) except the per-paragraph opt-out
  (`w:suppressAutoHyphens`). The zone is in twips (Word's UI is in 0.1 in from the right margin);
  the consecutive-hyphen limit caps consecutive hyphenated lines. Automatic hyphenation requires a
  **hyphenation dictionary per language**, and RO and RU are the required ones (see §5 OI-5);
  without a dictionary for a paragraph's language the paragraph is not hyphenated and a
  `hyphenation.unavailable (lang)` diagnostic is emitted once per language per session.
- **Manual hyphenation** (Word's Hyphenation → Manual) inserts `w:softHyphen` at the user-chosen
  points and is a *later* feature; the property and the deletion/selection rules for `w:softHyphen`
  (ED-014/ED-015) are core and ship first.
- **Snap to grid**: `w:pPr/w:snapToGrid` (per paragraph, default on) together with the document grid
  (`w:docGrid` in `w:sectPr`, owned by 01/02). The formatting layer owns the toggle and must
  invalidate `document` when it changes, because line heights across the document change.
- The East Asian line-breaking properties (`w:kinsoku`, `w:wordWrap`, `w:overflowPunct`,
  `w:topLinePunct`, `w:autoSpaceDE`, `w:autoSpaceDN`) are preserved on round-trip and are exposed
  behind an "Asian typography" section that is hidden for RO/RU-only documents.
- All of these are per-paragraph properties applied to every paragraph in the selection, including
  paragraphs inside tables and nested tables, and including the paragraph mark of the last paragraph
  of a cell.

**Edge cases**
- `w:pageBreakBefore` on the first paragraph of a table cell is meaningless; the UI must disable the
  checkbox and the command must reject it with `code: 'inapplicable'`.
- A `w:keepLines` paragraph taller than a page: layout must break it anyway (02) and must not loop.
- `w:consecutiveHyphenLimit` of 0 means unlimited; the UI must show "no limit".
- Setting `w:widowControl` on for a paragraph that inherits `val="0"` from its style requires writing
  `w:widowControl w:val="1"` explicitly (an absent element would inherit off); the resolution rules
  for this property must be covered by a dedicated test (§5 OI-1).

---

### 3.3 Styles

#### FM-017 - Styles gallery and the Styles pane
**Priority:** core · **Effort:** L

**Commands:** `view.openStylesPane()`, `styles.setPaneOptions(options)`,
`styles.setGalleryFilter(filter)`, `styles.reorder(styleIds)`
**Events:** `styles.changed`, `view.changed`
**OOXML:** `w:styles` listing (`w:style/@w:styleId`, `@w:type`, `@w:default`, `@w:customStyle`,
`w:name`, `w:aliases`, `w:basedOn`, `w:next`, `w:link`, `w:autoRedefine`, `w:hidden`, `w:semiHidden`,
`w:unhideWhenUsed`, `w:qFormat`, `w:uiPriority`, `w:locked`, `w:personal*`), `w:latentStyles` with
`w:lsdException`.

**Behaviour**
- **Gallery contents**: the gallery shows styles that (a) match the gallery's type filter
  (paragraph / character / table / list), (b) have `w:qFormat` (shown in the gallery), and (c) are
  not `w:hidden`/`w:semiHidden` unless the pane options say otherwise. Ordering is by
  `w:uiPriority` ascending, then by name; a style with no `w:uiPriority` sorts after those that have
  one (Word's behaviour).
- **Previews**: each gallery entry renders a preview using the layout engine (02 is asked to render a
  sample string with the style applied) showing at least the font, size, colour, and for paragraph
  styles the indentation/alignment. Preview caching must be per style revision and must not re-render
  on every selection change; the gallery must remain responsive with 200+ styles.
- **Styles pane options**: list ("In use" / "In current document" / "All styles" - this maps to
  filtering by `w:semiHidden`/`w:unhideWhenUsed` and whether the style is referenced),
  "Show previews", "Show recommended styles" (filtering by `w:uiPriority`), "Sort by: name / priority
  / recommended", "Disable Linked Styles", and "Select All N instances" on a style's context menu.
- **Styles with the same name but different ids** must be shown as distinct entries with a
  disambiguation suffix, because a document produced by merging two contracts commonly has
  `Heading1` and `Heading1_1` both named "heading 1"; hiding the second one is a data-loss-shaped bug.
- The pane's context menu must offer: Apply, Modify, Delete, Rename, Select All N, Add Gallery to
  Quick Access Toolbar, Remove from Style Gallery (`w:qFormat` off), Hide Until Used
  (`w:semiHidden` + `w:unhideWhenUsed`), and the "New Style"/"New Style from Selection" entries.
- `styles.changed` must be emitted for every mutation of the styles part so the pane, the gallery and
  the reveal pane refresh from one source of truth.
- The gallery and pane must be driven by the same style list model, so a change in the resolution of
  "recommended" does not make the two disagree.
- Dragging a style in the gallery writes `w:uiPriority` values (a reorder is one undo entry) - the
  gallery order is *document data*, not a user preference, and must round-trip.

**Edge cases**
- A style whose `w:name` is a built-in name (e.g. "heading 1") must be recognisable as a built-in for
  the UI's icons and for the `w:link` pairing, and matching must be by name, case-insensitively, not
  by `w:styleId` (Word matches built-ins by name; a document with `w:styleId="H1"` and
  `w:name w:val="heading 1"` is a Heading 1).
- A style referencing a missing `w:basedOn` must still appear in the gallery and apply what it does
  specify (FM-020).
- The gallery must show the *current* style of the selection as pressed, resolved via the same
  cascade as FM-021/FM-022 (for a mixed selection, no style is shown as pressed).
- A character style applied to a caret's typing context (not to any text) must show as pressed while
  the caret is there (Word's "next text" behaviour, ED-012).

---

#### FM-018 - Applying styles: paragraph, character, linked, table, list
**Priority:** core · **Effort:** L

**Commands:** `style.applyParagraph(styleId, { clearDirect })`, `style.applyCharacter(styleId)`,
`style.applyToAll(styleId)`, `style.applyShortcut(key)` · **Events:** `styles.changed`,
`format.changed`, `document.changed`
**OOXML:** `w:pPr/w:pStyle`, `w:rPr/w:rStyle`, `w:tblPr/w:tblStyle`, `w:pPr/w:numPr` (from a list
style), `w:style/@w:type`, `w:link`, `w:aliases`; the `w:style/w:key`-equivalent shortcut storage is
**not** representable in OOXML (see behaviour).

**Behaviour**
- **Applying a paragraph style writes only `w:pPr/w:pStyle` and never removes direct formatting.** A
  user who applies "Heading 1" to a paragraph with direct bold keeps the bold (and the toolbar shows
  bold) - this is Word's behaviour and it is the number-one source of "the style does not work"
  confusion. The library must expose `clearDirect: true` as an explicit option and surface the
  distinction in the UI ("Apply style" vs "Apply style and clear direct formatting"):
  - `w:pStyle` is written on every paragraph in the selection;
  - the **paragraph mark's `rPr`** is *not* modified (the style supplies it);
  - `w:numPr` from the paragraph's direct formatting is **kept** (a direct list membership survives a
    style change) - this is Word's behaviour and it means applying "Normal" to a list item does not
    remove the list (FM-030 covers removing numbering explicitly).
- **Applying a character style** writes `w:rStyle` on every run in the selection and on the caret's
  typing context for a collapsed selection. Word's rule for a collapsed caret: the character style
  becomes the "next typed text" style and is written when typing starts (ED-012 writes it as the new
  run's `w:rStyle`).
- **Linked styles** (`w:style/@w:link`): applying a linked *paragraph* style also applies its linked
  character style (`w:rStyle`) to all runs in the paragraph, so that a subsequent "clear paragraph
  formatting" (Ctrl+Q) leaves the character half intact (Word's behaviour). Applying the linked
  *character* style writes only `w:rStyle`.
- **Table styles** are applied to a `w:tbl` (`w:tblPr/w:tblStyle`) with the conditional-formatting
  flags in `w:tblLook`; the apply command lives here, the table model and its dialogs belong to the
  table spec. Applying a table style to a *selection of cells* is not a thing in Word and must be
  rejected.
- **List styles** (`w:style/@w:type="numbering"`) are applied by writing `w:pPr/w:numPr/w:numId`
  pointing at a `w:num` whose abstract definition is the list style's (FM-030). Applying a list style
  to a paragraph style's definition is also supported (a paragraph style whose `w:pPr` contains
  `w:numPr`), which is how "List Paragraph" and Word's numbered-heading styles work.
- **Style shortcut keys** (`Ctrl+Alt+1` for Heading 1, `Ctrl+Alt+2`, `Ctrl+Alt+3`,
  `Ctrl+Shift+N` for Normal, `Ctrl+Shift+L` for List Bullet) are built-in bindings resolved by the
  style's built-in **name**, not by id. Custom per-style shortcut keys are not representable in
  OOXML (Word stores them in the user's template/registry), so the library stores them in its
  settings extension part and documents them as non-standard; the built-in bindings must always work
  even when the style has been renamed.
- Applying a style updates the *whole* paragraph even if the selection is partial (Word); applying a
  character style to a partial selection applies to the intersected runs only.
- One undo entry per application, containing the `pStyle`/`rStyle` writes for all paragraphs/runs
  (I2). Applying the style already in force is a no-op (I4).
- `style.applyToAll(styleId)` ("Select All N instances" then a change) is a *query* plus a bulk
  apply; the bulk apply must be one undo entry and must report `affectedRanges` (ED-006).

**Edge cases**
- Applying a paragraph style to a paragraph inside a content control must not remove the control; the
  control's `w:sdtPr/w:rPr` may still override the appearance, which the reveal pane must explain.
- A style that does not exist in the document: `style.applyParagraph('Missing')` is rejected with
  `code: 'style-not-found'`; the library must not silently create the style (creating is FM-019).
- Applying a character style to a `w:sym` run (ED-015) is allowed and writes `w:rStyle` alongside the
  symbol's font.
- Applying a style inside a read-only document is rejected (ED-038).

---

#### FM-019 - Creating and modifying styles: update to match, autoRedefine, next style
**Priority:** core · **Effort:** L

**Commands:** `style.create(definition)`, `style.createFromSelection({ name, type })`,
`style.modify(styleId, delta)`, `style.updateToMatchSelection(styleId, { alsoUpdate })`,
`style.setAutoRedefine(styleId, on)`, `style.setNextStyle(styleId, nextStyleId)`,
`style.setShortcut(styleId, key)`, `style.setBasedOn(styleId, baseStyleId)`
**Events:** `styles.changed`, `document.changed` (only when the definition change alters existing
content's appearance - see below)

**Behaviour**
- `style.create` requires: `type` (`paragraph|character|table|numbering`), `name`, and either a
  `basedOn` style or an explicit `pPr`/`rPr`; it writes a new `w:style` with a generated `w:styleId`
  (a sanitised ASCII id, unique in the document, deterministic per ED-039) and `w:customStyle="1"`
  for user styles. Name uniqueness is enforced against `w:name` across the same type; a collision
  appends " 2".
- `style.createFromSelection` ("New Style from Selection") captures the selection's **resolved**
  formatting as direct `pPr`/`rPr` in the style definition, with the option to include (a) the
  character formatting, (b) the paragraph formatting, (c) numbering, (d) the basedOn style, and
  (e) the "Style for following paragraph" (`w:next`) - Word's New Style dialog's fields, all of
  which must be offered.
- **`style.modify` semantics for existing content**: a style's definition is data that existing
  paragraphs resolve against, so modifying it changes them. The command must:
  1. re-resolve and re-invalidate every paragraph (and run) that uses the style or a style based on
     it - layout invalidation `document`, because a modified style can change any metric;
  2. return the affected ranges in `CommandResult` so the host can refresh;
  3. be one undo entry whose inverse restores the previous `w:pPr`/`w:rPr` verbatim including
     element order.
- **"Update to match selection"** (`style.updateToMatchSelection`) writes the selection's resolved
  formatting *minus* what the basedOn chain already supplies (otherwise every update accumulates the
  entire cascade into the style and the style becomes unmaintainable - this de-duplication is
  required and must be tested by modifying a style twice and asserting the definition does not grow).
  The dialog must offer Word's "Automatically update" (`w:autoRedefine`) as a per-style flag: when
  set, applying direct formatting to a paragraph of that style **redefines the style** instead of
  writing direct formatting. `w:autoRedefine` must be honoured (it is used by template authors) and
  must be visible in the pane so a user can turn it off.
- **`w:next`** ("Style for following paragraph"): used by ED-013 on Enter at the end of a paragraph.
  The dialog must offer it for paragraph styles, and the value must be validated (a `w:next` pointing
  at a character style is invalid and is normalised to the same style with a diagnostic).
- **`w:basedOn`** changes: the command must reject a change that would create a cycle (FM-020) and
  must warn when the new base style does not supply a property the style relied on (the resolved
  appearance changes; the warning lists the properties).
- Every mutation here emits `styles.changed` with the affected style ids and the document revision.
- The dialogs (New Style, Modify Style, Style Based On, Style for Following Paragraph) are
  differential in the same way as FM-015: untouched fields are not written into the definition.
- Modifying a style that is protected (`w:style/w:locked`) must be rejected unless the host overrides
  (`w:locked` is honoured for built-in styles in protected documents; see §5 OI-9 for the exact
  interaction).

**Edge cases**
- Creating a style whose name collides with a **latent/built-in** style must *materialise* that
  built-in style (FM-023) rather than creating a differently-named custom style - Word's behaviour
  and the thing that makes "New Style called 'Heading 4'" work.
- Modifying a style while a document is protected in `readOnly` mode is rejected; in `comments` mode
  it is rejected; in `forms` mode it is rejected unless the style is not used by protected content
  (the library's rule: style modification requires unrestricted editing).
- `style.modify` on a style used by another style's `w:basedOn` must re-resolve the dependents;
  `styles.changed` must list them.
- Undo of a style creation must remove the style and every reference to it that the creation itself
  introduced (none, in the normal flow, because the apply is a separate command - but the *combined*
  gesture "create and apply" is one entry and must remove both).

---

#### FM-020 - Style inheritance: basedOn chains, link, type, cycles, missing targets
**Priority:** core · **Effort:** L · **Depends:** FM-021, FM-022

**Commands:** `style.resolve(styleId)` (diagnostic), `style.repairInheritance(scope)`
**Events:** `styles.changed`
**OOXML:** `w:style/w:basedOn`, `w:style/w:link`, `w:style/@w:type`, `w:style/@w:default`,
`w:style/w:aliases`, `w:docDefaults`.

**Behaviour**
- **Chain resolution**: a style's properties are the union of its own `w:pPr`/`w:rPr` over its
  `w:basedOn` ancestor's, resolved from the root ancestor down to the applied style (the applied
  style wins). "Wins" means per-property, not per-element: a style that sets only `w:sz` does not
  erase its ancestor's `w:color`.
- **Type constraint**: a style may only be based on a style of the **same type**. A paragraph style
  based on a character style (or vice versa) is invalid; on read, the invalid `w:basedOn` is ignored
  with a `styles.invalidInheritance` diagnostic, and `style.repairInheritance` can remove it. A
  numbering style's `w:basedOn` is likewise ignored (numbering styles do not inherit through
  `w:basedOn`; they inherit through `w:styleLink`/`w:numStyleLink`, FM-030).
- **Cycles**: `A basedOn B basedOn A` is invalid. Detection must be cycle-safe (a visited set) and
  must never recurse unboundedly; a detected cycle is broken at the point where the revisit occurs,
  a diagnostic is emitted, and resolution proceeds with the truncated chain (Word's behaviour is to
  ignore the offending link). `w:link` cycles are detected separately.
- **Missing targets**: a `w:basedOn`/`w:next`/`w:link` pointing at a style id that does not exist is
  tolerated: the reference is ignored for resolution, the attribute is **preserved** on save (so a
  round trip does not destroy information that another producer might resolve), and a diagnostic is
  emitted. The same rule for `w:link` (a paragraph style whose linked character style is missing
  simply has no character half).
- **`w:link`** pairs a paragraph style with a character style so that the pair behaves as one style
  in the UI ("linked style"). Both directions must be honoured (`A.w:link = B` and `B.w:link = A`),
  a one-sided link is repaired on demand, and the "Disable linked styles" pane option (FM-017) makes
  the UI treat the two halves independently without changing the file.
- **`w:default`**: exactly one paragraph style and one character style may carry `w:default="1"`;
  when several do, the first in the part wins and a diagnostic is emitted; when none does, the
  library synthesises the standard defaults in memory (and does **not** write them unless the
  document is modified elsewhere).
- **`w:aliases`**: a style may have alternative names, comma-separated; lookups by name must consider
  the primary `w:name` first, then the aliases (Word's `w:name` for a renamed built-in keeps the
  built-in name and adds the user's name as an alias - the library follows the same convention so
  that built-in detection keeps working).
- **Diagnostics** (`styles.invalidInheritance`, `styles.cycle`, `styles.missingTarget`) must be
  emitted once per document revision, not per resolution call, or a resolution-heavy operation
  (a Replace All over a big document) will emit thousands of events.
- Chain resolution must be **cached** per `(styleId, stylesPartRevision)`; the cascade is the hottest
  path in the whole library (every toolbar update, every layout line, every reveal pane refresh) and
  a naive implementation resolves the chain per character.

**Edge cases**
- A style based on a style that is based on *itself* through a longer chain (A→B→C→B): the cycle is
  broken at B and C still contributes.
- Two styles with the same `w:styleId` (a malformed part) - the first wins, the second is renamed on
  demand with a diagnostic.
- `w:basedOn` on a style whose base is `w:hidden`: the hidden flag is **not** inherited (visibility
  is not an inheritable property), and the UI must not hide the dependent style.
- `w:qFormat`, `w:uiPriority`, `w:hidden`, `w:semiHidden`, `w:unhideWhenUsed`, `w:locked`,
  `w:autoRedefine` are **not** inherited through `w:basedOn` (they are style metadata, not
  formatting); treating them as inherited is a subtle and visible bug (a style disappears from the
  gallery because its base is hidden).

---

#### FM-021 - Effective formatting resolution for runs (Word's cascade, toggle XOR)
**Priority:** core · **Effort:** XL · **Depends:** FM-020

**Commands:** `format.query(range)` (read-only; the API behind every toolbar state)
**Events:** none (pure read; `format.changed` is emitted by the commands that mutate)
**OOXML:** reads `w:docDefaults/w:rPrDefault/w:rPr`, `w:style` (paragraph and character, with
`w:basedOn` chains), `w:pPr/w:rStyle`? no - `w:rPr/w:rStyle`, `w:p/w/pPr/w:rPr` (the paragraph
mark), `w:abstractNum/w:lvl/w:rPr`, `w:tblStyle` conditional formats, `w:r/w:rPr` (direct).

**Behaviour**
- **Resolution order for a character position, from lowest to highest priority** (later wins):
  1. `w:docDefaults/w:rPrDefault/w:rPr`;
  2. the default *character* style (`w:style[@w:type='character'][@w:default='1']`, normally "Default
     Paragraph Font"), resolved through its chain;
  3. the paragraph's **paragraph style chain** - the paragraph style's `w:basedOn` ancestors from the
     root down to the applied style, then the default paragraph style beneath it;
  4. the **numbering level's** `w:rPr` (`w:numPr/w:ilvl` → `w:abstractNum/w:lvl/w:rPr`) - applies
     **only to the number's own text**, not to the paragraph's runs, and is therefore consulted only
     when resolving the glyph run of a list number;
  5. the **table style's** `w:rPr` for the conditional formats that apply
     (`w:tblLook` bits + `w:cnfStyle` on the row/cell), for runs inside a table;
  6. the **character style chain** from the run's `w:rStyle` (root ancestor → applied style);
  7. the run's **direct** `w:rPr`.
  The position of level 5 relative to level 3 is the one part of this order that is genuinely
  ambiguous against Word's observed behaviour - see §5 OI-1. The implementation must make the order a
  single ordered list of "levels" so it can be changed in one place.
- **Toggle properties** resolve by a different rule from ordinary properties (ECMA-376 §17.7.3):
  the toggle set for runs is `w:b`, `w:bCs`, `w:i`, `w:iCs`, `w:caps`, `w:smallCaps`, `w:strike`,
  `w:dstrike`, `w:outline`, `w:shadow`, `w:emboss`, `w:imprint`, `w:vanish`, `w:webHidden`.
  - Direct formatting (`w:r/w:rPr`) is **absolute**: present with `w:val="1"` (or with no `w:val`)
    means on; present with `w:val="0"` means off.
  - Along the style levels (2, 3, 5, 6), a toggle that is present and true **flips** the value
    accumulated from the lower levels; a toggle that is present and **false contributes nothing**
    (it does not force off). The default value at the bottom is false.
  - Consequence, which must be reproduced and documented: `docDefaults` with `<w:b/>` plus a
    paragraph style with `<w:b/>` yields **not bold**, because the value flips twice. This is Word's
    behaviour and users do hit it; the reveal pane (FM-008) must show both levels so it is
    explicable.
  - `<w:b w:val="false"/>`/`"0"` in a style is *not* a way to turn bold off; the UI must therefore
    write `w:b w:val="0"` **directly on the run** when the user turns bold off for text that a style
    bolds.
- **Ordinary (non-toggle) properties** resolve by "highest level that specifies it wins", where
  "specifies" means the element/attribute is present, regardless of value.
- **Null/none values** are real values and must win: `w:u w:val="none"`, `w:highlight w:val="none"`,
  `w:color w:val="auto"`, `w:bdr w:val="nil"`. Stripping them makes the style's value resurface and
  is a visible regression.
- **`w:lang`, `w:noProof`, `w:rStyle` and `w:vanish`** participate in the cascade like ordinary
  properties (`w:lang` per script class, 1.8).
- **The paragraph mark's `rPr`** (`w:p/w/pPr/w:rPr`) is resolved by the *same* algorithm with the
  paragraph's own style chain, and is the source for: formatting of an empty paragraph, formatting
  displayed when a whole paragraph is selected and no run applies, and the formatting inherited when
  typing at the end of a paragraph (ED-012). When character formatting is applied to a selection that
  covers whole paragraphs, the command writes both the runs and the mark (FM-001).
- **Performance**: the resolver must be a pure function of `(documentRevision, position)` memoised
  per paragraph revision and per run, and must support a "partial" query for one property (the
  toolbar's bold state must not resolve the whole property set).
- **Testability**: the algorithm must be implemented against a declarative fixture format (a
  mini-document + expected resolved values per property) so the ~40 Word compatibility cases,
  especially the toggle cases, are data, not code.

**Edge cases**
- A run with no `w:rPr` inside a paragraph whose style supplies bold: bold is on.
- A run inside a `w:ins` (a tracked insertion): the run's `w:rPr` is the insertion's, and the
  resolution is otherwise unchanged (04 may mark it visually).
- A run inside a `w:sdt` whose `w:sdtPr/w:rPr` sets a font: the control's `w:rPr` applies to the
  *placeholder text* only, not to the control's real content (a common misreading that produces
  "the date field is blue but the typed date is not").
- `w:rStyle` on the run pointing at a paragraph style is invalid; it is ignored with a diagnostic.
- Hidden text (`w:vanish`) resolves as an ordinary toggle and must be excluded from layout when
  `view.showHiddenText` is off (ED-037) - resolution does not change, rendering does.

---

#### FM-022 - Effective formatting resolution for paragraphs (numbering, table styles, paragraph mark)
**Priority:** core · **Effort:** XL · **Depends:** FM-020, FM-021

**Commands:** `format.queryParagraph(range)` · **Events:** none (read-only)
**OOXML:** reads `w:docDefaults/w:pPrDefault/w:pPr`, `w:style` (paragraph, table, numbering),
`w:pPr` (direct), `w:abstractNum/w:lvl/w:pPr`, `w:tblStyle` + `w:tblLook` + `w:cnfStyle`,
`w:pPr/w:rPr`.

**Behaviour**
- **Resolution order for a paragraph, from lowest to highest priority:**
  1. `w:docDefaults/w:pPrDefault/w:pPr`;
  2. the **default paragraph style** (`w:style[@w:type='paragraph'][@w:default='1']`, normally
     "Normal") and its `w:basedOn` chain;
  3. the paragraph's **paragraph style chain** (root ancestor → applied style);
  4. the **numbering level's** `w:pPr` (`w:numPr/w:ilvl` → `w:abstractNum/w:lvl/w:pPr`): supplies
     `w:ind` (the hanging indent for the number) and `w:tabs` (the tab after the number) and,
     rarely, `w:jc`. A `w:numPr` whose `w:ilvl` exceeds the definition's last level is clamped to the
     last level.
  5. the **table style's** `w:pPr` for the applicable conditional formats, for paragraphs inside a
     table (a table style's `w:pPr` supplies `w:spacing`, `w:ind`, `w:jc` for cells);
  6. the paragraph's **direct** `w:pPr`.
  Order rationale and the one ambiguous rung (level 5 vs 3) are the same as FM-021 - see §5 OI-1.
- **`w:numPr` is not a formatting property but a structural one**, yet it participates here because
  the level's `w:pPr` contributes indentation. The rule: a direct `w:ind` on the paragraph
  **overrides** the numbering's indent for that paragraph; a direct `w:numPr` overrides a style's
  `w:numPr` entirely; `w:numPr/w:numId w:val="0"` means "no numbering", overriding any numbering the
  style supplies. All three must be honoured, and `w:numId="0"` must be preserved on round-trip
  (deleting it silently re-applies the style's list - a real bug in naive implementations).
- **Conditional table formats**: applicability is decided by `w:tblLook`'s bits
  (`firstRow`, `lastRow`, `firstColumn`, `lastColumn`, `noHBand`, `noVBand`) combined with position
  (header row, banded rows, etc.) and by `w:cnfStyle` on the row/cell when present. The reveal pane
  must name the level that supplied a value (`band1Horz`, `firstCol`, …) because a table-style
  problem is otherwise undebuggable.
- **Paragraph-mark `rPr` resolution** uses FM-021's algorithm with the paragraph's style chain, and
  its result is what the toolbar shows when the caret is in an empty paragraph or when the whole
  paragraph is selected. Applying character formatting with the mark "covered" writes it (FM-001).
- **Which paragraph properties are toggle properties**: the paragraph toggle set (per ECMA-376) must
  be implemented and tested explicitly - `w:contextualSpacing` is the one that users notice
  (`w:keepNext`/`w:keepLines`/`w:pageBreakBefore`/`w:widowControl` are ordinary booleans, and
  `w:widowControl` has a non-false default; see FM-016 and §5 OI-1).
- **Section properties** (`w:sectPr` inside the last paragraph's `w:pPr`) are not formatting and are
  never merged or resolved; they must survive every formatting write.
- **Revision properties** (`w:pPrChange`, `w:rPrChange`) are not part of the current resolution (they
  describe the previous state) but must be preserved verbatim (04).
- Performance and caching rules are the same as FM-021, keyed by paragraph revision.

**Edge cases**
- A paragraph inside a table inside a content control: all levels apply; the control's
  `w:sdtPr/w:rPr` affects only the placeholder.
- A paragraph whose style is a **numbering style** (`w:type="numbering"` applied via
  `w:pPr/w:pStyle`): numbering styles are not paragraph styles; if a paragraph points at one, it is
  ignored (with a diagnostic) because only `w:numStyleLink` makes numbering styles effective.
- A paragraph with `w:pPr/w:ind/@w:hanging` and a numbering level that also sets a hanging indent:
  the direct `w:hanging` wins for the text position, but the **number** is still placed at the
  level's `w:ind/@w:left` position (the number's position comes from the level, the text's from the
  paragraph) - this asymmetry is exactly what makes a mis-indented list look wrong and must be
  implemented deliberately.
- `w:spacing` resolved from the numbering level applies to the whole paragraph (Word writes
  `w:spacing` into some list level definitions, and it takes effect).
- `w:divId` (a Word 2007 HTML-div artefact) is preserved and ignored.

---

#### FM-023 - Style management: delete, rename, hide, priority, qFormat, latent styles, docDefaults
**Priority:** important · **Effort:** L

**Commands:** `style.delete(styleId)`, `style.rename(styleId, name)`, `style.setHidden(styleId, on)`,
`style.setPriority(styleId, n)`, `style.setInGallery(styleId, on)`,
`style.setQuickFormat...`? (same as gallery), `style.materializeLatent(name)`,
`style.setDocDefaults(delta)`, `style.setDefault(styleId)`
**Events:** `styles.changed`, `document.changed`
**OOXML:** `w:style` attributes, `w:latentStyles`/`w:lsdException`
(`@w:name`, `@w:uiPriority`, `@w:semiHidden`, `@w:unhideWhenUsed`, `@w:locked`, `@w:qFormat`),
`w:docDefaults/w:rPrDefault`, `w:docDefaults/w:pPrDefault`, `w:style/@w:default`,
`w:settings/w:doNotUseHTMLParagraphAutoSpacing`? (not relevant), `w:settings/w:styleLockQFSet`,
`w:settings/w:styleLockTheme`, `w:settings/w:stylePaneFormatFilter`, `w:settings/w:stylePaneSortMethod`.

**Behaviour**
- **Delete a style** requires repairing every reference to it, and the repair rules are normative:
  1. paragraphs using the deleted paragraph style are reassigned to the deleted style's `w:basedOn`
     (or the default paragraph style when there is none) - **not** blindly to "Normal";
  2. runs using the deleted character style lose their `w:rStyle` (and become direct formatting?
     no - they revert to their paragraph style's character resolution);
  3. every `w:basedOn` pointing at the deleted style is re-pointed at the deleted style's base;
  4. every `w:next` pointing at it is re-pointed at the deleted style's `w:next`, and a self-
     reference is cleared;
  5. every `w:link` pointing at it is removed on the other half;
  6. every `w:abstractNum/w:lvl/w:pStyle` referencing it is left in place but becomes inert
     (Word leaves it; the library leaves it and emits a diagnostic);
  7. the numbering style's `w:styleLink`/`w:numStyleLink` references are cleared.
  All of that is **one undo entry** and one operation, because a half-repaired document is corruption.
- **Built-in styles cannot be deleted.** Word refuses and hides them instead. The library follows:
  `style.delete` on a built-in (matched by `w:name` against the built-in name table) is rejected with
  `code: 'builtin-not-deletable'` and the UI offers "Hide" instead.
- **Rename** changes `w:name` and never `w:styleId` (the id is the stable identity that all
  references use; changing it would either break every reference or require an O(n) rewrite). For a
  **built-in** style, renaming writes the user's name as `w:name` and keeps the built-in name in
  `w:aliases`, so built-in detection (shortcut keys, the gallery's built-in icons, the
  `w:link` pairing) keeps working - this mirrors Word, which stores the built-in name as the primary
  and the user's as an alias, and the library must accept **both** arrangements on read.
- **Hide / semi-hide**: `w:hidden` hides the style everywhere; `w:semiHidden` + `w:unhideWhenUsed`
  hides it until it is used (the mechanism behind "Normal" not appearing in the gallery). Both are
  metadata and are not inherited (FM-020).
- **Priority**: `w:uiPriority` orders the gallery list (FM-017); "recommended" styles are those with
  a low priority value and are what the "Show recommended styles" filter shows.
- **Latent styles**: `w:latentStyles/w:lsdException` controls built-in styles that are **not**
  defined in the document. Applying or modifying one must **materialise** it: a new `w:style` is
  inserted with the built-in definition from the library's built-in style table (the same table Word
  ships in its default template), the matching `w:lsdException`'s flags are honoured
  (`w:locked`, `w:qFormat`, `w:semiHidden`, `w:uiPriority`), and no other latent style is affected.
  The built-in table must cover at least: Normal, heading 1-9, Title, Subtitle, Title Text, Body
  Text, Quote, Intense Quote, Caption, List Paragraph, List Bullet/Number, No Spacing, Table
  Normal/Grid, Default Paragraph Font, Hyperlink, FollowedHyperlink, Footnote/Endnote
  Reference/Text, Header/Footer, Page Number, TOC 1-3, Strong, Emphasis, Subtle/Intense
  Emphasis/Reference, Book Title, and the caption/label styles. The list is a data file, not code.
- **`docDefaults`**: editing the default font/size (`w:rPrDefault`) or the default paragraph
  spacing (`w:pPrDefault`) is a document-wide change (invalidation `document`) and must be one undo
  entry. The library must warn when a document's `docDefaults` differ from the built-in defaults in a
  way that surprises the user (a document produced by another tool with a 10 pt default makes every
  style look wrong) and offer "Reset to built-in defaults".
- **`w:style/@w:default`** ("Set as default" for the paragraph/character default): changing it must
  clear the attribute on the previous holder in the same operation; two defaults is a corrupt state.
- Styles-part locks: `w:settings/w:styleLockQFSet` (styles cannot be added to the gallery),
  `w:styleLockTheme` (theme locked), `w:styleLockStylesPart` - these are honoured by
  `editor.canExecute` (ED-038) and preserved on save.
- The style pane's **sort and filter preferences** (`w:stylePaneFormatFilter`,
  `w:stylePaneSortMethod`) are document settings in OOXML and must round-trip.
- Deleting a style used by the token module or by a template's binding must be refused with a
  `code: 'style-in-use-by-token'` when the module is installed (05).

**Edge cases**
- Deleting a style that a numbering definition's `w:pStyle` binds (the "list paragraph" binding):
  the numbering definition keeps a dangling `w:pStyle`; the library emits a diagnostic and offers
  `style.repairInheritance` to clean it.
- Renaming a style to a name that already exists appends a suffix rather than creating a duplicate
  name; the dialog must warn first.
- Materialising a latent style inside a document whose `w:latentStyles` has no `w:lsdException` for
  it uses Word's built-in table defaults.
- Deleting a style referenced by `w:tblStyle` on a table: the table loses its table style and falls
  back to its direct `w:tblPr`, which is a visible formatting change; the confirm dialog must say so
  and list the affected tables.

---

### 3.4 Themes

#### FM-024 - Theme colours: clrScheme, themeColor/themeTint/themeShade, theme switching
**Priority:** important · **Effort:** L

**Depends:** 01 (theme part packaging)

**Commands:** `theme.set(themeId|themeXml)`, `theme.colors.set(slot, color)`,
`theme.resetToBuiltin(name)`, `format.color.setThemeColor(slot, { tint, shade })`
**Events:** `theme.changed`, `format.changed`, `document.changed` (invalidation `document`)
**OOXML:** `word/theme/theme1.xml` (and `word/theme/themeOverride1.xml` where present),
`a:themeElements/a:clrScheme` with slots `dk1, lt1, dk2, lt2, accent1..accent6, hlink, folHlink`,
each containing `a:srgbClr` or `a:sysClr`; `w:rPr/w:color/@w:themeColor`, `@w:themeTint`,
`@w:themeShade`; `w:shd`'s `@w:themeFill`/`@w:themeFillTint`/`@w:themeFillShade`;
`w:themeFontLang` in settings.

**Behaviour**
- **Slot names in `w:themeColor` are the *Word* names, not the `a:clrScheme` element names.** The
  mapping is normative and must be a single table:

  | `w:themeColor` | `a:clrScheme` element |
  | --- | --- |
  | `dark1`, `text1` | `a:dk1` |
  | `light1`, `background1` | `a:lt1` |
  | `dark2`, `text2` | `a:dk2` |
  | `light2`, `background2` | `a:lt2` |
  | `accent1` … `accent6` | `a:accent1` … `a:accent6` |
  | `hyperlink` | `a:hlink` |
  | `followedHyperlink` | `a:folHlink` |
  | `none` | (no theme colour; the literal `w:val` is used) |

  Both spellings (`dark1` and `text1`) must be accepted on read; the library writes the spelling the
  document already uses for that slot, defaulting to `dark1`/`light1`/… in `w:rPr` and to
  `text1`/`background1` in `w:tblPr`/`w:tcPr`-adjacent contexts (where Word uses the `textN`/
  `backgroundN` spelling).
- **Tint and shade** are two-hex-digit values (00-FF) with this normative computation, applied per
  sRGB channel with rounding half-up:
  - `shade`: `channel' = channel * (1 - shade/255)` - blend toward black;
  - `tint`: `channel' = channel + (255 - channel) * (tint/255)` - blend toward white;
  - both present is invalid; shade wins with a diagnostic, and only one is written.
  Word's actual rounding for some slots is a fixed ladder rather than a linear blend (see §5 OI-10);
  the linear formula above is the library's definition and the one the layout engine must use, so
  that the editor and the renderer agree.
- **What follows the theme**: runs with `w:themeColor` change instantly when the theme changes;
  runs with a literal `w:val` do not. The UI must make this visible in the colour picker (a theme
  swatch vs a standard swatch) and the reveal pane must say "Accent 1, Lighter 40 %" rather than a
  hex value. Choosing a theme swatch writes `themeColor` (+ tint); choosing a standard colour writes
  `w:val` and **removes** `themeColor`/`themeTint`/`themeShade`.
- **Theme switching** replaces the theme part and emits `theme.changed`; it must not rewrite any run
  (nothing to rewrite) and must invalidate layout `document` (fonts can change, so metrics change).
  Fonts that a run set as a *literal* family must not follow the theme; theme slots must.
- The theme also drives: the table-style accent colours, the chart colours (out of scope), the
  hyperlink colour (through `hlink`), and SmartArt. Only colour and font schemes are in scope here.
- `theme.colors.set(slot, color)` writes the `a:clrScheme` entry; changing `dk1`/`lt1` must also keep
  the `a:sysClr`/`a:srgbClr` child shape valid (`a:sysClr` carries `@lastClr` which must be updated
  so that consumers which ignore `@val` still get a sensible colour).
- The document's `w:themeFontLang` (settings) declares the language used to choose per-script theme
  fonts; a change is a document-level setting with `document` invalidation.
- Where the document has no theme part at all (a minimal DOCX), the library must synthesise the
  Office default theme **in memory** for resolution and only write a theme part when something
  actually needs one - otherwise loading any minimal file and saving "just to check" adds a part.

**Edge cases**
- A theme with fewer than 12 slots or with a slot out of order must be repaired on read
  (missing slots filled from the built-in default) and reported.
- `w:themeColor="none"` is legal and means "no theme colour"; it must not be confused with a missing
  attribute.
- `themeOverride1.xml` (a part-level theme override) must be honoured for the part it is
  related to and must not leak into other parts.
- Applying a theme to a document in which no run uses theme colours changes no run's appearance but
  still invalidates the whole document - the command must be honest about the invalidation even when
  nothing visibly changes.

---

#### FM-025 - Theme fonts: major/minor, per-script fonts, themeFontLang, font substitution
**Priority:** important · **Effort:** M · **Depends:** FM-024, FM-002

**Commands:** `theme.fonts.set({ major, minor, script })`, `theme.fonts.setForScript(script, family)`
**Events:** `theme.changed`, `fonts.substituted`, `document.changed` (invalidation `document`)
**OOXML:** `a:themeElements/a:fontScheme/a:majorFont` and `a:minorFont`, each with `a:latin`, `a:ea`,
`a:cs`, and a list of per-script overrides `a:font[@script="…"]` (`@typeface`); the `w:rFonts` theme
attributes `@w:asciiTheme`, `@w:hAnsiTheme`, `@w:cstheme`, `@w:eastAsiaTheme` with the values
`majorAscii`, `majorHAnsi`, `majorEastAsia`, `majorBidi`, `minorAscii`, `minorHAnsi`,
`minorEastAsia`, `minorBidi`.

**Behaviour**
- The theme font slots relevant to this product:
  - **majorLatin** (`a:majorFont/a:latin`) - used by headings; reached by `w:asciiTheme="majorHAnsi"`
    (and `majorAscii`).
  - **minorLatin** (`a:minorFont/a:latin`) - body text; `minorHAnsi`/`minorAscii`.
  - **majorBidi/minorBidi** (`a:cs`) - complex scripts; reached by `w:cstheme`. In Word, `a:cs` is
    **also** what `w:hAnsiTheme`'s "Complex Script" slot shows; Romanian and Russian do **not** use
    this (1.8).
  - **per-script overrides** (`a:font[@script="Cyrl" @typeface="…"]`) - a theme may name a different
    face for Cyrillic. This must be honoured for Russian: when resolving the font for a Cyrillic
    character in a run that uses a theme font, the `Cyrl` override (if present) wins over
    `a:majorFont/a:latin`.
  Script tags are ISO 15924 four-letter codes; the mapping from a character's Unicode script to the
  tag must be a small table covering at least `Latn`, `Cyrl`, `Grek`, `Arab`, `Hebr`, `Thai`, `Hans`,
  `Hant`, `Jpan`, `Hang`, `Deva`.
- **Resolution for a theme-font run** (normative, and shared with the layout engine):
  1. if the run's `w:rFonts` carries a literal family for the character's script class, use it;
  2. else determine the theme slot from the relevant theme attribute (major/minor × script class);
  3. else apply the per-script override `a:font[@script]` for the character's script;
  4. else use `a:latin` of the slot;
  5. else use the document's `w:themeFontLang` language to pick the matching `a:font` entry by
     language tag;
  6. else fall back to the environment's per-script default and emit `fonts.substituted`.
  Note the order of (3) and (4): the per-script override is an *override of the typeface*, not a
  replacement of the slot, so it must be consulted before the slot's `a:latin` only when the run's
  script matches the override's script.
- `w:rFonts` theme attributes must be written **as a set with the script class**: writing
  `w:asciiTheme="majorHAnsi"` must also write `w:hAnsiTheme="majorHAnsi"` and must **remove**
  `w:ascii`/`w:hAnsi` (FM-002).
- **Substitution for missing theme fonts**: identical to FM-002's chain, with one addition - the
  theme's fonts are commonly not installed (Calibri Light, Cambria), so the bundled metric-compatible
  set must be consulted before a last-resort fallback, and a single `fonts.substituted` summary must
  be emitted per theme (not per run) so the host can show one message.
- Changing a theme font invalidates layout `document` and must re-measure everything; the command
  must therefore be explicit about being expensive and must be excluded from typing-time paths.
- A run using `w:asciiTheme` with a slot value that does not exist (`majorFoo`) is invalid: the
  attribute is ignored with a diagnostic and the run falls back to its paragraph style's font.

**Edge cases**
- A theme font change must **not** alter runs that set a literal family, even when that family
  happens to equal the old theme font (they are different things and the distinction must survive a
  round trip).
- The document's default font, when set in `w:docDefaults` with a theme attribute, must follow the
  theme; when set with a literal family, it must not. This is the difference between a template that
  rebrands cleanly and one that does not, and it must be surfaced by "Reset to theme fonts".
- A `w:font[@script]` entry with an empty `@typeface` means "use the slot's `a:latin`" and must not
  be treated as an empty font name.
- `w:themeFontLang` with an empty `@w:eastAsia`/`@w:bidi` falls back to `@w:val`.

---

### 3.5 Lists and numbering

#### FM-026 - Bulleted lists
**Priority:** core · **Effort:** M

**Commands:** `list.toggleBullets()`, `list.setBulletStyle(styleId|definition)`,
`list.removeBullets()` · **Events:** `numbering.changed`, `document.changed` (invalidation
`document` when a new numbering definition is created, else `paragraph`)
**OOXML:** `w:pPr/w:numPr` (`w:ilvl`, `w:numId`) → `w:numbering/w:num/@w:numId` →
`w:abstractNum/@w:abstractNumId`; a bullet level is `w:lvl` with `w:numFmt w:val="bullet"`,
`w:lvlText` (the bullet character), `w:lvlJc`, `w:suff`, `w:pPr/w:ind`, and `w:rPr/w:rFonts` naming
the symbol font.

**Behaviour**
- Toggling bullets applies a `w:numPr` at `w:ilvl` 0 (or the current level for a list paragraph,
  FM-028) referencing a `w:num` whose abstract definition is the document's bullet definition for
  that level; when the document has none, one is **created** by cloning the built-in definition
  below and appended to `numbering.xml` (FM-031 owns the id allocation and cleanup).
- The built-in bullet definitions the library ships (matching Word's default template, which is what
  makes a document look right in Word):

  | Level | Character | Code point | Font (`w:rFonts`) | `w:lvlText` storage |
  | --- | --- | --- | --- | --- |
  | 1 | • | U+2022 | Symbol | the PUA character `F0B7` |
  | 2 | o | U+006F | Courier New | literal `o` |
  | 3 | ▪ | U+25AA | Wingdings | the PUA character `F0A7` |
  | 4 | • | U+2022 | Symbol | `F0B7` |
  | 5 | o | U+006F | Courier New | `o` |
  | 6 | ▪ | U+25AA | Wingdings | `F0A7` |
  | 7 | • | U+2022 | Symbol | `F0B7` |
  | 8 | o | U+006F | Courier New | `o` |
  | 9 | ▪ | U+25AA | Wingdings | `F0A7` |

  The critical, frequently-missed detail: Word stores the *symbol-font* character in the Private Use
  Area with `w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"` in the level's `w:rPr`.
  A definition that stores U+2022 with a normal font renders as a different bullet in Word and is a
  visible fidelity failure. The library must write the PUA form for levels 1/3/… and must render PUA
  bullets by the level's font when displaying.
- Bullet indentation: each level's `w:pPr/w:ind` uses a **hanging** indent whose text position is
  `left` and whose bullet sits at `left - hanging`. The library's built-in definitions use the Word
  values (level 1: `w:left="720" w:hanging="360"`, +720 per level).
- `w:suff` controls what follows the bullet: `tab` (default, advances to the level's next tab stop),
  `space`, or `nothing`. The Define New Bullet dialog (FM-027 covers the shared "Define New…" UI)
  exposes it.
- **Removing bullets**: `list.removeBullets()` writes `w:numPr/w:numId w:val="0"` when the numbering
  comes from a style (so that it stays removed after a style re-application), and removes the
  `w:numPr` element when it is direct. The indent that the list supplied must be **compensated**:
  removing a list leaves the paragraph with a direct `w:ind` matching where the text was, or the
  paragraph jumps to the margin. Word's "No List" keeps the visual position; the library follows.
- Toggling bullets on a selection applies to every paragraph in it, at the level each paragraph had
  (a mixed-level selection keeps its levels); toggling off removes for all.
- Bullets and numbering are one property (`w:numPr`): applying bullets to a numbered paragraph
  replaces the numbering, and vice versa; the old list membership is not remembered.
- The command is one undo entry including the numbering-part changes it created (ED-023's rule about
  removing a `w:num` created by the undone command).

**Edge cases**
- A bullet list inside a table cell: the `w:numPr` is on the cell's paragraphs and the indentation is
  measured from the cell's text boundary (FM-012).
- A paragraph whose style already supplies bullets and whose direct `w:numPr` is added: the direct
  one wins (FM-022); the UI must show "bulleted" as pressed even though the style also has bullets.
- A list paragraph with `w:lvlText` containing more than the bullet character (a custom "• - " 
  prefix) is preserved and rendered.
- Bullets in a right-to-left paragraph (`w:bidi`) place the bullet on the right; `w:lvlJc` is
  logical, and the renderer must not mirror it twice.

---

#### FM-027 - Numbered lists, numbering formats, and Define New Number Format
**Priority:** core · **Effort:** L

**Commands:** `list.toggleNumbering(styleId?)`, `list.setNumberFormat(spec)`,
`list.defineNewNumberFormat(spec)`, `list.setNumberAppearance({ font, alignment, suff, prefix,
suffix })` · **Events:** `numbering.changed`, `document.changed`
**OOXML:** `w:abstractNum/w:lvl/w:numFmt`, `w:lvlText`, `w:lvlJc`, `w:rPr` (font for the number),
`w:suff`, `w:start`, `w:num/w:lvlOverride`.

**Behaviour**
- The numbering formats exposed (the practical subset of `w:numFmt`'s full enumeration in
  ECMA-376 §17.9.17, which must be **read and preserved** even when the UI cannot produce it):

  | UI name | `w:numFmt` | Example |
  | --- | --- | --- |
  | 1, 2, 3 | `decimal` | 1. |
  | 01, 02, 03 | `decimalZero` | 01. |
  | I, II, III | `upperRoman` | II. |
  | i, ii, iii | `lowerRoman` | ii. |
  | A, B, C | `upperLetter` | B. |
  | a, b, c | `lowerLetter` | b. |
  | First, Second | `ordinal` | 1st / 2nd |
  | One, Two | `cardinalText` | one |
  | First, Second (words) | `ordinalText` | first |
  | 1st, 2nd, 3rd (superscript) | *(no numFmt)* | the `ordinal` + `w:vertAlign` combination Word's UI offers |
  | 001, 002 | `decimalZero` with `w:start` | 001 |
  | Hex, Chicago, none | `hex`, `chicago`, `none` | preserved, UI-exposed only for `none` |

  `w:numFmt="none"` is meaningful: the level exists but shows no number (used to build invisible
  levels and to keep a uniform indent across a multilevel list); it must be selectable.
- **Prefix/suffix** are part of `w:lvlText` ("%1." or "(%1)" or "Article %1:"), and the dialog's
  "Number format" field must edit it with the level placeholder rendered as a token the user cannot
  break (Word's behaviour: the placeholder is inserted by a button and cannot be typed over).
- **Number appearance**: font (`w:lvl/w:rPr/w:rFonts` + size/colour/bold), alignment
  (`w:lvlJc`: `left|center|right` - note it is `w:lvlJc`, not `w:jc`), "Follow number with: tab /
  space / nothing" (`w:suff`), and the number's tab position (which comes from the tab stop added by
  the level's `w:pPr/w:tabs`).
- The dialog is **one undo entry** even though it writes `w:numFmt`, `w:lvlText`, `w:lvlJc`, `w:suff`,
  `w:start` and `w:rPr` (I2). Editing an existing list's format must affect **all paragraphs that
  share the same `w:abstractNum`** - which is Word's behaviour and a genuine surprise ("I changed the
  format and it changed in three other places"). The library must warn in the dialog: "This changes
  every list that uses this numbering definition" with a count, and must offer "Create a new
  definition instead" which clones the abstract definition and re-points only the selected
  paragraphs.
- **`w:start`** (`w:start` on the level, default 1) sets the first number. The "Set Numbering Value"
  pathway for overriding a single list is FM-029.
- Applying a numbering format to a paragraph that is not yet a list makes it one (creating the
  `w:numPr` and definition); applying to a list paragraph changes the definition's format.
- `list.toggleNumbering()` uses the last-used format for the session (Word's behaviour) and defaults
  to `decimal` + `%1.` + tab.
- A level whose `w:start` is not 1, whose `w:lvlText` has multiple placeholders ("%1.%2"), or whose
  `w:numFmt` is not supported by the UI must be shown read-only in the dialog rather than rewritten.

**Edge cases**
- `w:start` of 0 is legal (a 0-based list) and must not be clamped to 1.
- A `w:numFmt="chicago"` level (asterisk, dagger, double-dagger) must render its glyph sequence
  correctly and must not fall back to decimal.
- A numbering definition with a `w:lvlText` referencing a level above it that has no number
  (`%2` used at level 1) is invalid; the placeholder resolves to nothing and a diagnostic is
  emitted.
- Numbering inside a content control: the `w:numPr` belongs to the paragraph inside the control and
  must not be moved to the control's `w:sdtPr`.
- Numbers are not text: find/replace must not match them (the number is generated by
  `w:numFmt`/`w:lvlText`, not by `w:t`), while the *level's* literal prefix/suffix text is also not
  searchable. This asymmetry must be documented in the help and is a frequent user question.

---

#### FM-028 - Multilevel lists: levels, lvlText, restart, isLgl, promote/demote
**Priority:** core · **Effort:** L

**Commands:** `list.setLevel(ilvl)`, `list.promote()`, `list.demote()`, `list.setMultilevelStyle(id)`,
`list.setLvlRestart(ilvl, value)`, `list.setLegal(on)`, `list.setLevelText(ilvl, text, numFmt)`
**Events:** `numbering.changed`, `document.changed`
**OOXML:** `w:abstractNum/@w:multiLevelType` (`singleLevel|multilevel|hybridMultilevel`),
`w:abstractNum/@w:nsid`, `@w:tmpl`, `w:lvl/@w:ilvl` (0-8), `w:lvl/@w:tplc`, `w:lvlText`,
`w:lvlRestart`, `w:isLgl`, `w:lvlJc`, `w:pPr`, `w:rPr`, `w:start`.

**Behaviour**
- A list has up to **9 levels** (ilvl 0-8). `w:multiLevelType` distinguishes a single-level list
  (`singleLevel`), a true outline list (`multilevel`), and Word's List Library entries
  (`hybridMultilevel`, which use a `w:tmpl` code to identify the library entry so that applying the
  same library entry twice reuses the definition).
- **`w:lvlText` placeholders** are `%1`…`%9`, referring to the number of that level, and the text
  may mix literals: `%1.`, `%1.%2`, `(%1)`, `Article %1, section %2:`. The dialog's preview must
  render all levels with the current `w:start`/`w:numFmt`.
- **`w:lvlRestart`** controls when a level restarts: the default (`1`) restarts a level whenever a
  **higher** (lower-numbered) level appears; a value of `0` means **never restart** (the level's
  counter keeps growing); a value of `n` means restart when level `n` appears. This is the property
  behind "the sub-numbering did not reset" complaints and must be exposed in the dialog with a plain
  explanation.
- **`w:isLgl`** (legal numbering): when set on a level, all levels in the displayed number use
  decimal form (so a `lowerRoman` level under an `isLgl` parent displays as `IV.3` → `4.3`). It is a
  property of the *parent* level in practice and is exposed as "Legal numbering" with that note.
- **Promote/demote**: Tab/Shift+Tab on a list paragraph (ED-012) and the Increase/Decrease Indent
  buttons change `w:pPr/w:numPr/w:ilvl` by ±1, clamped to 0-8, and compensate the direct indent so
  the paragraph does not shift twice. Demoting past level 8 is a no-op; demoting a paragraph whose
  definition has fewer levels **extends the definition** by cloning the last level's properties to
  the new levels (Word's behaviour when a single-level list is demoted) - this creation is part of
  the same undo entry.
- Promoting a level-0 list item does **not** remove the list (Word keeps it at level 0 with the same
  indent); "remove the list" is an explicit command (FM-026).
- **Restart vs continue across lists**: a level restarts per `w:lvlRestart` within one list; two
  separate lists may share an abstract definition and continue (`FM-029`).
- Applying a multilevel list style to a selection applies the whole hierarchy (each paragraph gets
  the level it had, clamped to the new definition's level count).
- The library ships the standard List Library entries (1/1.1/1.1.1 with arabic, the roman/letter
  variants, the "Article/Section" style, and the bullet variants) as data, with their `w:tmpl` and
  `w:nsid` values generated deterministically (ED-039) so that two runs of the same operation
  produce the same file.

**Edge cases**
- A level whose `w:lvlText` uses `%2` but whose level 2 has `w:numFmt="none"` renders the parent's
  number only; the placeholder collapses (and a diagnostic is emitted when the definition is read).
- A list in a table cell: each cell's paragraphs keep their own `w:numPr`; promote/demote inside a
  cell must not affect the neighbouring cells (Word's Tab moves cells, but Ctrl+Tab inserts a tab -
  promote/demote inside a cell is only reachable from the toolbar, which is a deliberate design
  choice to avoid the Tab conflict).
- A paragraph with `w:ilvl` greater than the definition's last level: clamped to the last level for
  rendering and left unmodified in the file (Word leaves it).
- `w:nsid` collisions between two definitions (32-bit ids) must be detected on creation and avoided;
  the id must be a deterministic function of the definition content plus a salt, not a random value
  (ED-039).

---

#### FM-029 - Numbering restart, continuation, and set numbering value
**Priority:** important · **Effort:** M

**Commands:** `list.restartAt(value)`, `list.continuePrevious()`, `list.setStartOverride(ilvl, value)`,
`list.continueFromPreviousList()` · **Events:** `numbering.changed`, `document.changed`
**OOXML:** `w:num/w:lvlOverride/w:startOverride/@w:val` (a per-list start value), a new `w:num`
referencing the *same* `w:abstractNum` (the standard way to restart without duplicating the
definition), `w:lvlOverride/w:lvl` (a full level override), `w:abstractNum/w:lvl/w:start`
(the definition's start), `w:nsid`/`w:tmpl` for identity.

**Behaviour**
- Three distinct operations, and the UI must not blur them:
  1. **Continue previous list**: the paragraph joins the previous list, i.e. its `w:numPr/w:numId`
     points at the same `w:num` as the paragraph above (if the abstract definitions match). If they
     do not match, Word creates a `w:num` over the previous list's abstract definition.
  2. **Restart at N**: a **new `w:num`** (new `w:numId`) over the same `w:abstractNum`, with
     `w:lvlOverride/w:startOverride w:val="N"` for the affected level(s). Creating a new `w:num` is
     the mechanism; `w:startOverride` alone would affect every list sharing that `w:num`.
  3. **Set Numbering Value** (Word's dialog): the same as (2) but with the *first* value of the
     selected paragraphs, applied to the level the user chooses, and with the dialog's option
     "Restart list after" / "Continue from previous list". "Set Numbering Value" on a paragraph that
     is already part of a multi-paragraph list must select the whole logical list (Word selects the
     list's paragraphs) and change the start value for all of them.
- **Continuation rule** (implicit, and the source of much confusion): two list paragraphs continue
  each other when their `w:numId` values resolve to the same `w:num` - not merely to the same
  `w:abstractNum`. Documenting this in the reveal pane ("List identity: numId 5, definition 3,
  level 0, start 1") is required; the pane is the only way an HR manager can tell why one list
  continues another.
- Restart also happens *automatically* per `w:lvlRestart` (FM-028) when a higher level intervenes;
  an explicit restart must be recorded as an override and must survive the interleaving.
- Applying a *paragraph style* that carries `w:numPr` (a numbered-heading style) must respect an
  existing direct `w:numPr` (FM-022): the direct one wins. "Continue previous list" on such a
  paragraph writes a direct `w:numPr`.
- All three operations are one undo entry, including the creation of the `w:num` element; the
  inverse must remove it and restore the previous `w:numId` references.
- Deleting a paragraph that was the only user of a `w:num` must **not** immediately delete the
  `w:num` (other paragraphs may be added later and Word does not delete eagerly); cleanup happens in
  FM-031's `list.cleanup` operation, which is an explicit command (and, when it runs, must be one
  undo entry).

**Edge cases**
- Restarting a **multilevel** list at level 2 while level 1 continues: the override applies to the
  selected level only, and `w:lvlRestart` still governs the rest.
- "Continue previous list" when the previous list has a different `w:numFmt`: Word continues the
  *identity* (the count) but uses the current definition's format. The library follows, and the pane
  must show both definitions.
- Restart on the first paragraph of a document: legal, writes a `w:num` with `startOverride` 1 that
  is functionally identical to continuing; the command must not create a redundant `w:num` in that
  case (I4) when the previous list is the same `w:num` and the start is already 1.
- `startOverride` values above 32767 are rejected (schema range).

---

#### FM-030 - List styles vs direct list formatting (styleLink/numStyleLink)
**Priority:** important · **Effort:** L

**Commands:** `style.createListStyle(definition)`, `list.applyListStyle(styleId)`,
`list.detachFromListStyle()`, `style.setNumberingStyleLink(...)`
**Events:** `styles.changed`, `numbering.changed`, `document.changed`
**OOXML:** `w:style[@w:type="numbering"]` containing `w:pPr/w:numPr` and `w:styleLink`;
`w:abstractNum/w:numStyleLink` (an abstract definition that delegates its levels to a numbering
style) and `w:style/w:styleLink/w:val` (a numbering style that names the abstract definition);
`w:abstractNum/w:lvl/w:pStyle` (a level bound to a paragraph style).

**Behaviour**
- **Two directions of linkage, both normative:**
  1. `w:abstractNum/w:numStyleLink` → a numbering **style**; the abstract definition has **no levels
     of its own** and takes them from the style's `w:pPr/w:numPr` → `w:num` → `w:abstractNum`. This
     is how "List Bullet" style-based lists work.
  2. `w:style[@w:type="numbering"]/w:styleLink` → an abstract definition id; this is the other half
     of the pair and must be kept consistent.
  The library must read both, must write both when creating a list style, and must repair a
  half-present pair on demand (a `numStyleLink` with no matching `styleLink` is inert and must be
  diagnosed).
- **`w:abstractNum/w:lvl/w:pStyle`** binds a level to a paragraph style: applying that paragraph
  style to a paragraph puts it at that level of that list. This is the mechanism behind Word's
  Heading 1-9 being numbered when a template numbers its headings, and it must be supported (the HR
  template case: "Article 1. Scope" generated from Heading 1).
- **Precedence**, which must be implemented exactly:
  1. a **direct** `w:pPr/w:numPr` on the paragraph (including `w:numId="0"` meaning none) wins over
     everything;
  2. else the **paragraph style's** `w:pPr/w:numPr` (which may reach the definition through
     `numStyleLink`);
  3. else the paragraph's style is **bound to a level** by `w:lvl/w:pStyle`, in which case it is
     numbered at that level of the definition reached through the style's own numbering;
  4. else no list.
- **Applying a list style** writes `w:pPr/w:numPr` on the paragraphs pointing at a `w:num` over the
  style's abstract definition (creating the `w:num` if needed). It does **not** write `w:pStyle`
  (a list style is not a paragraph style). The UI's numbering gallery must make the difference
  visible: applying "List Bullet" (a paragraph style) changes the paragraph's style; applying a list
  style changes only the numbering. Both are legitimate and the user-visible difference is exactly
  what "styles gallery" vs "numbering library" means.
- **Detaching** (`list.detachFromListStyle`) writes the resolved numbering as a direct `w:numPr` so
  that later edits to the list style do not affect the paragraph - Word's "no style" behaviour for
  numbering, and the way to stop a template change from reformatting a finished contract.
- Creating a list style writes a `w:style` of `w:type="numbering"` with the abstract definition
  referenced by `w:styleLink`, and (when the UI creates it from a selection) the levels copied from
  the selection's resolved numbering.
- Deleting a list style must not orphan paragraphs: they keep their `w:numPr` (which still resolves
  through the `w:num`/`w:abstractNum`, since the `numStyleLink` indirection is only in one direction)
  and a diagnostic is emitted for the `numStyleLink` left behind.
- The reveal pane (FM-008) must show the full chain: paragraph → `w:numId` → `w:abstractNumId` →
  (`numStyleLink` → list style) → level.

**Edge cases**
- A paragraph with a direct `w:numPr` at level 2 and a style binding it to level 0 of another list:
  the direct one wins entirely (the style's binding is ignored), which must be shown in the pane.
- A numbering style whose `w:pPr/w:numPr` points at a `w:num` that does not exist: the style is
  inert, and the paragraphs fall through to rule 3/4; diagnosed, not silently repaired.
- A `w:lvl/w:pStyle` binding on a level whose `w:numFmt="none"`: the paragraph is in the list but
  shows no number (used for "keep the indent, drop the number").
- Applying a paragraph style that carries numbering to a paragraph that already has a direct list
  must not silently create a second list identity; the command must report the conflict and the UI
  must offer "keep current list / use the style's list".

---

#### FM-031 - numbering.xml lifecycle: id allocation, overrides, paste merge, cleanup, detection
**Priority:** important · **Effort:** L

**Commands:** `list.cleanup()`, `list.detectListStyles()`, `list.convertIndentToRealList()`,
`list.stripNumberingFromIndentOnlyLists()` · **Events:** `numbering.changed`, `document.changed`
**OOXML:** `w:numbering/w:abstractNum` (`@w:abstractNumId`, `@w:nsid`, `@w:tmpl`,
`@w:multiLevelType`), `w:numbering/w:num` (`@w:numId`, `w:abstractNumId`),
`w:num/w:lvlOverride` (with `w:startOverride` or a full `w:lvl`), `w:settings/w:numIdMacAtCleanup`.

**Behaviour**
- **Id allocation**: `w:abstractNumId` and `w:numId` must be unique and are conventionally allocated
  as `max(existing) + 1`, keeping `w:numId` values aligned with the counter recorded in
  `w:settings/w:numIdMacAtCleanup` (Word's own "next numId MAC" marker, which Word uses to detect
  concurrent edits). The library must:
  - read `w:numIdMacAtCleanup` when present and allocate above `max(maxId, counter)`;
  - write an updated `w:numIdMacAtCleanup` when it allocates past it;
  - never reuse an id that a paragraph still references.
  Allocation must be **deterministic** (a counter, ED-039), not random.
- **`w:nsid`** is a 32-bit identity for an abstract definition and must be unique across the document;
  collisions must be avoided by derivation (a hash of the definition content plus a deterministic
  salt) and checked against existing values.
- **Cleanup** (`list.cleanup`) is the explicit garbage collection:
  1. remove every `w:num` that no `w:numPr` references (except `w:numId` 0, which is a sentinel and
     is never removed);
  2. remove every `w:abstractNum` that no `w:num` references;
  3. optionally renumber the survivors densely (`renumber: true`), remapping every `w:numPr/w:numId`
     and every `w:num/@w:abstractNumId` consistently, and updating `w:numIdMacAtCleanup`;
  4. optionally **merge identical abstract definitions** (`mergeIdentical: true`): two definitions
     with the same level structure (levels, `w:numFmt`, `w:lvlText`, `w:start`, `w:lvlRestart`,
     `w:isLgl`, `w:lvlJc`, `w:pPr`, `w:rPr`) are merged by re-pointing the `w:num`s, except when a
     definition is referenced by `w:numStyleLink` or by a `w:lvl/w:pStyle` binding or carries a
     `w:nsid`/`w:tmpl` that identifies a List Library entry (those are identities and merging them
     would change semantics for other producers).
  Cleanup is one undo entry and must be safe to run on any document (it must never change what the
  user sees; that is the acceptance test).
- **Paste merge** (the biggest source of numbering bloat and the reason this feature exists): on
  paste, a fragment's numbering must be merged rather than appended whenever possible, using this
  order:
  1. if the destination has an abstract definition that is structurally identical to the source's
     **and** the source fragment's list is meant to continue (same document, same list identity),
     reuse the destination's `w:numId`;
  2. else if the source is a different document and the fragment's list is the only instance of that
     definition in the fragment, and the destination has an identical definition, reuse it (this is
     what makes pasting a bulleted clause into another contract keep the same bullets rather than
     creating `numId 12`);
  3. else import the definition (new `w:abstractNumId` + `w:num`) and re-point the fragment's
     `w:numPr`; if the fragment's definitions are already identical to each other, import one copy
     (deduplicate within the fragment too);
  4. `w:lvlOverride` values are preserved per list; a `startOverride` that would collide with the
     merged list's current state must be preserved as-is (the count is content, not identity).
  The count of created/merged/reused definitions must be reported through `numbering.changed` so the
  behaviour is testable and diagnosable.
- **List detection** (`list.detectListStyles`) inspects paragraphs that *look* like lists but are not
  (a paragraph starting with "•", "1.", "a)", "-", or "-" followed by a tab or spaces, with an
  indent and no `w:numPr`) and offers conversion. The detection rules must be conservative and
  configurable (the pattern set, whether the marker must be followed by a tab, whether the indent
  must be present) because false positives on a contract's "1." in body text would be destructive.
- `list.convertIndentToRealList` performs the conversion for the selected paragraphs: it creates (or
  reuses) a numbering definition matching the detected markers, writes `w:numPr`, and removes the
  literal marker text from the `w:t` content - one undo entry, and the inverse must restore the
  literal markers exactly.
- `list.stripNumberingFromIndentOnlyLists` is the reverse ("this list is fake, just keep the
  indentation"): it removes the `w:numPr` and writes a direct `w:ind` that reproduces the position,
  optionally re-inserting the literal marker text.

**Edge cases**
- A document with **no** `numbering.xml` part at all: allocation must create the part with the
  correct content type and relationship (01), and `list.cleanup` on it must be a no-op.
- A `w:numId` referenced by a paragraph but absent from `numbering.xml` (a corrupt or truncated
  file): the paragraph renders with no number, a diagnostic is emitted, and cleanup must not
  "fix" it by renumbering other definitions into the gap (that would silently change other lists).
- Merging definitions must not merge two definitions whose `w:nsid` differ but whose content matches
  when one of them is referenced by `w:numStyleLink`.
- Cleanup on a document where a `w:num` has a `w:lvlOverride` with a full `w:lvl` (not just a start
  override): the override's level content must be compared as part of the definition's identity when
  deciding whether a `w:num` can be dropped, because dropping it changes the rendering.
- Renumbering must update `w:numIdMacAtCleanup` to the new maximum, or Word will re-issue ids that
  the document already uses.

---

## 4. Cross-cutting notes

### 4.1 Command/event inventory

Every feature above names its commands and events; the union of them is the editing/formatting
public API. Two rules apply to the whole surface:

- **Idempotence and silence (I4).** A command whose effect is already in force must return
  `ok: true` with an empty `affectedRanges`, emit no `document.changed`, and create no undo entry.
  This is what makes `set`-style commands safe to call from a host that tracks state optimistically.
- **Rejection is not an exception (I5).** Policy, applicability and capability failures return
  `ok: false` with a code from a single documented enumeration (`protected`, `read-only`,
  `inapplicable`, `not-found`, `empty-selection`, `document-boundary`, `clipboard-unavailable`,
  `layout-unavailable`, `pattern-too-complex`, `no-op-selection`, `incompatible-target`,
  `style-not-found`, `builtin-not-deletable`, `style-in-use-by-token`, `special-unavailable`) and
  additionally emit `command.rejected`. Throwing is reserved for programming errors.

### 4.2 Keyboard map

The bindings that this spec fixes (all others are host policy). Word's defaults are normative here
because the persona is a Word user:

| Keys | Command |
| --- | --- |
| Ctrl+Left / Ctrl+Right (+Shift) | Word navigation (ED-009) |
| Ctrl+Up / Ctrl+Down | Paragraph start navigation (ED-011) |
| Home / End / Ctrl+Home / Ctrl+End (+Shift) | Line and story edges (ED-010) |
| Shift+F5, Ctrl+Alt+Z | Go Back (ED-011) |
| F8 / Shift+F8 / Esc | Extend mode (ED-003) |
| Ctrl+Shift+F8 | Column selection mode (ED-005) |
| Ctrl+A | Select all with escalation (ED-006) |
| Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) | Undo / redo (ED-023) |
| Ctrl+C / Ctrl+X / Ctrl+V | Clipboard (ED-026/ED-027) |
| Ctrl+Alt+V | Paste Special (ED-027) |
| Ctrl+F / Ctrl+H / F3 / Shift+F3 | Find / replace / next / previous (ED-032, ED-035) |
| Ctrl+Space / Ctrl+Q | Clear character / paragraph formatting (FM-006) |
| Ctrl+B / Ctrl+I / Ctrl+U | Bold / italic / underline (FM-001) |
| Ctrl+Shift+> / Ctrl+Shift+< | Grow / shrink font (FM-002) |
| Ctrl+] / Ctrl+[ | Grow / shrink font by the ladder (FM-002) |
| Ctrl+E / Ctrl+L / Ctrl+R / Ctrl+J | Centre / left / right / justify (FM-009) |
| Ctrl+1 / Ctrl+2 / Ctrl+5 | Single / double / 1.5 line spacing (FM-010) |
| Ctrl+0 | Add/remove 12 pt space before a paragraph (FM-011) |
| Ctrl+M / Ctrl+Shift+M | Increase / decrease indent (FM-012) |
| Ctrl+T / Ctrl+Shift+T | Hanging / first-line indent (FM-012) |
| Ctrl+Shift+N | Apply Normal style (FM-018) |
| Ctrl+Alt+1 / 2 / 3 | Apply Heading 1 / 2 / 3 (FM-018) |
| Ctrl+Shift+L | Apply List Bullet (FM-018) |
| Ctrl+Shift+S | Apply Styles pane (FM-017) |
| Shift+F1 | Reveal Formatting (FM-008) |
| Ctrl+Shift+C / Ctrl+Shift+V | Copy / paste formatting (FM-007) |
| Ctrl+Shift+8 | Toggle formatting marks (ED-037) |
| Ctrl+Shift+Space / Ctrl+Shift+- / Ctrl+- | Non-breaking space / non-breaking hyphen / optional hyphen (ED-015) |
| Ctrl+Enter / Ctrl+Shift+Enter / Shift+Enter | Page break / column break / line break (ED-013) |
| Insert | Overwrite mode (ED-012) |
| Alt+X | Unicode code point conversion (ED-015) |
| Shift+F3 | Change case cycle (FM-005) |
| Tab / Shift+Tab / Ctrl+Tab | Context-sensitive tab (ED-012) |

### 4.3 What "Word-faithful" means for this spec

Three claims in the brief are load-bearing and are therefore given normative rules above rather than
left to the implementer: the Ctrl+Arrow word model (ED-009), the formatting cascade with toggle
semantics (FM-021/FM-022), and the undo-granularity rule for gestures (ED-025). Everything else in
this spec that says "Word does X" without a normative rule is a description of intent and may be
implemented differently if the visible result is equivalent.

---

## 5. Open items

Items I could not resolve from the specification alone and which must be settled against a real Word
installation (a fixture DOCX plus the observed behaviour) before the affected feature is implemented.

| Id | Item | Affects | Proposed resolution |
| --- | --- | --- | --- |
| OI-1 | **Table style vs paragraph style precedence** in the cascade, and whether `w:keepNext`/`w:keepLines`/`w:contextualSpacing` are toggle properties. Sources disagree about where table styles sit relative to paragraph styles, and a wrong choice makes a table style either unable to override `Normal` (the observed Word behaviour in practice) or unable to be overridden by a style. | FM-021, FM-022, FM-016 | Build the cascade as an ordered list of levels; verify with a fixture that has a table style setting a font and a paragraph style setting a different one, then pin the order and lock it with the fixture. |
| OI-2 | **NFC normalisation asymmetry**: typed/pasted text is normalised, loaded text is preserved. This is deliberate (lossless round trip) but means a document can contain two byte sequences for the same word, which affects find and spellcheck. | ED-015, ED-032, ED-036 | Keep the asymmetry, and make all comparison paths (find, proofing, collation) normalise their operands rather than the stored text. |
| OI-3 | **What formatting the second paragraph's text takes when a paragraph mark is deleted** (ED-014): the leading paragraph's mark `rPr`, the paragraph's own style resolution, or nothing. Word's observable behaviour is inconsistent enough that I would not encode a rule without a fixture. | ED-014 | Take a fixture DOCX with two differently-formatted paragraphs, delete the mark in Word, inspect the result, and encode exactly that. |
| OI-4 | **Footnote/endnote text in the plain-text clipboard flavour**: whether to append note text or omit it. Word omits it; some consumers expect it. | ED-026 | Default to omitting with a `clipboard.degraded` event; expose `clipboard.plainTextIncludeNotes` as a host option. |
| OI-5 | **Required data files**: RO and RU spellcheck dictionaries, hyphenation dictionaries, the Romanian word list for diacritic restore, the autocorrect rule sets, and the built-in style table. These are data dependencies with licensing implications (a GPL dictionary cannot ship in a permissively-licensed library). | ED-017, ED-018, ED-019, ED-036, FM-016, FM-023 | Source permissively licensed or self-produced dictionaries; treat the built-in style table as original data transcribed from the OOXML built-in style names (which are not copyrightable) but written as our own definitions. Decide before the affected feature is scheduled. |
| OI-6 | **Cross-document comment paste**: whether Word copies comment bodies across documents or drops them. I specified dropping with a `degraded` event because comment parts and relationships are document-scoped. | ED-028 | Verify with Word; if Word copies them, implement copying with new ids. |
| OI-7 | **Whether the toolbar's font-size control also writes `w:szCs`.** I specified that it does (so a mixed-script run stays consistent), but this is a deliberate divergence risk if Word writes only `w:sz`. | FM-002 | Verify against a Word-produced file that sets a size from the toolbar on a run with both Latin and complex-script text. |
| OI-8 | **Space-before suppression at the top of a page**: controlled by `w:compat` settings (`suppressTopSpacing` and the hard-break variant) but the actual rule is a layout decision. | FM-011, FM-016 | Own the property and the compat flag here; let layout (02) implement the pagination-time rule and cover both with fixtures. |
| OI-9 | **Interaction of `w:style/w:locked` with document protection** and whether a locked style can be modified in an unprotected document. | FM-019, FM-023 | Verify; the proposed default is: `w:locked` is honoured only when protection is enforced, and is advisory otherwise. |
| OI-10 | **Word's exact tint/shade arithmetic** for theme colour variants, including whether Word 2013+ persists per-slot variant ladders in a theme extension rather than computing them. | FM-024 | Verify with a Word-produced theme part containing `w:themeTint` values across the 5-variant ladder; pin the formula so that editor and renderer agree even if it differs from Word by a rounding step. |
| OI-11 | **`^n` (manual column break) and a few other find special codes** whose exact Word codes I could not confirm; the table in ED-035 includes only the codes I am confident about, and the rest must be completed from Word's Special menu. | ED-035 | Enumerate Word's Find→Special menu directly and complete the table. |
| OI-12 | **Column selection and visual lines**: whether Word's block selection is anchored to visual lines or to paragraph lines. I specified visual lines because that is what the rectangle looks like. | ED-005 | Verify with a wrapped paragraph and a rotated/vertical text box. |

---

## 6. Coverage map

Every bullet of the domain brief mapped to its feature(s), so that a reviewer can check the brief
against the spec without re-reading it.

| Brief item | Features |
| --- | --- |
| Caret placement | ED-001 |
| Keyboard navigation: Ctrl+Arrow | ED-009 |
| Keyboard navigation: Ctrl+Home / Ctrl+End | ED-010 |
| Keyboard navigation: Ctrl+Shift semantics | ED-003, ED-009, ED-010, ED-011 |
| Selection: character / word / line / paragraph / block / cell / row / column / object / all | ED-004, ED-006 (block: ED-005 means column selection; structural block is ED-004) |
| Shift-extension | ED-003, ED-009, ED-010, ED-011 |
| Multi-click and drag-select | ED-003 |
| IME composition | ED-016 |
| Dead keys | ED-015 |
| Diacritics for Romanian (ă â î ș ț) | ED-017, ED-015 |
| Russian input | ED-018 |
| Autocorrect | ED-019 |
| Autoformat | ED-020 |
| Smart quotes | ED-021 |
| Undo/redo with typed-run grouping | ED-023, ED-024 |
| Exactly one undo entry per object-manipulation gesture | ED-025 |
| Clipboard: rich, plain, internal, cross-document | ED-026, ED-027 |
| Fields and content controls surviving a clipboard round trip | ED-028 |
| Drag-and-drop of text and of files | ED-031 |
| Find and replace | ED-032, ED-033, ED-034, ED-035 |
| Formatting-aware find | ED-033 |
| Regex find | ED-034 |
| Spellcheck integration | ED-036 |
| Show-formatting-marks toggle | ED-037 |
| Read-only and restricted-editing modes | ED-038 |
| Headless no-DOM consumer driving the same mutations | ED-039 |
| Character formatting | FM-001 - FM-008 |
| Paragraph formatting | FM-009 - FM-016 |
| Paragraph dialog (indents, spacing, line spacing, page-break rules) | FM-015 (with FM-010, FM-011, FM-012, FM-016) |
| Styles gallery | FM-017 |
| Applying / modifying / creating styles | FM-018, FM-019 |
| Style inheritance and based-on | FM-020 |
| Direct formatting vs style precedence using Word's actual rules | FM-021, FM-022 |
| Themes and theme fonts / colours | FM-024, FM-025 |
| Format painter | FM-007 |
| Clear formatting | FM-006 |
| Reveal formatting | FM-008 |
| List styles vs direct list formatting | FM-030 |
| Numbering format choices (bullets, arabic, roman, letters, multilevel) | FM-026, FM-027, FM-028 |

<!-- END -->
