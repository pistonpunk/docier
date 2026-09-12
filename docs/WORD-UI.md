# Making docier look and feel like Word

This is the plan for the interface work, written after a research pass that
compared this implementation against Microsoft Word on concrete numbers. It is
organised in phases, ordered so that each one is worth doing before the next.

## How the research was done, and how much to trust it

Four areas were investigated in parallel: ribbon and title bar geometry and
typography; colour, depth and interaction states; the document surface and the
chrome that frames it; and the transient chrome (mini toolbar, context menus,
dialogs, Backstage).

Word itself was not available to measure directly, so every claim about Word is
marked:

- **measured** - read off a Word screenshot that was calibrated against a known
  dimension, accurate to roughly 15 percent.
- **documented** - taken from Microsoft's published interface guidance.
- **estimated** - the researcher's judgement, to be verified before acting on it.

A new-code phase that depends on an *estimated* value should confirm it first.
The confidence is repeated per item below, because the difference matters: the
accent colour is measured and can be changed with confidence, whereas the ribbon
body height has a 15 percent error bar.

Two useful by-products of the research are worth stating up front, because they
change what "looks like Word" means in practice:

1. **Word's ribbon is a fixed height, and its tabs are not all the same.** This
   implementation's ribbon is 111px on Home, 78px on Layout and 50px on Insert,
   so clicking a tab moves the document up or down by up to 61px. Word holds the
   body at a constant height and spends the space differently per tab.
2. **Nearly all of the "Word feel" lives in tokens, not in structure.** The
   accent, the surfaces, the border weights, the state fills and the type scale
   are what the eye reads as Word. The structural gaps (no title bar, no
   dialogs) are real, but the colour pass is what makes the largest difference
   per unit of work, which is why it is phase one.

## Phase 1 - The light theme foundation

Goal: the palette, the state fills, the elevation and the type scale match
Word's light theme. Nothing in this phase adds structure; it changes values.
Everything later is judged against it.

