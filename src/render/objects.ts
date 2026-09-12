import type { AtomPlacement, LineFragment, LineRun, ObjectPlacement, Rect } from '../layout/index.js';
import { mp } from '../units/index.js';
import type { Frame } from './types.js';
import type { PaintScale } from './scale.js';
import { formatNumber, formatPx } from './scale.js';
import type { ImageRegistry } from './images.js';
import { applyStyle, positionStyle } from './style.js';
import { ATTR, box, element, geometryAt, stamp } from './dom.js';

const MILLI_DEGREES_PER_DEGREE = 1000;

const MISSING_LABEL = 'missing image';

export interface ImageBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export const objectBoxOf = (line: LineFragment, run: LineRun, atom: AtomPlacement): Rect => ({
  x: atom.x,
  y: mp(line.baselineY - run.ascent),
  width: atom.object?.width ?? mp(0),
  height: atom.object?.height ?? mp(0),
});

export const imageBoxOf = (object: ObjectPlacement, scale: PaintScale): ImageBox => {
  const crop = object.crop;
  if (crop === undefined || crop.width <= 0 || crop.height <= 0) {
    return { left: 0, top: 0, width: scale.px(object.width), height: scale.px(object.height) };
  }
  const scaleX = object.width / crop.width;
  const scaleY = object.height / crop.height;
  return {
    left: -scale.px(mp(crop.x * scaleX)),
    top: -scale.px(mp(crop.y * scaleY)),
    width: scale.px(mp(object.width * scaleX)),
    height: scale.px(mp(object.height * scaleY)),
  };
};

const missingLabel = (id: string | undefined): string =>
  id === undefined ? MISSING_LABEL : `${MISSING_LABEL}: ${id}`;

const paintMissing = (
  container: HTMLElement,
  id: string | undefined,
  scale: PaintScale,
  object: ObjectPlacement,
): void => {
  stamp(container, { [ATTR.imageMissing]: id ?? '' });
  applyStyle(container, {
    'background-color': 'var(--docier-surface-raised, #ffffff)',
    'outline-color': 'var(--docier-error, #b00020)',
    'outline-offset': '-1px',
    'outline-style': 'dashed',
    'outline-width': '1px',
  });
  const label = box('docier-image-missing-label');
  applyStyle(label, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    width: formatPx(scale.px(object.width)),
    height: formatPx(scale.px(object.height)),
    'font-family': 'var(--docier-ui-font, sans-serif)',
    'font-size': 'var(--docier-ui-font-size, 12px)',
    color: 'var(--docier-error, #b00020)',
    overflow: 'hidden',
    'white-space': 'pre',
  });
  label.textContent = missingLabel(id);
  container.appendChild(label);
};

const paintImage = (container: HTMLElement, object: ObjectPlacement, url: string, scale: PaintScale): void => {
  const node = element('img', 'docier-image');
  stamp(node, { [ATTR.image]: object.relationshipId ?? '' });
  applyStyle(
    node,
    positionStyle(imageBoxOf(object, scale), {
      transform: `rotate(${formatNumber(object.rotationMilliDegrees / MILLI_DEGREES_PER_DEGREE)}deg)`,
      'transform-origin': '50% 50%',
    }),
  );
  node.setAttribute('src', url);
  node.setAttribute('alt', '');
  container.appendChild(node);
};

export interface ObjectPaintInput {
  readonly line: LineFragment;
  readonly run: LineRun;
  readonly frame: Frame;
  readonly scale: PaintScale;
  readonly images: ImageRegistry;
}

export const paintObjects = (parent: HTMLElement, input: ObjectPaintInput): void => {
  const { line, run, frame, scale, images } = input;
  if (run.object === undefined) return;
  for (const atom of line.atoms) {
    const object = atom.object;
    if (object === undefined) continue;
    if (atom.source.start < run.source.start || atom.source.end > run.source.end) continue;
    const container = box('docier-object');
    stamp(container, { [ATTR.object]: String(atom.atomId), [ATTR.line]: String(line.id) });
    applyStyle(
      container,
      positionStyle(geometryAt(objectBoxOf(line, run, atom), frame, scale)),
    );
    const url = images.urlFor(object.relationshipId);
    if (url === undefined) paintMissing(container, object.relationshipId, scale, object);
    else paintImage(container, object, url, scale);
    parent.appendChild(container);
  }
};
