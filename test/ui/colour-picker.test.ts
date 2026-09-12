import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { marksAt } from '../../src/edit/inspect.js';
import type { ColourPickerHandle, ColourSection } from '../../src/ui/colour-picker.js';
import {
  createColourPicker,
  colourSections,
  mixHex,
  shadeHex,
  tintHex,
} from '../../src/ui/colour-picker.js';
import { contentRun, paragraphOf, text } from '../layout/support.js';
import { pos } from '../edit/support.js';
import type { ChromeHandle } from '../../src/ui/chrome.js';
import { bodyOf, chromeOf, click, disposeChromes, paragraphText } from './support.js';

const pickers: ColourPickerHandle[] = [];

afterEach(() => {
  while (pickers.length > 0) pickers.pop()?.dispose();
  disposeChromes();
  document.body.innerHTML = '';
});

const COLOUR = 'docier.command.format.setColor';
const HIGHLIGHT = 'docier.command.format.setHighlight';
const ANCHOR = { left: 100, top: 40, width: 24, height: 24 };

interface Executed {
  readonly commandId: string;
  readonly args: Record<string, unknown>;
}

const recordCommands = (handle: EditorHandle): Executed[] => {
  const seen: Executed[] = [];
  handle.events.on('docier:command:execute', (event) => {
    seen.push({ commandId: event.commandId, args: event.args as Record<string, unknown> });
  });
  return seen;
};

const markAt = (handle: EditorHandle, offset = 0): string | undefined => {
  const model = handle.document;
  const session = handle.session;
  if (model === undefined || session === undefined) throw new Error('no document');
  return marksAt(model, session, pos(offset))?.color;
};

const highlightAt = (handle: EditorHandle, offset = 0): string | undefined => {
  const model = handle.document;
  const session = handle.session;
  if (model === undefined || session === undefined) throw new Error('no document');
  return marksAt(model, session, pos(offset))?.highlight;
};

const handleTo = (handle: EditorHandle, offset: number): void => {
  handle.setSelection(pos(offset), pos(offset));
};

const pickerOf = (
  handle: EditorHandle,
  chrome: ChromeHandle,
  command: string = COLOUR,
  value: () => string | undefined = () => markAt(handle),
): ColourPickerHandle => {
  const picker = createColourPicker({ context: chrome.context, command, value, mount: document.body });
  pickers.push(picker);
  return picker;
};

const swatchFor = (picker: ColourPickerHandle, value: string): HTMLElement => {
  const node = picker.element.querySelector<HTMLElement>(`[data-docier-swatch="${value}"]`);
  expect(node, value).not.toBeNull();
  return node!;
};

const gridCells = (picker: ColourPickerHandle, key: string): readonly HTMLElement[] => [
  ...picker.element.querySelectorAll<HTMLElement>(`[data-docier-colour-grid="${key}"] [data-docier-swatch]`),
];

