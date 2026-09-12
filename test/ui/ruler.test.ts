import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { ParagraphProperties, SectionProperties } from '../../src/model/index.js';
import { ATTR } from '../../src/render/dom.js';
import { UNIT_SPECS, formatRulerValue } from '../../src/ui/ruler.js';
import { MARGIN_TWIPS } from '../layout/support.js';
import { bodyOf, chromeOf, disposeChromes, longBody, paragraphText } from './support.js';

afterEach(() => {
  disposeChromes();
  document.body.innerHTML = '';
});

const RULER = '[data-docier-part="ruler"]';
const markerFor = (chrome: { element: HTMLElement }, part: string): HTMLElement => {
  const marker = chrome.element.querySelector<HTMLElement>(`[data-docier-part="${part}"]`);
  expect(marker, part).not.toBeNull();
  return marker!;
};

const key = (target: HTMLElement, value: string, shiftKey = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

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

const valuenow = (marker: HTMLElement): number => Number(marker.getAttribute('aria-valuenow'));

const indentationOf = (
  handle: EditorHandle,
  index = 0,
): { readonly left: number | undefined; readonly firstLine: number | undefined; readonly right: number | undefined } => {
  const slot = handle.session?.slots()[index];
  if (slot === undefined) throw new Error('no slot');
  const indentation = ParagraphProperties.inOwner(slot.element).indentation;
  return {
    left: indentation.left as number | undefined,
    firstLine: indentation.firstLine as number | undefined,
    right: indentation.right as number | undefined,
  };
};

const leftMarginOf = (handle: EditorHandle): number | undefined => {
  const model = handle.document;
  if (model === undefined) throw new Error('no document');
  return SectionProperties.inOwner(model.body().element).margins.left as number | undefined;
};

describe('one ruler for the document', () => {
  it('renders exactly one ruler however many pages are laid out', async () => {
    const short = await chromeOf(bodyOf(paragraphText('short')));
    await short.handle.whenReady();
    const long = await chromeOf(longBody());
    await long.handle.whenReady();

    expect(short.chrome.ruler).toBeDefined();
    expect(long.chrome.ruler).toBeDefined();
    expect(long.handle.layout!.pages.length).toBeGreaterThan(6);

    expect(short.chrome.element.querySelectorAll(RULER).length).toBe(1);
    expect(long.chrome.element.querySelectorAll(RULER).length).toBe(1);
    expect(long.chrome.element.querySelectorAll(`[${ATTR.page}]`).length).toBeGreaterThan(6);

    const ruler = long.chrome.element.querySelector(RULER);
    expect(ruler!.closest(`[${ATTR.pages}]`)).toBeNull();
    expect(ruler!.closest('.docier-chrome')).not.toBeNull();
  });

  it('is labelled and exposes draggable markers as sliders', async () => {
    const { chrome } = await chromeOf(longBody());
    const ruler = chrome.element.querySelector(RULER)!;
    expect(ruler.getAttribute('role')).toBe('toolbar');
    expect(ruler.getAttribute('aria-label')).toBe('Ruler');
    expect(ruler.getAttribute('aria-orientation')).toBe('horizontal');

    const sliders = [...ruler.querySelectorAll<HTMLElement>('[role="slider"]')];
    expect(sliders.length).toBe(6);
    const labels = sliders.map((slider) => slider.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Left margin',
      'Right margin',
      'First line indent',
      'Hanging indent',
      'Left indent',
      'Right indent',
    ]);
    for (const slider of sliders) {
      expect(slider.getAttribute('aria-valuenow')).not.toBeNull();
      expect(slider.getAttribute('aria-valuetext')).not.toBeNull();
    }
    expect(chrome.ruler!.markers.length).toBe(6);
  });

  it('hides and shows with the ruler state', async () => {
    const { chrome } = await chromeOf(longBody());
    expect(chrome.ruler!.element.hidden).toBe(false);
    chrome.setRulerVisible(false);
    expect(chrome.ruler!.element.hidden).toBe(true);
    chrome.setRulerVisible(true);
    expect(chrome.ruler!.element.hidden).toBe(false);
  });
});

