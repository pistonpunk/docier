import type {
  BlockFragment,
  ObjectChild,
  LineFragment,
  LineRun,
  ObjectPlacement,
  PageFragment,
} from '../layout/index.js';
import { mp } from '../units/index.js';
import type { Frame } from './types.js';
import type { PaintScale } from './scale.js';
import { formatPx } from './scale.js';
import type { ImageRegistry } from './images.js';
import { applyStyle, positionStyle } from './style.js';
import { ATTR, box, element, geometryAt, stamp } from './dom.js';
import {
  MISSING_IMAGE_BACKGROUND,
  cssRotationOf,
  floatsByStacking,
  floatsInPage,
  pageOriginOf,
  rotationStyle,
  MISSING_IMAGE_FONT_SIZE_PX,
  MISSING_IMAGE_OUTLINE,
  MISSING_IMAGE_OUTLINE_WIDTH_PX,
  missingImageLabel,
  objectBoxOf,
} from './inline-object.js';

export interface ImageBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

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

const paintMissing = (
  container: HTMLElement,
  id: string | undefined,
  scale: PaintScale,
  object: ObjectPlacement,
): void => {
  stamp(container, { [ATTR.imageMissing]: id ?? '' });
  applyStyle(container, {
    'background-color': `var(--docier-surface-raised, ${MISSING_IMAGE_BACKGROUND})`,
    'outline-color': `var(--docier-error, ${MISSING_IMAGE_OUTLINE})`,
    'outline-offset': `-${formatPx(MISSING_IMAGE_OUTLINE_WIDTH_PX)}`,
    'outline-style': 'dashed',
    'outline-width': formatPx(MISSING_IMAGE_OUTLINE_WIDTH_PX),
  });
  const label = box('docier-image-missing-label');
  applyStyle(label, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    width: formatPx(scale.px(object.width)),
    height: formatPx(scale.px(object.height)),
    'font-family': 'var(--docier-ui-font, sans-serif)',
    'font-size': `var(--docier-ui-font-size, ${formatPx(MISSING_IMAGE_FONT_SIZE_PX)})`,
    color: `var(--docier-error, ${MISSING_IMAGE_OUTLINE})`,
    overflow: 'hidden',
    'white-space': 'pre',
  });
  label.textContent = missingImageLabel(id);
  container.appendChild(label);
};

const paintChild = (
  container: HTMLElement,
  child: ObjectChild,
  images: ImageRegistry,
  scale: PaintScale,
): void => {
  const node = element('img', 'docier-image');
  stamp(node, { [ATTR.image]: child.relationshipId ?? '' });
  const url = child.relationshipId === undefined ? undefined : images.urlFor(child.relationshipId);
  if (url === undefined) return;
  applyStyle(
    node,
    positionStyle(
      {
        left: scale.px(child.x),
        top: scale.px(child.y),
        width: scale.px(child.width),
        height: scale.px(child.height),
      },
      {
        transform: cssRotationOf(child.rotationMilliDegrees),
        'transform-origin': '50% 50%',
      },
    ),
  );
  node.setAttribute('src', url);
  node.setAttribute('alt', '');
  container.appendChild(node);
};

const paintImage = (container: HTMLElement, object: ObjectPlacement, url: string, scale: PaintScale): void => {
  const node = element('img', 'docier-image');
  stamp(node, { [ATTR.image]: object.relationshipId ?? '' });
  applyStyle(
    node,
    positionStyle(imageBoxOf(object, scale), {
      transform: cssRotationOf(object.rotationMilliDegrees),
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
    if (object.anchor !== undefined) continue;
    if (atom.source.start < run.source.start || atom.source.end > run.source.end) continue;
    const container = box('docier-object');
    stamp(container, {
      [ATTR.object]: String(atom.atomId),
      [ATTR.objectId]: object.objectId,
      [ATTR.line]: String(line.id),
    });
    applyStyle(
      container,
      positionStyle(
        geometryAt(objectBoxOf(line, run, atom), frame, scale),
        object.anchor === undefined ? {} : { ...rotationStyle(object.rotationMilliDegrees) },
      ),
    );
    if (object.relationshipId === undefined) {
      for (const child of object.children) paintChild(container, child, images, scale);
      parent.appendChild(container);
      continue;
    }
    const url = images.urlFor(object.relationshipId);
    if (url !== undefined) paintImage(container, object, url, scale);
    else paintMissing(container, object.relationshipId, scale, object);
    for (const child of object.children) paintChild(container, child, images, scale);
    parent.appendChild(container);
  }
};

export interface FloatPaintInput {
  readonly page: PageFragment;
  readonly paintText?: ((container: HTMLElement, objectId: string) => void) | undefined;
  readonly blocks: readonly BlockFragment[];
  readonly frame: Frame;
  readonly scale: PaintScale;
  readonly images: ImageRegistry;
}

export const paintFloats = (
  parent: HTMLElement,
  input: FloatPaintInput,
  behind: boolean,
): number => {
  const page = input.page;
  const origin = pageOriginOf(page);
  const floats = floatsInPage(page)
    .filter((entry) => (entry.atom.object?.anchor?.behind ?? false) === behind)
    .sort(floatsByStacking);
  for (const entry of floats) {
    const object = entry.atom.object;
    if (object === undefined) continue;
    const container = box('docier-object');
    stamp(container, {
      [ATTR.object]: String(entry.atom.atomId),
      [ATTR.objectId]: object.objectId,
      [ATTR.line]: String(entry.line.id),
    });
    applyStyle(
      container,
      positionStyle(
        geometryAt(objectBoxOf(entry.line, entry.run, entry.atom, origin), input.frame, input.scale),
        { ...rotationStyle(object.rotationMilliDegrees) },
      ),
    );
    if (object.relationshipId === undefined) {
      input.paintText?.(container, object.objectId);
    } else {
      const url = input.images.urlFor(object.relationshipId);
      if (url !== undefined) paintImage(container, object, url, input.scale);
      else paintMissing(container, object.relationshipId, input.scale, object);
    }
    for (const child of object.children) paintChild(container, child, input.images, input.scale);
    parent.appendChild(container);
  }
  return floats.length;
};