const press = (target: HTMLElement, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

const colouredBody = (): string =>
  bodyOf(
    paragraphOf(
      '',
      contentRun('<w:rPr><w:color w:val="FF0000"/></w:rPr>', text('red run')) +
        contentRun('', text(' plain run')),
    ),
  );

describe('the colour palette', () => {
  it('is the Word one: a theme grid, a standard grid and the automatic entry', () => {
    const sections = colourSections('text');
    expect(sections.map((section: ColourSection) => section.key)).toEqual(['theme', 'standard']);
    expect(sections.map((section) => section.columns)).toEqual([10, 10]);
    expect(sections.map((section) => section.swatches.length)).toEqual([50, 50]);
    expect(sections[0]?.label).toBe('Theme Colours');
    expect(sections[1]?.label).toBe('Standard Colours');

    const standard = sections[1]?.swatches ?? [];
    expect(new Set(standard.map((swatch) => swatch.value)).size).toBe(50);
    expect(standard[0]?.value).toBe('C00000');
    expect(standard[3]?.value).toBe('FFFF00');
    expect(standard.some((swatch) => swatch.label === 'Yellow, lighter 60%')).toBe(true);
    expect(standard.some((swatch) => swatch.label === 'Yellow, darker 40%')).toBe(true);
  });

  it('uses the named OOXML highlight values for the highlight palette', () => {
    const sections = colourSections('highlight');
    expect(sections.length).toBe(1);
    expect(sections[0]?.columns).toBe(5);
    expect(sections[0]?.swatches.length).toBe(15);
    expect(sections[0]?.swatches.map((swatch) => swatch.value)).toEqual([
      'yellow',
      'green',
      'cyan',
      'magenta',
      'blue',
      'red',
      'darkBlue',
      'darkCyan',
      'darkGreen',
      'darkMagenta',
      'darkRed',
      'darkYellow',
      'darkGray',
      'lightGray',
      'black',
    ]);
    expect(sections[0]?.swatches[0]?.css).toBe('#ffff00');
  });

  it('mixes shades rather than repeating the hues', () => {
    expect(tintHex('000000', 1)).toBe('FFFFFF');
    expect(tintHex('FF0000', 0.5)).toBe('FF8080');
    expect(shadeHex('FF0000', 0.5)).toBe('800000');
    expect(mixHex('4472C4', 255, 0)).toBe('4472C4');
  });
});

describe('opening the picker', () => {
  it('renders the sections, the swatches and the no-colour entry', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello world')));
    const picker = pickerOf(handle, chrome);
    expect(picker.visible).toBe(false);
    expect(picker.element.hidden).toBe(true);

    picker.open(ANCHOR);

    expect(picker.visible).toBe(true);
    expect(picker.element.hidden).toBe(false);
    expect(picker.element.parentElement).toBe(document.body);
    expect(picker.element.getAttribute('role')).toBe('dialog');
    expect(picker.element.getAttribute('aria-label')).toBe('Font Colour');

    const headings = [...picker.element.querySelectorAll('.docier-colour-heading')].map(
      (node) => node.textContent,
    );
    expect(headings).toEqual(['Theme Colours', 'Standard Colours']);
    expect(gridCells(picker, 'theme').length).toBe(50);
    expect(gridCells(picker, 'standard').length).toBe(50);
    expect(picker.element.querySelectorAll('[data-docier-swatch]').length).toBe(101);
    expect(swatchFor(picker, 'auto').textContent).toBe('Automatic');
    expect(document.activeElement).toBe(gridCells(picker, 'theme')[0]);
  });

  it('places the highlight palette with its own argument key and label', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const picker = pickerOf(handle, chrome, HIGHLIGHT, () => highlightAt(handle));
    picker.open(ANCHOR);
    expect(picker.element.getAttribute('aria-label')).toBe('Text Highlight Colour');
    expect(picker.element.getAttribute('data-docier-colour-kind')).toBe('highlight');
    expect(picker.element.querySelectorAll('[data-docier-colour-grid]').length).toBe(1);
    expect(swatchFor(picker, 'none').textContent).toBe('No Colour');
  });

  it('opens near the anchor and stays inside the viewport', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const picker = pickerOf(handle, chrome);
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;

    picker.open({ left: 100, top: 40, width: 24, height: 24 });
    expect(picker.element.style.left).toBe('100px');
    expect(picker.element.style.top).toBe('68px');

    picker.open({ left: viewWidth - 4, top: 40, width: 24, height: 24 });
    const right = Number.parseFloat(picker.element.style.left);
    expect(right).toBeLessThanOrEqual(viewWidth - 8);

    picker.open({ left: 100, top: viewHeight - 40, width: 24, height: 24 });
    const bottom = Number.parseFloat(picker.element.style.top);
    expect(bottom).toBeGreaterThanOrEqual(8);
    expect(bottom).toBeLessThan(viewHeight - 40);
  });

  it('mounts into the chrome portal and stays opaque without one', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const picker = createColourPicker({ context: chrome.context, command: COLOUR });
    pickers.push(picker);
    picker.open(ANCHOR);
    expect(picker.element.parentElement?.getAttribute('data-docier-portal')).toBe('');
    expect(picker.element.style.background).toBe('var(--docier-surface-raised, #ffffff)');

    const loose = pickerOf(handle, chrome);
    loose.open(ANCHOR);
    expect(loose.element.parentElement).toBe(document.body);
    expect(loose.element.style.border).toBe('1px solid var(--docier-border, #c9c9c9)');
  });

  it('marks the colour the caret already carries', async () => {
    const plain = await chromeOf(bodyOf(paragraphText('hello')));
    handleTo(plain.handle, 0);
    const plainPicker = pickerOf(plain.handle, plain.chrome);
    plainPicker.open(ANCHOR);
    expect(swatchFor(plainPicker, 'auto').getAttribute('aria-pressed')).toBe('true');
    expect(swatchFor(plainPicker, 'auto').getAttribute('data-docier-current')).toBe('true');
    expect(swatchFor(plainPicker, 'C00000').getAttribute('aria-pressed')).toBe('false');

    const coloured = await chromeOf(colouredBody());
    handleTo(coloured.handle, 0);
    const colouredPicker = pickerOf(coloured.handle, coloured.chrome);
    colouredPicker.open(ANCHOR);
    expect(swatchFor(colouredPicker, 'FF0000').getAttribute('aria-pressed')).toBe('true');
    expect(swatchFor(colouredPicker, 'FF0000').getAttribute('data-docier-current')).toBe('true');
    expect(swatchFor(colouredPicker, 'auto').getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(swatchFor(colouredPicker, 'FF0000'));
  });
});

