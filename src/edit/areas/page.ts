import type { CommandDefinition } from '../../api/types.js';
import { twip } from '../../units/index.js';
import type { EighthPoint } from '../../units/index.js';
import type { PageOrientation } from '../../model/index.js';
import { areaCommand, documentSection, DOCUMENT_INVALIDATION } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

export interface MarginArgs {
  readonly side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
  readonly twips?: number | undefined;
  readonly topTwips?: number | undefined;
  readonly rightTwips?: number | undefined;
  readonly bottomTwips?: number | undefined;
  readonly leftTwips?: number | undefined;
}

export interface OrientationArgs {
  readonly orientation?: PageOrientation | undefined;
  readonly landscape?: boolean | undefined;
}

export interface PageSizeArgs {
  readonly preset?: 'letter' | 'legal' | 'a4' | undefined;
  readonly widthTwips?: number | undefined;
  readonly heightTwips?: number | undefined;
}

export interface ColumnArgs {
  readonly count?: number | undefined;
}

export interface PageBorderArgs {
  readonly none?: boolean | undefined;
  readonly style?: string | undefined;
  readonly sizeEighths?: number | undefined;
  readonly color?: string | undefined;
  readonly spaceTwips?: number | undefined;
  readonly sides?: readonly ('top' | 'left' | 'bottom' | 'right')[] | undefined;
}

const PAPER: Readonly<Record<'letter' | 'legal' | 'a4', readonly [number, number]>> = {
  letter: [12240, 15840],
  legal: [12240, 20160],
  a4: [11906, 16838],
};

const SIDES: readonly ('top' | 'left' | 'bottom' | 'right')[] = ['top', 'left', 'bottom', 'right'];

const namedMargin = (args: MarginArgs): { readonly side: 'top' | 'right' | 'bottom' | 'left'; readonly value: number } | undefined => {
  if (args.side === undefined || args.twips === undefined) return undefined;
  return { side: args.side, value: args.twips };
};

const isMarginRequest = (args: MarginArgs): boolean =>
  namedMargin(args) !== undefined ||
  args.topTwips !== undefined ||
  args.rightTwips !== undefined ||
  args.bottomTwips !== undefined ||
  args.leftTwips !== undefined;

const marginSpec = (): AreaSpec<MarginArgs> => ({
  id: 'docier.command.doc.setMargins',
  label: 'Page margins',
  category: 'doc',
  invalidation: DOCUMENT_INVALIDATION,
  permissions: ['format'],
  enabledIn: (_host, args) => args !== undefined && isMarginRequest(args),
  reason: () => 'This control needs a margin measurement to apply',
  run: (active, args) => {
    const section = documentSection(active);
    const current = section.margins;
    const named = namedMargin(args);
    const next = {
      top: twip(args.topTwips ?? (named?.side === 'top' ? named.value : current.top)),
      right: twip(args.rightTwips ?? (named?.side === 'right' ? named.value : current.right)),
      bottom: twip(args.bottomTwips ?? (named?.side === 'bottom' ? named.value : current.bottom)),
      left: twip(args.leftTwips ?? (named?.side === 'left' ? named.value : current.left)),
      header: current.header,
      footer: current.footer,
      gutter: current.gutter,
    };
    const same =
      next.top === current.top &&
      next.right === current.right &&
      next.bottom === current.bottom &&
      next.left === current.left;
    if (same) return false;
    section.margins = next;
    return true;
  },
});

const orientationSpec = (): AreaSpec<OrientationArgs> => ({
  id: 'docier.command.doc.setOrientation',
  label: 'Page orientation',
  category: 'doc',
  invalidation: DOCUMENT_INVALIDATION,
  permissions: ['format'],
  enabledIn: (_host, args) => args?.orientation !== undefined || args?.landscape !== undefined,
  reason: () => 'This control needs an orientation of portrait or landscape',
  run: (active, args) => {
    const section = documentSection(active);
    const current = section.pageSize;
    const target: PageOrientation =
      args.orientation ?? (args.landscape === true ? 'landscape' : 'portrait');
    const short = Math.min(current.width as number, current.height as number);
    const long = Math.max(current.width as number, current.height as number);
    const width = twip(target === 'landscape' ? long : short);
    const height = twip(target === 'landscape' ? short : long);
    if (
      target === current.orientation &&
      width === current.width &&
      height === current.height
    ) {
      return false;
    }
    section.pageSize = { width, height, orientation: target };
    return true;
  },
});

