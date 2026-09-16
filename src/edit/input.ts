import type { DocPos, DocRange, PageFragment } from '../layout/index.js';
import type { CaretGeometry, CommandRegistry, TextAffinity } from '../api/types.js';
import { ATTR } from '../render/dom.js';
import { MP_PER_TWIP, fromCssPx, mp, mpToTwip, toCssPx } from '../units/index.js';
import type { Mp } from '../units/index.js';
import type { CaretStopEntry, LineEntry, PositionIndex } from './positions.js';
import { caretGeometryOf, clientToPage, hitTestPage, pageToViewport, stopsOfLine } from './caret.js';
import type { SheetOffset } from './caret.js';
import type { EditSession } from './session.js';
import type { EditSelection } from './selection.js';
import { endOf, isCollapsed, rangeAsDocRange, startOf } from './selection.js';
import type { ObjectBox } from './objects.js';
import { clearObjectSelection, findObjectBox, objectBoxAt, objectSelectionOf } from './objects.js';
import type { HandleBox, ObjectHandle } from './object-resize.js';
import {
  HANDLE_CURSORS,
  HANDLE_SIZE_PX,
  OBJECT_HANDLES,
  handleAtPoint,
  handlePointsOf,
  startObjectResize,
} from './object-resize.js';
import type { ClipboardDataLike } from './clipboard/types.js';
import { firstImageFile, imageArgsOf } from './image-file.js';

export interface InputHost {
  readonly root: HTMLElement;
  readonly rendered: HTMLElement;
  readonly commands: CommandRegistry;
  readonly session: EditSession | undefined;
  readonly selection: EditSelection;
  readonly zoom: number;
}

export interface InputHandle {
  refresh(): void;
  reveal(): void;
  focus(): void;
  dispose(): void;
}

interface ClipboardEventLike {
  readonly clipboardData?: ClipboardDataLike | undefined;
}

interface DataTransferEventLike {
  readonly dataTransfer?: ClipboardDataLike | undefined;
  readonly clientX?: number | undefined;
  readonly clientY?: number | undefined;
}

const DRAG_THRESHOLD_PX = 4;
const OVERLAY_Z_INDEX = 2;
const COMPOSER_Z_INDEX = 3;
const GUIDE_Z_INDEX = 4;
const CARET_BLINK_MS = 530;
const CARET_RETRY_MS = 16;
const CARET_WATCHDOG_MS = 250;
const COLUMN_EDGE_PX = 5;
const MIN_COLUMN_WIDTH_MP = mp(120 * MP_PER_TWIP);
const MIN_ROW_HEIGHT_MP = mp(120 * MP_PER_TWIP);
const MIN_TABLE_WIDTH_MP = mp(240 * MP_PER_TWIP);

export interface ColumnEdge {
  readonly table: number;
  readonly column: number;
  readonly x: Mp;
  readonly width: Mp;
  readonly widths: readonly number[];
}

export interface TableWidthEdge {
  readonly table: number;
  readonly side: 'left' | 'right';
  readonly x: Mp;
  readonly width: Mp;
  readonly columns: readonly number[];
}

type TableEdge =
  | ({ readonly kind: 'column' } & ColumnEdge)
  | ({ readonly kind: 'row' } & RowEdge)
  | ({ readonly kind: 'table' } & TableWidthEdge);

export interface RowEdge {
  readonly table: number;
  readonly row: number;
  readonly y: Mp;
  readonly height: Mp;
}

export const tableWidthEdgeInPage = (
  page: PageFragment,
  point: { readonly x: Mp; readonly y: Mp },
  tolerance: Mp,
): TableWidthEdge | undefined => {
  let best: TableWidthEdge | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const table of page.tables) {
    const box = table.box;
    if (point.y < box.y || point.y > box.y + box.height) continue;
    const left = box.x;
    const right = mp(box.x + box.width);
    const candidates: readonly { readonly side: 'left' | 'right'; readonly x: Mp }[] = [
      { side: 'left', x: left },
      { side: 'right', x: right },
    ];
    for (const candidate of candidates) {
      const distance = Math.abs((point.x as number) - (candidate.x as number));
      if (distance > (tolerance as number) || distance >= bestDistance) continue;
      bestDistance = distance;
      best = {
        table: table.table,
        side: candidate.side,
        x: candidate.x,
        width: box.width,
        columns: table.columns.map((value) => mpToTwip(value)),
      };
    }
  }
  return best;
};

export const rowEdgeInPage = (
  page: PageFragment,
  point: { readonly x: Mp; readonly y: Mp },
  tolerance: Mp,
): RowEdge | undefined => {
  let best: RowEdge | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const table of page.tables) {
    for (const row of table.rows) {
      for (const cell of row.cells) {
        if (point.x < cell.box.x || point.x > cell.box.x + cell.box.width) continue;
        const bottom = mp(cell.box.y + cell.box.height);
        const distance = Math.abs((point.y as number) - (bottom as number));
        if (distance > (tolerance as number) || distance >= bestDistance) continue;
        bestDistance = distance;
        best = { table: row.table, row: row.row, y: bottom, height: cell.box.height };
      }
    }
  }
  return best;
};

export const columnEdgeInPage = (
  page: PageFragment,
  point: { readonly x: Mp; readonly y: Mp },
  tolerance: Mp,
): ColumnEdge | undefined => {
  let best: ColumnEdge | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const table of page.tables) {
    for (const row of table.rows) {
      for (const cell of row.cells) {
        if (point.y < cell.box.y || point.y > cell.box.y + cell.box.height) continue;
        const right = mp(cell.box.x + cell.box.width);
        const distance = Math.abs((point.x as number) - (right as number));
        if (distance > (tolerance as number) || distance >= bestDistance) continue;
        bestDistance = distance;
        const widths: number[] = [];
        for (const sibling of row.cells) {
          const span = Math.max(1, sibling.columnSpan);
          const share = Math.round(mpToTwip(sibling.box.width) / span);
          for (let index = 0; index < span; index += 1) widths[sibling.column + index] = share;
        }
        best = {
          table: row.table,
          column: cell.column + cell.columnSpan - 1,
          x: right,
          width: cell.box.width,
          widths,
        };
      }
    }
  }
  return best;
};

