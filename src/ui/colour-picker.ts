import type { Disposable } from '../api/types.js';
import { highlightColorOf } from '../render/color.js';
import { closestFrom, createDisposableStore, make, markPart, setText } from './dom.js';
import type { ChromeContext } from './types.js';

export type ColourKind = 'text' | 'highlight';

export interface ColourSwatch {
  readonly value: string;
  readonly label: string;
  readonly css: string;
}

export interface ColourSection {
  readonly key: string;
  readonly label: string;
  readonly columns: number;
  readonly swatches: readonly ColourSwatch[];
}

export interface ColourPickerAnchor {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ColourPickerOptions {
  readonly context: ChromeContext;
  readonly command: string;
  readonly argKey?: string | undefined;
  readonly value?: (() => string | undefined) | undefined;
  readonly mount?: HTMLElement | undefined;
  readonly onPick?: ((value: string) => void) | undefined;
  readonly onClose?: (() => void) | undefined;
}

export interface ColourPickerHandle extends Disposable {
  readonly element: HTMLElement;
  readonly visible: boolean;
  open(anchor: ColourPickerAnchor): void;
  close(focusOpener?: boolean): void;
  refresh(): void;
}

export const SET_COLOR_COMMAND = 'docier.command.format.setColor';
export const SET_HIGHLIGHT_COMMAND = 'docier.command.format.setHighlight';

export const NO_COLOUR: Readonly<Record<ColourKind, string>> = {
  text: 'auto',
  highlight: 'none',
};

export const PALETTE_COLUMNS: Readonly<Record<ColourKind, number>> = { text: 10, highlight: 5 };

export const SWATCH_PX = 20;
export const SWATCH_GAP_PX = 2;
export const PICKER_PADDING_PX = 8;
export const VIEWPORT_MARGIN_PX = 8;
export const ANCHOR_GAP_PX = 4;
export const DEFAULT_PICKER_WIDTH = 238;
export const DEFAULT_PICKER_HEIGHT = 252;

export const argKeyFor = (command: string): string =>
  command === SET_HIGHLIGHT_COMMAND ? 'highlight' : 'color';

export const kindFor = (command: string): ColourKind =>
  command === SET_HIGHLIGHT_COMMAND ? 'highlight' : 'text';

interface HueSpec {
  readonly key: string;
  readonly name: string;
  readonly value: string;
}

interface RowSpec {
  readonly key: string;
  readonly name: string;
  readonly apply: (hex: string) => string;
}

const channelOf = (hex: string, index: number): number => {
  const parsed = Number.parseInt(hex.slice(index, index + 2), 16);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const hexByte = (value: number): string =>
  Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

export const mixHex = (hex: string, target: number, amount: number): string => {
  const parts: string[] = [];
  for (let index = 0; index < 6; index += 2) {
    const channel = channelOf(hex, index);
    parts.push(hexByte(channel + (target - channel) * amount));
  }
  return parts.join('');
};

export const tintHex = (hex: string, amount: number): string => mixHex(hex, 255, amount);
export const shadeHex = (hex: string, amount: number): string => mixHex(hex, 0, amount);

const THEME_HUES: readonly HueSpec[] = [
  { key: 'ui.colour.hue.white', name: 'White', value: 'FFFFFF' },
  { key: 'ui.colour.hue.black', name: 'Black', value: '000000' },
  { key: 'ui.colour.hue.lightGray', name: 'Light Gray', value: 'E7E6E6' },
  { key: 'ui.colour.hue.darkBlueText', name: 'Dark Blue', value: '44546A' },
  { key: 'ui.colour.hue.accent1', name: 'Accent 1', value: '4472C4' },
  { key: 'ui.colour.hue.accent2', name: 'Accent 2', value: 'ED7D31' },
  { key: 'ui.colour.hue.accent3', name: 'Accent 3', value: 'A5A5A5' },
  { key: 'ui.colour.hue.accent4', name: 'Accent 4', value: 'FFC000' },
  { key: 'ui.colour.hue.accent5', name: 'Accent 5', value: '5B9BD5' },
  { key: 'ui.colour.hue.accent6', name: 'Accent 6', value: '70AD47' },
];

const STANDARD_HUES: readonly HueSpec[] = [
  { key: 'ui.colour.hue.darkRed', name: 'Dark Red', value: 'C00000' },
  { key: 'ui.colour.hue.red', name: 'Red', value: 'FF0000' },
  { key: 'ui.colour.hue.orange', name: 'Orange', value: 'FFC000' },
  { key: 'ui.colour.hue.yellow', name: 'Yellow', value: 'FFFF00' },
  { key: 'ui.colour.hue.lightGreen', name: 'Light Green', value: '92D050' },
  { key: 'ui.colour.hue.green', name: 'Green', value: '00B050' },
  { key: 'ui.colour.hue.lightBlue', name: 'Light Blue', value: '00B0F0' },
  { key: 'ui.colour.hue.blue', name: 'Blue', value: '0070C0' },
  { key: 'ui.colour.hue.navy', name: 'Dark Blue', value: '002060' },
  { key: 'ui.colour.hue.purple', name: 'Purple', value: '7030A0' },
];

const baseRow: RowSpec = { key: 'ui.colour.row.base', name: '', apply: (hex) => hex };

const THEME_ROWS: readonly RowSpec[] = [
  baseRow,
  { key: 'ui.colour.row.lighter80', name: 'lighter 80%', apply: (hex) => tintHex(hex, 0.8) },
  { key: 'ui.colour.row.lighter60', name: 'lighter 60%', apply: (hex) => tintHex(hex, 0.6) },
  { key: 'ui.colour.row.lighter40', name: 'lighter 40%', apply: (hex) => tintHex(hex, 0.4) },
  { key: 'ui.colour.row.darker25', name: 'darker 25%', apply: (hex) => shadeHex(hex, 0.25) },
];

const STANDARD_ROWS: readonly RowSpec[] = [
  baseRow,
  { key: 'ui.colour.row.lighter60', name: 'lighter 60%', apply: (hex) => tintHex(hex, 0.6) },
  { key: 'ui.colour.row.lighter30', name: 'lighter 30%', apply: (hex) => tintHex(hex, 0.3) },
  { key: 'ui.colour.row.darker20', name: 'darker 20%', apply: (hex) => shadeHex(hex, 0.2) },
  { key: 'ui.colour.row.darker40', name: 'darker 40%', apply: (hex) => shadeHex(hex, 0.4) },
];

const HIGHLIGHT_SWATCHES: readonly HueSpec[] = [
  { key: 'ui.colour.highlight.yellow', name: 'Yellow', value: 'yellow' },
  { key: 'ui.colour.highlight.green', name: 'Bright Green', value: 'green' },
  { key: 'ui.colour.highlight.cyan', name: 'Turquoise', value: 'cyan' },
  { key: 'ui.colour.highlight.magenta', name: 'Pink', value: 'magenta' },
  { key: 'ui.colour.highlight.blue', name: 'Blue', value: 'blue' },
  { key: 'ui.colour.highlight.red', name: 'Red', value: 'red' },
  { key: 'ui.colour.highlight.darkBlue', name: 'Dark Blue', value: 'darkBlue' },
  { key: 'ui.colour.highlight.darkCyan', name: 'Teal', value: 'darkCyan' },
  { key: 'ui.colour.highlight.darkGreen', name: 'Green', value: 'darkGreen' },
  { key: 'ui.colour.highlight.darkMagenta', name: 'Violet', value: 'darkMagenta' },
  { key: 'ui.colour.highlight.darkRed', name: 'Dark Red', value: 'darkRed' },
  { key: 'ui.colour.highlight.darkYellow', name: 'Dark Yellow', value: 'darkYellow' },
  { key: 'ui.colour.highlight.darkGray', name: 'Gray 50%', value: 'darkGray' },
  { key: 'ui.colour.highlight.lightGray', name: 'Gray 25%', value: 'lightGray' },
  { key: 'ui.colour.highlight.black', name: 'Black', value: 'black' },
];

export const HIGHLIGHT_VALUES: readonly string[] = HIGHLIGHT_SWATCHES.map((spec) => spec.value);

export type ColourLabelLookup = (key: string, fallback: string) => string;

const identityLookup: ColourLabelLookup = (_key, fallback) => fallback;

const gridSwatches = (
  hues: readonly HueSpec[],
  rows: readonly RowSpec[],
  lookup: ColourLabelLookup,
): readonly ColourSwatch[] => {
  const swatches: ColourSwatch[] = [];
  for (const row of rows) {
    for (const hue of hues) {
      const name = lookup(hue.key, hue.name);
      const modifier = row.name === '' ? '' : lookup(row.key, row.name);
      const value = row.apply(hue.value);
      swatches.push({
        value,
        label: modifier === '' ? name : `${name}, ${modifier}`,
        css: `#${value.toLowerCase()}`,
      });
    }
  }
  return swatches;
};

export const colourSections = (
  kind: ColourKind,
  lookup: ColourLabelLookup = identityLookup,
): readonly ColourSection[] => {
  if (kind === 'highlight') {
    return [
      {
        key: 'highlight',
        label: lookup('ui.colour.section.highlight', 'Highlight Colours'),
        columns: PALETTE_COLUMNS.highlight,
        swatches: HIGHLIGHT_SWATCHES.map((spec) => ({
          value: spec.value,
          label: lookup(spec.key, spec.name),
          css: highlightColorOf(spec.value) ?? '#ffffff',
        })),
      },
    ];
  }
  return [
    {
      key: 'theme',
      label: lookup('ui.colour.section.theme', 'Theme Colours'),
      columns: PALETTE_COLUMNS.text,
      swatches: gridSwatches(THEME_HUES, THEME_ROWS, lookup),
    },
    {
      key: 'standard',
      label: lookup('ui.colour.section.standard', 'Standard Colours'),
      columns: PALETTE_COLUMNS.text,
      swatches: gridSwatches(STANDARD_HUES, STANDARD_ROWS, lookup),
    },
  ];
};

const SWATCH_SHADOW = 'inset 0 0 0 1px rgba(0, 0, 0, 0.18)';

const TOKENS = {
  surface: 'var(--docier-surface-raised, #ffffff)',
  border: 'var(--docier-border, #c9c9c9)',
  radius: 'var(--docier-radius, 4px)',
  shadow: 'var(--docier-shadow-3, 0 8px 24px rgba(0, 0, 0, 0.24))',
  text: 'var(--docier-text, #1b1b1b)',
  muted: 'var(--docier-text-muted, #575757)',
  accent: 'var(--docier-accent, #1f6feb)',
  font: 'var(--docier-ui-font, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif)',
  fontSize: 'var(--docier-ui-font-size, 13px)',
} as const;

const CURRENT_OUTLINE = `2px solid ${TOKENS.accent}`;

const PORTAL_SELECTOR = '[data-docier-portal]';

const mountFor = (doc: Document): HTMLElement => {
  const portal = doc.querySelector<HTMLElement>(PORTAL_SELECTOR);
  return portal ?? doc.body;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

interface CellEntry {
  readonly cell: HTMLElement;
  readonly group: number;
  readonly index: number;
}

export const createColourPicker = (options: ColourPickerOptions): ColourPickerHandle => {
  const { context } = options;
  const store = createDisposableStore();
  const doc = context.host.ownerDocument;
  const mount = options.mount ?? mountFor(doc);
  const kind = kindFor(options.command);
  const argKey = options.argKey ?? argKeyFor(options.command);
  const noneValue = NO_COLOUR[kind];

  const text = (key: string, fallback: string): string => {
    const value = context.i18n.text(key);
    return value === key ? fallback : value;
  };

  const element = make('div', 'docier-colour-picker');
  markPart(element, 'colour-picker');
  element.setAttribute('role', 'dialog');
  element.setAttribute('data-docier-colour-kind', kind);
  element.setAttribute(
    'aria-label',
    context.i18n.text(kind === 'highlight' ? 'ui.control.highlight' : 'ui.control.textColor'),
  );
  element.hidden = true;
  Object.assign(element.style, {
    position: 'fixed',
    zIndex: '1000',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: `${String(PICKER_PADDING_PX)}px`,
    background: TOKENS.surface,
    border: `1px solid ${TOKENS.border}`,
    borderRadius: TOKENS.radius,
    boxShadow: TOKENS.shadow,
    color: TOKENS.text,
    fontFamily: TOKENS.font,
    fontSize: TOKENS.fontSize,
    maxHeight: '80vh',
    overflow: 'auto',
  });

  const entries: CellEntry[] = [];
  const groups: { readonly cells: HTMLElement[]; readonly columns: number }[] = [];

  for (const section of colourSections(kind, text)) {
    const groupIndex = groups.length;
    const wrapper = make('div', 'docier-colour-section');
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-label', section.label);
    wrapper.setAttribute('data-docier-colour-section', section.key);
    Object.assign(wrapper.style, { display: 'flex', flexDirection: 'column', gap: '4px' });

    const heading = make('div', 'docier-colour-heading');
    heading.setAttribute('aria-hidden', 'true');
    setText(heading, section.label);
    Object.assign(heading.style, { color: TOKENS.muted, fontSize: '11px' });
    wrapper.appendChild(heading);

    const grid = make('div', 'docier-colour-grid');
    grid.setAttribute('data-docier-colour-grid', section.key);
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: `repeat(${String(section.columns)}, ${String(SWATCH_PX)}px)`,
      gap: `${String(SWATCH_GAP_PX)}px`,
    });

    const cells: HTMLElement[] = [];
    for (const swatch of section.swatches) {
      const cell = make('button', 'docier-colour-swatch');
      cell.setAttribute('type', 'button');
      cell.setAttribute('data-docier-swatch', swatch.value);
      cell.setAttribute('data-docier-colour-group', section.key);
      cell.setAttribute('aria-label', swatch.label);
      cell.setAttribute('title', swatch.label);
      cell.tabIndex = -1;
      Object.assign(cell.style, {
        appearance: 'none',
        width: `${String(SWATCH_PX)}px`,
        height: `${String(SWATCH_PX)}px`,
        padding: '0',
        border: '0',
        borderRadius: '2px',
        cursor: 'pointer',
        background: swatch.css,
        boxShadow: SWATCH_SHADOW,
        outline: 'none',
      });
      grid.appendChild(cell);
      cells.push(cell);
      entries.push({ cell, group: groupIndex, index: cells.length - 1 });
    }
    wrapper.appendChild(grid);
    element.appendChild(wrapper);
    groups.push({ cells, columns: section.columns });
  }

  const noneLabel = text(
    kind === 'highlight' ? 'ui.colour.none' : 'ui.colour.automatic',
    kind === 'highlight' ? 'No Colour' : 'Automatic',
  );
  const none = make('button', 'docier-colour-none');
  none.setAttribute('type', 'button');
  none.setAttribute('data-docier-swatch', noneValue);
  none.setAttribute('aria-label', noneLabel);
  none.setAttribute('title', noneLabel);
  none.tabIndex = -1;
  Object.assign(none.style, {
    appearance: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '2px',
    border: '0',
    borderRadius: '2px',
    background: 'transparent',
    color: TOKENS.text,
    font: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    outline: 'none',
  });

  const chip = make('span', 'docier-colour-none-chip');
  Object.assign(chip.style, {
    width: `${String(SWATCH_PX)}px`,
    height: `${String(SWATCH_PX)}px`,
    borderRadius: '2px',
    background: '#ffffff',
    backgroundImage:
      'linear-gradient(135deg, transparent 42%, #c0392b 42%, #c0392b 58%, transparent 58%)',
    boxShadow: SWATCH_SHADOW,
    flex: '0 0 auto',
  });
  const chipLabel = make('span', 'docier-colour-none-label');
  setText(chipLabel, noneLabel);
  none.appendChild(chip);
  none.appendChild(chipLabel);
  element.appendChild(none);

  const marksCurrent = (button: HTMLElement, ring: HTMLElement, current: boolean): void => {
    button.setAttribute('aria-pressed', current ? 'true' : 'false');
    ring.style.outline = current ? CURRENT_OUTLINE : 'none';
    ring.style.outlineOffset = current ? '1px' : '0';
    if (current) button.setAttribute('data-docier-current', 'true');
    else button.removeAttribute('data-docier-current');
  };

  const matches = (swatch: string, current: string): boolean =>
    swatch.toLowerCase() === current.toLowerCase();

  const refresh = (): void => {
    const current = options.value?.();
    for (const entry of entries) {
      const swatch = entry.cell.getAttribute('data-docier-swatch') ?? '';
      marksCurrent(entry.cell, entry.cell, current !== undefined && matches(swatch, current));
    }
    marksCurrent(none, chip, current === undefined || matches(noneValue, current));
  };

  const focusCell = (cell: HTMLElement): void => {
    for (const entry of entries) entry.cell.tabIndex = -1;
    none.tabIndex = -1;
    cell.tabIndex = 0;
    cell.focus();
  };

  const startCell = (): HTMLElement => {
    const current = entries.find(
      (entry) => entry.cell.getAttribute('data-docier-current') === 'true',
    );
    return current?.cell ?? entries[0]?.cell ?? none;
  };

  const activate = (cell: HTMLElement): void => {
    const value = cell.getAttribute('data-docier-swatch');
    if (value === null) return;
    if (context.commands.get(options.command) === undefined) return;
    const args: Record<string, string> = {};
    args[argKey] = value;
    options.onPick?.(value);
    void context.commands.execute(options.command, args, { source: 'ui' });
    close(true);
  };

  const focusedCell = (event: KeyboardEvent): HTMLElement | undefined => {
    const target = event.target;
    if (target instanceof HTMLElement && element.contains(target) && target.hasAttribute('data-docier-swatch')) {
      return target;
    }
    const active = doc.activeElement;
    return active instanceof HTMLElement && element.contains(active) ? active : undefined;
  };

  const move = (event: KeyboardEvent, cell: HTMLElement): void => {
    const entry = entries.find((candidate) => candidate.cell === cell);
    if (entry === undefined) return;
    const group = groups[entry.group];
    if (group === undefined) return;
    const columns = group.columns;
    const last = group.cells.length - 1;
    let next = entry.index;
    if (event.key === 'ArrowRight') next = clamp(entry.index + 1, 0, last);
    else if (event.key === 'ArrowLeft') next = clamp(entry.index - 1, 0, last);
    else if (event.key === 'ArrowDown') next = entry.index + columns;
    else if (event.key === 'ArrowUp') next = entry.index - columns;
    else if (event.key === 'Home') next = entry.index - (entry.index % columns);
    else if (event.key === 'End') next = clamp(entry.index - (entry.index % columns) + columns - 1, 0, last);
    else return;
    if (next < 0 || next > last) {
      if (event.key === 'ArrowDown' && entry.index + columns > last) {
        event.preventDefault();
        focusCell(none);
      }
      return;
    }
    const target = group.cells[next];
    if (target === undefined) return;
    event.preventDefault();
    focusCell(target);
  };

  store.listen<KeyboardEvent>(element, 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const cell = focusedCell(event);
    if (cell === undefined) return;
    if (cell === none) {
      if (event.key === 'ArrowUp') {
        const last = groups[groups.length - 1];
        const target = last?.cells[0];
        if (target !== undefined) {
          event.preventDefault();
          focusCell(target);
        }
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate(none);
      }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(cell);
      return;
    }
    move(event, cell);
  });

