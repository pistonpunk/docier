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

### The indent controls cannot be dragged

**Reported:** "the indent controls are fucked, i need to click to move one and
then click somewhere else on the page etc etc. make it drag to move as it's
unusable".

The margin markers on the same ruler already drag correctly, hold to move, with a
guide and one commit on release. The indent markers still use an older helper
that commits on every pointer move. Being reproduced and diagnosed separately and
will be folded in here.

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

### Objects cannot be resized like Word's

**Reported:** "images, tables, whatnot, should be resizable just like in word".

Dragging a vertical cell border resizes a table column and dragging a horizontal
one resizes a row, both verified. What does not exist: selecting an object and
getting handles, resizing a picture, resizing a table as a whole, or moving either.
Inserting a picture is refused outright, as are footnotes, headers, hyperlinks,
symbols, text boxes, a table of contents and comments. Being researched
separately, including whether the transaction snapshot covering media is the gate,
and will be folded in here.

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
