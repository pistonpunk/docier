import type { DocRange, LayoutResult, PageFragment, Rect } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { objectBoxOf, pageOriginOf } from '../render/inline-object.js';
import type { EditSession } from './session.js';

export interface ObjectBox {
  readonly objectId: string;
  readonly page: number;
  readonly box: Rect;
  readonly range: DocRange;
}

export interface ObjectPoint {
  readonly x: Mp;
  readonly y: Mp;
}

interface ObjectSelection {
  readonly ids: readonly string[];
  readonly anchor: string;
}

const selections = new WeakMap<EditSession, ObjectSelection>();

export const objectSelectionOf = (session: EditSession): string | undefined =>
  selections.get(session)?.anchor;

export const objectSelectionSetOf = (session: EditSession): readonly string[] =>
  selections.get(session)?.ids ?? [];

export const selectObject = (
  session: EditSession,
  objectId: string,
  options?: { readonly additive?: boolean },
): void => {
  if (objectId === '') {
    selections.delete(session);
    return;
  }
  const current = selections.get(session);
  if (options?.additive !== true || current === undefined) {
    selections.set(session, { ids: [objectId], anchor: objectId });
    return;
  }
  if (current.ids.includes(objectId)) {
    const ids = current.ids.filter((id) => id !== objectId);
    if (ids.length === 0) {
      selections.delete(session);
      return;
    }
    selections.set(session, { ids, anchor: ids[ids.length - 1] as string });
    return;
  }
  selections.set(session, { ids: [...current.ids, objectId], anchor: objectId });
};

export const clearObjectSelection = (session: EditSession): boolean =>
  selections.delete(session);

export const resizableObjectsInPage = (page: PageFragment): readonly ObjectBox[] => {
  const found: ObjectBox[] = [];
  for (const block of page.blocks) {
    for (const line of block.lines) {
      for (const atom of line.atoms) {
        const object = atom.object;
        if (object === undefined || object.objectId === '') continue;
        if (object.relationshipId === undefined && object.children.length === 0) continue;
        const run = line.runs.find(
          (candidate) =>
            candidate.object === object ||
            (atom.source.start >= candidate.source.start &&
              atom.source.end <= candidate.source.end),
        );
        if (run === undefined) continue;
        found.push({
          objectId: object.objectId,
          page: page.index,
          box: objectBoxOf(line, run, atom, pageOriginOf(page)),
          range: atom.source,
        });
      }
    }
  }
  return found;
};

export const findObjectBox = (
  layout: LayoutResult,
  objectId: string,
): ObjectBox | undefined => {
  for (const page of layout.pages) {
    for (const candidate of resizableObjectsInPage(page)) {
      if (candidate.objectId === objectId) return candidate;
    }
  }
  return undefined;
};

const contains = (box: Rect, point: ObjectPoint): boolean =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height;

export const objectBoxAt = (
  page: PageFragment,
  point: ObjectPoint,
): ObjectBox | undefined => {
  for (const candidate of resizableObjectsInPage(page)) {
    if (candidate.box.width <= 0 || candidate.box.height <= 0) continue;
    if (contains(candidate.box, point)) return candidate;
  }
  return undefined;
};
