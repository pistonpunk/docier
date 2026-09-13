import type { CommandDefinition, LocalizedString } from '../../api/types.js';
import { noInvalidation } from '../../api/types.js';
import type { DocRange } from '../../layout/index.js';
import { docPos } from '../../layout/index.js';
import { Paragraph, RangeMarker, createWElement, setWAttr } from '../../model/index.js';
import type { DocumentModel } from '../../model/index.js';
import { RELATIONSHIP_TYPES } from '../../ooxml/namespaces.js';
import { createDeclaration, createDocument } from '../../ooxml/xml/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { insertionPoint } from '../mutation.js';
import { rangeAsDocRange, setSelection } from '../selection.js';
import { areaCommand, changedBy } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

export const COMMENTS_PART_NAME = 'word/comments.xml';

const NOT_ALIGNED: LocalizedString =
  'This document lays out in a way the editing layer cannot map onto paragraphs, so comments are unavailable';
const NO_TEXT: LocalizedString = 'Select the text to comment on';
const ONE_PARAGRAPH: LocalizedString =
  'This build anchors a comment inside a single paragraph, and the selection crosses a boundary';

export interface CommentArgs {
  readonly text?: string | undefined;
  readonly author?: string | undefined;
  readonly initials?: string | undefined;
  readonly date?: string | undefined;
}

export const commentsRootOf = (model: DocumentModel): XmlElement | undefined => {
  const relationship = model.package.relationships.firstRelationshipOfType(
    model.mainPartName,
    RELATIONSHIP_TYPES.comments ?? '',
  );
  if (relationship === undefined) return undefined;
  return model.stories().find((story) => story.partName === relationship.resolvedTarget)?.element;
};

const ensureCommentsRoot = (model: DocumentModel): XmlElement | undefined => {
  const existing = commentsRootOf(model);
  if (existing !== undefined) return existing;
  const root = createWElement(model.body().element, 'comments');
  root.selfClosing = false;
  const document = createDocument(createDeclaration());
  document.children.push(root);
  model.package.createDocumentPart(COMMENTS_PART_NAME, document, { role: 'comments' });
  model.package.addRelationship(model.mainPartName, {
    type: RELATIONSHIP_TYPES.comments ?? '',
    target: 'comments.xml',
    targetMode: 'Internal',
  });
  model.adoptStory('comment', COMMENTS_PART_NAME, root);
  return root;
};

export const nextCommentId = (root: XmlElement): number => {
  let highest = 0;
  for (const child of root.children) {
    if (child.kind !== 'element' || child.localName !== 'comment') continue;
    const value = Number(child.attributes.find((entry) => entry.localName === 'id')?.value ?? '');
    if (Number.isFinite(value) && value > highest) highest = value;
  }
  return highest + 1;
};

const commentElement = (root: XmlElement, id: number, args: CommentArgs | undefined): void => {
  const comment = createWElement(root, 'comment');
  comment.selfClosing = false;
  setWAttr(comment, 'id', String(id));
  setWAttr(comment, 'author', args?.author ?? 'docier');
  if (args?.initials !== undefined) setWAttr(comment, 'initials', args.initials);
  if (args?.date !== undefined) setWAttr(comment, 'date', args.date);

  const paragraph = createWElement(comment, 'p');
  paragraph.selfClosing = false;
  const run = createWElement(paragraph, 'r');
  run.selfClosing = false;
  const text = createWElement(run, 't');
  text.children.push({ kind: 'text', value: args?.text ?? '', parent: text });
  run.children.push(text);
  paragraph.children.push(run);
  comment.children.push(paragraph);
  root.children.push(comment);
  root.selfClosing = false;
};

const markerElement = (parent: XmlElement, localName: string, id: number): XmlElement => {
  const marker = createWElement(parent, localName);
  setWAttr(marker, 'id', String(id));
  return marker;
};

const referenceRun = (parent: XmlElement, id: number): XmlElement => {
  const run = createWElement(parent, 'r');
  run.selfClosing = false;
  const reference = createWElement(run, 'commentReference');
  setWAttr(reference, 'id', String(id));
  run.children.push(reference);
  return run;
};

