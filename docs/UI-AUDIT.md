# UI and interaction audit

A research pass into the parts of docier that do not work the way a person
expects, with the measurements behind each finding and a phased plan to fix them.
This is the *behaviour* audit; `WORD-UI.md` is the *appearance* audit. They share
a subject and should be read together.

Nothing in this document has been implemented. It exists so the work can be done
one phase at a time without re-measuring anything.

## How this was measured

Driven in Chromium at 1600x1000 against a local build of `example/`, plus reading
the source for causes. Numbers in quotations are real output. Where a claim comes
from the person using the product rather than from my own measurement, it is
marked **reported** and says whether I reproduced it.

## The ribbon should fit its contents

**Reported:** "words ribbon isnt 84px just because, it fits its contents
perfectly, same should happen here".

This is a correction to the plan in `WORD-UI.md`, which had the ribbon on a fixed
`--docier-ribbon-height` token, and it is right. Measured by removing that
minimum and reading what each tab actually needs:

| Tab | Natural height | Rows per group |
|---|---|---|
| Home | **112px** | 2, 3, 2, **4**, 2 |
| Insert | 51px | 1 across seven groups |
| Design | 51px | 1, 1 |
| Layout | 51px | 1, 1, 1 |
| References | 51px | 1 across four groups |
| Review | 51px | 1 across four groups |
| View | 51px | 1, 1, 1 |
| Table | 51px | 1, 1, 1 |
| Picture | 51px | 1, 1, 1 |

So letting the ribbon fit its content today gives 112px on Home and 51px on
everything else, and switching tabs moves the document 61px. That is why the
fixed height was introduced, and the fixed height was treating the symptom.

Word's ribbon fits its contents *and* holds one height because its tabs are
designed to need the same one. The measurements say exactly which groups are over
and which are under:

- **Over on Home:** Styles needs four rows and Font needs three.
- **Under on every other tab:** one row each, where Word's tabs use two, because
  Word gives its important commands large buttons with the label beneath.

So the work is content design on both sides, not a height token:

1. The Styles gallery becomes a single horizontally scrolling row of preview
   tiles, which is Word's shape and takes Styles from four rows to one.
2. The Font group is brought to two rows, which needs the large button variant
   and a smaller control, not more width. The measurement and the failed
   attempts are recorded in `WORD-UI.md`.
3. The other tabs are brought up to two rows by making their principal commands
   large buttons, which is what Word does and what makes its tabs uniform.
4. Only then is the forced minimum height removed, and the ribbon is left to fit
   its content as it should.

Acceptance: with the token removed, every tab's natural height is within a few
pixels of the others, and the document does not move when a tab changes.

## Reported problems

### Range formatting does not apply

**Reported:** "can't highlight text and apply styling just to it". **Confirmed,
and it is severe.**

At the model level, with the XML read before and after:

| Selection | Result |
|---|---|
| Mid-run inside a paragraph's only run | `noop`. No mark anywhere, and the paragraph is **silently split** at the start offset |
| Same on `fixtures/contract.docx` p0, selecting 1..6 of the Heading1 run | same `noop`, the paragraph becomes `<r>C</r><r>ONTRACT ...</r>`, still no `w:b` |
| Mid-run in a multi-run paragraph | partially applies: the middle and trailing runs get the mark, the run holding the selection **start** never does |
| Spanning two paragraphs | only the second is formatted; the first is split and left unformatted |
| Starting exactly on a run boundary, or covering a whole run | works correctly |

Press Bold once and nothing happens; press it again, on the same selection, and
it works, because the first press split the paragraph at the selection start. That
is why the DOM-level measurements were ambiguous.

**Root cause.** `setRunPropertiesOnRange` (`src/edit/mutation.ts:460`) splits the
selection boundaries with `splitBoundary` (`src/edit/mutation.ts:454`), which
splits through `splitRunAt` (`src/edit/mutation.ts:196`) by mutating
`paragraph.children` directly. But `runSpans` (`src/edit/mutation.ts:99`) reads
the run list from `Paragraph.of(...)`, and `Paragraph.children()` memoizes it in
`childCache` (`src/model/blocks/paragraph.ts:47-59`). Nothing invalidates that
cache, and `forgetSubtree` is not called until the very end
(`src/edit/mutation.ts:475`), after the damage. Measured directly: after
`splitRunAt(run, 2)`, `runSpans` still reports a single run of length 2 while the
paragraph really holds 11 characters across two runs.

