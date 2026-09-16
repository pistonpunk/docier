import type {
  AtomPlacement,
  BlockFragment,
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
      parent.appendChild(container);
      continue;
    }
    const url = images.urlFor(object.relationshipId);
    if (url !== undefined) paintImage(container, object, url, scale);
    else paintMissing(container, object.relationshipId, scale, object);
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

interface PlacedFloat {
  readonly line: LineFragment;
  readonly run: LineRun;
  readonly atom: AtomPlacement;
  readonly height: number;
  readonly order: number;
}

const regionBlocks = (page: PageFragment): readonly BlockFragment[] => {
  const out: BlockFragment[] = [...page.blocks];
  if (page.header !== undefined) out.push(...page.header.blocks);
  if (page.footer !== undefined) out.push(...page.footer.blocks);
  if (page.footnotes !== undefined) out.push(...page.footnotes.blocks);
  return out;
};

export const floatsInPage = (page: PageFragment): readonly PlacedFloat[] => {
  const found: PlacedFloat[] = [];
  let order = 0;
  for (const block of regionBlocks(page)) {
    for (const line of block.lines) {
      for (const atom of line.atoms) {
        const object = atom.object;
        if (object === undefined || object.anchor === undefined) continue;
        const run = line.runs.find(
          (candidate) =>
            candidate.object === object ||
            (atom.source.start >= candidate.source.start &&
              atom.source.end <= candidate.source.end),
        );
        if (run === undefined) continue;
        found.push({
          line,
          run,
          atom,
          height: object.anchor.relativeHeight,
          order,
        });
        order += 1;
      }
    }
  }
  return found;
};

const byStacking = (first: PlacedFloat, second: PlacedFloat): number =>
  first.height === second.height ? first.order - second.order : first.height - second.height;

export const paintFloats = (
  parent: HTMLElement,
  input: FloatPaintInput,
  behind: boolean,
): number => {
  const page = input.page;
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
  const floats = floatsInPage(page)
    .filter((entry) => (entry.atom.object?.anchor?.behind ?? false) === behind)
    .sort(byStacking);
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
    parent.appendChild(container);
  }
  return floats.length;
};