| Item | Value | Confidence |
|---|---|---|
| Accent | `--docier-accent` `#1f6feb` to `#185abd` (Office blue; same hue, so nothing else moves) | measured |
| Ribbon surface | the ribbon becomes the white surface and the tab strip the darker band - currently they are the wrong way round | measured |
| Hover, pressed, checked | neutral greys, not accent tints: `--docier-state-hover #f5f5f5`, `--docier-state-pressed #e0e0e0`, `--docier-state-selected #ebebeb` | documented |
| Structural border | `--docier-border` `#c9c9c9` to `#d1d1d1`, with a lighter value again for in-ribbon separators | documented |
| Text selection | `rgba(24, 90, 189, 0.20)`, about half the current saturation | estimated |
| Disabled text | `#bdbdbd` | documented |
| Pop-up shadow | Fluent's two-layer shadow: `0 8px 16px rgba(0,0,0,0.14), 0 0 2px rgba(0,0,0,0.12)` | documented |
| Page shadow | a token instead of a literal: `0 2px 6px rgba(0,0,0,0.10), 0 0 1px rgba(0,0,0,0.10)` | measured |
| Pasteboard and canvas | `#e6e6e6` behind the pages and `#ececec` for the canvas, from one source rather than two greys meeting at the page edge | measured |
| Text | primary `#242424`, secondary `#616161` | documented |
| UI type | `12px`, with the group label at the same size rather than two steps smaller | estimated |
| Font stack | lead with `Segoe UI Variable Text`, `Segoe UI`, then Selawik (Microsoft's open, metric-compatible face) before `system-ui` | estimated |
| Tab height | `--docier-tab-height: 24px` | measured |
| Status bar height | `--docier-status-height: 22px` | measured |
| Ruler height | 20px in the comfortable density | measured |

Acceptance: build and tests green; the chrome and the demo render in the new
palette; a screenshot compared against the previous one shows the surfaces
inverted to Word's arrangement and the accent at Office blue.

## Phase 2 - Ribbon, tabs and title bar

Goal: the ribbon holds still, reads at Word's proportions, and the Quick Access
Toolbar sits where Word puts it.

1. **A fixed ribbon height.** `--docier-ribbon-height: 84px`, with the panel at
   100 percent, so switching tabs no longer moves the document. *measured*
2. **Large buttons.** Word's most-used commands are 32px icons with the label
   beneath. Add a large control variant and use it for Paste, the whole Insert
   tab, the Design tab and Editing's Find, with 32px glyphs alongside the
   existing 16px ones. *documented*
3. **A title bar with the Quick Access Toolbar.** The QAT currently has no CSS
   rule at all and is parked after the last tab; it belongs in a 32px title bar
   above the tab strip with Save, Undo and Redo at 16px icons and the document
   name centred. *measured*
4. **Row rhythm inside a group.** Wrapped rows are stretched by
   `align-content: stretch`, giving an 18.5px gap between 26px rows where Word's
   rows are adjacent: set `align-content: center` and `row-gap: 2px`, and stop
   groups from growing with `flex: 0 0 auto`. *measured*
5. **Groups sized to their content.** Word spends spare width on the in-ribbon
   gallery, not by stretching every group. Keep the Styles group growing and
   let the rest take their natural width. *measured*
6. **The tab strip.** 24px tall, 12px labels, and the selected tab marked by its
   surface rather than by bold blue text with a coloured underline, which Word
   does not do. *measured*
7. **Narrow ribbons.** Below 760px the panel currently wraps and the ribbon grows
   to between 205 and 281px. Word collapses groups instead. *measured*
8. Smaller items: scope the icon-only label rule to a data attribute so
   text-labelled menu buttons stop inflating to 216px; render the Styles gallery
   tiles with their own class so the style fonts apply; give the ribbon collapse
   control a chevron and a sane hit area, since it is currently an empty
   26x110px accent rectangle. *measured*

Acceptance: the ribbon measures 84px on every tab; the document does not move
when tabs change; the QAT sits in a title bar; no control overlaps and nothing
overflows at 1600, 1280 and 1024.

## Phase 3 - The document surface and the status bar

Goal: the page, the rulers and the status bar read like Word's.

1. **Ruler numerals.** They are 13px near-black body text with no rule at all.
   Give them a muted 9px tabular-numeral style. *estimated*
2. **Ruler numbering starts at the margin.** Word counts from the left text
   edge, so the tick at the margin prints 0. Ours counts from the page edge.
   *documented*
3. **The vertical ruler is always painted; Word shows it over the left margin.**
   Add `verticalRuler: 'always' | 'onMarginHover' | 'never'` defaulting to
   on-margin-hover. *documented*
4. **The ruler goes stale by one zoom step** because `setZoom` updates the DOM
   attribute after the store. Fix the order or read the store. *estimated*
5. **The ruler's white text band is invisible on a white ruler.** *estimated*
6. **The status bar** is 37px with 13px items where Word's is about 22px with
   12px items; its view toggles are in the reverse of Word's order and include a
   Draft button Word does not put there; and its language item prints a locale
   tag rather than a language name. *measured, documented*
7. **Zoom** is a linear 25 to 400 percent slider; Word is 10 to 500 with 100
   percent at the centre, which wants a log-mapped position. *documented*
8. **The ruler corner** is a 38px unit cycler that overhangs the 24px vertical
   ruler; Word's corner is the tab selector. Move the unit cycler to the ruler's
   context menu. *documented*
9. **One grey, one scroller.** Make the canvas the scroller, style the
   scrollbars, and take the pasteboard grey from a single token so two greys stop
   meeting at the page edge. *estimated*
10. **Collapse the page gap** on a double-click, which Word does. *estimated*

Acceptance: ruler numerals and numbering match Word's; the status bar is 22px
with Word's items in Word's order; zoom lands on 100 percent at the slider's
centre.

## Phase 4 - The transient chrome, and the dialogs

Goal: the parts that appear and disappear look like Word's, and the dialogs
exist at all. This is the largest new-code phase.

1. **Menu items are unstyled user-agent buttons.** They need the full menu-item
   treatment: no appearance, no border, inherited font, full width, a proper row
   height, and separators that are visible. *documented*
2. **Disabled-reason prose is printed inside menu items**, which Word never
   does. Keep the reason in the accessible name and the tooltip. *documented*
3. **Keytip badges are drawn 235px below the controls they label**, because the
   overlay is absolutely positioned inside the canvas. Make it fixed. *measured*
4. **There are no dialogs.** Font and Paragraph both route to a stub, so the
   two most expected dialogs in a word processor do not exist. Build a dialog
   surface with tabs, a preview, and a button row, then the Font dialog on top
   of it. *documented*
5. **The mini toolbar** is 16px text in a 38px bar where the ribbon is 13px in a
   26px bar, so it looks like a different application. Its contents diverge from
   Word's, its separators are invisible, it anchors below the selection rather
   than above, and it hides on right-click. *documented, estimated*
6. **The text context menu is missing most of Word's entries.** Rebuild it:
   Cut, Copy, Paste Options, then Font, Paragraph, Bullets and Numbering, then
   the insert and link entries, then Synonyms, Translate, New Comment, and
   Format Painter. *documented*
7. **Submenus open at the item's right edge** rather than the menu's, which
   makes them jump. *documented*
8. **Screen tips are the browser's native tooltips.** Word's are a styled panel
   with the command's name, its shortcut and a description. *documented*
9. **Tab keytips do not exist**, and Alt+H currently reaches Highlight rather
   than the Home tab. Word binds F, H, N, G, P, S, R, W to the tabs. *documented*
10. **The Backstage does not cover the window** and has no right-hand pane.
    *estimated*
11. **Collapsing the ribbon covers the ruler**, and double-clicking a tab does
    nothing where Word toggles the collapse. *documented*

Acceptance: every context menu item renders as a menu row; the mini toolbar
matches the ribbon's type scale and sits above the selection; the Font dialog
opens, applies and closes; keytips reach the tabs.

## Order and dependencies

Phase 1 first, because every later judgement about colour and weight is made
against it, and because it is the cheapest change with the largest effect.
Phase 2 next: it is the largest visual mass on screen and it fixes the document
moving when tabs change, which is the most jarring thing a user meets. Phase 3
dresses the surface around the page. Phase 4 is the largest build and depends on
Phase 1's tokens for its dialog and menu styling.

## Related defects found while researching

These are not interface work but were found by measuring, and are recorded here
so they are not lost:

- A table column can be allocated less than its own content plus padding, so
  text overflows into the next cell. Diagnosed with line references in
  `agent_progress.md`.
- The four view-mode buttons write a state that nothing reads, so they only
  light up. Print Layout, Web Layout, Draft and Read Mode render identically.
- Several insert commands are refused with an explicit reason rather than
  failing: image, footnote, header, link, symbol, text box, table of contents
  and comments.

### What the large-button pass needs, measured

Phase 2's last item is large buttons, and the ribbon cannot come down to Word's
84px until it is done. The measurement that says why, taken on the Home tab at a
1214px ribbon:

    Clipboard  122px  2 rows
    Font       427px  3 rows   <- drives the height
    Paragraph  380px  2 rows
    Styles     146px  4 rows   <- also drives the height
    Editing     77px  2 rows

Two rows of controls is 54px, which with the group label and the panel padding
fits 84px comfortably, so two rows is the target. The Font group's third row is
not caused by the node order: the two combos are already first in `nodes`, and
they still wrap onto a row of their own, leaving three buttons isolated on a
third row beneath them:

    row 1  10 items, widths 122 64 28 28 28 28 28 28 28 28  (410px)
    row 2   2 items, widths 110 52                            (162px)  <- the combos
    row 3   3 items, widths 28 28 28                           (84px)

So the cause is in how the combo wrappers take part in the flex line breaking,
not in the order of the nodes. Start there: the wrappers are column flex boxes
with their own min-height, and they are the only controls in the group whose
intrinsic width is over 100px. The Styles gallery's four rows want the same
treatment: eight tiles in a 146px column is two columns by four, and Word shows
them as one row of preview tiles, which needs the gallery to be the group that
grows (it already is) and the tiles to be wider than they are tall.

### The Styles gallery is why the ribbon is 112px, and the fix is a different gallery

Chased to the end. The Font group is already two rows, which an earlier reading
got wrong by counting the combos' inner inputs as a third row. The height comes
from the Styles gallery, and widening its group does not help, because the
gallery does not grow:

    .docier-group-controls > .docier-menu-gallery{flex:0 1 auto;min-width:0}

With `flex: 0 1 auto` the gallery keeps its content width, so giving its group a
264px minimum left the gallery at 132px and it went on rendering two columns.
That change also cost the Font group a row's worth of width and pushed it to
three rows, so it was reverted: net worse.

The gallery's columns come from `repeat(auto-fit, minmax(64px, 1fr))`, so the
number of columns follows the gallery's width. Four columns needs 262px, three
needs 196, two needs 132. Eight tiles therefore render as four rows at 132px or
three rows at 196px, and the ribbon cannot reach Word's 84px while a group is
three or four rows tall.

Word does not solve this with a wider group. Its ribbon Styles gallery is a
single horizontal row of preview tiles, about one tile tall, with a scroll arrow
at its end, and the tiles are wider than they are tall so a style's name and its
shape both read. Ours is a wrapping grid of text tiles. So the fix is to replace
the wrapping grid in the ribbon with a single-row horizontal gallery with
overflow, which is a change to the gallery control rather than to the ribbon's
widths. That would put the Styles group at one row, leave Font's two rows as the
tallest, and make 84px reachable.