So the second split is computed against a truncated paragraph, and the scan that
chooses which runs to patch sees a run list that no longer matches the text, comes
back empty, and the command returns `false`. `clearRunFormattingOnRange`
(`src/edit/mutation.ts:479`) has the same defect.

**The fix is one line**: invalidate the paragraph view inside `splitBoundary`
after its loop, with `model.context.forgetSubtree(paragraph)`. Both callers route
their splits through it. Emulated with that single change: a mid-run selection
yields `<r>al</r><r><w:rPr><w:b/></w:rPr>pha b</r><r>ravo</r>`; the multi-run case
now marks the leading partial run; the two-paragraph case marks both paragraphs.

**A second, separate defect behind the same report.** The report also says the
toggle "unselects them once I start typing", and that is true whenever the caret
sits on a run boundary. Three conventions for "the run at the caret" disagree:
`caretRun` (`src/edit/mutation.ts:504-510`, used by the toggle) and
`runElementAt` (`src/edit/inspect.ts:62-72`, used by the toolbar) are left-biased,
while `insertionPoint` (`src/edit/mutation.ts:247-285`) is right-biased and at
`at === span.start` inserts *before* that run while copying **its** properties. So
the toggle and the toolbar mean the run ending at the caret, and typing continues
in the run starting at it. Confirmed in the browser: with the caret at the start
of a bold run, Ctrl+B wrote `<w:b w:val="0"/>` onto the preceding run, the text
the user never pointed at, and the button went out.

The fix is in `insertionPoint`'s `at === span.start` branch: take the properties
from `previous` when it exists, keeping the insertion index so surrounding markers
do not move. That makes what the toggle writes, what the toolbar shows and what
typing inherits the same run. Right-biasing the other two instead would remove the
disagreement but invert which run the button toggles, so it is the worse option.

**Three secondary findings from the same investigation:**

- When a format fails this way the paragraph has still been mutated, but the
  command reports `changed: false`, so no change event is emitted and no undo
  entry is recorded (`src/edit/commands.ts:174-188`). The tree is dirty, undo
  reports disabled, and a save would contain the stray runs.
- **There is no pending or sticky format state anywhere in the code base.** Caret
  formatting is implemented purely by writing into the run under the caret, which
  is why the boundary convention matters as much as it does.
- `isActive` resolves marks through styles, so on a Heading paragraph the Bold
  button reads active even when the run carries no `w:b`, and the first toggle
  writes an explicit off rather than turning the button off.

### The caret is lost during work

**Reported:** "the intermittent cursor that shows where the text is, disappears
once i start typing or do anything! then idk where it is". **Confirmed, and the
cause is not what it looks like.**

The caret element is almost never *hidden*. In a 25-step instrumented walkthrough
it never received `display:none` in any normal path. What a person meets is worse
and simpler: **the caret keeps blinking as a lie while the editor has stopped
listening, or cannot edit.** Six conditions, each reproduced, in the order they
are likely to be met.

**1. Focus is never taken on mount, so the caret blinks at position 0 while
keystrokes go nowhere.** Load the demo and type without clicking: `activeElement`
is `BODY`, not the composer, and the typed text produces nothing and moves
nothing, while the caret is painted and blinking at the document start. Every key
listener is attached to the hidden composer (`src/edit/input.ts:744-754`) and the
composer is only focused by a pointer down inside the page
(`src/edit/input.ts:614`). The mount path never focuses it
(`src/api/editor.ts:943-953`). **The demo asks for the behaviour that does not
happen**: `example/src/main.ts:107` sets `autoFocus: true`, the option is
declared (`src/api/types.ts:470`), defaulted (`src/api/config.ts:19`), typed
(`src/api/config.ts:103`) and documented as working in the spec, and **nothing in
`src/` reads it**. It is dead code. Fix: read it in `mountSession` after
`attachInput` and call `input.focus()` then `input.reveal()`.

**2. Clicking any chrome blurs the composer and nothing restores it.** This is
almost certainly the reported experience. Click in the text, type to prove it
works, click a ribbon control, then type again: nothing, while the caret is still
on screen and still blinking. Only the floating toolbar
(`src/ui/floating-toolbar.ts:149-151`) and the menus (`src/ui/menu.ts:222-225`)
cancel the focus-stealing mousedown; the ribbon's control factory
(`src/ui/controls.ts`, around line 371) and the status-bar buttons do not. So
mousedown moves DOM focus to the button, blur takes the keyboard from the
composer, and because all key handling lives on that one element there is no
fallback and no blur handler. Word does the opposite: the document keeps the
caret and the ribbon never steals it. Fix: the same mousedown `preventDefault`
on ribbon and status-bar controls. Hiding the caret on blur would remove the lie
but not fix the typing.

