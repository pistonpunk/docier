import type { CommandArea, CommandDefinition, LocalizedString } from '../../api/types.js';
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

const anyIo = (): boolean => true;
const pdfIo = (io: DocumentIo): boolean => io.exportPdf !== undefined;

export const documentCommands = (
  host: DocumentAreaHost,
): readonly CommandDefinition<never, void>[] => [
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
