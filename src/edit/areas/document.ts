import type { CommandArea, CommandDefinition, LocalizedString } from '../../api/types.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { Paragraph } from '../../model/index.js';
import type { RevisionDecision } from '../index.js';
import { resolveAllRevisions, resolveRevision, revisionAt } from '../revisions.js';
import { createWElement, setWAttr } from '../../model/index.js';
import type { AreaHost, AreaSpec } from './support.js';
import { areaCommand, documentSection, DOCUMENT_INVALIDATION } from './support.js';

export interface DocumentIo {
  open(): void;
  save(): void;
  saveAs(): void;
  print(): void;
  exportDocx(): void;
  exportHtml(): void;
  exportPdf?(): void;
}

export interface DocumentAreaHost extends AreaHost {
  readonly io: DocumentIo | undefined;
}

const NO_HANDLER: LocalizedString = 'This editor was mounted without document handlers';
const NO_PAGE_BACKGROUND: LocalizedString =
  'A page colour needs a document loaded and a colour of six hexadecimal digits, or the word none to clear it';
const HOST_OWNS_PDF: LocalizedString = 'Supply an exportPdf handler to enable PDF export';

const docSpec = <A>(
  host: DocumentAreaHost,
  id: string,
  label: string,
  use: (io: DocumentIo) => void,
  available: (io: DocumentIo) => boolean,
  missing: LocalizedString,
  category: CommandArea = 'doc',
): CommandDefinition<A, void> => {
  const spec: AreaSpec<A> = {
    id,
    label,
    category,
    chrome: true,
    enabledIn: (): boolean => {
      const io = host.io;
      return io !== undefined && available(io);
    },
    reason: (): LocalizedString => missing,
    run: (): boolean => {
      const io = host.io;
      if (io === undefined) return false;
      use(io);
      return false;
    },
  };
  return areaCommand<A>(host, spec);
};

const HEX = /^[0-9a-fA-F]{6}$/;

export interface PageBackgroundArgs {
  readonly color?: string;
}

const backgroundElement = (host: AreaHost): XmlElement | undefined => {
  const root = host.session.model.body().element.parent;
  if (root === undefined) return undefined;
  return root.children.find(
    (child): child is XmlElement => child.kind === 'element' && child.localName === 'background',
  );
};

const backgroundReason = (args: PageBackgroundArgs | undefined): LocalizedString | undefined => {
  const color = args?.color;
  if (color === undefined) return 'This control needs a colour to apply';
  if (color !== 'none' && !HEX.test(color)) return 'A page colour is written as six hexadecimal digits';
  return undefined;
};

const pageBackgroundSpec: AreaSpec<PageBackgroundArgs> = {
  id: 'docier.command.doc.setPageBackground',
  label: 'Page colour',
  category: 'doc',
  permissions: ['format'],
  code: 'INAPPLICABLE',
  enabledIn: (host, args) => host.session.aligned && backgroundReason(args) === undefined,
  reason: (host, args) => {
    if (!host.session.aligned) return NO_PAGE_BACKGROUND;
    return backgroundReason(args) ?? NO_PAGE_BACKGROUND;
  },
  run: (host, args) => {
    const color = args?.color;
    if (color === undefined || (color !== 'none' && !HEX.test(color))) return false;
    const root = host.session.model.body().element.parent;
    if (root === undefined) return false;
    const changed = host.session.changeBackground(() => {
      const existing = backgroundElement(host);
      if (existing !== undefined) {
        existing.parent = undefined;
        root.children = root.children.filter((child) => child !== existing);
      }
      if (color === 'none') return;
      const background = createWElement(root, 'background');
      background.parent = root;
      const fill = createWElement(background, 'color');
      setWAttr(fill, 'val', color.toUpperCase());
      fill.parent = background;
      background.children.push(fill);
      root.children.unshift(background);
    });
    if (!changed) return false;
    host.session.relayout();
    return true;
  },
};

export interface LineNumberArgs {
  readonly countBy?: number;
  readonly start?: number;
  readonly restart?: 'newPage' | 'newSection' | 'continuous';
  readonly none?: boolean;
}

const lineNumberReason = (args: LineNumberArgs | undefined): LocalizedString | undefined => {
  if (args === undefined) return 'This control needs a line number setting to apply';
  if (args.none === true) return undefined;
  if (args.countBy === undefined || args.countBy < 1) {
    return 'This control needs how many lines to count between numbers';
  }
  return undefined;
};

