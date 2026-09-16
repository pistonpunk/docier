import type {
  BlockFragment,
  BorderSet,
  LayoutResult,
  LineFragment,
  LineRun,
  PageFragment,
  Rect,
  RunPaint,
  Shading,
} from '../layout/index.js';
import { mp } from '../units/index.js';
import type {
  MeasuredRect,
  RectSource,
  RectStyle,
  RenderedDocument,
  RunFontSpec,
  TextAdvanceMeasurer,
  ZoomMode,
} from './types.js';
import type { PaintScale } from './scale.js';
import { formatNumber, formatPx, paintScale } from './scale.js';
import { ATTR, frameOf, geometryAt } from './dom.js';
import { fontShorthand, runFontSpec } from './style.js';
import { BORDER_SIDES, edgeBandOf, shadingColorOf } from './decoration.js';
import { needsSegmentation, segmentsOf } from './runs.js';
import { objectBoxOf, rotatedBounds } from './inline-object.js';

export const DEFAULT_TOLERANCE_PX = 0.5;
export const DEFAULT_MAX_DIVERGENCES = 100;

export type TextWidthSource = (element: HTMLElement) => number | undefined;

const regionBlocks = (page: PageFragment): readonly BlockFragment[] => {
  const out: BlockFragment[] = [];
  if (page.header !== undefined) out.push(...page.header.blocks);
  if (page.footer !== undefined) out.push(...page.footer.blocks);
  if (page.footnotes !== undefined) out.push(...page.footnotes.blocks);
  return out;
};

export const RESULT_GAPS: readonly string[] = ['fontFileHash'];

export type DivergenceKind =
  | 'pageCount'
  | 'pageSize'
  | 'pageOrigin'
  | 'staleResult'
  | 'missingRun'
  | 'strayRun'
  | 'runBox'
  | 'runAdvance'
  | 'runFontSize'
  | 'decoration'
  | 'objectBox'
  | 'missingImage';

export interface LayoutDivergence {
  readonly kind: DivergenceKind;
  readonly message: string;
  readonly documentHash: string;
  readonly page: number;
  readonly blockId: number;
  readonly lineId: number;
  readonly runIndex: number;
  readonly docPos: number | undefined;
  readonly engineWidthMp: number;
  readonly engineWidthPx: number;
  readonly renderedWidthPx: number;
  readonly deltaPx: number;
  readonly tolerancePx: number;
  readonly resolvedFontFamily: string;
  readonly fontFileHash: string | undefined;
  readonly text: string;
}

export type DivergenceSkipReason =
  | 'runWithoutPaint'
  | 'zeroWidthRun'
  | 'hiddenRun'
  | 'objectRun'
  | 'unreadableBox'
  | 'unreadableFontSize'
  | 'segmentCountMismatch'
  | 'segmentedRunAdvance'
  | 'smallCapsAdvance'
  | 'controlCharacterAdvance'
  | 'noTextMeasurer'
  | 'fontsPending'
  | 'unmeasurableText'
  | 'unreadableObjectBox'
  | 'pageLayerMissing'
  | 'unreadablePageLayer'
  | 'unreadablePageOrigin'
  | 'unreadablePage';

export type DivergenceSkipSeverity = 'info' | 'warning';

const SKIP_SEVERITY: Record<DivergenceSkipReason, DivergenceSkipSeverity> = {
  runWithoutPaint: 'warning',
  zeroWidthRun: 'info',
  hiddenRun: 'info',
  objectRun: 'info',
  unreadableBox: 'warning',
  unreadableFontSize: 'warning',
  segmentCountMismatch: 'warning',
  segmentedRunAdvance: 'info',
  smallCapsAdvance: 'info',
  controlCharacterAdvance: 'info',
  noTextMeasurer: 'warning',
  fontsPending: 'warning',
  unmeasurableText: 'warning',
  unreadableObjectBox: 'warning',
  pageLayerMissing: 'warning',
  unreadablePageLayer: 'warning',
  unreadablePageOrigin: 'warning',
  unreadablePage: 'warning',
};

export interface DivergenceSkip {
  readonly reason: DivergenceSkipReason;
  readonly count: number;
  readonly severity: DivergenceSkipSeverity;
}