  store.listen<MouseEvent>(element, 'click', (event) => {
    const target = closestFrom(event.target, '[data-docier-swatch]');
    if (target === undefined || !element.contains(target)) return;
    event.preventDefault();
    activate(target);
  });

  store.listen<MouseEvent>(doc, 'mousedown', (event) => {
    if (!isOpen) return;
    const target = event.target;
    if (target instanceof Node && element.contains(target)) return;
    close(false);
  });

  store.listen<KeyboardEvent>(doc, 'keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen) return;
    event.preventDefault();
    close(true);
  });

  store.listen(doc.defaultView ?? doc, 'resize', () => {
    close(false);
  });

  const place = (anchor: ColourPickerAnchor): void => {
    const width = element.offsetWidth || DEFAULT_PICKER_WIDTH;
    const height = element.offsetHeight || DEFAULT_PICKER_HEIGHT;
    const viewWidth = doc.defaultView?.innerWidth ?? 0;
    const viewHeight = doc.defaultView?.innerHeight ?? 0;
    const left =
      viewWidth === 0
        ? anchor.left
        : clamp(anchor.left, VIEWPORT_MARGIN_PX, Math.max(VIEWPORT_MARGIN_PX, viewWidth - width - VIEWPORT_MARGIN_PX));
    const below = anchor.top + anchor.height + ANCHOR_GAP_PX;
    const above = anchor.top - height - ANCHOR_GAP_PX;
    let top = below;
    if (viewHeight > 0 && below + height > viewHeight - VIEWPORT_MARGIN_PX && above >= VIEWPORT_MARGIN_PX) {
      top = above;
    }
    if (viewHeight !== 0) {
      top = clamp(top, VIEWPORT_MARGIN_PX, Math.max(VIEWPORT_MARGIN_PX, viewHeight - height - VIEWPORT_MARGIN_PX));
    }
    element.style.left = `${String(Math.round(left))}px`;
    element.style.top = `${String(Math.round(top))}px`;
  };

  let isOpen = false;
  let opener: HTMLElement | undefined;

  const detach = (): void => {
    element.hidden = true;
    if (element.parentNode !== null) element.parentNode.removeChild(element);
  };

  const close = (focusOpener = false): void => {
    if (!isOpen) return;
    isOpen = false;
    detach();
    const target = opener;
    opener = undefined;
    if (focusOpener && target !== undefined && target.isConnected) target.focus();
    options.onClose?.();
  };

  const open = (anchor: ColourPickerAnchor): void => {
    if (isOpen) detach();
    isOpen = true;
    const active = doc.activeElement;
    opener = active instanceof HTMLElement ? active : undefined;
    mount.appendChild(element);
    element.hidden = false;
    refresh();
    place(anchor);
    focusCell(startCell());
  };

  return {
    element,
    get visible(): boolean {
      return isOpen;
    },
    open,
    close,
    refresh,
    dispose: () => {
      close(false);
      store.dispose();
    },
  };
};
