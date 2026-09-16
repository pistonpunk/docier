import type { CommandArea, CommandDefinition, LocalizedString } from '../../api/types.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { xml } from '../../ooxml/index.js';
import { W_NAMESPACE } from '../../ooxml/namespaces.js';
import { createWElement, setWAttr } from '../../model/index.js';
import type { AreaHost, AreaSpec } from './support.js';
import { areaCommand } from './support.js';

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

const anyIo = (): boolean => true;
const pdfIo = (io: DocumentIo): boolean => io.exportPdf !== undefined;

export const documentCommands = (
  host: DocumentAreaHost,
): readonly CommandDefinition<never, void>[] => [
  areaCommand<PageBackgroundArgs>(host, pageBackgroundSpec),
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