export interface DivergenceChecked {
  readonly pages: number;
  readonly lines: number;
  readonly runs: number;
  readonly boxes: number;
  readonly advances: number;
  readonly fonts: number;
  readonly decorations: number;
  readonly objects: number;
}

export interface DivergenceReport {
  readonly ok: boolean;
  readonly complete: boolean;
  readonly documentHash: string;
  readonly version: number;
  readonly zoom: number;
  readonly zoomMode: ZoomMode;
  readonly tolerancePx: number;
  readonly rectSource: 'browser' | 'style';
  readonly authoritative: boolean;
  readonly checked: DivergenceChecked;
  readonly skipped: readonly DivergenceSkip[];
  readonly divergences: readonly LayoutDivergence[];
  readonly gaps: readonly string[];
}

export interface DivergenceCheckOptions {
  readonly tolerancePx?: number;
  readonly measureText?: TextAdvanceMeasurer;
  readonly rectOf?: RectSource;
  readonly textWidthOf?: TextWidthSource;
  readonly maxDivergences?: number;
  readonly requireBrowserLayout?: boolean;
}

export const hasLayoutEngine = (): boolean => {
  if (typeof document === 'undefined') return false;
  const body = document.body;
  if (body === null || body === undefined) return false;
  const probe = document.createElement('div');
  probe.style.setProperty('position', 'absolute');
  probe.style.setProperty('width', '10px');
  probe.style.setProperty('height', '10px');
  body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  body.removeChild(probe);
  return rect.width > 0;
};

export const browserRectSource = (): RectSource => (element) => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
};

export const browserTextWidthSource = (): TextWidthSource => {
  const range = document.createRange();
  return (element) => {
    const text = element.firstChild;
    if (text === null || text.nodeType !== Node.TEXT_NODE) return undefined;
    range.selectNodeContents(text);
    const rect = range.getBoundingClientRect();
    return Number.isFinite(rect.width) ? rect.width : undefined;
  };
};

const numeric = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const styleRectSource = (factor: number): RectSource => (element) => {
  const width = numeric(element.style.width);
  const height = numeric(element.style.height);
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = element;
  while (node !== null) {
    left += numeric(node.style.left);
    top += numeric(node.style.top);
    if (node.hasAttribute(ATTR.page) || node.hasAttribute(ATTR.surface)) break;
    node = node.parentElement;
  }
  return { left: left * factor, top: top * factor, width: width * factor, height: height * factor };
};

export const canvasTextMeasurer = (): TextAdvanceMeasurer | undefined => {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (context === null) return undefined;
  const precise = context as CanvasRenderingContext2D & { textRendering?: string };
  if ('textRendering' in precise) precise.textRendering = 'geometricPrecision';
  const measure = (text: string, font: RunFontSpec): number | undefined => {
    context.font = fontShorthand(font);
    const metrics = context.measureText(text);
    return Number.isFinite(metrics.width) ? metrics.width : undefined;
  };
  return { measure };
};

export const fontsArePending = (): boolean => {
  if (typeof document === 'undefined') return false;
  const set = (document as { fonts?: FontFaceSet }).fonts;
  return set !== undefined && set.status !== 'loaded';
};

const HAS_CONTROL = /[\t\n\r\f\v]/;

const atomBoundaries = (
  line: LineFragment,
  run: LineRun,
  scale: PaintScale,
): readonly number[] => {
  const edges: number[] = [];
  for (const atom of line.atoms) {
    if (atom.source.start < run.source.start || atom.source.end > run.source.end) continue;
    edges.push(scale.px(atom.x), scale.px(mp(atom.x + atom.width)));
  }
  return edges;
};

const boundaryGap = (boundaries: readonly number[], value: number): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const boundary of boundaries) best = Math.min(best, Math.abs(boundary - value));
  return best;
};

const localRect = (rect: MeasuredRect, sheet: MeasuredRect): MeasuredRect => ({
  left: rect.left - sheet.left,
  top: rect.top - sheet.top,
  width: rect.width,
  height: rect.height,
});

const unionOf = (rects: readonly MeasuredRect[]): MeasuredRect => {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  return { left, top, width: right - left, height: bottom - top };
};

