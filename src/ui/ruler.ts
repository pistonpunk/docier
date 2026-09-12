import type { Disposable } from '../api/types.js';
import type { PageFragment } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { MP_PER_TWIP, fromCssPx, mp, mpToTwip, toCssPx, twip, twipToMp } from '../units/index.js';
import { createDisposableStore, markPart, markSlot, make, setText } from './dom.js';
import type { ChromeContext, RulerUnit } from './types.js';

export interface RulerIndents {
  readonly firstLineTwips: number;
  readonly leftTwips: number;
  readonly rightTwips: number;
}

export interface RulerMetrics {
  readonly page: PageFragment;
  readonly zoom: number;
  readonly offsetPx: number;
  readonly indents?: RulerIndents | undefined;
  readonly gutterTwips?: number | undefined;
}

export interface RulerOptions {
  readonly context: ChromeContext;
  readonly metrics: () => RulerMetrics | undefined;
  readonly onIndent?: ((value: RulerIndents) => void) | undefined;
  readonly onMargin?: ((side: 'left' | 'right', twips: number) => void) | undefined;
}

export interface RulerHandle extends Disposable {
  readonly element: HTMLElement;
  readonly markers: readonly HTMLElement[];
  readonly ticks: HTMLElement;
  readonly textArea: HTMLElement;
  refresh(): void;
}

interface UnitSpec {
  readonly mpPerUnit: number;
  readonly majorStep: number;
  readonly minorStep: number;
  readonly decimals: number;
}

const INCH_MP = 1440 * MP_PER_TWIP;

export const UNIT_SPECS: Readonly<Record<RulerUnit, UnitSpec>> = {
  cm: { mpPerUnit: INCH_MP / 2.54, majorStep: 1, minorStep: 0.5, decimals: 1 },
  mm: { mpPerUnit: INCH_MP / 25.4, majorStep: 10, minorStep: 5, decimals: 0 },
  inch: { mpPerUnit: INCH_MP, majorStep: 1, minorStep: 0.25, decimals: 0 },
  pt: { mpPerUnit: 1000, majorStep: 10, minorStep: 5, decimals: 0 },
  pica: { mpPerUnit: 12000, majorStep: 6, minorStep: 3, decimals: 0 },
  px: { mpPerUnit: INCH_MP / 96, majorStep: 12, minorStep: 3, decimals: 0 },
};

export const RULER_UNITS: readonly RulerUnit[] = ['cm', 'mm', 'inch', 'pt', 'pica', 'px'];

const MAX_TICKS = 400;

export const formatRulerValue = (valueMp: number, units: RulerUnit): string => {
  const spec = UNIT_SPECS[units];
  const value = valueMp / spec.mpPerUnit;
  if (spec.decimals === 0) return String(Math.round(value));
  return value.toFixed(spec.decimals);
};

const MARKER_DEFS: readonly {
  readonly part: string;
  readonly labelKey: string;
  readonly kind: string;
}[] = [
  { part: 'margin-left', labelKey: 'ui.ruler.marginLeft', kind: 'margin' },
  { part: 'margin-right', labelKey: 'ui.ruler.marginRight', kind: 'margin' },
  { part: 'indent-first-line', labelKey: 'ui.ruler.indentFirstLine', kind: 'first-line' },
  { part: 'indent-hanging', labelKey: 'ui.ruler.indentHanging', kind: 'hanging' },
  { part: 'indent-left', labelKey: 'ui.ruler.indentLeft', kind: 'left' },
  { part: 'indent-right', labelKey: 'ui.ruler.indentRight', kind: 'right' },
];

const ZERO_INDENTS: RulerIndents = { firstLineTwips: 0, leftTwips: 0, rightTwips: 0 };

