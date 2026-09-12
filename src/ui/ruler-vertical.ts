import type { Disposable } from '../api/types.js';
import type { Mp } from '../units/index.js';
import { MP_PER_TWIP, fromCssPx, mp, mpToTwip, toCssPx, twip, twipToMp } from '../units/index.js';
import { createDisposableStore, markPart, markSlot, make, setText } from './dom.js';
import { UNIT_SPECS, formatRulerValue } from './ruler.js';
import type { RulerMetrics } from './ruler.js';
import type { ChromeContext, RulerUnit } from './types.js';

export type VerticalMarginSide = 'top' | 'bottom';

export type VerticalRulerMetrics = RulerMetrics;

export interface VerticalRulerOptions {
  readonly context: ChromeContext;
  readonly metrics: () => VerticalRulerMetrics | undefined;
  readonly onMargin?: ((side: VerticalMarginSide, twips: number) => void) | undefined;
}

export interface VerticalRulerHandle extends Disposable {
  readonly element: HTMLElement;
  readonly markers: readonly HTMLElement[];
  readonly lines: readonly HTMLElement[];
  readonly ticks: HTMLElement;
  readonly textArea: HTMLElement;
  refresh(): void;
}

const SIDES: readonly VerticalMarginSide[] = ['top', 'bottom'];

const SIDE_PARTS: Readonly<Record<VerticalMarginSide, string>> = {
  top: 'margin-top',
  bottom: 'margin-bottom',
};

const SIDE_LABEL_KEYS: Readonly<Record<VerticalMarginSide, string>> = {
  top: 'ui.ruler.marginTop',
  bottom: 'ui.ruler.marginBottom',
};

const LINE_THICKNESS_PX = 2;
const LINE_HOVER_THICKNESS_PX = 4;
const HIT_HEIGHT_PX = 20;
const MAX_TICKS = 400;

