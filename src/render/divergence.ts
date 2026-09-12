import type { LayoutResult, LineFragment, LineRun, PageFragment, RunPaint } from '../layout/index.js';
import { mp } from '../units/index.js';
import type {
  MeasuredRect,
  RectSource,
  RenderedDocument,
  RunFontSpec,
  TextAdvanceMeasurer,
  ZoomMode,
} from './types.js';
import type { PaintScale } from './scale.js';
import { paintScale } from './scale.js';
import { ATTR } from './dom.js';
import { fontShorthand, runFontSpec } from './style.js';
import { needsSegmentation } from './runs.js';

export const DEFAULT_TOLERANCE_PX = 0.5;
export const DEFAULT_MAX_DIVERGENCES = 100;

export const RESULT_GAPS: readonly string[] = [
  'fontFileHash',
  'perRunAscentAndDescent',
  'perAtomFontSize',
  'verticalShift',
  'pageOriginInDocument',
  'imageSourceAndSize',
  'paragraphDecorationRects',
];

export type DivergenceKind =
  | 'pageCount'
  | 'pageSize'
  | 'staleResult'
  | 'missingRun'
  | 'strayRun'
  | 'runBox'
  | 'runAdvance';

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
  readonly renderedWidthPx: number;
  readonly deltaPx: number;
  readonly tolerancePx: number;
  readonly resolvedFontFamily: string;
  readonly fontFileHash: string | undefined;
  readonly text: string;
}

export interface DivergenceSkip {
  readonly reason: string;
  readonly count: number;
}

export interface DivergenceChecked {
  readonly pages: number;
  readonly lines: number;
  readonly runs: number;
  readonly boxes: number;
  readonly advances: number;
}

