import type { CommandDefinition, LocalizedString } from '../../api/types.js';
import { createWElement, setWAttr } from '../../model/index.js';
import type { DocumentModel } from '../../model/index.js';
import { RELATIONSHIP_TYPES } from '../../ooxml/namespaces.js';
import { createDeclaration, createDocument } from '../../ooxml/xml/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { insertRunChildAt } from './content.js';
import { areaCommand, writingAt } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

export const FOOTNOTES_PART_NAME = 'word/footnotes.xml';

const SEPARATOR_ID = -1;
const CONTINUATION_ID = 0;

const NOT_ALIGNED: LocalizedString =
  'This document lays out in a way the editing layer cannot map onto paragraphs, so footnotes are unavailable';
const NOT_IN_BODY: LocalizedString = 'Place the caret in the body to insert a footnote';

export interface NoteArgs {
  readonly text?: string | undefined;
}

interface CaretTarget {
  readonly element: XmlElement;
}

const caretOf = (host: AreaHost): CaretTarget | undefined => {
  const target = host.session.resolve(host.selection.focus);
  if (target === undefined) return undefined;
  if (host.session.index.storyAt(host.selection.focus)?.kind !== 'body') return undefined;
  return { element: target.slot.element };
};

export const footnotesRootOf = (model: DocumentModel): XmlElement | undefined => {
  const relationship = model.package.relationships.firstRelationshipOfType(
    model.mainPartName,
    RELATIONSHIP_TYPES.footnotes ?? '',
  );
  if (relationship === undefined) return undefined;
  return model.stories().find((story) => story.partName === relationship.resolvedTarget)?.element;
};

const typedNote = (root: XmlElement, type: string, id: number, localName: string): void => {
  const note = createWElement(root, 'footnote');
  note.selfClosing = false;
  setWAttr(note, 'type', type);
  setWAttr(note, 'id', String(id));
  const paragraph = createWElement(note, 'p');
  paragraph.selfClosing = false;
  const run = createWElement(paragraph, 'r');
  run.selfClosing = false;
  run.children.push(createWElement(run, localName));
  paragraph.children.push(run);
  note.children.push(paragraph);
  root.children.push(note);
};

const ensureFootnotesRoot = (model: DocumentModel): XmlElement | undefined => {
  const existing = footnotesRootOf(model);
  if (existing !== undefined) return existing;
  const root = createWElement(model.body().element, 'footnotes');
  root.selfClosing = false;
  typedNote(root, 'separator', SEPARATOR_ID, 'separator');
  typedNote(root, 'continuationSeparator', CONTINUATION_ID, 'continuationSeparator');
  const document = createDocument(createDeclaration());
  document.children.push(root);
  model.package.createDocumentPart(FOOTNOTES_PART_NAME, document, { role: 'footnotes' });
  model.package.addRelationship(model.mainPartName, {
    type: RELATIONSHIP_TYPES.footnotes ?? '',
    target: 'footnotes.xml',
    targetMode: 'Internal',
  });
  model.adoptStory('footnote', FOOTNOTES_PART_NAME, root);
  return root;
};

export const nextNoteId = (root: XmlElement): number => {
  let highest = 0;
  for (const child of root.children) {
    if (child.kind !== 'element' || child.localName !== 'footnote') continue;
    const value = Number(child.attributes.find((entry) => entry.localName === 'id')?.value ?? '');
    if (Number.isFinite(value) && value > highest) highest = value;
  }
  return highest + 1;
};

const footnoteElement = (root: XmlElement, id: number, text: string): void => {
  const note = createWElement(root, 'footnote');
  note.selfClosing = false;
  setWAttr(note, 'id', String(id));
  const paragraph = createWElement(note, 'p');
  paragraph.selfClosing = false;
  const run = createWElement(paragraph, 'r');
  run.selfClosing = false;
  const value = createWElement(run, 't');
  value.children.push({ kind: 'text', value: text, parent: value });
  run.children.push(value);
  paragraph.children.push(run);
  note.children.push(paragraph);
  root.children.push(note);
  root.selfClosing = false;
};

const footnoteSpec: AreaSpec<NoteArgs> = {
  id: 'docier.command.insert.footnote',
  label: 'Footnote',
  category: 'insert',
  permissions: ['insert'],
  enabledIn: (host) => host.session.aligned && caretOf(host) !== undefined,
  reason: (host) => (host.session.aligned ? NOT_IN_BODY : NOT_ALIGNED),
  run: (host, args) => {
    const target = caretOf(host);
    if (target === undefined) return false;
    const model = host.session.model;
    const root = ensureFootnotesRoot(model);
    if (root === undefined) return false;
    const id = nextNoteId(root);

    let inserted = false;
    host.session.changeRegions(() => {
      inserted = writingAt(host, () =>
        insertRunChildAt(model, target.element, host.session.resolve(host.selection.focus)?.offset ?? 0, (run) => {
          const reference = createWElement(run, 'footnoteReference');
          setWAttr(reference, 'id', String(id));
          run.children.push(reference);
        }),
      );
      if (inserted) footnoteElement(root, id, args?.text ?? '');
      return inserted;
    });
    if (!inserted) return false;
    model.context.forgetSubtree(target.element);
    host.session.relayout();
    return true;
  },
};

export const noteCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<NoteArgs>(host, footnoteSpec),
];