export const createVerticalRuler = (options: VerticalRulerOptions): VerticalRulerHandle => {
  const { context } = options;
  const store = createDisposableStore();
  const doc = context.host.ownerDocument;
  const hovered = new Set<VerticalMarginSide>();
  let dragging: VerticalMarginSide | undefined;
  let abandonDrag: (() => void) | undefined;

  const element = make('div', 'docier-ruler-vertical');
  markPart(element, 'ruler-vertical');
  markSlot(element, 'ruler');
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', context.i18n.text('ui.chrome.ruler'));
  element.setAttribute('aria-orientation', 'vertical');
  Object.assign(element.style, {
    position: 'relative',
    width: 'var(--docier-ruler-size, 24px)',
    height: '100%',
    minHeight: '0',
    flex: '0 0 auto',
    alignSelf: 'stretch',
    boxSizing: 'border-box',
    background: 'var(--docier-surface-raised)',
    borderRight: '1px solid var(--docier-border)',
    userSelect: 'none',
    touchAction: 'none',
  });

  const strip = make('div', 'docier-ruler-vertical-strip');
  strip.setAttribute('data-docier-part', 'ruler-vertical-strip');
  Object.assign(strip.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    overflow: 'hidden',
  });

  const textArea = make('div', 'docier-ruler-vertical-text-area');
  textArea.setAttribute('data-docier-part', 'ruler-vertical-text-area');
  Object.assign(textArea.style, {
    position: 'absolute',
    left: '0',
    right: '0',
    background: 'var(--docier-page)',
  });

  const ticks = make('div', 'docier-ruler-vertical-ticks');
  ticks.setAttribute('data-docier-part', 'ruler-vertical-ticks');
  Object.assign(ticks.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
  });

  strip.appendChild(textArea);
  strip.appendChild(ticks);
  element.appendChild(strip);

  const badge = make('div', 'docier-ruler-vertical-badge');
  badge.setAttribute('data-docier-part', 'ruler-vertical-badge');
  Object.assign(badge.style, {
    position: 'absolute',
    left: 'calc(100% + var(--docier-gap, 4px))',
    transform: 'translateY(-50%)',
    background: 'var(--docier-text)',
    color: 'var(--docier-surface-raised)',
    fontFamily: 'var(--docier-ui-font)',
    fontSize: 'calc(var(--docier-ui-font-size, 13px) - 2px)',
    lineHeight: '1.5',
    padding: '0 4px',
    borderRadius: 'var(--docier-radius, 4px)',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    zIndex: '3',
  });
  badge.hidden = true;
  badge.setAttribute('aria-hidden', 'true');
  element.appendChild(badge);

  const markers = new Map<VerticalMarginSide, HTMLElement>();
  const lines = new Map<VerticalMarginSide, HTMLElement>();

  for (const side of SIDES) {
    const handle = make('button', `docier-ruler-vertical-handle docier-ruler-vertical-handle-${side}`);
    handle.setAttribute('type', 'button');
    handle.setAttribute('role', 'slider');
    handle.setAttribute('data-docier-part', SIDE_PARTS[side]);
    handle.setAttribute('aria-label', context.i18n.text(SIDE_LABEL_KEYS[side]));
    handle.setAttribute('title', context.i18n.text(SIDE_LABEL_KEYS[side]));
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-valuemin', '0');
    handle.setAttribute('aria-valuemax', '0');
    handle.setAttribute('aria-valuenow', '0');
    handle.setAttribute('aria-valuetext', '');
    Object.assign(handle.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      height: `${String(HIT_HEIGHT_PX)}px`,
      transform: 'translateY(-50%)',
      appearance: 'none',
      border: '0',
      padding: '0',
      margin: '0',
      background: 'transparent',
      cursor: 'row-resize',
      touchAction: 'none',
    });

    const line = make('span', `docier-ruler-vertical-line docier-ruler-vertical-line-${side}`);
    Object.assign(line.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      top: '50%',
      height: `${String(LINE_THICKNESS_PX)}px`,
      transform: 'translateY(-50%)',
      background: 'var(--docier-accent)',
      borderRadius: '1px',
      pointerEvents: 'none',
    });

    handle.appendChild(line);
    markers.set(side, handle);
    lines.set(side, line);
    strip.appendChild(handle);
  }

  const units = (): RulerUnit => context.state.units;

  const unitSuffix = (value: RulerUnit): string => {
    const key = `ui.ruler.unit.${value}`;
    const text = context.i18n.text(key);
    return text === key ? value : text;
  };

  const setEmphasis = (side: VerticalMarginSide, on: boolean): void => {
    const handle = markers.get(side);
    const line = lines.get(side);
    if (handle === undefined || line === undefined) return;
    handle.style.background = on ? 'var(--docier-accent-soft)' : 'transparent';
    line.style.height = on ? `${String(LINE_HOVER_THICKNESS_PX)}px` : `${String(LINE_THICKNESS_PX)}px`;
  };

  for (const side of SIDES) {
    const handle = markers.get(side);
    if (handle === undefined) continue;
    store.listen<PointerEvent>(handle, 'pointerenter', () => {
      hovered.add(side);
      setEmphasis(side, true);
    });
    store.listen<PointerEvent>(handle, 'pointerleave', () => {
      hovered.delete(side);
      if (dragging !== side) setEmphasis(side, false);
    });
  }

  const positionHandle = (
    side: VerticalMarginSide,
    valueMp: number,
    zoom: number,
    offsetPx: number,
    reportedMp: number = valueMp,
  ): void => {
    const handle = markers.get(side);
    if (handle === undefined) return;
    const px = toCssPx(mp(Math.round(valueMp)), zoom);
    handle.style.top = `${String(offsetPx + px)}px`;
    handle.setAttribute('aria-valuenow', String(Math.round(mpToTwip(mp(Math.round(reportedMp))))));
    handle.setAttribute('aria-valuetext', `${formatRulerValue(reportedMp, units())} ${unitSuffix(units())}`);
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
      const tick = make('span', 'docier-ruler-vertical-tick');
      const top = offsetPx + toCssPx(mp(Math.round(value)), zoom);
      Object.assign(tick.style, {
        position: 'absolute',
        right: '0',
        top: `${String(top)}px`,
        height: '1px',
        width: isMajor ? '100%' : '35%',
        background: 'var(--docier-border)',
      });
      if (isMajor) {
        const label = make('span', 'docier-ruler-vertical-tick-label');
        setText(label, formatRulerValue(value, units()));
        Object.assign(label.style, {
          position: 'absolute',
          right: '2px',
          top: '2px',
          fontFamily: 'var(--docier-ui-font)',
          fontSize: '9px',
          lineHeight: '9px',
          color: 'var(--docier-text-muted)',
          pointerEvents: 'none',
        });
        tick.appendChild(label);
      }
      ticks.appendChild(tick);
    }
  };

  const refresh = (): void => {
    const current = options.metrics();
    element.hidden = !context.state.rulerVisible || current === undefined;
    if (current === undefined) return;

    const page = current.page;
    const zoom = current.zoom === 0 ? 1 : current.zoom;
    const offsetPx = current.offsetPx;
    const top = page.contentBox.y;
    const bottom = page.contentBox.y + page.contentBox.height;
    const pageStart = page.page.y;
    const pageEnd = page.page.y + page.page.height;
    const maxTwips = Math.round(mpToTwip(mp(page.page.height)));

    textArea.style.top = `${String(offsetPx + toCssPx(top, zoom))}px`;
    textArea.style.height = `${String(toCssPx(mp(bottom - top), zoom))}px`;

    positionHandle('top', top, zoom, offsetPx, mp(top - pageStart));
    positionHandle('bottom', bottom, zoom, offsetPx, mp(pageEnd - bottom));

    for (const side of SIDES) {
      markers.get(side)?.setAttribute('aria-valuemax', String(maxTwips));
    }

    renderTicks(pageStart, pageEnd, zoom, offsetPx);
  };

  const marginBase = (side: VerticalMarginSide): number => {
    const current = options.metrics();
    if (current === undefined) return 0;
    const page = current.page;
    return side === 'top'
      ? page.contentBox.y
      : page.page.height - page.contentBox.height - page.contentBox.y;
  };

  const marginLimit = (side: VerticalMarginSide): number => {
    const current = options.metrics();
    if (current === undefined) return Number.POSITIVE_INFINITY;
    const page = current.page;
    const other =
      side === 'top'
        ? page.page.height - page.contentBox.y - page.contentBox.height
        : page.contentBox.y;
    return Math.max(0, Math.floor((page.page.height - other) / MP_PER_TWIP));
  };

  const commitMargin = (side: VerticalMarginSide, valueTwips: number): void => {
    const clamped = Math.min(Math.max(0, Math.round(valueTwips)), marginLimit(side));
    const value = Number.isFinite(clamped) ? clamped : Math.max(0, Math.round(valueTwips));
    options.onMargin?.(side, value);
    const command = 'docier.command.doc.setMargins';
    const args =
      side === 'top' ? { topTwips: value } : { bottomTwips: value };
    if (context.commands.get(command) !== undefined) {
      void context.commands.execute(command, args, { source: 'ui' });
      return;
    }
    context.run('setMargin', { side, twips: value });
  };

  let guide: HTMLElement | undefined;

  const guideHost = (): HTMLElement | undefined => {
    const canvas =
      element.closest('.docier-canvas') ??
      element.parentElement?.querySelector('.docier-canvas') ??
      doc.querySelector('.docier-canvas');
    return canvas instanceof HTMLElement ? canvas : undefined;
  };

  const showGuide = (viewportY: number): void => {
    const host = guideHost();
    if (host === undefined) return;
    if (guide === undefined) {
      guide = make('div', 'docier-guide-line');
      markPart(guide, 'margin-guide');
      Object.assign(guide.style, {
        position: 'absolute',
        left: '0',
        right: '0',
        height: '1px',
        zIndex: '5',
        pointerEvents: 'none',
        backgroundImage:
          'repeating-linear-gradient(to right, var(--docier-guide) 0 6px, transparent 6px 12px)',
      });
      host.appendChild(guide);
    }
    const box = host.getBoundingClientRect();
    guide.style.top = `${String(Math.round(viewportY - box.top))}px`;
    guide.hidden = false;
  };

  const hideGuide = (): void => {
    if (guide !== undefined) guide.hidden = true;
  };

  const marginDrag = (side: VerticalMarginSide, event: PointerEvent): void => {
    const marker = markers.get(side);
    const current = options.metrics();
    if (marker === undefined || current === undefined) return;
    event.preventDefault();
    const zoom = current.zoom === 0 ? 1 : current.zoom;
    const sign = side === 'top' ? 1 : -1;
    const base = Math.round(marginBase(side) / MP_PER_TWIP);
    const startY = event.clientY;
    const markerY = marker.getBoundingClientRect().top;
    let pending = base;
    dragging = side;
    setEmphasis(side, true);

    const onMove = (moveEvent: PointerEvent): void => {
      const travel = moveEvent.clientY - startY;
      pending = Math.round(base + sign * mpToTwip(fromCssPx(travel, zoom)));
      showGuide(markerY + travel);
      badge.hidden = false;
      badge.style.top = `${String(Math.round(markerY + travel))}px`;
      setText(badge, `${formatRulerValue(twipToMp(twip(pending)) as Mp, units())} ${unitSuffix(units())}`);
    };
    const onUp = (): void => {
      hideGuide();
      badge.hidden = true;
      dragging = undefined;
      abandonDrag = undefined;
      if (!hovered.has(side)) setEmphasis(side, false);
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('keydown', onKey);
      if (pending !== base) commitMargin(side, pending);
    };
    const onKey = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      pending = base;
      onUp();
    };
    abandonDrag = () => {
      pending = base;
      onUp();
    };
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
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

  for (const side of SIDES) {
    const marker = markers.get(side);
    if (marker === undefined) continue;
    const sign = side === 'top' ? 1 : -1;
    store.listen<PointerEvent>(marker, 'pointerdown', (event) => {
      marginDrag(side, event);
    });
    store.listen<KeyboardEvent>(marker, 'keydown', (event) => {
      const step = event.shiftKey ? 10 : 1;
      const delta = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
      if (delta === 0) return;
      event.preventDefault();
      commitMargin(side, marginBase(side) / MP_PER_TWIP + sign * delta);
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
    get lines(): readonly HTMLElement[] {
      return [...lines.values()];
    },
    ticks,
    textArea,
    refresh,
    dispose: () => {
      abandonDrag?.();
      store.dispose();
      guide?.remove();
      element.remove();
    },
  };
};
