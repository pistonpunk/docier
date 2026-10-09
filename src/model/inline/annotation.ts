import type { InlineNode } from './nodes.js';
import type { ContentControl } from '../blocks/content-control.js';
import {
  AlternateContent,
  Hyperlink,
  InlineContainer,
  RangeMarker,
  Run as RunView,
  SimpleField,
} from './nodes.js';
import { parseTokenTag } from '../../tokens/keys.js';
import type { TokenKind } from '../../tokens/types.js';

export interface LinkAnnotation {
  readonly relationshipId: string | undefined;
  readonly anchor: string | undefined;
  readonly tooltip: string | undefined;
}

export interface TokenAnnotation {
  readonly key: string;
  readonly kind: TokenKind;
  readonly placeholder: boolean;
}

export interface RunAnnotation {
  readonly link: LinkAnnotation | undefined;
  readonly commentIds: readonly number[];
  readonly token: TokenAnnotation | undefined;
}

export const NO_ANNOTATION: RunAnnotation = { link: undefined, commentIds: [], token: undefined };

export type AnnotatableChild = InlineNode | ContentControl;

const isContentControl = (node: AnnotatableChild): node is ContentControl =>
  node.inlineKind === 'contentControl';

const tokenOf = (control: ContentControl): TokenAnnotation | undefined => {
  const parsed = parseTokenTag(control.tag);
  if (parsed === undefined) return undefined;
  return { key: parsed.key, kind: parsed.kind, placeholder: control.isShowingPlaceholder };
};

export const commentIdOf = (id: string | undefined): number | undefined => {
  if (id === undefined) return undefined;
  const value = Number(id);
  return Number.isFinite(value) ? value : undefined;
};

export const annotationIsEmpty = (annotation: RunAnnotation): boolean =>
  annotation.link === undefined && annotation.commentIds.length === 0;

export const annotateRuns = (
  children: readonly AnnotatableChild[],
): ReadonlyMap<RunView, RunAnnotation> => {
  const out = new Map<RunView, RunAnnotation>();
  const walk = (
    nodes: readonly AnnotatableChild[],
    link: LinkAnnotation | undefined,
    open: readonly number[],
    token: TokenAnnotation | undefined,
  ): void => {
    let scoped = open;
    for (const node of nodes) {
      if (node instanceof RunView) {
        out.set(node, { link, commentIds: scoped, token });
        continue;
      }
      if (isContentControl(node)) {
        const nested = tokenOf(node) ?? token;
        walk(node.inlineChildren(), link, scoped, nested);
        continue;
      }
      if (node instanceof Hyperlink) {
        walk(
          node.children(),
          {
            relationshipId: node.relationshipId,
            anchor: node.anchor,
            tooltip: node.tooltip,
          },
          scoped,
          token,
        );
        continue;
      }
      if (node instanceof RangeMarker && node.markerKind.startsWith('commentRange')) {
        const id = commentIdOf(node.commentId);
        if (id === undefined) continue;
        scoped =
          node.markerKind === 'commentRangeStart'
            ? [...scoped, id]
            : scoped.filter((entry) => entry !== id);
        continue;
      }
      if (
        node instanceof InlineContainer ||
        node instanceof SimpleField ||
        node instanceof AlternateContent
      ) {
        walk(node.children(), link, scoped, token);
      }
    }
  };
  walk(children, undefined, [], undefined);
  return out;
};