const rectDelta = (
  expected: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  actual: MeasuredRect,
): number =>
  Math.max(
    Math.abs(actual.left - expected.left),
    Math.abs(actual.top - expected.top),
    Math.abs(actual.width - expected.width),
    Math.abs(actual.height - expected.height),
  );

const rectMessage = (label: string, expected: RectStyle, actual: MeasuredRect): string =>
  `${label} is at ${actual.left}+${actual.top} ${actual.width}x${actual.height} px where the engine ` +
  `places it at ${expected.left}+${expected.top} ${expected.width}x${expected.height} px`;

export const formatDivergence = (divergence: LayoutDivergence): string =>
  `[${divergence.kind}] page ${divergence.page} line ${divergence.lineId} run ${divergence.runIndex}: ` +
  `${divergence.message} (engine ${divergence.engineWidthMp} mp = ${formatNumber(divergence.engineWidthPx)} px, ` +
  `rendered ${formatNumber(divergence.renderedWidthPx)} px, delta ${formatNumber(divergence.deltaPx)} px over ` +
  `${formatNumber(divergence.tolerancePx)} px tolerance, font ${divergence.resolvedFontFamily}, ` +
  `hash ${divergence.documentHash})`;

interface DivergenceDraft {
  readonly kind: DivergenceKind;
  readonly message: string;
  readonly page: number;
  readonly blockId: number;
  readonly lineId: number;
  readonly runIndex: number;
  readonly docPos: number | undefined;
  readonly engineWidthMp: number;
  readonly renderedWidthPx: number;
  readonly resolvedFontFamily: string;
  readonly text: string;
}

