import type { LineFragment, LineMark, LineMarkKind } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { Frame } from './types.js';
import type { PaintScale } from './scale.js';
import { formatPx } from './scale.js';
import { applyStyle, positionStyle } from './style.js';
import { ATTR, box, geometryAt, stamp } from './dom.js';

export const MARK_GLYPHS: Readonly<Record<LineMarkKind, string>> = {
  paragraph: '¶',
  space: '·',
  tab: '→',
  break: '↵',
};

export const MARK_COLOUR = 'var(--docier-mark, #7a7a7a)';

export interface MarkPaintInput {
  readonly line: LineFragment;
  readonly frame: Frame;
  readonly scale: PaintScale;
}

const widthOf = (mark: LineMark): Mp => mp(mark.width > 0 ? mark.width : mp(0));

export const paintMarks = (parent: HTMLElement, input: MarkPaintInput): void => {
  const { line, frame, scale } = input;
  for (const mark of line.marks) {
    const node = box('docier-mark');
    stamp(node, { [ATTR.mark]: mark.kind, [ATTR.line]: String(line.id) });
    node.textContent = MARK_GLYPHS[mark.kind];
    applyStyle(node, {
      ...positionStyle(
        geometryAt(
          {
            x: mark.x,
            y: mp(line.baselineY - line.ascent),
            width: widthOf(mark),
            height: mp(line.lineHeight),
          },
          frame,
          scale,
        ),
      ),
      color: MARK_COLOUR,
      'font-size': formatPx(scale.px(mp(line.ascent + line.descent))),
      'line-height': formatPx(scale.px(mp(line.lineHeight))),
      'pointer-events': 'none',
    });
    parent.appendChild(node);
  }
};