export const createRuler = (options: RulerOptions): RulerHandle => {
  const { context } = options;
  const store = createDisposableStore();
  const doc = context.host.ownerDocument;

  const element = make('div', 'docier-ruler');
  markPart(element, 'ruler');
  markSlot(element, 'ruler');
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', context.i18n.text('ui.chrome.ruler'));
  element.setAttribute('aria-orientation', 'horizontal');

  const corner = make('div', 'docier-ruler-corner');
  const unitButton = make('button', 'docier-ruler-unit');
  unitButton.setAttribute('type', 'button');
  unitButton.setAttribute('data-docier-part', 'ruler-units');
  unitButton.setAttribute('aria-haspopup', 'menu');
  unitButton.addEventListener('click', (event) => {
    event.preventDefault();
    context.run('setUnits', { cycle: true });
  });
  corner.appendChild(unitButton);
  element.appendChild(corner);

  const strip = make('div', 'docier-ruler-strip');
  strip.setAttribute('data-docier-part', 'ruler-strip');
  const textArea = make('div', 'docier-ruler-text-area');
  textArea.setAttribute('data-docier-part', 'ruler-text-area');
  const ticks = make('div', 'docier-ruler-ticks');
  ticks.setAttribute('data-docier-part', 'ruler-ticks');
  const badge = make('div', 'docier-ruler-badge');
  badge.hidden = true;
  badge.setAttribute('aria-hidden', 'true');
  strip.appendChild(textArea);
  strip.appendChild(ticks);
  element.appendChild(strip);
  element.appendChild(badge);

  const markers = new Map<string, HTMLElement>();
  for (const definition of MARKER_DEFS) {
    const marker = make('button', `docier-ruler-marker docier-ruler-marker-${definition.kind}`);
    marker.setAttribute('type', 'button');
    marker.setAttribute('role', 'slider');
    marker.setAttribute('data-docier-part', definition.part);
    marker.setAttribute('aria-label', context.i18n.text(definition.labelKey));
    marker.setAttribute('aria-orientation', 'horizontal');
    marker.setAttribute('aria-valuemin', '0');
    marker.setAttribute('aria-valuemax', '0');
    marker.setAttribute('aria-valuenow', '0');
    marker.setAttribute('aria-valuetext', '');
    markers.set(definition.part, marker);
    strip.appendChild(marker);
  }

  const units = (): RulerUnit => context.state.units;

  const unitSuffix = (value: RulerUnit): string => {
    const key = `ui.ruler.unit.${value}`;
    const text = context.i18n.text(key);
    return text === key ? value : text;
  };

  const positionMarker = (part: string, valueMp: number, zoom: number, offsetPx: number): void => {
    const marker = markers.get(part);
    if (marker === undefined) return;
    const px = toCssPx(mp(Math.round(valueMp)) as Mp, zoom);
    marker.style.left = `${String(offsetPx + px)}px`;
    marker.setAttribute('aria-valuenow', String(Math.round(mpToTwip(mp(Math.round(valueMp))))));
    marker.setAttribute('aria-valuetext', `${formatRulerValue(valueMp, units())} ${unitSuffix(units())}`);
  };

  const renderTicks = (fromMp: number, toMp: number, zoom: number, offsetPx: number): void => {
    while (ticks.firstChild !== null) ticks.removeChild(ticks.firstChild);
    const spec = UNIT_SPECS[units()];
    const majorMp = spec.majorStep * spec.mpPerUnit;
    const minorMp = spec.minorStep * spec.mpPerUnit;
    const start = Math.floor(fromMp / minorMp) * minorMp;
    let count = 0;
    for (let value = start; value <= toMp && count < MAX_TICKS; value += minorMp) {
      count += 1;
      const isMajor = Math.abs(value / majorMp - Math.round(value / majorMp)) < 0.0001;
      const tick = make('span', 'docier-ruler-tick');
      tick.style.left = `${String(offsetPx + toCssPx(mp(Math.round(value)) as Mp, zoom))}px`;
      tick.style.height = isMajor ? '100%' : '35%';
      if (isMajor) {
        const label = make('span', 'docier-ruler-tick-label');
        setText(label, formatRulerValue(value, units()));
        tick.appendChild(label);
      }
      ticks.appendChild(tick);
    }
  };

  const refresh = (): void => {
    const current = options.metrics();
    element.hidden = !context.state.rulerVisible || current === undefined;
    setText(unitButton, units());
    unitButton.setAttribute('aria-label', context.i18n.text('ui.ruler.units'));
    unitButton.setAttribute('title', context.i18n.text('ui.ruler.units'));
    if (current === undefined) return;

    const page = current.page;
    const zoom = current.zoom === 0 ? 1 : current.zoom;
    const offsetPx = current.offsetPx;
    const left = page.contentBox.x;
    const right = page.contentBox.x + page.contentBox.width;
    const pageStart = page.page.x;
    const pageEnd = page.page.x + page.page.width;
    const gutterMp = (current.gutterTwips ?? 0) * MP_PER_TWIP;

    textArea.style.left = `${String(offsetPx + toCssPx(left, zoom))}px`;
    textArea.style.width = `${String(toCssPx(mp(right - left) as Mp, zoom))}px`;

    positionMarker('margin-left', pageStart, zoom, offsetPx);
    positionMarker('margin-right', pageEnd, zoom, offsetPx);

    const indents = current.indents ?? ZERO_INDENTS;
    const leftIndentMp = left + gutterMp + indents.leftTwips * MP_PER_TWIP;
    positionMarker('indent-left', leftIndentMp, zoom, offsetPx);
    positionMarker(
      'indent-first-line',
      leftIndentMp + indents.firstLineTwips * MP_PER_TWIP,
      zoom,
      offsetPx,
    );
    positionMarker(
      'indent-hanging',
      leftIndentMp + Math.min(0, indents.firstLineTwips) * MP_PER_TWIP,
      zoom,
      offsetPx,
    );
    positionMarker('indent-right', right - indents.rightTwips * MP_PER_TWIP, zoom, offsetPx);

    renderTicks(pageStart, pageEnd, zoom, offsetPx);
  };

  const currentIndents = (): RulerIndents => options.metrics()?.indents ?? ZERO_INDENTS;

  const commitIndent = (patch: Partial<RulerIndents>): void => {
    const base = currentIndents();
    const next: RulerIndents = {
      firstLineTwips: Math.round(patch.firstLineTwips ?? base.firstLineTwips),
      leftTwips: Math.round(patch.leftTwips ?? base.leftTwips),
      rightTwips: Math.round(patch.rightTwips ?? base.rightTwips),
    };
    options.onIndent?.(next);
    const command = 'docier.command.format.setParagraphIndent';
    if (context.commands.get(command) !== undefined) {
      void context.commands.execute(command, next, { source: 'ui' });
      return;
    }
    context.run('setIndent', { ...next, target: 'ruler' });
  };

  const startDrag = (part: string, event: MouseEvent, apply: (deltaTwips: number) => void): void => {
    const marker = markers.get(part);
    const current = options.metrics();
    if (marker === undefined || current === undefined) return;
    event.preventDefault();
    const startX = event.clientX;
    const zoom = current.zoom === 0 ? 1 : current.zoom;
    const onMove = (moveEvent: MouseEvent): void => {
      const deltaPx = moveEvent.clientX - startX;
      const deltaTwips = mpToTwip(fromCssPx(deltaPx, zoom));
      apply(deltaTwips);
      setText(badge, `${formatRulerValue(deltaPx * 1000, units())} ${unitSuffix(units())}`);
      badge.hidden = false;
      badge.style.left = `${String(moveEvent.clientX)}px`;
    };
    const onUp = (): void => {
      badge.hidden = true;
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      doc.removeEventListener('keydown', onKey);
    };
    const onKey = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      onUp();
    };
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
    doc.addEventListener('keydown', onKey);
    const capture = (marker as unknown as { setPointerCapture?: (id: number) => void })
      .setPointerCapture;
    if (typeof capture === 'function' && 'pointerId' in event) {
      try {
        capture.call(marker, (event as unknown as { pointerId: number }).pointerId);
      } catch {
        void 0;
      }
    }
  };

  const indentApply: Readonly<Record<string, (deltaTwips: number) => void>> = {
    'indent-left': (delta) => {
      commitIndent({ leftTwips: currentIndents().leftTwips + delta });
    },
    'indent-first-line': (delta) => {
      commitIndent({ firstLineTwips: currentIndents().firstLineTwips + delta });
    },
    'indent-hanging': (delta) => {
      commitIndent({ firstLineTwips: Math.min(0, currentIndents().firstLineTwips) + delta });
    },
    'indent-right': (delta) => {
      commitIndent({ rightTwips: currentIndents().rightTwips - delta });
    },
  };

  for (const part of Object.keys(indentApply)) {
    const marker = markers.get(part);
    const apply = indentApply[part];
    if (marker === undefined || apply === undefined) continue;
    store.listen<MouseEvent>(marker, 'pointerdown', (event) => {
      startDrag(part, event, apply);
    });
    store.listen<KeyboardEvent>(marker, 'keydown', (event) => {
      const step = event.shiftKey ? 10 * MP_PER_TWIP : MP_PER_TWIP;
      const delta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
      if (delta === 0) return;
      event.preventDefault();
      apply(Math.round(mpToTwip(mp(delta))));
    });
  }

  const marginBase = (side: 'left' | 'right'): number => {
    const current = options.metrics();
    if (current === undefined) return 0;
    return side === 'left'
      ? current.page.contentBox.x
      : current.page.page.width - current.page.contentBox.width - current.page.contentBox.x;
  };

  const commitMargin = (side: 'left' | 'right', valueTwips: number): void => {
    const value = Math.max(0, Math.round(valueTwips));
    options.onMargin?.(side, value);
    const command = 'docier.command.doc.setMargins';
    if (context.commands.get(command) !== undefined) {
      void context.commands.execute(command, { side, twips: value }, { source: 'ui' });
      return;
    }
    context.run('setMargin', { side, twips: value });
  };

  for (const side of ['left', 'right'] as const) {
    const marker = markers.get(`margin-${side}`);
    if (marker === undefined) continue;
    const sign = side === 'left' ? 1 : -1;
    store.listen<MouseEvent>(marker, 'pointerdown', (event) => {
      startDrag(`margin-${side}`, event, (delta) => {
        commitMargin(side, marginBase(side) / MP_PER_TWIP + sign * delta);
      });
    });
    store.listen<KeyboardEvent>(marker, 'keydown', (event) => {
      const step = event.shiftKey ? 10 : 1;
      const delta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
      if (delta === 0) return;
      event.preventDefault();
      commitMargin(side, marginBase(side) / MP_PER_TWIP + (side === 'left' ? delta : -delta));
    });
  }

  store.add({
    dispose: context.subscribe(() => {
      refresh();
    }),
  });

  refresh();

  return {
    element,
    get markers(): readonly HTMLElement[] {
      return [...markers.values()];
    },
    ticks,
    textArea,
    refresh,
    dispose: () => {
      store.dispose();
    },
  };
};

export const twipsToMp = (value: number): Mp => twipToMp(twip(value));
