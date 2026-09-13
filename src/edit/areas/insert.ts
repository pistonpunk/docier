import type { CommandDefinition } from '../../api/types.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { R_NAMESPACE, xml } from '../../ooxml/index.js';
import { createWElement, setWAttr } from '../../model/index.js';
import { appendRun, insertContainerAt, insertRunChildAt } from './content.js';
import { areaCommand, writingAt } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

const HYPERLINK_RELATIONSHIP = `${R_NAMESPACE}/hyperlink`;

export const HYPERLINK_STYLE = 'Hyperlink';

export interface SymbolArgs {
  readonly char?: string | undefined;
  readonly codePoint?: number | undefined;
  readonly font?: string | undefined;
}

export interface LinkArgs {
  readonly url?: string | undefined;
  readonly text?: string | undefined;
  readonly tooltip?: string | undefined;
}

export interface FieldArgs {
  readonly instruction?: string | undefined;
  readonly format?: string | undefined;
}

const DEFAULT_SYMBOL_FONT = 'Segoe UI Symbol';

interface CaretTarget {
  readonly element: XmlElement;
  readonly offset: number;
  readonly partName: string | undefined;
}

const caretOf = (host: AreaHost): CaretTarget | undefined => {
  const target = host.session.resolve(host.selection.focus);
  if (target === undefined) return undefined;
  return {
    element: target.slot.element,
    offset: target.offset,
    partName: host.session.model.story(target.slot.story)?.partName,
  };
};

export const hexOf = (args: SymbolArgs): string | undefined => {
  const point =
    args.codePoint ??
    (args.char === undefined || args.char === '' ? undefined : args.char.codePointAt(0));
  if (point === undefined || !Number.isFinite(point) || point < 0) return undefined;
  return point.toString(16).toUpperCase().padStart(4, '0');
};

const symbolSpec: AreaSpec<SymbolArgs> = {
  id: 'docier.command.insert.symbol',
  label: 'Symbol',
  category: 'insert',
  permissions: ['insert'],
  enabledIn: (_host, args) => hexOf(args ?? {}) !== undefined,
  reason: () => 'This control needs a symbol to insert',
  run: (active, args) => {
    const hex = hexOf(args);
    const target = caretOf(active);
    if (hex === undefined || target === undefined) return false;
    return writingAt(active, () =>
      insertRunChildAt(active.session.model, target.element, target.offset, (run) => {
        const symbol = createWElement(run, 'sym');
        setWAttr(symbol, 'font', args.font ?? DEFAULT_SYMBOL_FONT);
        setWAttr(symbol, 'char', hex);
        run.children.push(symbol);
      }),
    );
  },
};

const relationshipFor = (host: AreaHost, url: string, partName: string | undefined): string => {
  const pkg = host.session.model.package;
  const owner = partName ?? pkg.mainDocumentPartName;
  const existing = pkg
    .getRelationships(owner, HYPERLINK_RELATIONSHIP)
    .find((relationship) => relationship.target === url && relationship.targetMode === 'External');
  if (existing !== undefined) return existing.id;
  return pkg.addRelationship(owner, {
    type: HYPERLINK_RELATIONSHIP,
    target: url,
    targetMode: 'External',
  }).id;
};

const linkSpec: AreaSpec<LinkArgs> = {
  id: 'docier.command.insert.link',
  label: 'Hyperlink',
  category: 'insert',
  permissions: ['insert'],
  enabledIn: (_host, args) => args?.url !== undefined && args.url !== '',
  reason: () => 'This control needs a web address to link to',
  run: (active, args) => {
    const url = args.url;
    const target = caretOf(active);
    if (url === undefined || url === '' || target === undefined) return false;
    const relationshipId = relationshipFor(active, url, target.partName);
    return writingAt(active, () =>
      insertContainerAt(
        active.session.model,
        target.element,
        target.offset,
        'hyperlink',
        (container) => {
          xml.setAttribute(container, 'id', relationshipId, 'r', R_NAMESPACE);
          if (args.tooltip !== undefined) setWAttr(container, 'tooltip', args.tooltip);
          const run = appendRun(container, args.text ?? url);
          const properties = createWElement(run, 'rPr');
          const style = createWElement(properties, 'rStyle');
          setWAttr(style, 'val', HYPERLINK_STYLE);
          properties.children.push(style);
          run.children.unshift(properties);
        },
      ),
    );
  },
};

const fieldSpec = (id: string, label: string, instruction: string): AreaSpec<FieldArgs> => ({
  id,
  label,
  category: 'insert',
  permissions: ['insert'],
  run: (active, args) => {
    const target = caretOf(active);
    if (target === undefined) return false;
    const format = args.format;
    const text =
      args.instruction ??
      (format === undefined || format === '' ? instruction : `${instruction} \\@ "${format}"`);
    return writingAt(active, () =>
      insertContainerAt(active.session.model, target.element, target.offset, 'fldSimple', (container) => {
        setWAttr(container, 'instr', text);
        setWAttr(container, 'dirty', 'true');
      }),
    );
  },
});

export const insertCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<SymbolArgs>(host, symbolSpec),
  areaCommand<LinkArgs>(host, linkSpec),
  areaCommand<FieldArgs>(host, fieldSpec('docier.command.insert.pageNumber', 'Page number', 'PAGE')),
  areaCommand<FieldArgs>(host, fieldSpec('docier.command.insert.dateTime', 'Date and time', 'DATE')),
];
