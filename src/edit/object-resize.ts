import type { Rect } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import {
  MP_PER_POINT,
  MP_PER_TWIP,
  fromCssPx,
  mp,
  mpToTwip,
  roundHalfEven,
} from '../units/index.js';

export type ObjectHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const OBJECT_HANDLES: readonly ObjectHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const HANDLE_CURSORS: Readonly<Record<ObjectHandle, string>> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

export const HANDLE_SIZE_PX = 8;

export const HANDLE_HIT_RADIUS_PX = 12;

export const RESIZE_DEAD_ZONE_PX = 3;

export const MIN_OBJECT_MP: Mp = mp(MP_PER_POINT);

export const MIN_OBJECT_TWIPS = MIN_OBJECT_MP / MP_PER_TWIP;

interface Sign {
  readonly x: number;
  readonly y: number;
}

const SIGNS: Readonly<Record<ObjectHandle, Sign>> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
};

export const handleIsCorner = (handle: ObjectHandle): boolean => {
  const sign = SIGNS[handle];
  return sign.x !== 0 && sign.y !== 0;
};

export const aspectLocked = (handle: ObjectHandle, shift: boolean): boolean =>
  handleIsCorner(handle) ? !shift : shift;

export interface ObjectResizeInput {
  readonly handle: ObjectHandle;
  readonly box: Rect;
  readonly dx: Mp;
  readonly dy: Mp;
  readonly lockAspect: boolean;
}

export interface ObjectResizeResult {
  readonly box: Rect;
  readonly scaleX: number;
  readonly scaleY: number;
}

const floorFactor = (width: number, height: number): number =>
  Math.max(
    (MIN_OBJECT_MP as number) / Math.max(1, width),
    (MIN_OBJECT_MP as number) / Math.max(1, height),
  );

export const resizeObjectBox = (input: ObjectResizeInput): ObjectResizeResult => {
  const { handle, box, lockAspect } = input;
  const sign = SIGNS[handle];
  const width = box.width as number;
  const height = box.height as number;
  let scaleX = 1;
  let scaleY = 1;
  if (lockAspect) {
    const growth =
      sign.x !== 0 && sign.y !== 0
        ? (sign.x * (input.dx as number) * width + sign.y * (input.dy as number) * height) /
          (width * width + height * height)
        : sign.x !== 0
          ? (sign.x * (input.dx as number)) / Math.max(1, width)
          : (sign.y * (input.dy as number)) / Math.max(1, height);
    const factor = Math.max(1 + growth, floorFactor(width, height));
    scaleX = factor;
    scaleY = factor;
  } else {
    if (sign.x !== 0) {
      scaleX = Math.max(
        1 + (sign.x * (input.dx as number)) / Math.max(1, width),
        (MIN_OBJECT_MP as number) / Math.max(1, width),
      );
    }
    if (sign.y !== 0) {
      scaleY = Math.max(
        1 + (sign.y * (input.dy as number)) / Math.max(1, height),
        (MIN_OBJECT_MP as number) / Math.max(1, height),
      );
    }
  }
  const nextWidth = mp(roundHalfEven(width * scaleX));
  const nextHeight = mp(roundHalfEven(height * scaleY));
  const x = sign.x < 0 ? mp(roundHalfEven(box.x + box.width - nextWidth)) : box.x;
  const y = sign.y < 0 ? mp(roundHalfEven(box.y + box.height - nextHeight)) : box.y;
  return {
    box: { x, y, width: nextWidth, height: nextHeight },
    scaleX: nextWidth / Math.max(1, width),
    scaleY: nextHeight / Math.max(1, height),
  };
};

export const transformOriginOf = (handle: ObjectHandle): string => {
  const sign = SIGNS[handle];
  return `${sign.x < 0 ? '100%' : '0%'} ${sign.y < 0 ? '100%' : '0%'}`;
};

export interface HandleBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface HandlePoint {
  readonly handle: ObjectHandle;
  readonly x: number;
  readonly y: number;
}

export const handlePointsOf = (box: HandleBox): readonly HandlePoint[] => {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const middleX = box.left + box.width / 2;
  const middleY = box.top + box.height / 2;
  return [
    { handle: 'nw', x: box.left, y: box.top },
    { handle: 'n', x: middleX, y: box.top },
    { handle: 'ne', x: right, y: box.top },
    { handle: 'e', x: right, y: middleY },
    { handle: 'se', x: right, y: bottom },
    { handle: 's', x: middleX, y: bottom },
    { handle: 'sw', x: box.left, y: bottom },
    { handle: 'w', x: box.left, y: middleY },
  ];
};