describe('ruler interaction', () => {
  it('commits an indent change through the command surface when a key is pressed', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const seen = recordCommands(handle);

    const marker = markerFor(chrome, 'indent-left');
    const event = key(marker, 'ArrowRight');
    expect(event.defaultPrevented).toBe(true);
    await handle.whenReady();
    const indent = seen.find(
      (entry) => entry.commandId === 'docier.command.format.setParagraphIndent',
    );
    expect(indent).toBeDefined();
    expect(indent!.args.leftTwips).toBe(1);
    expect(indentationOf(handle).left).toBe(1);

    seen.length = 0;
    key(marker, 'ArrowRight', true);
    await handle.whenReady();
    expect(seen[0]?.args.leftTwips).toBe(11);
    expect(indentationOf(handle).left).toBe(11);
  });

  it('commits margin changes through the command surface', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const seen = recordCommands(handle);
    const marker = markerFor(chrome, 'margin-left');
    key(marker, 'ArrowRight');
    await handle.whenReady();
    expect(seen[0]?.commandId).toBe('docier.command.doc.setMargins');
    expect(seen[0]?.args.side).toBe('left');
    expect(seen[0]?.args.twips).toBe(MARGIN_TWIPS + 1);
    expect(leftMarginOf(handle)).toBe(MARGIN_TWIPS + 1);

    key(marker, 'ArrowLeft', true);
    await handle.whenReady();
    expect(seen[1]?.args.twips).toBe(MARGIN_TWIPS - 9);
    expect(leftMarginOf(handle)).toBe(MARGIN_TWIPS - 9);
  });

  it('drags a marker without reading layout geometry', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const seen = recordCommands(handle);
    const marker = markerFor(chrome, 'margin-left');
    const down = new MouseEvent('pointerdown', { clientX: 100, clientY: 5, bubbles: true, cancelable: true });
    marker.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 5, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 120, clientY: 5, bubbles: true }));
    await handle.whenReady();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.commandId).toBe('docier.command.doc.setMargins');
    expect(leftMarginOf(handle)).toBe(MARGIN_TWIPS + 300);

    const before = seen.length;
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 5, bubbles: true }));
    await handle.whenReady();
    expect(seen.length).toBe(before);
  });

  it('reads the caret paragraph indents and offsets them rather than resetting them', async () => {
    const { handle, chrome } = await chromeOf(
      bodyOf(paragraphText('indented', '<w:ind w:left="720" w:firstLine="240"/>')),
    );
    await handle.whenReady();

    const left = markerFor(chrome, 'indent-left');
    const firstLine = markerFor(chrome, 'indent-first-line');
    expect(valuenow(left)).toBe(MARGIN_TWIPS + 720);
    expect(valuenow(firstLine)).toBe(MARGIN_TWIPS + 960);

    const seen = recordCommands(handle);
    key(left, 'ArrowRight');
    await handle.whenReady();
    expect(seen[0]?.args).toMatchObject({ leftTwips: 721, firstLineTwips: 240 });
    expect(indentationOf(handle)).toMatchObject({ left: 721, firstLine: 240 });
    expect(valuenow(left)).toBe(MARGIN_TWIPS + 721);
    expect(valuenow(firstLine)).toBe(MARGIN_TWIPS + 961);
  });

  it('cycles units from the ruler corner', async () => {
    const { chrome } = await chromeOf(longBody(), { units: 'cm' });
    const button = chrome.element.querySelector<HTMLElement>('[data-docier-part="ruler-units"]')!;
    expect(button.getAttribute('aria-label')).toBe('Ruler units');
    expect(chrome.store.get().units).toBe('cm');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(chrome.store.get().units).toBe('mm');
    expect(button.textContent).toBe('mm');
  });

  it('formats values per unit', () => {
    expect(formatRulerValue(1440 * 50, 'inch')).toBe('1');
    expect(formatRulerValue(1440 * 50, 'cm')).toBe('2.5');
    expect(formatRulerValue(1440 * 50, 'mm')).toBe('25');
    expect(Object.keys(UNIT_SPECS)).toEqual(['cm', 'mm', 'inch', 'pt', 'pica', 'px']);
  });
});