const clipboardDataOf = (event: Event): ClipboardDataLike | undefined =>
  (event as unknown as ClipboardEventLike).clipboardData;

const dataTransferOf = (event: Event): ClipboardDataLike | undefined =>
  (event as unknown as DataTransferEventLike).dataTransfer;

const buttonOf = (event: Event): number => {
  const value = (event as unknown as { readonly button?: number }).button;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const clientPointOf = (
  event: Event,
): { readonly x: number; readonly y: number } | undefined => {
  const like = event as unknown as DataTransferEventLike;
  if (typeof like.clientX !== 'number' || typeof like.clientY !== 'number') return undefined;
  if (!Number.isFinite(like.clientX) || !Number.isFinite(like.clientY)) return undefined;
  return { x: like.clientX, y: like.clientY };
};

interface KeyRule {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
  readonly command: string;
  readonly movement?: boolean;
}

const PREFIX = 'docier.command.';

const KEY_RULES: readonly KeyRule[] = [
  { key: 'ArrowLeft', command: `${PREFIX}selection.moveLeft`, movement: true },
  { key: 'ArrowRight', command: `${PREFIX}selection.moveRight`, movement: true },
  { key: 'ArrowLeft', ctrl: true, command: `${PREFIX}selection.moveWordLeft`, movement: true },
  { key: 'ArrowRight', ctrl: true, command: `${PREFIX}selection.moveWordRight`, movement: true },
  { key: 'ArrowUp', command: `${PREFIX}selection.moveUp`, movement: true },
  { key: 'ArrowDown', command: `${PREFIX}selection.moveDown`, movement: true },
  { key: 'ArrowUp', ctrl: true, command: `${PREFIX}selection.moveParagraphStart`, movement: true },
  { key: 'ArrowDown', ctrl: true, command: `${PREFIX}selection.moveParagraphEnd`, movement: true },
  { key: 'Home', command: `${PREFIX}selection.moveLineStart`, movement: true },
  { key: 'End', command: `${PREFIX}selection.moveLineEnd`, movement: true },
  { key: 'Home', ctrl: true, command: `${PREFIX}selection.moveStoryStart`, movement: true },
  { key: 'End', ctrl: true, command: `${PREFIX}selection.moveStoryEnd`, movement: true },
  { key: 'Backspace', command: `${PREFIX}edit.deleteBackward` },
  { key: 'Backspace', ctrl: true, command: `${PREFIX}edit.deleteWordBackward` },
  { key: 'Delete', command: `${PREFIX}edit.deleteForward` },
  { key: 'Delete', ctrl: true, command: `${PREFIX}edit.deleteWordForward` },
  { key: 'Enter', command: `${PREFIX}edit.splitParagraph` },
  { key: 'Enter', shift: true, command: `${PREFIX}edit.insertLineBreak` },
  { key: 'Enter', ctrl: true, command: `${PREFIX}edit.insertPageBreak` },
  { key: 'Enter', ctrl: true, shift: true, command: `${PREFIX}edit.insertColumnBreak` },
  { key: 'a', ctrl: true, command: `${PREFIX}edit.selectAll` },
  { key: 'b', ctrl: true, command: `${PREFIX}format.bold` },
  { key: 'i', ctrl: true, command: `${PREFIX}format.italic` },
  { key: 'u', ctrl: true, command: `${PREFIX}format.underline` },
  { key: 'v', ctrl: true, shift: true, command: `${PREFIX}clipboard.pastePlain` },
  { key: 'z', ctrl: true, command: `${PREFIX}history.undo` },
  { key: 'z', ctrl: true, shift: true, command: `${PREFIX}history.redo` },
  { key: 'y', ctrl: true, command: `${PREFIX}history.redo` },
  { key: ' ', ctrl: true, command: `${PREFIX}format.clearCharacterFormatting` },
  { key: 'q', ctrl: true, command: `${PREFIX}format.clearParagraphFormatting` },
  { key: 'l', ctrl: true, command: `${PREFIX}format.alignLeft` },
  { key: 'e', ctrl: true, command: `${PREFIX}format.alignCenter` },
  { key: 'r', ctrl: true, command: `${PREFIX}format.alignRight` },
  { key: 'j', ctrl: true, command: `${PREFIX}format.alignJustify` },
];

const CLEARING_PREFIXES: readonly string[] = [`${PREFIX}edit.`, `${PREFIX}selection.`];

const INPUT_COMMANDS: Readonly<Record<string, string>> = {
  insertText: `${PREFIX}edit.insertText`,
  insertLineBreak: `${PREFIX}edit.insertLineBreak`,
  insertParagraph: `${PREFIX}edit.splitParagraph`,
  deleteContentBackward: `${PREFIX}edit.deleteBackward`,
  deleteContentForward: `${PREFIX}edit.deleteForward`,
  deleteWordBackward: `${PREFIX}edit.deleteWordBackward`,
  deleteWordForward: `${PREFIX}edit.deleteWordForward`,
};

const isMacPlatform = (): boolean =>
  (globalThis.navigator?.platform ?? '').toLowerCase().includes('mac');

const matchesRule = (rule: KeyRule, event: KeyboardEvent, mac: boolean): boolean => {
  const primary = mac ? event.metaKey : event.ctrlKey;
  const shift = rule.movement === true ? true : (rule.shift ?? false) === event.shiftKey;
  return (
    rule.key === event.key &&
    (rule.ctrl ?? false) === primary &&
    shift &&
    (rule.alt ?? false) === event.altKey &&
    (rule.meta ?? false) === (!mac && event.metaKey)
  );
};

const applyStyle = (node: HTMLElement, values: Readonly<Record<string, string>>): void => {
  for (const [name, value] of Object.entries(values)) node.style.setProperty(name, value);
};

const pageBox = (
  sheet: HTMLElement,
): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } => {
  const rect = sheet.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
};