**3. Ctrl+A over a table wedges the editor, and clicking inside the selection
cannot get you out.** Press Ctrl+A in the sample and type: the selection is
`[0, 877]`, the text length does not change, and the caret is painted and
blinking while every edit is refused. `selectAll` selects the whole *story*
including cell containers (`src/edit/selection.ts:119-123`), any range crossing a
cell boundary is uneditable (`src/edit/session.ts:400-413`), and so `insertText`
is disabled with `CROSSES_CELLS` and each keystroke is swallowed silently
(`src/edit/commands.ts:120-130`, `:367-374`). The trap is the escape: a click
inside the selection only *arms a drag* instead of collapsing it
(`src/edit/input.ts:614-616`), so the wedged state survives the obvious recovery.
Only an arrow key gets out. Fix: clamp `selectAll` to the anchor's container, or
collapse the selection when a click lands inside it.

**4. The header and footer caret is painted at the top of the page.** After
inserting a footer, the caret box measured top 253 while the footer text sat at y
1306: painted horizontally right, vertically wrong, by exactly the region
placement offset. `placeBlocks` shifts `block.box.y`, `line.box.y` and
`line.baselineY` by `dy` (`src/layout/pipeline.ts:58,65,66`) but leaves
`line.caretStops` untouched, so the stops stay region-local while everything else
moves. Fix: shift the stops by the same `dy`.

**5. Zoom moves the caret without revealing it, and the zoom control also steals
focus.** Click mid-text, then zoom to 150 percent: the caret's top becomes 994
while the scroll view ends at 973, with `scrollTop` unchanged. `setZoom` ends in
`input?.refresh()` (`src/api/editor.ts:1088`), and `refresh` paints without
scrolling, where the transaction path calls `reveal()`
(`src/api/editor.ts:745-746`, `:393`). Zoom is the outlier. Fix: call `reveal()`
there instead.

**6. The blink is free-running at a 50 percent duty cycle, never reset on
input.** Typing one character every 110 to 130ms and sampling the computed
opacity right after each keystroke gives an on-fraction of **0.49**, with a
longest off interval of 540ms, and the animation's `currentTime` shows the phase
is never reset by input. So the caret is genuinely absent about half the time,
including while you are typing, and stopping mid-cycle leaves it dark. Word's
caret goes solid while you type and restarts its blink from the visible phase on
each keystroke. Contrast is not the problem: 1px of black on white is the maximum
available, about 21:1.

**Two things that turn a transient state into a permanent one.** The print
stylesheet's `!important` hide (`src/render/print-style.ts:86`) beats the caret's
inline `display`, verified in the browser, though it is reachable only for a host
that starts a print preview. And `scrollCaretIntoView`
(`src/edit/input.ts:345-356`) returns early when the caret's display is `none`,
so once anything hides it, nothing can reveal it again.

**What I could not reproduce, having tried:** a caret hidden at the very end of a
document, in an empty paragraph, in a table cell, or on an unrendered page (there
is no such page: the DOM holds every laid-out page in every measurement). The
only genuine no-caret case found is a body with no paragraphs at all, which the
engine's own edits make unreachable.

### The indent controls cannot be dragged, and they corrupt other paragraphs

**Reported:** "the indent controls are fucked, i need to click to move one and
then click somewhere else on the page etc etc. make it drag to move as it's
unusable". **Confirmed, and the real behaviour is worse than reported.**

**They cannot be dragged at all.** A 60px drag with eight to twelve pointermove
steps moves the marker zero pixels: `indent-left` stays at 307.141px and
`aria-valuenow` stays 1440 across every sample, with no `setParagraphIndent`
executed. Measured at document level with capture listeners, a whole ruler drag
delivers **9 pointermove, 1 mousemove, 0 mouseup, 1 pointerup**. `startDrag`
(`src/ui/ruler.ts:246`) calls `preventDefault()` on pointerdown, which makes
Chromium suppress the compatibility mouse events for the rest of that sequence,
and then listens for `mousemove` and `mouseup`. Its move handler never runs and
its up handler never runs. `marginDrag` calls the same `preventDefault` but listens
for the pointer events, which is the whole difference.

