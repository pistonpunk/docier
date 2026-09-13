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
once i start typing or do anything! then idk where it is".

Not reproduced as stated. Measured by sampling the caret's computed opacity over
1.3 seconds: after clicking into text it takes both values (blinking), and after
typing it still takes both, with `display: block` and a real box on screen at the
caret's position. So the caret exists and blinks in the paths I tried.

Two things about it are nonetheless worth acting on, and may be what is meant:

- It is 1px of pure black blinking with a 50 percent duty cycle, so for half of
  every second there is nothing at the insertion point. Word's caret blinks too,
  but a person rarely complains about Word's, which suggests the difference is
  contrast and width rather than the blink itself.
- Nothing hides it when the document loses focus, and nothing guarantees it is on
  screen after keyboard navigation, undo, a programmatic selection, a zoom change
  or a layout change: `scrollCaretIntoView` runs only from `reveal()`. Each of
  those is a path where the caret can be painted off screen with the view never
  moved to it. That is a plausible source of "then I don't know where it is".

Being gathered separately at the model level and will be folded in here.

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

### The context menu is poor

**Reported:** "rightclick menu is ass".

An earlier audit established that every context menu item does something, so this
is presentation and content rather than dead entries. `WORD-UI.md` already
records the specific defects found by research: items render as unstyled
user-agent buttons, disabled-reason prose is printed inside the items, submenus
open at the item's right edge rather than the menu's, the menu opens with its
first item under the pointer and is about 35 percent taller than Word's, and the
text menu is missing most of Word's entries. Being measured and designed
separately and will be folded in here.

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

**A decision to put to the commissioner.** Word has no height handle on a table,
because a table's height is the sum of its rows. I recommend refusing one and
pointing at Table Properties rather than inventing an affordance Word does not
have. The same reasoning puts table *move* out of scope: OOXML has no in-flow
table position.

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