export const detectDivergence = (
  result: LayoutResult,
  rendered: RenderedDocument,
  options: DivergenceCheckOptions = {},
): DivergenceReport => {
  const tolerancePx = options.tolerancePx ?? DEFAULT_TOLERANCE_PX;
  const maxDivergences = options.maxDivergences ?? DEFAULT_MAX_DIVERGENCES;
  const scale: PaintScale = paintScale(rendered.zoom);
  const browserAvailable = hasLayoutEngine();
  const readableRects = options.rectOf !== undefined || browserAvailable;
  const rectFactor = rendered.zoomMode === 'transform' ? rendered.zoom : 1;
  const rectOf: RectSource =
    options.rectOf ?? (browserAvailable ? browserRectSource() : styleRectSource(rectFactor));
  const measureText =
    options.measureText ?? (options.rectOf !== undefined ? undefined : canvasTextMeasurer());
  const textWidthOf =
    options.textWidthOf ?? (browserAvailable ? browserTextWidthSource() : undefined);
  const fontsPending = options.measureText === undefined && fontsArePending();

  const divergences: LayoutDivergence[] = [];
  const skipCounts = new Map<DivergenceSkipReason, number>();
  let boxes = 0;
  let runs = 0;
  let lines = 0;
  let advances = 0;
  let fonts = 0;
  let decorations = 0;
  let objects = 0;

  const skip = (reason: DivergenceSkipReason): void => {
    skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);
  };

  const push = (draft: DivergenceDraft, deltaPx: number): void => {
    if (divergences.length >= maxDivergences) return;
    divergences.push({
      ...draft,
      documentHash: result.documentHash,
      engineWidthPx: scale.px(mp(draft.engineWidthMp)),
      deltaPx,
      tolerancePx,
      fontFileHash: undefined,
    });
  };

  const baseDraft = (page: number, blockId: number, lineId: number, runIndex: number): DivergenceDraft => ({
    kind: 'runBox',
    message: '',
    page,
    blockId,
    lineId,
    runIndex,
    docPos: undefined,
    engineWidthMp: 0,
    renderedWidthPx: 0,
    resolvedFontFamily: '',
    text: '',
  });

  const root = rendered.root;
  const sheets = Array.from(root.querySelectorAll<HTMLElement>(`[${ATTR.page}]`));
  const version = Number.parseInt(root.getAttribute(ATTR.version) ?? '', 10);
  const hash = root.getAttribute(ATTR.hash);
  if (version !== result.version || hash !== result.documentHash) {
    push(
      {
        ...baseDraft(-1, -1, -1, -1),
        kind: 'staleResult',
        message: `the painted DOM was produced from result version ${String(version)} hash ${String(hash)}`,
      },
      0,
    );
  }
  if (sheets.length !== result.pages.length) {
    push(
      {
        ...baseDraft(-1, -1, -1, -1),
        kind: 'pageCount',
        message: `painted ${sheets.length} page sheets for ${result.pages.length} page fragments`,
      },
      0,
    );
  }

  const boxMessage = (
    segmented: boolean,
    painted: readonly MeasuredRect[],
    engineLeftPx: number,
    engineTopPx: number,
    engineWidthPx: number,
  ): string => {
    if (segmented) {
      return (
        `painted boxes (${painted
          .map((rect) => `left ${rect.left}px width ${rect.width}px`)
          .join(', ')}) do not sit on the engine atom boundaries of a run the engine places at ` +
        `left ${engineLeftPx}px top ${engineTopPx}px width ${engineWidthPx}px`
      );
    }
    const rect = painted[0];
    return (
      `painted box (left ${rect?.left ?? 0}px top ${rect?.top ?? 0}px width ${rect?.width ?? 0}px) does not ` +
      `match the engine (left ${engineLeftPx}px top ${engineTopPx}px width ${engineWidthPx}px)`
    );
  };

  const checkRun = (
    page: PageFragment,
    sheet: HTMLElement,
    sheetRect: MeasuredRect,
    blockId: number,
    line: LineFragment,
    index: number,
    run: LineRun,
    paint: RunPaint | undefined,
  ): void => {
    runs += 1;
    if (paint === undefined) {
      skip('runWithoutPaint');
      return;
    }
    if (paint.hidden) {
      skip('hiddenRun');
      return;
    }
    if (run.object !== undefined) {
      skip('objectRun');
      return;
    }
    if (run.width === 0) {
      skip('zeroWidthRun');
      return;
    }
    const spec = runFontSpec(paint, scale);
    const found = Array.from(
      sheet.querySelectorAll<HTMLElement>(
        `[${ATTR.line}="${line.id}"][${ATTR.run}="${index}"]`,
      ),
    );
    if (found.length === 0) {
      push(
        {
          ...baseDraft(page.index, blockId, line.id, index),
          kind: 'missingRun',
          message: 'no painted box exists for this run',
          docPos: run.source.start,
          engineWidthMp: run.width,
          resolvedFontFamily: spec.family,
          text: run.text,
        },
        scale.px(run.width),
      );
      return;
    }
    const painted: MeasuredRect[] = [];
    for (const node of found) {
      const rect = rectOf(node);
      if (rect === undefined) {
        skip('unreadableBox');
        return;
      }
      painted.push(localRect(rect, sheetRect));
      boxes += 1;
    }
    const paintedWidth = painted.reduce((total, rect) => total + rect.width, 0);
    const paintedLeft = painted.reduce(
      (left, rect) => Math.min(left, rect.left),
      Number.POSITIVE_INFINITY,
    );
    const paintedTop = painted.reduce(
      (top, rect) => Math.min(top, rect.top),
      Number.POSITIVE_INFINITY,
    );
    const engineWidthPx = scale.px(run.width);
    const engineLeftPx = scale.px(mp(run.x - page.page.x));
    const engineTopPx = scale.px(mp(line.baselineY - run.ascent - page.page.y));
    const engineHeightPx = scale.px(mp(run.ascent + run.descent));
    const segmented = found.length > 1;
    const boundaries = segmented ? atomBoundaries(line, run, scale) : [];
    const edgeDelta = segmented
      ? painted.reduce(
          (worst, rect) =>
            Math.max(worst, boundaryGap(boundaries, rect.left), boundaryGap(boundaries, rect.left + rect.width)),
          0,
        )
      : 0;
    const widthDelta =
      segmented && paintedWidth <= engineWidthPx + tolerancePx
        ? 0
        : Math.abs(paintedWidth - engineWidthPx);
    const leftDelta = Math.abs(paintedLeft - engineLeftPx);
    const topDelta = Math.abs(paintedTop - engineTopPx);
    const heightDelta = Math.min(
      ...painted.map((rect) => Math.abs(rect.height - engineHeightPx)),
    );
    const worst = Math.max(widthDelta, leftDelta, topDelta, heightDelta, edgeDelta);
    if (worst > tolerancePx) {
      push(
        {
          ...baseDraft(page.index, blockId, line.id, index),
          kind: 'runBox',
          message: boxMessage(segmented, painted, engineLeftPx, engineTopPx, engineWidthPx),
          docPos: run.source.start,
          engineWidthMp: run.width,
          renderedWidthPx: paintedWidth,
          resolvedFontFamily: spec.family,
          text: run.text,
        },
        worst,
      );
      return;
    }
    const segments = segmentsOf(line, run, paint);
    if (found.length === segments.length) {
      found.forEach((node, segmentIndex) => {
        const segment = segments[segmentIndex];
        if (segment === undefined) return;
        const paintedSize = Number.parseFloat(node.style.fontSize);
        if (!Number.isFinite(paintedSize)) {
          skip('unreadableFontSize');
          return;
        }
        fonts += 1;
        const expectedSizePx = scale.px(segment.size);
        const sizeDelta = Math.abs(paintedSize - expectedSizePx);
        if (sizeDelta > tolerancePx) {
          push(
            {
              ...baseDraft(page.index, blockId, line.id, index),
              kind: 'runFontSize',
              message:
                `the painted box uses ${paintedSize} px where the engine resolves the atoms of ` +
                `"${segment.text}" to ${expectedSizePx} px`,
              docPos: run.source.start,
              engineWidthMp: segment.size,
              renderedWidthPx: paintedSize,
              resolvedFontFamily: spec.family,
              text: segment.text,
            },
            sizeDelta,
          );
        }
      });
    } else {
      skip('segmentCountMismatch');
    }
    if (found.length > 1 || needsSegmentation(run, paint)) {
      skip('segmentedRunAdvance');
      return;
    }
    if (paint.smallCaps) {
      skip('smallCapsAdvance');
      return;
    }
    if (HAS_CONTROL.test(run.text)) {
      skip('controlCharacterAdvance');
      return;
    }
    if (fontsPending) {
      skip('fontsPending');
      return;
    }
    const node = found[0];
    const paintedText = node === undefined || textWidthOf === undefined ? undefined : textWidthOf(node);
    const measured = paintedText ?? measureText?.measure(run.text, spec);
    if (measured === undefined) {
      skip(measureText === undefined ? 'noTextMeasurer' : 'unmeasurableText');
      return;
    }
    advances += 1;
    const advanceDelta = Math.abs(measured - engineWidthPx);
    if (advanceDelta > tolerancePx) {
      push(
        {
          ...baseDraft(page.index, blockId, line.id, index),
          kind: 'runAdvance',
          message:
            paintedText === undefined
              ? `the resolved font advances "${run.text}" to ${measured} px where the engine measured ` +
                `${engineWidthPx} px`
              : `the painted text "${run.text}" is ${measured} px wide where the engine lays the run ` +
                `out at ${engineWidthPx} px`,
          docPos: run.source.start,
          engineWidthMp: run.width,
          renderedWidthPx: measured,
          resolvedFontFamily: spec.family,
          text: run.text,
        },
        advanceDelta,
      );
    }
  };

  const checkObjects = (
    page: PageFragment,
    sheet: HTMLElement,
    sheetRect: MeasuredRect,
    blockId: number,
    line: LineFragment,
    index: number,
    run: LineRun,
  ): void => {
    if (run.object === undefined) return;
    const frame = frameOf(page.page);
    const origin = {
      originX: page.page.x,
      originY: page.page.y,
      originWidth: page.page.width,
      originHeight: page.page.height,
      contentX: page.contentBox.x,
      contentY: page.contentBox.y,
      contentWidth: page.contentBox.width,
      contentHeight: page.contentBox.height,
    };
    for (const atom of line.atoms) {
      const object = atom.object;
      if (object === undefined) continue;
      if (atom.source.start < run.source.start || atom.source.end > run.source.end) continue;
      objects += 1;
      const node = sheet.querySelector<HTMLElement>(`[${ATTR.object}="${String(atom.atomId)}"]`);
      const draft: DivergenceDraft = {
        ...baseDraft(page.index, blockId, line.id, index),
        docPos: atom.source.start,
        engineWidthMp: object.width,
        text: object.relationshipId ?? '',
      };
      if (node === null) {
        push(
          {
            ...draft,
            kind: 'missingImage',
            message:
              `the engine places an object of ${object.width} mp and the DOM paints nothing for it; ` +
              `${object.relationshipId === undefined ? 'an inline drawing without a relationship' : object.relationshipId} must be reported, not omitted`,
          },
          scale.px(object.width),
        );
        continue;
      }
      const rect = rectOf(node);
      if (rect === undefined) {
        skip('unreadableObjectBox');
        continue;
      }
      const local = localRect(rect, sheetRect);
      const box = objectBoxOf(line, run, atom, origin);
      const transformed =
        (node.ownerDocument.defaultView?.getComputedStyle(node).transform ?? 'none') !== 'none';
      const expected = geometryAt(
        transformed ? rotatedBounds(box, object.rotationMilliDegrees) : box,
        frame,
        scale,
      );
      const delta = rectDelta(expected, local);
      if (delta > tolerancePx) {
        push({ ...draft, kind: 'objectBox', message: rectMessage('the painted object box', expected, local) }, delta);
        continue;
      }
      if (!node.hasAttribute(ATTR.imageMissing)) continue;
      const label = (node.textContent ?? '').trim();
      const visible = label !== '' && (object.width <= 0 || (local.width > 0 && local.height > 0));
      if (!visible) {
        push(
          {
            ...draft,
            kind: 'missingImage',
            message: `the object at ${local.left}+${local.top} is reported as missing but carries no visible placeholder`,
          },
          0,
        );
      }
    }
  };

  const checkDecoration = (
    node: HTMLElement | null,
    page: PageFragment,
    sheetRect: MeasuredRect,
    area: Rect,
    shading: Shading | undefined,
    borders: BorderSet | undefined,
    identity: { readonly blockId: number; readonly lineId: number; readonly label: string },
  ): void => {
    const shaded = shadingColorOf(shading?.fill) !== undefined;
    const edged =
      borders === undefined
        ? false
        : BORDER_SIDES.some((side) => (borders[side]?.width ?? 0) > 0);
    if (!shaded && !edged) return;
    const frame = frameOf(page.page);
    const draft = baseDraft(page.index, identity.blockId, identity.lineId, -1);
    if (node === null) {
      decorations += 1;
      push(
        {
          ...draft,
          kind: 'decoration',
          message: `the engine paints ${identity.label} decoration and the DOM paints no node for it`,
          engineWidthMp: area.width,
        },
        scale.px(area.width),
      );
      return;
    }
    if (shaded) {
      decorations += 1;
      const painted = node.querySelector<HTMLElement>(`[${ATTR.shading}]`);
      const rect = painted === null ? undefined : rectOf(painted);
      const expected = geometryAt(area, frame, scale);
      if (rect === undefined) {
        push(
          {
            ...draft,
            kind: 'decoration',
            message:
              `the engine shades ${identity.label} over ${expected.left}+${expected.top} ` +
              `${expected.width}x${expected.height} px and the DOM paints no shading node`,
            engineWidthMp: area.width,
          },
          0,
        );
      } else {
        const local = localRect(rect, sheetRect);
        const delta = rectDelta(expected, local);
        if (delta > tolerancePx) {
          push({ ...draft, kind: 'decoration', message: rectMessage(`${identity.label} shading`, expected, local) }, delta);
        }
      }
    }
    if (borders === undefined) return;
    for (const side of BORDER_SIDES) {
      const edge = borders[side];
      if (edge === undefined || edge.width <= 0) continue;
      decorations += 1;
      const rects: MeasuredRect[] = [];
      for (const painted of Array.from(node.querySelectorAll<HTMLElement>(`[${ATTR.border}="${side}"]`))) {
        const rect = rectOf(painted);
        if (rect !== undefined) rects.push(localRect(rect, sheetRect));
      }
      const expected = geometryAt(edgeBandOf(area, side, edge.width), frame, scale);
      if (rects.length === 0) {
        push(
          {
            ...draft,
            kind: 'decoration',
            message:
              `the engine paints the ${side} border of ${identity.label} at ${expected.left}+${expected.top} ` +
              `${expected.width}x${expected.height} px and the DOM paints no border node`,
            engineWidthMp: edge.width,
          },
          0,
        );
        continue;
      }
      const union = unionOf(rects);
      const delta = rectDelta(expected, union);
      if (delta > tolerancePx) {
        push(
          {
            ...draft,
            kind: 'decoration',
            message: rectMessage(`${identity.label} ${side} border`, expected, union),
          },
          delta,
        );
      }
    }
  };

  const checkPageOrigins = (): void => {
    if (sheets.length === 0) return;
    const layer = root.querySelector<HTMLElement>(`[${ATTR.pages}]`);
    if (layer === null) {
      skip('pageLayerMissing');
      return;
    }
    const layerRect = rectOf(layer);
    if (layerRect === undefined) {
      skip('unreadablePageLayer');
      return;
    }
    const placements: ({ readonly left: number; readonly top: number } | undefined)[] = [];
    for (const sheet of sheets) {
      const rect = rectOf(sheet);
      placements.push(
        rect === undefined ? undefined : { left: rect.left - layerRect.left, top: rect.top - layerRect.top },
      );
    }
    if (placements.some((placement) => placement === undefined)) {
      skip('unreadablePageOrigin');
      return;
    }
    const placed = placements as readonly { readonly left: number; readonly top: number }[];
    const first = result.pages[0];
    if (first === undefined) return;
    let gapPx = 0;
    if (placed.length > 1) {
      const second = result.pages[1];
      if (second !== undefined) {
        gapPx =
          (placed[1]?.top ?? 0) -
          (placed[0]?.top ?? 0) -
          scale.px(mp(second.origin.y - first.origin.y));
      }
    }
    result.pages.forEach((page, index) => {
      const placement = placed[index];
      if (placement === undefined) return;
      const expectedLeft = scale.px(page.origin.x);
      const expectedTop = scale.px(page.origin.y) + gapPx * index;
      const delta = Math.max(Math.abs(placement.left - expectedLeft), Math.abs(placement.top - expectedTop));
      if (delta > tolerancePx) {
        push(
          {
            ...baseDraft(page.index, -1, -1, -1),
            kind: 'pageOrigin',
            message:
              `page ${page.index} sits at ${placement.left}+${placement.top} px in the document where the ` +
              `engine origin puts it at ${expectedLeft}+${expectedTop} px; the painted sheets carry a ` +
              `uniform ${gapPx} px gap on top of the engine origins`,
          },
          delta,
        );
      }
    });
  };

  const checkBlock = (
    page: PageFragment,
    sheet: HTMLElement,
    sheetRect: MeasuredRect,
    block: BlockFragment,
  ): void => {
    const blockNode = sheet.querySelector<HTMLElement>(`[${ATTR.block}="${String(block.id)}"]`);
    checkDecoration(blockNode, page, sheetRect, block.box, block.shading, block.borders, {
      blockId: block.id,
      lineId: -1,
      label: `paragraph ${String(block.id)}`,
    });
    for (const line of block.lines) {
      lines += 1;
      line.runs.forEach((run, index) => {
        checkRun(page, sheet, sheetRect, block.id, line, index, run, result.paint[run.paint]);
        checkObjects(page, sheet, sheetRect, block.id, line, index, run);
      });
    }
  };

  for (const page of result.pages) {
    const sheet = sheets[page.index];
    if (sheet === undefined) continue;
    const sheetRect = rectOf(sheet);
    if (sheetRect === undefined) {
      skip('unreadablePage');
      continue;
    }
    const widthDelta = Math.abs(sheetRect.width - scale.px(page.page.width));
    const heightDelta = Math.abs(sheetRect.height - scale.px(page.page.height));
    const sizeDelta = Math.max(widthDelta, heightDelta);
    if (sizeDelta > tolerancePx) {
      push(
        {
          ...baseDraft(page.index, -1, -1, -1),
          kind: 'pageSize',
          message:
            `page sheet is ${formatPx(sheetRect.width)}x${formatPx(sheetRect.height)} where the engine lays it ` +
            `out at ${formatPx(scale.px(page.page.width))}x${formatPx(scale.px(page.page.height))}`,
          engineWidthMp: page.page.width,
          renderedWidthPx: sheetRect.width,
        },
        sizeDelta,
      );
    }
    for (const block of page.blocks) {
      checkBlock(page, sheet, sheetRect, block);
    }
    for (const block of regionBlocks(page)) {
      checkBlock(page, sheet, sheetRect, block);
    }
    for (const table of page.tables) {
      const tableNode = sheet.querySelector<HTMLElement>(`[${ATTR.table}="${String(table.table)}"]`);
      checkDecoration(tableNode, page, sheetRect, table.box, table.shading, undefined, {
        blockId: -1,
        lineId: -1,
        label: `table ${String(table.table)}`,
      });
      for (const row of table.rows) {
        const rowNode = tableNode?.querySelector<HTMLElement>(`[${ATTR.row}="${String(row.row)}"]`) ?? null;
        for (const cell of row.cells) {
          const cellNode = rowNode?.querySelector<HTMLElement>(`[${ATTR.cell}="${String(cell.column)}"]`) ?? null;
          checkDecoration(cellNode, page, sheetRect, cell.box, cell.shading, cell.borders, {
            blockId: -1,
            lineId: -1,
            label: `cell ${String(cell.column)} of row ${String(row.row)}`,
          });
        }
      }
    }
  }

  checkPageOrigins();

  const strayRuns = Array.from(root.querySelectorAll<HTMLElement>(`[${ATTR.run}]`)).filter((node) => {
    const lineId = node.getAttribute(ATTR.line);
    return lineId === null;
  });
  for (const node of strayRuns) {
    push(
      {
        ...baseDraft(-1, -1, -1, -1),
        kind: 'strayRun',
        message: 'a painted run box carries no line identity and cannot be attributed to the engine',
        renderedWidthPx: rectOf(node)?.width ?? 0,
        resolvedFontFamily: node.style.fontFamily,
        text: node.textContent ?? '',
      },
      0,
    );
  }

  const skipped: readonly DivergenceSkip[] = Array.from(skipCounts, ([reason, count]) => ({
    reason,
    count,
    severity: SKIP_SEVERITY[reason],
  }));
  const complete = skipped.every((entry) => entry.severity === 'info');

  return {
    ok: divergences.length === 0 && complete,
    complete,
    documentHash: result.documentHash,
    version: result.version,
    zoom: rendered.zoom,
    zoomMode: rendered.zoomMode,
    tolerancePx,
    rectSource: readableRects ? 'browser' : 'style',
    authoritative: readableRects && complete,
    checked: { pages: sheets.length, lines, runs, boxes, advances, fonts, decorations, objects },
    skipped,
    divergences,
    gaps: RESULT_GAPS,
  };
};