export interface DivergenceReport {
  readonly ok: boolean;
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

const numeric = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const styleRectSource = (zoom: number): RectSource => (element) => {
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
  return { left: left * zoom, top: top * zoom, width: width * zoom, height: height * zoom };
};

export const canvasTextMeasurer = (): TextAdvanceMeasurer | undefined => {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (context === null) return undefined;
  const measure = (text: string, font: RunFontSpec): number | undefined => {
    context.font = fontShorthand(font);
    const metrics = context.measureText(text);
    return Number.isFinite(metrics.width) ? metrics.width : undefined;
  };
  return { measure };
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
        .map((rect) => `${rect.left}+${rect.width}`)
        .join(', ')}) do not sit on the engine atom boundaries of a run the engine places at ` +
      `left ${engineLeftPx} top ${engineTopPx} width ${engineWidthPx}`
    );
  }
  const rect = painted[0];
  return (
    `painted box (left ${rect?.left ?? 0} top ${rect?.top ?? 0} width ${rect?.width ?? 0}) does not ` +
    `match the engine (left ${engineLeftPx} top ${engineTopPx} width ${engineWidthPx})`
  );
};

const localRect = (rect: MeasuredRect, sheet: MeasuredRect): MeasuredRect => ({
  left: rect.left - sheet.left,
  top: rect.top - sheet.top,
  width: rect.width,
  height: rect.height,
});

export const formatDivergence = (divergence: LayoutDivergence): string =>
  `[${divergence.kind}] page ${divergence.page} line ${divergence.lineId} run ${divergence.runIndex}: ` +
  `${divergence.message} (engine ${divergence.engineWidthMp} mp, rendered ${divergence.renderedWidthPx} px, ` +
  `delta ${divergence.deltaPx} px, font ${divergence.resolvedFontFamily}, hash ${divergence.documentHash})`;

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
  const authoritative = options.rectOf !== undefined || browserAvailable;
  const rectOf: RectSource =
    options.rectOf ?? (browserAvailable ? browserRectSource() : styleRectSource(rendered.zoom));
  const measureText =
    options.measureText ?? (options.rectOf !== undefined ? undefined : canvasTextMeasurer());

  const divergences: LayoutDivergence[] = [];
  const skipCounts = new Map<string, number>();
  let boxes = 0;
  let runs = 0;
  let lines = 0;
  let advances = 0;

  const skip = (reason: string): void => {
    skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);
  };

  const push = (draft: DivergenceDraft, deltaPx: number): void => {
    if (divergences.length >= maxDivergences) return;
    divergences.push({
      ...draft,
      documentHash: result.documentHash,
      deltaPx,
      tolerancePx,
      fontFileHash: undefined,
    });
  };

  const root = rendered.root;
  const sheets = Array.from(root.querySelectorAll<HTMLElement>(`[${ATTR.page}]`));
  const version = Number.parseInt(root.getAttribute(ATTR.version) ?? '', 10);
  const hash = root.getAttribute(ATTR.hash);
  if (version !== result.version || hash !== result.documentHash) {
    push(
      {
        kind: 'staleResult',
        message: `the painted DOM was produced from result version ${String(version)} hash ${String(hash)}`,
        page: -1,
        blockId: -1,
        lineId: -1,
        runIndex: -1,
        docPos: undefined,
        engineWidthMp: 0,
        renderedWidthPx: 0,
        resolvedFontFamily: '',
        text: '',
      },
      0,
    );
  }
  if (sheets.length !== result.pages.length) {
    push(
      {
        kind: 'pageCount',
        message: `painted ${sheets.length} page sheets for ${result.pages.length} page fragments`,
        page: -1,
        blockId: -1,
        lineId: -1,
        runIndex: -1,
        docPos: undefined,
        engineWidthMp: 0,
        renderedWidthPx: sheets.length,
        resolvedFontFamily: '',
        text: '',
      },
      0,
    );
  }

  const checkRun = (
    page: PageFragment,
    sheet: HTMLElement,
    sheetRect: MeasuredRect,
    blockId: number,
    line: LineFragment,
    index: number,
    run: LineFragment['runs'][number],
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
    const spec = runFontSpec(paint, scale);
    const found = Array.from(
      sheet.querySelectorAll<HTMLElement>(
        `[${ATTR.line}="${line.id}"][${ATTR.run}="${index}"]`,
      ),
    );
    if (found.length === 0) {
      push(
        {
          kind: 'missingRun',
          message: 'no painted box exists for this run',
          page: page.index,
          blockId,
          lineId: line.id,
          runIndex: index,
          docPos: run.source.start,
          engineWidthMp: run.width,
          renderedWidthPx: 0,
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
    const engineTopPx = scale.px(mp(line.baselineY - line.ascent - page.page.y));
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
    const worst = Math.max(widthDelta, leftDelta, topDelta, edgeDelta);
    if (worst > tolerancePx) {
      push(
        {
          kind: 'runBox',
          message: boxMessage(segmented, painted, engineLeftPx, engineTopPx, engineWidthPx),
          page: page.index,
          blockId,
          lineId: line.id,
          runIndex: index,
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
    if (measureText === undefined) {
      skip('noTextMeasurer');
      return;
    }
    const measured = measureText.measure(run.text, spec);
    if (measured === undefined) {
      skip('unmeasurableText');
      return;
    }
    advances += 1;
    const advanceDelta = Math.abs(measured - engineWidthPx);
    if (advanceDelta > tolerancePx) {
      push(
        {
          kind: 'runAdvance',
          message:
            `the resolved font advances "${run.text}" to ${measured} px where the engine measured ` +
            `${engineWidthPx} px`,
          page: page.index,
          blockId,
          lineId: line.id,
          runIndex: index,
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
    if (widthDelta > 0 || heightDelta > 0) {
      push(
        {
          kind: 'pageSize',
          message: `page sheet is ${sheetRect.width}x${sheetRect.height} px, engine says ${scale.px(page.page.width)}x${scale.px(page.page.height)} px`,
          page: page.index,
          blockId: -1,
          lineId: -1,
          runIndex: -1,
          docPos: undefined,
          engineWidthMp: page.page.width,
          renderedWidthPx: sheetRect.width,
          resolvedFontFamily: '',
          text: '',
        },
        Math.max(widthDelta, heightDelta),
      );
    }
    for (const block of page.blocks) {
      for (const line of block.lines) {
        lines += 1;
        line.runs.forEach((run, index) => {
          checkRun(page, sheet, sheetRect, block.id, line, index, run, result.paint[run.paint]);
        });
      }
    }
  }

  const strayRuns = Array.from(root.querySelectorAll<HTMLElement>(`[${ATTR.run}]`)).filter((node) => {
    const lineId = node.getAttribute(ATTR.line);
    return lineId === null;
  });
  for (const node of strayRuns) {
    push(
      {
        kind: 'strayRun',
        message: 'a painted run box carries no line identity and cannot be attributed to the engine',
        page: -1,
        blockId: -1,
        lineId: -1,
        runIndex: -1,
        docPos: undefined,
        engineWidthMp: 0,
        renderedWidthPx: rectOf(node)?.width ?? 0,
        resolvedFontFamily: node.style.fontFamily,
        text: node.textContent ?? '',
      },
      0,
    );
  }

  return {
    ok: divergences.length === 0,
    documentHash: result.documentHash,
    version: result.version,
    zoom: rendered.zoom,
    zoomMode: rendered.zoomMode,
    tolerancePx,
    rectSource: authoritative ? 'browser' : 'style',
    authoritative,
    checked: { pages: sheets.length, lines, runs, boxes, advances },
    skipped: Array.from(skipCounts, ([reason, count]) => ({ reason, count })),
    divergences,
    gaps: RESULT_GAPS,
  };
};

export const assertNoDivergence = (
  report: DivergenceReport,
  options: { readonly requireAuthoritative?: boolean } = {},
): void => {
  if (options.requireAuthoritative === true && !report.authoritative) {
    throw new Error('the divergence detector ran without browser layout; the check is not authoritative');
  }
  if (report.ok) return;
  throw new Error(
    `layout diverged from the LayoutResult in ${report.divergences.length} place(s):\n` +
      report.divergences.map(formatDivergence).join('\n'),
  );
};
