import type { InlineNode } from './nodes.js';
import {
  AlternateContent,
  Hyperlink,
  InlineContainer,
  RangeMarker,
  Run as RunView,
  SimpleField,
} from './nodes.js';

export interface LinkAnnotation {
  readonly relationshipId: string | undefined;
  readonly anchor: string | undefined;
  readonly tooltip: string | undefined;
}

export interface RunAnnotation {
  readonly link: LinkAnnotation | undefined;
  readonly commentIds: readonly number[];
}

export const NO_ANNOTATION: RunAnnotation = { link: undefined, commentIds: [] };

export const commentIdOf = (id: string | undefined): number | undefined => {
  if (id === undefined) return undefined;
  const value = Number(id);
  return Number.isFinite(value) ? value : undefined;
};

export const annotationIsEmpty = (annotation: RunAnnotation): boolean =>
  annotation.link === undefined && annotation.commentIds.length === 0;

export const annotateRuns = (inlines: readonly InlineNode[]): ReadonlyMap<RunView, RunAnnotation> => {
  const out = new Map<RunView, RunAnnotation>();
  const walk = (nodes: readonly InlineNode[], link: LinkAnnotation | undefined, open: readonly number[]): void => {
    let scoped = open;
    for (const node of nodes) {
      if (node instanceof RunView) {
        out.set(node, { link, commentIds: scoped });
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
        walk(node.children(), link, scoped);
      }
    }
  };
  walk(inlines, undefined, []);
  return out;
};