export const awaitsFonts = (report: DivergenceReport): boolean =>
  report.skipped.some((entry) => entry.reason === 'fontsPending');

const unrunChecks = (report: DivergenceReport): string =>
  report.skipped
    .filter((entry) => entry.severity === 'warning')
    .map((entry) => `${entry.reason} x${String(entry.count)}`)
    .join(', ');

export const assertNoDivergence = (
  report: DivergenceReport,
  options: { readonly requireAuthoritative?: boolean } = {},
): void => {
  const unrun = unrunChecks(report);
  if (options.requireAuthoritative === true && !report.authoritative) {
    if (report.rectSource !== 'browser') {
      throw new Error('the divergence detector ran without browser layout; the check is not authoritative');
    }
    throw new Error(
      `the divergence detector could not run every check (${unrun}); the report is not authoritative`,
    );
  }
  if (report.divergences.length > 0) {
    const listed = report.divergences.map(formatDivergence).join('\n');
    const note = report.complete ? '' : `\nthe detector could not run: ${unrun}`;
    throw new Error(
      `layout diverged from the LayoutResult in ${report.divergences.length} place(s):\n${listed}${note}`,
    );
  }
  if (!report.complete) {
    throw new Error(`the divergence detector could not run every check: ${unrun}`);
  }
};