describe('choosing a colour', () => {
  it('executes the colour command with the swatch value and applies it', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello world')));
    handle.setSelection(pos(0), pos(5));
    const seen = recordCommands(handle);
    const picker = pickerOf(handle, chrome);
    picker.open(ANCHOR);

    click(swatchFor(picker, 'C00000'));
    await handle.whenReady();

    expect(seen.length).toBe(1);
    expect(seen[0]?.commandId).toBe(COLOUR);
    expect(seen[0]?.args).toEqual({ color: 'C00000' });
    expect(markAt(handle, 0)).toBe('C00000');
    expect(picker.visible).toBe(false);
  });

  it('executes the highlight command with the named highlight value', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello world')));
    handle.setSelection(pos(0), pos(5));
    const seen = recordCommands(handle);
    const picker = pickerOf(handle, chrome, HIGHLIGHT, () => highlightAt(handle));
    picker.open(ANCHOR);

    click(swatchFor(picker, 'yellow'));
    await handle.whenReady();

    expect(seen.length).toBe(1);
    expect(seen[0]?.commandId).toBe(HIGHLIGHT);
    expect(seen[0]?.args).toEqual({ highlight: 'yellow' });
    expect(highlightAt(handle, 0)).toBe('yellow');
  });

  it('clears through the no-colour entry: automatic for text, none for highlight', async () => {
    const { handle, chrome } = await chromeOf(colouredBody());
    handle.setSelection(pos(0), pos(3));
    const seen = recordCommands(handle);
    const picker = pickerOf(handle, chrome);
    picker.open(ANCHOR);

    click(swatchFor(picker, 'auto'));
    await handle.whenReady();
    expect(seen[0]?.args).toEqual({ color: 'auto' });
    expect(markAt(handle, 0)).toBe('auto');

    handle.setSelection(pos(0), pos(5));
    const highlightSeen = recordCommands(handle);
    const highlightPicker = pickerOf(handle, chrome, HIGHLIGHT, () => highlightAt(handle));
    highlightPicker.open(ANCHOR);
    click(swatchFor(highlightPicker, 'none'));
    await handle.whenReady();
    expect(highlightSeen[0]?.args).toEqual({ highlight: 'none' });
    expect(highlightAt(handle, 0)).toBe('none');
  });

  it('refuses to fire when the command is not registered', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    handle.setSelection(pos(0), pos(3));
    const seen = recordCommands(handle);
    const picker = pickerOf(handle, chrome, 'docier.command.format.notAColour');
    picker.open(ANCHOR);
    click(swatchFor(picker, 'C00000'));
    await handle.whenReady();
    expect(seen.length).toBe(0);
  });
});