export const attachInput = (host: InputHost): InputHandle => {
  const owner = host.root.ownerDocument;
  let disposed = false;
  const overlay = owner.createElement('div');
  overlay.className = 'docier-overlay';
  applyStyle(overlay, {
    position: 'absolute',
    left: '0',
    top: '0',
    right: '0',
    bottom: '0',
    'pointer-events': 'none',
    overflow: 'hidden',
    'z-index': String(OVERLAY_Z_INDEX),
  });
  const selectionLayer = owner.createElement('div');
  const caret = owner.createElement('div');
  caret.className = 'docier-caret';
  applyStyle(caret, {
    position: 'absolute',
    width: '1px',
    'background-color': '#000',
    display: 'none',
  });
  const blink =
    typeof caret.animate === 'function'
      ? caret.animate(
          [
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.5 },
            { opacity: 0, offset: 0.5 },
            { opacity: 0, offset: 1 },
          ],
          { duration: CARET_BLINK_MS * 2, iterations: Number.POSITIVE_INFINITY },
        )
      : undefined;
  const objectLayer = owner.createElement('div');
  objectLayer.className = 'docier-object-layer';
  applyStyle(objectLayer, { position: 'absolute', left: '0', top: '0' });
  const objectFrame = owner.createElement('div');
  objectFrame.className = 'docier-object-frame';
  applyStyle(objectFrame, {
    position: 'absolute',
    display: 'none',
    outline: '1px solid var(--docier-accent, #1f6feb)',
  });
  const handleNodes = new Map<ObjectHandle, HTMLElement>();
  for (const handle of OBJECT_HANDLES) {
    const node = owner.createElement('div');
    node.className = `docier-object-handle docier-object-handle-${handle}`;
    applyStyle(node, {
      position: 'absolute',
      display: 'none',
      width: `${String(HANDLE_SIZE_PX)}px`,
      height: `${String(HANDLE_SIZE_PX)}px`,
      'background-color': 'var(--docier-surface, #ffffff)',
      border: '1px solid var(--docier-accent, #1f6feb)',
      'border-radius': '1px',
      'box-shadow': '0 0 0 1px rgba(255, 255, 255, 0.9)',
      'box-sizing': 'border-box',
    });
    handleNodes.set(handle, node);
    objectLayer.appendChild(node);
  }
  objectLayer.appendChild(objectFrame);
  overlay.appendChild(selectionLayer);
  overlay.appendChild(caret);
  overlay.appendChild(objectLayer);
  host.rendered.appendChild(overlay);

  const composer = owner.createElement('div');
  composer.className = 'docier-input';
  composer.setAttribute('contenteditable', 'true');
  composer.setAttribute('autocorrect', 'off');
  composer.setAttribute('autocapitalize', 'off');
  composer.setAttribute('spellcheck', 'false');
  composer.setAttribute('aria-hidden', 'true');
  applyStyle(composer, {
    position: 'absolute',
    opacity: '0',
    width: '1px',
    height: '1em',
    overflow: 'hidden',
    'z-index': String(COMPOSER_Z_INDEX),
    'caret-color': 'transparent',
    outline: 'none',
    'white-space': 'pre',
  });
  host.rendered.appendChild(composer);

  const index = (): PositionIndex | undefined => host.session?.index;

  const sheets = (): readonly HTMLElement[] =>
    Array.from(host.rendered.querySelectorAll<HTMLElement>(`[${ATTR.page}]`)).sort(
      (first, second) =>
        Number(first.getAttribute(ATTR.page) ?? '0') -
        Number(second.getAttribute(ATTR.page) ?? '0'),
    );

  const sheetFor = (page: number): HTMLElement | undefined =>
    sheets().find((sheet) => Number(sheet.getAttribute(ATTR.page) ?? '-1') === page);

  const pageFragmentOf = (page: number): PageFragment | undefined =>
    host.session?.layout.pages.find((candidate) => candidate.index === page);

  const originOf = (sheet: HTMLElement): SheetOffset => {
    const base = host.rendered.getBoundingClientRect();
    const box = pageBox(sheet);
    return { left: box.left - base.left, top: box.top - base.top };
  };

  const clearChildren = (node: HTMLElement): void => {
    while (node.firstChild !== null) node.removeChild(node.firstChild);
  };

  const xAt = (
    positions: PositionIndex,
    line: LineEntry,
    pos: DocPos,
    affinity: TextAffinity,
  ): Mp => {
    const stops = stopsOfLine(positions, line);
    const first: CaretStopEntry | undefined = stops[0];
    const last: CaretStopEntry | undefined = stops[stops.length - 1];
    if (first === undefined || last === undefined) return line.box.x;
    if ((pos as number) <= (first.pos as number)) return first.x;
    if ((pos as number) >= (last.pos as number)) return last.x;
    if (affinity === 'downstream') {
      for (const stop of stops) {
        if ((stop.pos as number) >= (pos as number)) return stop.x;
      }
      return last.x;
    }
    let found = first;
    for (const stop of stops) {
      if ((stop.pos as number) <= (pos as number)) found = stop;
    }
    return found.x;
  };

  const caretOf = (): CaretGeometry | undefined => {
    const positions = index();
    if (positions === undefined) return undefined;
    return caretGeometryOf(
      positions,
      host.selection.focus,
      host.selection.affinity,
      host.selection.page,
    );
  };

  const scrollerOf = (): HTMLElement | undefined => {
    let node: HTMLElement | null = host.rendered.parentElement;
    while (node !== null) {
      const overflow = host.root.ownerDocument.defaultView?.getComputedStyle(node).overflowY ?? '';
      if (overflow === 'auto' || overflow === 'scroll') return node;
      node = node.parentElement;
    }
    return undefined;
  };

  const scrollCaretIntoView = (hasGeometry: boolean): void => {
    const scroller = scrollerOf();
    if (scroller === undefined || !hasGeometry) return;
    const caretBox = caret.getBoundingClientRect();
    if (caretBox.height === 0) return;
    const view = scroller.getBoundingClientRect();
    const margin = Math.max(8, caretBox.height);
    const above = view.top + margin - caretBox.top;
    const below = caretBox.bottom + margin - view.bottom;
    if (above <= 0 && below <= 0) return;
    scroller.scrollTop += above > 0 ? -above : below;
  };

  let caretRetry: number | undefined;
  const retryCaret = (): void => {
    if (caretRetry !== undefined) return;
    const win = owner.defaultView;
    if (win === null) return;
    caretRetry = win.setTimeout(() => {
      caretRetry = undefined;
      paintCaret();
    }, CARET_RETRY_MS);
  };

  const paintCaret = (): boolean => {
    const geometry = caretOf();
    if (geometry === undefined) {
      caret.style.display = 'none';
      retryCaret();
      return false;
    }
    const page = pageFragmentOf(geometry.page);
    const sheet = sheetFor(geometry.page);
    if (page === undefined || sheet === undefined) {
      caret.style.display = 'none';
      retryCaret();
      return false;
    }
    const zoom = host.zoom;
    const offset = originOf(sheet);
    const point = pageToViewport(page, offset, geometry.x, geometry.y, zoom);
    const height = toCssPx(geometry.height, zoom);
    caret.style.display = selectedObject() === undefined ? 'block' : 'none';
    if (caret.style.display === 'block' && blink !== undefined) {
      const at = Number(blink.currentTime ?? 0);
      if (!Number.isFinite(at) || at >= CARET_BLINK_MS) blink.currentTime = 0;
      if (blink.playState === 'finished' || blink.playState === 'idle') blink.play();
    }
    applyStyle(caret, {
      left: `${String(point.left)}px`,
      top: `${String(point.top)}px`,
      height: `${String(height)}px`,
    });
    composer.style.display = 'block';
    applyStyle(composer, {
      left: `${String(point.left)}px`,
      top: `${String(point.top)}px`,
      height: `${String(height)}px`,
    });
    return true;
  };

  const selectedObject = (): string | undefined => {
    const session = host.session;
    return session === undefined ? undefined : objectSelectionOf(session);
  };

  const paintSelection = (): void => {
    clearChildren(selectionLayer);
    const positions = index();
    const current = host.selection;
    if (positions === undefined || isCollapsed(current)) return;
    if (selectedObject() !== undefined) return;
    const start = startOf(current);
    const end = endOf(current);
    const zoom = host.zoom;
    for (const line of positions.lines) {
      if ((line.end as number) <= (start as number)) continue;
      if ((line.start as number) >= (end as number)) continue;
      const page = pageFragmentOf(line.page);
      const sheet = sheetFor(line.page);
      if (page === undefined || sheet === undefined) continue;
      const offset = originOf(sheet);
      const from = xAt(positions, line, start, 'downstream');
      const to = xAt(positions, line, end, 'upstream');
      const corner = pageToViewport(page, offset, from, line.box.y, zoom);
      const box = owner.createElement('div');
      applyStyle(box, {
        position: 'absolute',
        left: `${String(corner.left)}px`,
        top: `${String(corner.top)}px`,
        width: `${String(Math.max(0, toCssPx(mp(to - from), zoom)))}px`,
        height: `${String(toCssPx(line.box.height, zoom))}px`,
        'background-color': 'var(--docier-selection, rgba(31, 111, 235, 0.34))',
      });
      selectionLayer.appendChild(box);
    }
  };

  const hitTest = (
    clientX: number,
    clientY: number,
  ): { readonly pos: DocPos; readonly affinity: TextAffinity; readonly page: number } | undefined => {
    const positions = index();
    if (positions === undefined) return undefined;
    for (const sheet of sheets()) {
      const box = pageBox(sheet);
      if (clientX < box.left || clientX > box.left + box.width) continue;
      if (clientY < box.top || clientY > box.top + box.height) continue;
      const pageIndex = Number(sheet.getAttribute(ATTR.page) ?? '-1');
      const page = pageFragmentOf(pageIndex);
      if (page === undefined) return undefined;
      const point = clientToPage(
        page,
        { left: box.left, top: box.top },
        clientX,
        clientY,
        host.zoom,
      );
      const hit = hitTestPage(positions, pageIndex, point);
      return hit === undefined ? undefined : { pos: hit.pos, affinity: hit.affinity, page: hit.page };
    }
    return undefined;
  };

  const objectFrameBox = (): HandleBox | undefined => {
    const id = selectedObject();
    const session = host.session;
    if (id === undefined || session === undefined) return undefined;
    const found = findObjectBox(session.layout, id);
    if (found === undefined) return undefined;
    const page = pageFragmentOf(found.page);
    const sheet = sheetFor(found.page);
    if (page === undefined || sheet === undefined) return undefined;
    const corner = pageToViewport(
      page,
      originOf(sheet),
      found.box.x,
      found.box.y,
      host.zoom,
    );
    return {
      left: corner.left,
      top: corner.top,
      width: toCssPx(found.box.width, host.zoom),
      height: toCssPx(found.box.height, host.zoom),
    };
  };

  const paintObjectHandles = (): void => {
    const box = objectFrameBox();
    if (box === undefined) {
      objectFrame.style.display = 'none';
      for (const node of handleNodes.values()) node.style.display = 'none';
      return;
    }
    applyStyle(objectFrame, {
      display: 'block',
      left: `${String(box.left)}px`,
      top: `${String(box.top)}px`,
      width: `${String(box.width)}px`,
      height: `${String(box.height)}px`,
    });
    for (const point of handlePointsOf(box)) {
      const node = handleNodes.get(point.handle);
      if (node === undefined) continue;
      applyStyle(node, {
        display: 'block',
        left: `${String(point.x - HANDLE_SIZE_PX / 2)}px`,
        top: `${String(point.y - HANDLE_SIZE_PX / 2)}px`,
      });
    }
  };

  const surfacePointOf = (
    clientX: number,
    clientY: number,
  ): { readonly x: number; readonly y: number } => {
    const base = host.rendered.getBoundingClientRect();
    return { x: clientX - base.left, y: clientY - base.top };
  };

  const objectHandleAt = (clientX: number, clientY: number): ObjectHandle | undefined => {
    const box = objectFrameBox();
    if (box === undefined) return undefined;
    const point = surfacePointOf(clientX, clientY);
    return handleAtPoint(box, point.x, point.y);
  };

  const objectAtPoint = (clientX: number, clientY: number): ObjectBox | undefined => {
    if (index() === undefined) return undefined;
    const zoom = host.zoom === 0 ? 1 : host.zoom;
    for (const sheet of sheets()) {
      const box = pageBox(sheet);
      if (clientX < box.left || clientX > box.left + box.width) continue;
      if (clientY < box.top || clientY > box.top + box.height) continue;
      const pageIndex = Number(sheet.getAttribute(ATTR.page) ?? '-1');
      const page = pageFragmentOf(pageIndex);
      if (page === undefined) return undefined;
      const point = clientToPage(page, { left: box.left, top: box.top }, clientX, clientY, zoom);
      return objectBoxAt(page, point);
    }
    return undefined;
  };

  const objectElementOf = (objectId: string): HTMLElement | undefined => {
    for (const node of host.rendered.querySelectorAll<HTMLElement>(`[${ATTR.objectId}]`)) {
      if (node.getAttribute(ATTR.objectId) === objectId) return node;
    }
    return undefined;
  };

  const dropObjectSelection = (): void => {
    const session = host.session;
    if (session === undefined || objectSelectionOf(session) === undefined) return;
    clearObjectSelection(session);
    paintObjectHandles();
    paintSelection();
  };

  const startResize = (handle: ObjectHandle, event: PointerEvent): void => {
    const session = host.session;
    const id = selectedObject();
    if (session === undefined || id === undefined) return;
    const found = findObjectBox(session.layout, id);
    if (found === undefined) return;
    event.preventDefault();
    composer.focus({ preventScroll: true });
    startObjectResize({
      document: owner,
      handle,
      box: found.box,
      zoom: host.zoom,
      clientX: event.clientX,
      clientY: event.clientY,
      target: objectElementOf(id),
      commit: ({ widthTwips, heightTwips }) => {
        run(`${PREFIX}object.setSize`, { objectId: id, widthTwips, heightTwips });
        paintObjectHandles();
        paintCaret();
      },
    });
  };

  let dragging = false;
  let columnGuide: HTMLElement | undefined;
  let armed: { readonly from: DocRange; readonly x: number; readonly y: number } | undefined =
    undefined;
  let dragSource: DocRange | undefined = undefined;
  let dropPos: DocPos | undefined = undefined;
  let armedObject: { readonly range: DocRange; readonly x: number; readonly y: number } | undefined =
    undefined;

  const run = (command: string, args?: unknown): void => {
    void host.commands.execute(command, args);
  };

  const tableEdgeAt = (clientX: number, clientY: number): TableEdge | undefined => {
    if (index() === undefined) return undefined;
    const zoom = host.zoom === 0 ? 1 : host.zoom;
    const tolerance = fromCssPx(COLUMN_EDGE_PX, zoom);
    for (const sheet of sheets()) {
      const box = pageBox(sheet);
      if (clientX < box.left || clientX > box.left + box.width) continue;
      if (clientY < box.top || clientY > box.top + box.height) continue;
      const pageIndex = Number(sheet.getAttribute(ATTR.page) ?? '-1');
      const page = pageFragmentOf(pageIndex);
      if (page === undefined) return undefined;
      const point = clientToPage(page, { left: box.left, top: box.top }, clientX, clientY, zoom);
      const table = tableWidthEdgeInPage(page, point, tolerance);
      if (table !== undefined) return { kind: 'table', ...table };
      const column = columnEdgeInPage(page, point, tolerance);
      const row = rowEdgeInPage(page, point, tolerance);
      if (column !== undefined && row !== undefined) {
        const columnDistance = Math.abs((point.x as number) - (column.x as number));
        const rowDistance = Math.abs((point.y as number) - (row.y as number));
        return rowDistance < columnDistance ? { kind: 'row', ...row } : { kind: 'column', ...column };
      }
      if (row !== undefined) return { kind: 'row', ...row };
      if (column !== undefined) return { kind: 'column', ...column };
      return undefined;
    }
    return undefined;
  };

  const guideFor = (kind: 'column' | 'row'): HTMLElement => {
    if (columnGuide === undefined) {
      columnGuide = owner.createElement('div');
      columnGuide.className = 'docier-column-guide';
      host.rendered.appendChild(columnGuide);
    }
    const shared = `position:absolute;z-index:${String(GUIDE_Z_INDEX)};pointer-events:none;background-color:var(--docier-accent,#185abd);`;
    columnGuide.style.cssText =
      kind === 'column'
        ? `${shared}top:0;bottom:0;width:1px;`
        : `${shared}left:0;right:0;height:1px;`;
    return columnGuide;
  };

  const startRowDrag = (edge: RowEdge, event: PointerEvent): void => {
    const zoom = host.zoom === 0 ? 1 : host.zoom;
    const anchor = hitTest(event.clientX, event.clientY)?.pos;
    const startY = event.clientY;
    const base = edge.height;
    const guide = guideFor('row');
    const baseBox = host.rendered.getBoundingClientRect();
    let pending = mpToTwip(base);
    guide.hidden = false;

    const onMove = (moveEvent: PointerEvent): void => {
      const delta = fromCssPx(moveEvent.clientY - startY, zoom);
      const height = mp(
        Math.max(MIN_ROW_HEIGHT_MP as number, (base as number) + (delta as number)) as number,
      );
      pending = mpToTwip(height);
      guide.style.top = `${String(Math.round(moveEvent.clientY - baseBox.top))}px`;
    };
    const finish = (): void => {
      guide.hidden = true;
      owner.removeEventListener('pointermove', onMove);
      owner.removeEventListener('pointerup', finish);
      owner.removeEventListener('pointercancel', finish);
      if (pending !== mpToTwip(base)) {
        run(`${PREFIX}table.setRowHeight`, {
          row: edge.row,
          heightTwips: pending,
          ...(anchor === undefined ? {} : { anchor }),
        });
      }
    };
    guide.style.top = `${String(Math.round(event.clientY - baseBox.top))}px`;
    owner.addEventListener('pointermove', onMove);
    owner.addEventListener('pointerup', finish);
    owner.addEventListener('pointercancel', finish);
    event.preventDefault();
  };

  const startEdgeDrag = (edge: TableEdge, event: PointerEvent): void => {
    if (edge.kind === 'row') {
      startRowDrag(edge, event);
      return;
    }
    if (edge.kind === 'table') {
      startTableWidthDrag(edge, event);
      return;
    }
    startColumnDrag(edge, event);
  };

  const startTableWidthDrag = (edge: TableWidthEdge, event: PointerEvent): void => {
    const zoom = host.zoom === 0 ? 1 : host.zoom;
    const anchor = hitTest(event.clientX, event.clientY)?.pos;
    const startX = event.clientX;
    const base = edge.width;
    const direction = edge.side === 'right' ? 1 : -1;
    const guide = guideFor('column');
    const baseBox = host.rendered.getBoundingClientRect();
    let pending = mpToTwip(base);
    guide.hidden = false;

    const onMove = (moveEvent: PointerEvent): void => {
      const delta = fromCssPx(direction * (moveEvent.clientX - startX), zoom);
      const width = mp(Math.max(MIN_TABLE_WIDTH_MP as number, (base as number) + (delta as number)) as number);
      pending = mpToTwip(width);
      guide.style.left = `${String(
        Math.round(moveEvent.clientX - baseBox.left - (direction > 0 ? 0 : 1)),
      )}px`;
    };
    const finish = (): void => {
      guide.hidden = true;
      owner.removeEventListener('pointermove', onMove);
      owner.removeEventListener('pointerup', finish);
      owner.removeEventListener('pointercancel', finish);
      if (pending !== mpToTwip(base)) {
        run(`${PREFIX}table.setWidth`, {
          widthTwips: pending,
          fromWidths: edge.columns,
          ...(anchor === undefined ? {} : { anchor }),
        });
      }
    };
    guide.style.left = `${String(
      Math.round(event.clientX - baseBox.left - (direction > 0 ? 0 : 1)),
    )}px`;
    owner.addEventListener('pointermove', onMove);
    owner.addEventListener('pointerup', finish);
    owner.addEventListener('pointercancel', finish);
    event.preventDefault();
  };

  const startColumnDrag = (edge: ColumnEdge, event: PointerEvent): void => {
    const zoom = host.zoom === 0 ? 1 : host.zoom;
    const anchor = hitTest(event.clientX, event.clientY)?.pos;
    const startX = event.clientX;
    const base = edge.width;
    const guide = guideFor('column');
    const baseBox = host.rendered.getBoundingClientRect();
    let pending = mpToTwip(base);
    const widths = [...edge.widths];
    guide.hidden = false;

    const onMove = (moveEvent: PointerEvent): void => {
      const delta = fromCssPx(moveEvent.clientX - startX, zoom);
      const width = mp(Math.max(MIN_COLUMN_WIDTH_MP as number, (base as number) + (delta as number)) as number);
      pending = mpToTwip(width);
      widths[edge.column] = pending;
      guide.style.left = `${String(Math.round(moveEvent.clientX - baseBox.left))}px`;
    };
    const finish = (): void => {
      guide.hidden = true;
      owner.removeEventListener('pointermove', onMove);
      owner.removeEventListener('pointerup', finish);
      owner.removeEventListener('pointercancel', finish);
      if (pending !== mpToTwip(base)) {
        run(`${PREFIX}table.setColumnWidth`, {
          column: edge.column,
          widthTwips: pending,
          widths,
          ...(anchor === undefined ? {} : { anchor }),
        });
      }
    };
    guide.style.left = `${String(Math.round(event.clientX - baseBox.left))}px`;
    owner.addEventListener('pointermove', onMove);
    owner.addEventListener('pointerup', finish);
    owner.addEventListener('pointercancel', finish);
    event.preventDefault();
  };

  const onHover = (event: PointerEvent): void => {
    if (dragging) return;
    const handle = objectHandleAt(event.clientX, event.clientY);
    if (handle !== undefined) {
      host.rendered.style.cursor = HANDLE_CURSORS[handle];
      return;
    }
    if (objectAtPoint(event.clientX, event.clientY) !== undefined) {
      host.rendered.style.cursor = 'move';
      return;
    }
    const edge = tableEdgeAt(event.clientX, event.clientY);
    host.rendered.style.cursor =
      edge === undefined
        ? ''
        : edge.kind === 'row'
          ? 'row-resize'
          : edge.kind === 'table'
            ? 'ew-resize'
            : 'col-resize';
  };

  const releasePointer = (): void => {
    dragging = false;
    armed = undefined;
    armedObject = undefined;
    dragSource = undefined;
    dropPos = undefined;
    owner.removeEventListener('pointermove', onPointerMove);
    owner.removeEventListener('pointerup', onPointerUp);
  };

  const inSelection = (pos: DocPos): boolean => {
    if (isCollapsed(host.selection)) return false;
    const range = rangeAsDocRange(host.selection);
    return (pos as number) > (range.start as number) && (pos as number) < (range.end as number);
  };

  const linkTargetAt = (event: PointerEvent): string | undefined => {
    const target = event.target;
    if (!(target instanceof Element)) return undefined;
    const node = target.closest(`[${ATTR.hyperlink}]`);
    if (node === null) return undefined;
    const id = node.getAttribute(ATTR.hyperlink) ?? '';
    if (id === '') return undefined;
    const model = host.session?.model;
    const resolved = model?.relationshipTarget(id);
    if (resolved === undefined) return undefined;
    return /^(https?|mailto|tel):/i.test(resolved) ? resolved : undefined;
  };

  const onPointerDown = (event: PointerEvent): void => {
    const button = buttonOf(event);
    if (button === 0 && (event.ctrlKey || event.metaKey)) {
      const url = linkTargetAt(event);
      if (url !== undefined) {
        event.preventDefault();
        owner.defaultView?.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
    }
    if (button === 0) {
      const handle = objectHandleAt(event.clientX, event.clientY);
      if (handle !== undefined) {
        startResize(handle, event);
        return;
      }
      const object = objectAtPoint(event.clientX, event.clientY);
      if (object !== undefined) {
        event.preventDefault();
        composer.focus({ preventScroll: true });
        if (selectedObject() !== object.objectId) {
          run(`${PREFIX}object.select`, { objectId: object.objectId });
        }
        paintObjectHandles();
        paintCaret();
        armedObject = { range: object.range, x: event.clientX, y: event.clientY };
        dragging = true;
        owner.addEventListener('pointermove', onPointerMove);
        owner.addEventListener('pointerup', onPointerUp);
        return;
      }
    }
    const edge = button === 0 ? tableEdgeAt(event.clientX, event.clientY) : undefined;
    if (edge !== undefined) {
      dropObjectSelection();
      startEdgeDrag(edge, event);
      return;
    }
    const hit = hitTest(event.clientX, event.clientY);
    if (hit === undefined) return;
    if (button !== 0 && inSelection(hit.pos)) return;
    if (button === 0) dropObjectSelection();
    event.preventDefault();
    composer.focus({ preventScroll: true });
    if (!event.shiftKey && inSelection(hit.pos)) {
      armed = { from: rangeAsDocRange(host.selection), x: event.clientX, y: event.clientY };
    } else if (event.shiftKey) {
      run(`${PREFIX}selection.extendTo`, { pos: hit.pos });
    } else {
      run(`${PREFIX}selection.setCaret`, { pos: hit.pos, page: hit.page });
    }
    dragging = true;
    owner.addEventListener('pointermove', onPointerMove);
    owner.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    if (armedObject !== undefined && dragSource === undefined) {
      const travelled =
        Math.abs(event.clientX - armedObject.x) + Math.abs(event.clientY - armedObject.y);
      if (travelled < DRAG_THRESHOLD_PX) return;
      dragSource = armedObject.range;
      armedObject = undefined;
      dropObjectSelection();
    }
    if (armed !== undefined && dragSource === undefined) {
      const travelled =
        Math.abs(event.clientX - armed.x) + Math.abs(event.clientY - armed.y);
      if (travelled < DRAG_THRESHOLD_PX) return;
      dragSource = armed.from;
      armed = undefined;
    }
    if (dragSource !== undefined) {
      event.preventDefault();
      const hit = hitTest(event.clientX, event.clientY);
      if (hit !== undefined) dropPos = hit.pos;
      return;
    }
    const hit = hitTest(event.clientX, event.clientY);
    if (hit === undefined) return;
    event.preventDefault();
    run(`${PREFIX}selection.extendTo`, { pos: hit.pos });
  };

  const onPointerUp = (event: PointerEvent): void => {
    const source = dragSource;
    const target = dropPos;
    const copy = event.ctrlKey || event.altKey || event.metaKey;
    releasePointer();
    if (source === undefined || target === undefined) return;
    run(`${PREFIX}clipboard.moveRange`, { from: source, to: target, copy });
  };

  const onCopy = (event: Event): void => {
    event.preventDefault();
    run(`${PREFIX}clipboard.copy`, { data: clipboardDataOf(event) });
  };

  const onCut = (event: Event): void => {
    event.preventDefault();
    run(`${PREFIX}clipboard.cut`, { data: clipboardDataOf(event) });
  };

  const onDragStart = (event: Event): void => {
    const data = dataTransferOf(event);
    if (data === undefined) return;
    run(`${PREFIX}clipboard.copy`, { data });
  };

  const onDragOver = (event: Event): void => {
    if (dataTransferOf(event) === undefined) return;
    event.preventDefault();
  };

  const insertImageFile = (data: ClipboardDataLike, at: DocPos | undefined): boolean => {
    const file = firstImageFile(data.files);
    if (file === undefined) return false;
    void (async (): Promise<void> => {
      const args = await imageArgsOf(file).catch(() => undefined);
      if (args === undefined) {
        await host.commands.execute(`${PREFIX}object.insertImage`);
        return;
      }
      if (at !== undefined) {
        await host.commands.execute(`${PREFIX}selection.setCaret`, { pos: at });
      }
      await host.commands.execute(`${PREFIX}object.insertImage`, args);
    })();
    return true;
  };

  const onDropEvent = (event: Event): void => {
    const data = dataTransferOf(event);
    if (data === undefined) return;
    event.preventDefault();
    const point = clientPointOf(event);
    const hit = point === undefined ? undefined : hitTest(point.x, point.y);
    if (insertImageFile(data, hit?.pos)) return;
    run(`${PREFIX}clipboard.paste`, hit === undefined ? { data } : { data, at: hit.pos });
  };

  const pageStep = (): number => {
    const scroller = scrollerOf();
    const height = scroller === undefined ? 0 : scroller.getBoundingClientRect().height;
    const stop = caretOf();
    const lineHeight = stop === undefined || stop.height <= 0 ? 0 : toCssPx(stop.height, host.zoom);
    if (height <= 0 || lineHeight <= 0) return 1;
    return Math.max(1, Math.floor(height / lineHeight) - 1);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && (dragSource !== undefined || armed !== undefined)) {
      event.preventDefault();
      releasePointer();
      return;
    }
    if (event.key === 'Escape' && selectedObject() !== undefined) {
      event.preventDefault();
      dropObjectSelection();
      paintCaret();
      return;
    }
    if ((event.key === 'PageDown' || event.key === 'PageUp') && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      run(`${PREFIX}selection.${event.key === 'PageDown' ? 'movePageDown' : 'movePageUp'}`, {
        lines: pageStep(),
        extend: event.shiftKey,
      });
      return;
    }
    const mac = isMacPlatform();
    for (const rule of KEY_RULES) {
      if (!matchesRule(rule, event, mac)) continue;
      event.preventDefault();
      if (CLEARING_PREFIXES.some((prefix) => rule.command.startsWith(prefix))) {
        dropObjectSelection();
        paintCaret();
      }
      run(rule.command, rule.movement === true ? { extend: event.shiftKey } : undefined);
      return;
    }
  };

  const onBeforeInput = (event: InputEvent): void => {
    if (event.inputType.startsWith('insertComposition')) return;
    event.preventDefault();
    dropObjectSelection();
    const command = INPUT_COMMANDS[event.inputType];
    if (command === undefined) return;
    if (command === `${PREFIX}edit.insertText`) {
      const text = event.data ?? '';
      if (text !== '') run(command, { text });
      return;
    }
    run(command);
  };

  const onCompositionEnd = (event: CompositionEvent): void => {
    const text = event.data ?? '';
    composer.textContent = '';
    if (text !== '') run(`${PREFIX}edit.insertText`, { text });
  };

  const onPaste = (event: ClipboardEvent): void => {
    event.preventDefault();
    dropObjectSelection();
    const data = clipboardDataOf(event);
    if (data !== undefined && insertImageFile(data, undefined)) return;
    run(`${PREFIX}clipboard.paste`, { data });
  };

  host.rendered.addEventListener('pointermove', onHover);
  host.rendered.addEventListener('pointerdown', onPointerDown);
  composer.addEventListener('keydown', onKeyDown);
  composer.addEventListener('beforeinput', onBeforeInput);
  composer.addEventListener('compositionend', onCompositionEnd);
  composer.addEventListener('paste', onPaste);
  composer.addEventListener('copy', onCopy);
  composer.addEventListener('cut', onCut);
  host.rendered.addEventListener('dragstart', onDragStart);
  host.rendered.addEventListener('dragover', onDragOver);
  host.rendered.addEventListener('drop', onDropEvent);

  paintCaret();
  paintSelection();
  paintObjectHandles();

  let caretStrikes = 0;
  const caretWatchdog = owner.defaultView?.setInterval(() => {
    if (disposed) return;
    if (owner.activeElement !== composer) {
      caretStrikes = 0;
      return;
    }
    const hidden = caret.style.display === 'none';
    const dark = blink !== undefined && Number(blink.currentTime ?? 0) >= CARET_BLINK_MS;
    caretStrikes = hidden || dark ? caretStrikes + 1 : 0;
    if (caretStrikes < 2) return;
    caretStrikes = 0;
    paintCaret();
    paintSelection();
    if (blink !== undefined) {
      blink.currentTime = 0;
      if (blink.playState === 'finished' || blink.playState === 'idle') blink.play();
    }
  }, CARET_WATCHDOG_MS);

  return {
    refresh: () => {
      paintCaret();
      paintSelection();
      paintObjectHandles();
    },
    reveal: () => {
      const painted = paintCaret();
      paintSelection();
      paintObjectHandles();
      scrollCaretIntoView(painted);
      if (blink !== undefined) blink.currentTime = 0;
    },
    focus: () => {
      composer.focus({ preventScroll: true });
    },
    dispose: () => {
      disposed = true;
      if (caretWatchdog !== undefined) owner.defaultView?.clearInterval(caretWatchdog);
      host.rendered.removeEventListener('pointermove', onHover);
      host.rendered.removeEventListener('pointerdown', onPointerDown);
      composer.removeEventListener('keydown', onKeyDown);
      composer.removeEventListener('beforeinput', onBeforeInput);
      composer.removeEventListener('compositionend', onCompositionEnd);
      composer.removeEventListener('paste', onPaste);
      composer.removeEventListener('copy', onCopy);
      composer.removeEventListener('cut', onCut);
      host.rendered.removeEventListener('dragstart', onDragStart);
      host.rendered.removeEventListener('dragover', onDragOver);
      host.rendered.removeEventListener('drop', onDropEvent);
      owner.removeEventListener('pointermove', onPointerMove);
      owner.removeEventListener('pointerup', onPointerUp);
      overlay.remove();
      composer.remove();
    },
  };
};