**What the commissioner experienced is a leaked listener, and it is a data-loss
bug.** `startDrag` adds `mousemove`, `mouseup` and `keydown` to the document
(lines 273-275) and only `onUp` removes them. Since `mouseup` never fires, they
leak permanently, one set per press. The leaked `mousemove` then fires on every
later pointer movement anywhere on the page and commits
`apply(delta, base)`, where `base` is the indent snapshot from the stale
pointerdown. Measured, a single click on the marker followed by moving the pointer
200px:

```
exec setParagraphIndent {"leftTwips":750,...}
exec setParagraphIndent {"leftTwips":1500,...}
exec setParagraphIndent {"leftTwips":2250,...}
exec setParagraphIndent {"leftTwips":3000,...}
```

3000 twips is exactly the 200px travelled. No click commits anything on its own:
the click arms the tracking, and every later mouse move is another commit and
another undo entry.

**And it edits paragraphs the user never touched.** After arming a listener in one
paragraph, clicking into a different paragraph and moving the mouse with no button
pressed overwrote that paragraph's indent: 2910 twips replaced by 1800,
`aria-valuenow` 4350 to 3240, with repeated `setParagraphIndent` executions. That
is silent data loss on a button-free mouse move, and it is the most serious
finding in this document.

**The badge is wrong in two ways.** It reports the delta rather than the value, and
it treats pixel travel as millipoints, `formatRulerValue(deltaPx * 1000, units)`
(line 258), so a 200px travel displayed "7.1 Centimetres" for a resulting indent of
5.29cm, about 33 percent high and ignoring zoom. It also stays on screen
afterwards, because the handler that would hide it never runs.

**Two hit-target defects.** `indent-hanging` is **unreachable whenever the first
line is not negative**: it sits at exactly the same x as `indent-left`, which
paints later, so all five probes returned `indent-left` or the page. This is the
same class of bug as the old margin-marker-under-the-corner problem.
`indent-first-line` is a triangle whose effective target tapers to a point at its
bottom, so probes at its left and right edges miss.

**And a value-model bug the drag fix will expose.** `setParagraphIndent` with
`{leftTwips:-600, firstLineTwips:-300}` returns `ok` and writes
`<w:ind w:left="-600" w:right="0" w:firstLine="-300"/>`, but both attributes are
unsigned in OOXML, so a leftward drag produces a file Word will interpret
differently. `applyIndent` (`src/ui/ruler.ts:58-61`) assigns absolute values with
no clamp. A negative first line should become `w:hanging`.

**The fix, and why it is a deletion.** Replace the `startDrag` call in the indent
pointerdown handler with an `indentDrag` shaped exactly like `marginDrag`: snapshot
the base and the start x on pointerdown; on document `pointermove` compute the
pending value, show the guide and the badge with the *absolute* resulting value,
and commit nothing; on `pointerup` remove the listeners and commit once, and only
if the value changed; on Escape revert and clean up, and register a cancel hook
for disposal. Keep the existing `indentApply` table for the value math, add
clamping inside `commitIndent`, and **delete `startDrag`**, so both marker families
share one interaction and the guide, the badge formatting and the single-commit
semantics are literally one piece of code. The two genuinely differ only in the
value math, which is already parameterised per marker.

Verified page-side without touching the repository: a pointer-event drag with a
deferred commit produced a clean linear ramp of 150, 300, 450, 600, 750, 900 twips
for 10 to 60px of travel, exactly one commit of 900 twips on release, and the
marker moved 307.141px to 367.141px.

A one-token alternative, changing six strings from the mouse events to the pointer
events, makes the drag track and terminate but keeps one undo entry per move and
the wrong badge, so it does not give the interaction being asked for.

### The context menu is poor, and two of its entries do nothing

**Reported:** "rightclick menu is ass". **Confirmed.** An earlier audit of mine
concluded that every context menu item worked, because clicking each one changed
something. That verdict was wrong in a specific way worth recording: an item that
opens a dialog stub sets a status message, which changed my fingerprint and read
as alive. Measured properly, **Cut, Copy and Paste in the text menu are built as
`openDialog` stubs and do nothing but print a message**, even though
`clipboard.cut`, `clipboard.copy` and `clipboard.paste` are all registered in
`src/edit/clipboard/commands.ts`. The same wiring bug affects the table menu's
four insert rows, which are `pending(...)` stubs although
`table.insertRowsAbove` and the rest exist.