describe('closing the picker', () => {
  it('closes on Escape and returns focus to the opener', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const picker = pickerOf(handle, chrome);
    picker.open(ANCHOR);
    expect(picker.visible).toBe(true);
    expect(document.activeElement).not.toBe(opener);

    const event = press(document.activeElement as HTMLElement, 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(picker.visible).toBe(false);
    expect(picker.element.parentElement).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape even when focus is outside the picker', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const picker = pickerOf(handle, chrome);
    picker.open(ANCHOR);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(picker.visible).toBe(false);
  });

  it('closes on a click outside and not on a click inside', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello world')));
    handle.setSelection(pos(0), pos(5));
    const picker = pickerOf(handle, chrome);
    picker.open(ANCHOR);

    picker.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(picker.visible).toBe(true);

    const cell = swatchFor(picker, 'C00000');
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(picker.visible).toBe(true);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(picker.visible).toBe(false);
    expect(document.activeElement).not.toBe(cell);
  });

  it('reports the close once per open', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    let closes = 0;
    const picker = createColourPicker({
      context: chrome.context,
      command: COLOUR,
      mount: document.body,
      onClose: () => {
        closes += 1;
      },
    });
    pickers.push(picker);
    picker.open(ANCHOR);
    picker.open(ANCHOR);
    expect(closes).toBe(0);
    picker.close();
    picker.close();
    expect(closes).toBe(1);
  });
});

describe('keyboard navigation', () => {
  it('moves through the grid with the arrows and applies with Enter', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello world')));
    handle.setSelection(pos(0), pos(5));
    const seen = recordCommands(handle);
    const picker = pickerOf(handle, chrome);
    picker.open(ANCHOR);

    const theme = gridCells(picker, 'theme');
    expect(document.activeElement).toBe(theme[0]);

    press(theme[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(theme[1]);
    press(theme[1]!, 'ArrowDown');
    expect(document.activeElement).toBe(theme[11]);
    press(theme[11]!, 'ArrowLeft');
    expect(document.activeElement).toBe(theme[10]);
    press(theme[10]!, 'Home');
    expect(document.activeElement).toBe(theme[10]);
    press(theme[10]!, 'End');
    expect(document.activeElement).toBe(theme[19]);

    press(theme[10]!, 'ArrowUp');
    expect(document.activeElement).toBe(theme[0]);
    press(theme[0]!, 'ArrowUp');
    expect(document.activeElement).toBe(theme[0]);

    press(theme[49]!, 'ArrowDown');
    expect(document.activeElement).toBe(swatchFor(picker, 'auto'));
    press(swatchFor(picker, 'auto'), 'ArrowUp');
    expect(document.activeElement).toBe(gridCells(picker, 'standard')[0]);

    press(theme[49]!, 'Enter');
    await handle.whenReady();
    expect(seen.length).toBe(1);
    expect(seen[0]?.commandId).toBe(COLOUR);
    expect(seen[0]?.args).toEqual({ color: theme[49]!.getAttribute('data-docier-swatch') });
    expect(picker.visible).toBe(false);
  });

  it('applies the automatic entry with Enter', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello world')));
    handle.setSelection(pos(0), pos(5));
    const seen = recordCommands(handle);
    const picker = pickerOf(handle, chrome);
    picker.open(ANCHOR);
    const none = swatchFor(picker, 'auto');
    none.focus();
    press(none, ' ');
    await handle.whenReady();
    expect(seen[0]?.args).toEqual({ color: 'auto' });
  });
});

describe('disposal', () => {
  it('closes the popover and stops listening', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const picker = pickerOf(handle, chrome);
    picker.open(ANCHOR);
    picker.dispose();
    expect(picker.visible).toBe(false);
    expect(picker.element.parentElement).toBeNull();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(picker.element.parentElement).toBeNull();
  });
});