export const handleAtPoint = (
  box: HandleBox,
  x: number,
  y: number,
): ObjectHandle | undefined => {
  for (const point of handlePointsOf(box)) {
    if (Math.abs(x - point.x) > HANDLE_HIT_RADIUS_PX) continue;
    if (Math.abs(y - point.y) > HANDLE_HIT_RADIUS_PX) continue;
    return point.handle;
  }
  return undefined;
};

export interface ObjectResizeCommit {
  readonly widthTwips: number;
  readonly heightTwips: number;
}

export const commitSizeOf = (
  from: Rect,
  to: Rect,
): ObjectResizeCommit | undefined => {
  const widthTwips = Math.max(MIN_OBJECT_TWIPS, mpToTwip(to.width));
  const heightTwips = Math.max(MIN_OBJECT_TWIPS, mpToTwip(to.height));
  if (widthTwips === mpToTwip(from.width) && heightTwips === mpToTwip(from.height)) {
    return undefined;
  }
  return { widthTwips, heightTwips };
};

export interface ObjectResizeGesture {
  readonly document: Document;
  readonly handle: ObjectHandle;
  readonly box: Rect;
  readonly zoom: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly target: HTMLElement | undefined;
  readonly commit: (size: ObjectResizeCommit) => void;
}

interface PointerPoint {
  readonly x: number;
  readonly y: number;
  readonly shift: boolean;
}

const pointOf = (event: Event): PointerPoint | undefined => {
  const like = event as unknown as {
    readonly clientX?: number;
    readonly clientY?: number;
    readonly shiftKey?: boolean;
  };
  if (typeof like.clientX !== 'number' || typeof like.clientY !== 'number') return undefined;
  if (!Number.isFinite(like.clientX) || !Number.isFinite(like.clientY)) return undefined;
  return { x: like.clientX, y: like.clientY, shift: like.shiftKey === true };
};

export const startObjectResize = (gesture: ObjectResizeGesture): void => {
  const owner = gesture.document;
  const zoom = gesture.zoom === 0 ? 1 : gesture.zoom;
  const startX = gesture.clientX;
  const startY = gesture.clientY;
  let moved = false;
  let result: ObjectResizeResult | undefined = undefined;

  const preview = (next: ObjectResizeResult): void => {
    const target = gesture.target;
    if (target === undefined) return;
    target.style.setProperty('transform-origin', transformOriginOf(gesture.handle));
    target.style.setProperty(
      'transform',
      `scale(${String(next.scaleX)}, ${String(next.scaleY)})`,
    );
  };

  const detach = (): void => {
    owner.removeEventListener('pointermove', onMove);
    owner.removeEventListener('pointerup', onFinish);
    owner.removeEventListener('pointercancel', onCancel);
    owner.removeEventListener('keydown', onKey);
  };

  const clear = (): void => {
    const target = gesture.target;
    if (target === undefined) return;
    target.style.removeProperty('transform');
    target.style.removeProperty('transform-origin');
  };

  const settle = (commit: boolean): void => {
    detach();
    clear();
    if (!commit || !moved || result === undefined) return;
    const size = commitSizeOf(gesture.box, result.box);
    if (size === undefined) return;
    gesture.commit(size);
  };

  function onMove(event: Event): void {
    const point = pointOf(event);
    if (point === undefined) return;
    if (!moved) {
      const travelled = Math.abs(point.x - startX) + Math.abs(point.y - startY);
      if (travelled < RESIZE_DEAD_ZONE_PX) return;
      moved = true;
    }
    event.preventDefault();
    result = resizeObjectBox({
      handle: gesture.handle,
      box: gesture.box,
      dx: fromCssPx(point.x - startX, zoom),
      dy: fromCssPx(point.y - startY, zoom),
      lockAspect: aspectLocked(gesture.handle, point.shift),
    });
    preview(result);
  }

  function onFinish(): void {
    settle(true);
  }

  function onCancel(): void {
    settle(false);
  }

  function onKey(event: Event): void {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    settle(false);
  }

  owner.addEventListener('pointermove', onMove);
  owner.addEventListener('pointerup', onFinish);
  owner.addEventListener('pointercancel', onCancel);
  owner.addEventListener('keydown', onKey);
};