**The box is fine; the rows are user-agent buttons.** At every surface the menu is
fixed, white, 1px bordered, 4px radius, with the right shadow. The rows measure:

```
display:flex  padding:5px 12px  min-height:24px  height:29px
font:13.3333px Arial          <- the UA button font, not the 12px UI font
background-color:rgb(239,239,239)   <- UA buttonface
border:2px outset rgb(0,0,0)        border-radius:0px   appearance:auto
```

The cause is one omission: `createControl` gives a plain item only the class
`docier-menu-item` (`src/ui/controls.ts:328`), and the reset that would fix it
(`appearance:none;background:transparent;border:1px solid transparent;font:inherit`)
lives on `.docier-control` (`src/ui/styles.ts:65`), which menu items never receive.
That single omission produces the grey slabs, the 29px rows, and **a dark theme
where the labels are invisible**: enabled rows render `#f2f2f2` text on the
`#efefef` buttonface, so only the disabled rows are readable.

**Items also shrink-wrap instead of filling the row.** There is no rule at all for
`.docier-menu-row` anywhere, and no `width:100%` on the item, so a 190px item sits
inside a 449px row and the hover fill is a ragged patch that stops at the label.
Measured widths across one menu: 190, 209, 284, 65, 56, 93, 73, 449, 156, 96. The
one full-width row is what sets the menu's width.

**Disabled rows print their reason inside themselves**, duplicating what is
already in the accessible name, the tooltip and the status bar
(`controls.ts:359-363`, styled at `styles.ts:86`). Live strings seen: "Select the
text to cut", "The clipboard is empty or unavailable", "This build has no search
engine, so find and replace are not implemented".

**Hover barely reads and disabled gives nothing.** The fill is
`--docier-state-hover` `#f5f5f5` on white, a 4 percent step, and the
`:not([aria-disabled="true"])` guard means a disabled row has no feedback at all.
Dark mode overrides neither state token, so it hovers to a light-theme fill.

**Four defects in the menu's own behaviour, all in `src/ui/menu.ts`:**

- **Submenus open at the trigger item's right edge**, not the menu's: measured at
  x=376 where the item ends, while the parent menu's right edge is 770. They open
  on click only, with no hover intent, and no chevron marks a row as having a
  child.
- **Clicking a submenu parent destroys the parent menu.** `openMenu` ends by
  focusing a child row (`menu.ts:246-247`), which fires `focusin` synchronously
  while `child` is still unassigned, so the parent's own handler
  (`menu.ts:230-236`) sees a target outside its list and closes itself. It is
  deterministic and reproduces on the text and ruler menus.
- **The viewport clamp uses a size the box no longer has.** It reads
  `offsetWidth`/`offsetHeight` before positioning, then applies `left`, which
  constrains the width, re-wraps the long rows and grows the box past the height
  it clamped against. Measured at 1000x700: a menu 392x334 placed at top 373,
  bottom 707, 7px past the viewport with its last row clipped.
- **The menu is glued to the pointer**, at exactly `clientX/clientY`, so the first
  row sits under the cursor. At the bottom edge the clamp then slides the box up
  and the pointer lands on the *last* row instead: measured with the pointer at
  y=887, the menu at top 716.

Two smaller ones: no `font` declaration on the menu at all, so labels are Arial
13.33px while separators inherit 16px from the host page against the ribbon's 12px;
and a mouse-opened menu focuses its first enabled row, so it appears with a focus
outline already drawn.

**A content defect:** the table's Cell Alignment rows are built as toggle nodes
with an `openDialog` action and no command, so `active` is always false and the
submenu can never show which alignment is current. It also carries three of Word's
nine positions.

#### Contents against Word

The text menu is missing **Paste Options** (the page menu already builds that
submenu, and `clipboard.pastePlain` exists), **New Comment** (`comment.create` is
registered, so the row would render honestly disabled), **Translate** and
**Format Painter** (neither command exists, so each needs a new
registered-unsupported entry rather than a row that lies). Font and Paragraph are
present as submenus where Word has dialog items, and the dialogs do not exist yet.