const lineNumbersSpec: AreaSpec<LineNumberArgs> = {
  id: 'docier.command.doc.setLineNumbers',
  label: 'Line numbers',
  category: 'doc',
  invalidation: DOCUMENT_INVALIDATION,
  permissions: ['format'],
  enabledIn: (host, args) => host.session.aligned && lineNumberReason(args) === undefined,
  reason: (host, args) => {
    if (!host.session.aligned) return NO_PAGE_BACKGROUND;
    return lineNumberReason(args) ?? 'This command is available here';
  },
  run: (host, args) => {
    if (lineNumberReason(args) !== undefined) return false;
    const section = documentSection(host);
    if (args?.none === true) {
      if (section.lineNumbering === undefined) return false;
      section.removeLineNumbering();
      host.session.relayout();
      return true;
    }
    const countBy = args?.countBy ?? 1;
    const changed =
      section.lineNumberCountBy !== countBy ||
      section.lineNumberStart !== (args?.start ?? 1) ||
      section.lineNumberRestart !== (args?.restart ?? 'newPage');
    if (!changed) return false;
    section.setLineNumbering({
      countBy,
      start: args?.start ?? 1,
      restart: args?.restart ?? 'newPage',
    });
    host.session.relayout();
    return true;
  },
};

export interface ResolveChangeArgs {
  readonly all?: boolean;
}

const revisionReason = (host: AreaHost, args: ResolveChangeArgs | undefined): LocalizedString | undefined => {
  if (args?.all === true) return undefined;
  const target = revisionTarget(host);
  if (target === undefined) return 'The caret is not inside a tracked change';
  return undefined;
};

const revisionTarget = (host: AreaHost) => {
  const session = host.session;
  const resolved = session.resolve(session.index.clamp(host.selection.focus));
  const paragraph = Paragraph.of(session.model.context, resolved?.slot.element ?? session.model.body().element);
  return revisionAt(session.model, paragraph.element, resolved?.offset ?? 0);
};

const resolveSpec = (
  id: string,
  label: string,
  decision: RevisionDecision,
): AreaSpec<ResolveChangeArgs> => ({
  id,
  label,
  category: 'doc',
  permissions: ['format'],
  enabledIn: (host, args) => host.session.aligned && host.editable && revisionReason(host, args) === undefined,
  reason: (host, args) => {
    if (!host.session.aligned) return NO_PAGE_BACKGROUND;
    if (!host.editable) return 'The document is read-only';
    return revisionReason(host, args) ?? 'This command is available here';
  },
  run: (host, args) => {
    if (!host.editable) return false;
    const changed =
      args?.all === true
        ? resolveAllRevisions(host.session.model, decision)
        : (() => {
            const target = revisionTarget(host);
            if (target === undefined) return false;
            return resolveRevision(host.session.model, target, decision);
          })();
    if (!changed) return false;
    host.session.relayout();
    return true;
  },
});

const anyIo = (): boolean => true;
const pdfIo = (io: DocumentIo): boolean => io.exportPdf !== undefined;

export const documentCommands = (
  host: DocumentAreaHost,
): readonly CommandDefinition<never, void>[] => [
  areaCommand<PageBackgroundArgs>(host, pageBackgroundSpec),
  areaCommand<LineNumberArgs>(host, lineNumbersSpec),
  areaCommand<ResolveChangeArgs>(host, resolveSpec('docier.command.doc.acceptChange', 'Accept change', 'accept')),
  areaCommand<ResolveChangeArgs>(host, resolveSpec('docier.command.doc.rejectChange', 'Reject change', 'reject')),
  docSpec(host, 'docier.command.doc.open', 'Open', (io) => {
    io.open();
  }, anyIo, NO_HANDLER),
  docSpec(host, 'docier.command.doc.save', 'Save', (io) => {
    io.save();
  }, anyIo, NO_HANDLER),
  docSpec(host, 'docier.command.doc.saveAs', 'Save as', (io) => {
    io.saveAs();
  }, anyIo, NO_HANDLER),
  docSpec(host, 'docier.command.export.docx', 'Export as DOCX', (io) => {
    io.exportDocx();
  }, anyIo, NO_HANDLER, 'export'),
  docSpec(host, 'docier.command.export.html', 'Export as HTML', (io) => {
    io.exportHtml();
  }, anyIo, NO_HANDLER, 'export'),
  docSpec(host, 'docier.command.doc.print', 'Print', (io) => {
    io.print();
  }, anyIo, NO_HANDLER),
  docSpec(host, 'docier.command.export.pdf', 'Export as PDF', (io) => {
    io.exportPdf?.();
  }, pdfIo, HOST_OWNS_PDF, 'export'),
];
