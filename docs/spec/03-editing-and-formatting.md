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

<!-- PART2 -->