The table menu should nest its two delete groupings under a single **Delete**
submenu, and is missing Insert Cells, a Select submenu, Split Table, Borders and
Shading, the other six cell alignments, Text Direction, AutoFit and Distribute,
Sort, Formula and Repeat Header Rows. Of those, only New Comment is actionable
today; two more could be composed from `table.setColumnWidth` and
`table.setRowHeight`; the rest need new commands, and the Select submenu needs a
selection helper that does not exist.

#### The design

- **Rows**: `min-height: var(--docier-menu-item-height)` at 22px in the comfortable
  density, `padding: 0 12px`, `width: 100%`, `appearance: none`, `border: 0`,
  `background: transparent`, `font: inherit`, and `cursor: default` rather than a
  pointer. Label column at 30px from the edge (8 padding, 16 check, 6 gap),
  `flex: 1 1 auto` with an ellipsis. Inset `4px 8px` on the label so the check
  column does not move when a menu carries no checkmarks.
- **Hover**: `--docier-state-selected` `#ebebeb`, an 8 percent step, across the
  full row. Disabled rows keep a flat colour with no fill.
- **Separators**: `margin: 4px 8px` so the line is inset rather than full bleed.
- **Submenus**: anchor at the parent menu's right edge less 2px, vertically
  aligned to the row, flipping to the left when they would overflow, with a 12px
  chevron in the right-hand column and hover intent.
- **Positioning**: anchor at the pointer plus 2px so the cursor is never inside the
  box, and measure *after* positioning rather than before, which removes the
  clamp defect and the overflow in one change.
- **Focus**: do not focus a row on a mouse open; focus the list itself and move to
  the first enabled row only for the keyboard path.
- **Type**: 12px `var(--docier-ui-font)` for labels and shortcuts, and no text in
  separators, which removes the inherited 16px.

Net effect on the text menu: **327px tall to about 257px**, and 451px wide to
about 200px once the disabled prose is gone.

New tokens: `--docier-menu-item-height` per density (20/22/44),
`--docier-menu-min-width: 200px` with the JavaScript `|| 220` fallback removed so
there is one source of truth, and dark-theme values for `--docier-state-hover` and
`--docier-state-selected`, which are currently missing and make dark mode hover to
a light fill.

#### Fix order

The visual complaint is almost entirely CSS: the four rules for the row, the hover
selector, the separator inset, the type, and the dark tokens. Then the five-line
deletion of the disabled prose in `controls.ts:359-363`. Then the four behavioural
defects in `menu.ts` and `context-menu.ts`. Then the contents, where Cut, Copy and
Paste and the table's four insert rows should be switched from stubs to the
commands that already exist.

### Objects cannot be resized like Word's, and a picture cannot even be seen

**Reported:** "images, tables, whatnot, should be resizable just like in word".
**Confirmed, and there is a larger problem underneath it.**

Measured against `contract.docx`, the only shipped document with media:

- **An image cannot be selected.** Clicking its centre sets a *text* caret: the
  selection moved from 0 to 311. There is no object-selection state to reach.
  `EditSelection` (`src/edit/selection.ts:16-21`) is anchor/focus/affinity, all
  text positions, and `hitTestPage` (`src/edit/caret.ts:89-100`) maps a point to a
  caret stop with no object test.
- **It shows no handles.** The only object DOM is one
  `<div class="docier-object" ...>`. Probing all eight handle positions returns
  the image's own label or the hidden input, with cursor `auto` at every one.
- **A table cannot be resized as a whole or moved.** Its outer right edge and its
  bottom edge both have cursor `auto`, dragging either changes nothing, and
  dragging from its top-left corner changes nothing.
- **The only affordance beyond the cell borders is the cell borders**, and both
  work: a 60px column drag took the table 623 to 686 wide, a 30px row drag took
  the row 30 to 60, one commit per gesture.

**And the bigger problem: no picture renders in the demo at all.** `contract.docx`
carries `word/media/image1.png`, but the renderer takes the missing path:
`data-docier-image-missing="rId4"`, a dashed red outline, a child label reading
`missing image: rId4`, and zero `docier-image` elements. The 64px box is exactly
the extent, so position, crop and rotation are laid out correctly and only the
bytes are absent. `images` and `imageProvider` are host-supplied render options
(`src/render/types.ts:113-114`), the demo passes neither, and nothing extracts
media parts for the renderer. So any resize would be validated against a red
dashed placeholder.