const pageSizeSpec = (): AreaSpec<PageSizeArgs> => ({
  id: 'docier.command.doc.setPageSize',
  label: 'Paper size',
  category: 'doc',
  invalidation: DOCUMENT_INVALIDATION,
  permissions: ['format'],
  enabledIn: (_host, args) =>
    args?.preset !== undefined ||
    (args?.widthTwips !== undefined && args?.heightTwips !== undefined),
  reason: () => 'This control needs a paper size',
  run: (active, args) => {
    const section = documentSection(active);
    const current = section.pageSize;
    const preset = args.preset === undefined ? undefined : PAPER[args.preset];
    const width = twip(args.widthTwips ?? preset?.[0] ?? (current.width as number));
    const height = twip(args.heightTwips ?? preset?.[1] ?? (current.height as number));
    const orientation: PageOrientation = width > height ? 'landscape' : 'portrait';
    if (width === current.width && height === current.height) return false;
    section.pageSize = { width, height, orientation };
    return true;
  },
});

const columnsSpec = (): AreaSpec<ColumnArgs> => ({
  id: 'docier.command.doc.setColumns',
  label: 'Columns',
  category: 'doc',
  invalidation: DOCUMENT_INVALIDATION,
  permissions: ['format'],
  enabledIn: (_host, args) => args?.count !== undefined,
  reason: () => 'This control needs a column count',
  run: (active, args) => {
    const count = args.count;
    if (count === undefined) return false;
    const section = documentSection(active);
    const next = Math.max(1, Math.min(12, Math.round(count)));
    if (section.columnCount === next) return false;
    section.columnCount = next;
    return true;
  },
});

const pageBordersSpec = (): AreaSpec<PageBorderArgs> => ({
  id: 'docier.command.doc.setPageBorders',
  label: 'Page borders',
  category: 'doc',
  invalidation: DOCUMENT_INVALIDATION,
  permissions: ['format'],
  enabledIn: (_host, args) =>
    args?.none === true || args?.style !== undefined || args?.color !== undefined,
  reason: () =>
    'This control needs a border style, a colour, or an explicit request to remove borders',
  run: (active, args) => {
    const section = documentSection(active);
    const borders = section.borders;
    const sides = args.sides ?? SIDES;
    if (args.none === true) {
      if (borders.element === undefined) return false;
      borders.remove();
      return true;
    }
    if (args.style === undefined && args.color !== undefined) {
      if (borders.element === undefined) return false;
      const colour = args.color;
      let recoloured = false;
      for (const side of sides) {
        const edge = borders.side(side);
        if (edge.style === undefined || edge.color === colour) continue;
        edge.color = colour;
        recoloured = true;
      }
      return recoloured;
    }
    const style = args.style;
    if (style === undefined) return false;
    const size = (args.sizeEighths ?? 4) as EighthPoint;
    let changed = false;
    for (const side of sides) {
      const edge = borders.side(side);
      if (
        edge.style === style &&
        edge.color === args.color &&
        edge.size === size &&
        edge.space === args.spaceTwips
      ) {
        continue;
      }
      edge.style = style;
      if (args.color === undefined) edge.color = undefined;
      else edge.color = args.color;
      edge.size = size;
      if (args.spaceTwips === undefined) edge.space = undefined;
      else edge.space = args.spaceTwips;
      changed = true;
    }
    return changed;
  },
});

export const pageCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<MarginArgs>(host, marginSpec()),
  areaCommand<OrientationArgs>(host, orientationSpec()),
  areaCommand<PageSizeArgs>(host, pageSizeSpec()),
  areaCommand<ColumnArgs>(host, columnsSpec()),
  areaCommand<PageBorderArgs>(host, pageBordersSpec()),
];