const anchorsOf = (host: AreaHost): { readonly paragraph: XmlElement } | undefined => {
  const range = rangeAsDocRange(host.selection);
  if (range.start === range.end) return undefined;
  const start = host.session.resolve(range.start);
  const end = host.session.resolve(range.end);
  if (start === undefined || end === undefined) return undefined;
  if (start.slot.element !== end.slot.element) return undefined;
  return { paragraph: start.slot.element };
};

const commentSpec: AreaSpec<CommentArgs> = {
  id: 'docier.command.comment.create',
  label: 'New comment',
  category: 'comment',
  permissions: ['insert'],
  enabledIn: (host) => host.session.aligned && anchorsOf(host) !== undefined,
  reason: (host) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    const range = rangeAsDocRange(host.selection);
    if (range.start === range.end) return NO_TEXT;
    return ONE_PARAGRAPH;
  },
  run: (host, args) => {
    const anchors = anchorsOf(host);
    if (anchors === undefined) return false;
    const range = rangeAsDocRange(host.selection);
    const model = host.session.model;
    const paragraph = anchors.paragraph;
    const start = host.session.resolve(range.start);
    const end = host.session.resolve(range.end);
    if (start === undefined || end === undefined) return false;

    const at = insertionPoint(model, paragraph, start.offset);
    if (at === undefined) return false;
    model.context.forgetSubtree(paragraph);
    const to = insertionPoint(model, paragraph, end.offset);
    if (to === undefined || to.parent !== at.parent) return false;

    const root = ensureCommentsRoot(model);
    if (root === undefined) return false;
    const id = nextCommentId(root);

    let inserted = false;
    host.session.changeRegions(() => {
      inserted = changedBy([paragraph], () => {
        commentElement(root, id, args);
        at.parent.children.splice(to.index, 0, markerElement(at.parent, 'commentRangeEnd', id));
        at.parent.children.splice(to.index + 1, 0, referenceRun(at.parent, id));
        at.parent.children.splice(at.index, 0, markerElement(at.parent, 'commentRangeStart', id));
        at.parent.selfClosing = false;
      });
      return inserted;
    });
    if (!inserted) return false;
    model.context.forgetSubtree(paragraph);
    host.session.relayout();
    return true;
  },
};

export interface CommentSelectArgs {
  readonly id?: number | undefined;
}

const paragraphByElement = (host: AreaHost): ReadonlyMap<XmlElement, Paragraph> => {
  const out = new Map<XmlElement, Paragraph>();
  for (const paragraph of host.session.model.paragraphs()) out.set(paragraph.element, paragraph);
  return out;
};

export const commentRangeOf = (host: AreaHost, id: number): DocRange | undefined => {
  const paragraphs = paragraphByElement(host);
  for (const slot of host.session.slots()) {
    const paragraph = paragraphs.get(slot.element);
    if (paragraph === undefined) continue;
    let offset = 0;
    let from: number | undefined;
    for (const node of paragraph.inlineChildren()) {
      if (node instanceof RangeMarker && node.commentId === String(id)) {
        if (node.markerKind === 'commentRangeStart') from = offset;
        else if (node.markerKind === 'commentRangeEnd' && from !== undefined) {
          return { start: docPos((slot.start as number) + from), end: docPos((slot.start as number) + offset) };
        }
      }
      offset += node.logicalText.length;
    }
  }
  return undefined;
};

const selectSpec: AreaSpec<CommentSelectArgs> = {
  id: 'docier.command.comment.select',
  label: 'Select comment',
  category: 'comment',
  layer: 'chrome',
  chrome: true,
  undoable: false,
  invalidation: noInvalidation,
  enabledIn: (host, args) => args?.id !== undefined && commentRangeOf(host, args.id) !== undefined,
  reason: () => 'There is no comment with that id in this document',
  run: (host, args) => {
    const id = args?.id;
    if (id === undefined) return false;
    const range = commentRangeOf(host, id);
    if (range === undefined) return false;
    host.setSelection(setSelection(host.session.index, range.start, range.end), 'set');
    return true;
  },
};

export const commentCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<CommentArgs>(host, commentSpec),
  areaCommand<CommentSelectArgs>(host, selectSpec),
];