**Also absent: floating objects.** Replacing the fixture's `wp:inline` with a
well-formed `wp:anchor` made the object disappear entirely, with the document
still loading clean and no error surfaced. `objectPlacementOf`
(`src/layout/objects.ts:90-94`) returns nothing unless a `wp:inline` child exists,
and there is no wrap type, position or anchor modelling anywhere in `src`.

**A small related defect:** right-clicking the picture gives the ordinary *text*
menu. `SURFACE_ATLAS` (`src/ui/context-menu.ts:18`) detects an image surface with
`img,[data-docier-image]`, which never matches the wrapper the missing path
produces, because that carries `data-docier-image-missing`.

#### The snapshot gate is narrower than the plan assumed

`EditSnapshot` (`src/edit/session.ts:60-65`) is body, relationships, numbering and
regions. Media is not in it. But what that actually gates matters, because it
changes the order of work:

- **Resizing an existing picture is not gated.** A resize writes attributes
  inside `body`, which is cloned and restored, and the relationship row is covered
  by the relationships field. Undo restores both.
- **Resizing a table is not gated.** Columns and rows already commit this way.
- **Inserting a picture *is* gated**, because it creates a media part. The package
  layer already has both halves: `addMediaPart`
  (`src/ooxml/package.ts:636-658`) creates the part and its relationship, and
  `Part.setBytes` (`src/ooxml/part.ts:204-211`) replaces bytes. Only the snapshot
  fails to call them. Note `pruneUnusedMedia` (`package.ts:752-769`) has **no
  callers**, so an undone insert leaks an orphan part into the saved package
  rather than corrupting it.
- **Floating objects are gated on the model, not the snapshot.** Nothing exists.

Undo runs the stored closure rather than the commit hooks, so media has to go into
the snapshot itself, not into `afterRollback`.

#### The design trap: object identity does not survive an edit

`paintObjects` stamps each object with `String(atom.atomId)`
(`src/render/objects.ts:103`), and `atomId` is a per-paragraph ordinal from a
counter inside atomize (`src/layout/atoms.ts:125-149`). Every resize triggers a
relayout, so a selection held as an atom id does not survive the edit it causes.
A stable id has to be added at the same time: either the `DrawingContent` `NodeId`
or `wp:docPr/@id` read during ingest.

#### The good news, which makes this cheaper than it looks

The overlay and the drag guide are appended to the **unscaled** surface,
`.docier-editor-surface` (`src/api/editor.ts:309-312`), which is the parent of the
element carrying `transform: scale(zoom)`. So a handle drawn there is constant in
device pixels at every zoom with no extra work, which is the hardest constraint in
the object spec already satisfied. The coordinate conversion, the drag skeleton
and the commit wrapper all exist for the table borders, and `TableFragment.box` and
`PreparedTable.total` already give a table's edges without new layout work.

#### The order of work

**Step 0, with step 1: make pictures visible in the demo**, by passing the media
parts of the loaded package to the renderer as `images` or `imageProvider`.
Without it nobody can see a resize, and the byte-preserving round trip is
untestable. It is small, it is demo-side, and it turns a plausible feature into an
observable one.

**Step 1, the first real resize: selection and handles for inline pictures.**

1. A stable id on `ObjectPlacement`, stamped on `.docier-object`.
2. An object-selection state beside the text selection, with
   `docier.command.object.select`, and un-refusing the existing
   `docier.command.object.setSize` (`src/edit/areas/unsupported.ts:191`), whose id,
   label and shape are already correct.
3. A hit test for object rects before the caret fallback, and eight handles plus a
   frame drawn on the unscaled surface.
4. A handle drag that previews by scaling the object element and commits once on
   release through a new area command written like `setColumnWidth`.

Corner handles lock the aspect ratio with the **opposite corner fixed**, which is
what stops the object walking across the page, and `Shift` inverts the lock, which
is Word's model and the opposite of most web editors. Commit `wp:extent` for the
layout and `pic:spPr/a:xfrm/a:ext` for everyone else; the media bytes and the crop
are never touched.

This step needs no snapshot change, no model change beyond one id, and no new
public API, which is why it is first.

**Then:** the table's whole width, which is a proportional multi-element write to
keep `tblW`, `gridCol` and `tcW` consistent and must set `tblLayout` to fixed or
Word will resize the table on open; then floating objects, which is the large
piece and where move lives; and picture *insert* last, because it is the only item
that changes what the file can contain and the only one the snapshot gates.

**Decided: tables get a width control and no height control.** Word has no height
handle on a table, because a table's height is the sum of its rows, and the
commissioner agreed to width only. So a table gets left and right handles on its
outer edges, with a proportional write to `tblW`, `gridCol` and `tcW` that sets
`tblLayout` to fixed, and no vertical handle at all. A person wanting a taller
table changes its rows. Table *move* stays out of scope for the same reason: OOXML
has no in-flow table position.

### The interface chrome reads as unfinished

**Reported:** "the text+ui in the app ui background is a mess (renderer is ok at
first glance)".

I could not pin this to one thing, so here is what I measured that could be meant,
most likely first:

- **The demo's own bar.** The demo puts a 54px dark bar above the editor carrying
  its own buttons. It belongs to my demo shell rather than the library, and it is
  the least Word-like thing on screen: it is dark where everything below is light,
  and it exists in no word processor.
- **The Styles gallery tiles.** They render at **10px in the interface font**,
  which is both off the 12px scale and wrong in kind: a style tile should show
  the style's own face and size so it reads as a preview, which is the whole point
  of a gallery. Eight plain words are what is there now.
- **The group labels.** Each carries its launcher chevron inside the label text,
  so "Clipboard" renders as "Clipboard with a chevron glued to it" rather than as
  a label with a separate control.
- **Sixty-three ribbon controls are still text words** where Word uses icons, on
  every tab except Home.
- **The ruler's negative labels** crowd the corner box, where the numbers to the
  left of the margin run under it.

If the report means something else, the cheapest way to find it is a screenshot
from the machine where it was seen, because every candidate above is visible in
mine and I cannot tell which of them prompted it.

## Phases

Ordered so that each is worth doing before the next. These are separate from the
phases in `WORD-UI.md`, which cover appearance; these cover behaviour, and the
two interleave: A and D want doing first because they are what a person meets
first.

### Phase A - Text editing correctness

The cluster that makes the editor feel broken rather than unfinished: applying a
format to a selection, and the caret being findable while working.

- Range formatting, once the model-level diagnosis lands.
- Pending marks for text typed after a toggle, if the diagnosis shows they do not
  survive.
- The caret: bring it on screen from every path that moves it, and make it
  possible to see at a glance while typing.

Acceptance: selecting a word and pressing Ctrl+B bolds exactly that word and
nothing else; typing after toggling bold produces bold text and leaves the button
pressed; the caret is on screen after every navigation, undo, zoom and layout
change.

### Phase B - Direct manipulation

Everything a person expects to grab and move.

- The indent markers drag like the margin markers already do.
- Objects get selection and resize handles: corner handles preserving the aspect
  ratio, edge handles not, with the cursor changing per handle.
- Tables resize as a whole in addition to by cell.
- Inserting a picture, if the diagnosis shows the snapshot is not the gate.

Acceptance: every handle a person expects is present and drags continuously, with
one commit per gesture.

### Phase C - The menu surface

- Context menu items styled as menu rows, at Word's height, with visible
  separators, hover and disabled states that read.
- Disabled reasons moved out of the items and into the accessible name and
  tooltip.
- Submenus opening at the menu's edge, and the menu positioned so its first item
  is not under the pointer.
- The text and table menus filled out to Word's contents, using commands that
  already exist.

Acceptance: no menu item renders as a user-agent button; the text menu carries
Word's entries; no menu runs off the viewport.

### Phase D - Ribbon content design

As set out above: the gallery as one scrolling row of preview tiles, large
buttons for the important commands, the remaining icons, and then the removal of
the forced height.

Acceptance: natural heights within a few pixels across tabs, with no forced
token.

### Phase E - Dialogs

Carried from `WORD-UI.md`: there are no dialogs at all, and Font and Paragraph
are the two a person reaches for first. This is the largest single build.

### Phase F - The refused commands

Image, footnote, header creation, hyperlink, symbol, text box, table of contents
and comments. Each refuses with a reason today, which is honest but is still a
document that cannot be produced.

## A principle worth keeping

Every finding in this document that took real time came from the same mistake,
mine included: measuring a *subset* of the state and reading absence in that
subset as breakage. The caret looked dead after typing because the probe watched
the wrong frame. Range formatting looked broken because the probe looked for a run
that had been split. Ctrl+I looked dead because it changes no text. The Font group
looked like three rows because the combos' inner inputs were counted as items.

So: when a measurement says something is broken, confirm it by measuring the
thing itself before acting on it.
