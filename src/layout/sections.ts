import type { Mp } from '../units/index.js';
import { mp, twipToMp } from '../units/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import type { SectionBreakType, SectionProperties } from '../model/index.js';
import {
  DEFAULT_FOOTER_DISTANCE,
  DEFAULT_GUTTER,
  DEFAULT_HEADER_DISTANCE,
  DEFAULT_MARGIN_BOTTOM,
  DEFAULT_MARGIN_LEFT,
  DEFAULT_MARGIN_RIGHT,
  DEFAULT_MARGIN_TOP,
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  SectionProperties as SectionPropertiesClass,
} from '../model/index.js';
import type { HeaderFooterVariant, PageKind, Rect } from './types.js';
import type { LayoutDiagnostic } from './types.js';
import type { IngestedDocument, IngestedParagraph } from './ingest.js';

export interface Section {
  readonly index: number;
  readonly breakType: SectionBreakType;
  readonly firstBlock: number;
  readonly blockCount: number;
  readonly page: Rect;
  readonly contentBox: Rect;
  readonly contentBoxes: Readonly<Record<HeaderFooterVariant, Rect>>;
  readonly pageWidth: Mp;
  readonly pageHeight: Mp;
  readonly titlePage: boolean;
  readonly evenAndOddHeaders: boolean;
  readonly headerDistance: Mp;
  readonly footerDistance: Mp;
  readonly propertiesElement: XmlElement | undefined;
}

export const contentBoxFor = (section: Section, variant: HeaderFooterVariant): Rect =>
  section.contentBoxes[variant];

export const withContentBoxes = (
  section: Section,
  boxes: Readonly<Record<HeaderFooterVariant, Rect>>,
): Section => ({
  ...section,
  contentBoxes: boxes,
});

export const pageVariantOf = (
  section: Section,
  kind: PageKind,
  firstOfSection: boolean,
  evenAndOddHeaders: boolean,
): HeaderFooterVariant => {
  if (firstOfSection && section.titlePage) return 'first';
  if (evenAndOddHeaders && kind === 'even') return 'even';
  return 'default';
};

const rectOf = (x: Mp, y: Mp, width: Mp, height: Mp): Rect => ({ x, y, width, height });

const geometryOf = (properties: SectionProperties | undefined): { page: Rect; contentBox: Rect } => {
  const size = properties?.pageSize;
  const margins = properties?.margins;
  const width = twipToMp(size?.width ?? DEFAULT_PAGE_WIDTH);
  const height = twipToMp(size?.height ?? DEFAULT_PAGE_HEIGHT);
  const top = twipToMp(margins?.top ?? DEFAULT_MARGIN_TOP);
  const right = twipToMp(margins?.right ?? DEFAULT_MARGIN_RIGHT);
  const bottom = twipToMp(margins?.bottom ?? DEFAULT_MARGIN_BOTTOM);
  const left = twipToMp(margins?.left ?? DEFAULT_MARGIN_LEFT);
  const gutter = twipToMp(margins?.gutter ?? DEFAULT_GUTTER);
  return {
    page: rectOf(mp(0), mp(0), width, height),
    contentBox: rectOf(
      mp(left + gutter),
      top,
      mp(width - left - right - gutter),
      mp(height - top - bottom),
    ),
  };
};

export const buildSections = (
  ingested: IngestedDocument,
  diagnostics: LayoutDiagnostic[],
): readonly Section[] => {
  const groups: IngestedParagraph[][] = [];
  let current: IngestedParagraph[] = [];
  for (const paragraph of ingested.paragraphs) {
    current.push(paragraph);
    if (paragraph.endsSection) {
      groups.push(current);
      current = [];
    }
  }
  groups.push(current);

  const tail = ingested.bodySectionPropertiesElement;
  const sections: Section[] = [];
  let firstBlock = 0;

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index] ?? [];
    const last = group[group.length - 1];
    const element =
      index === groups.length - 1 ? tail : last?.sectionPropertiesElement ?? tail;
    const properties =
      element === undefined ? undefined : SectionPropertiesClass.of(element);
    const { page, contentBox } = geometryOf(properties);
    const breakType: SectionBreakType = index === 0 ? 'nextPage' : properties?.effectiveType ?? 'nextPage';
    const margins = properties?.margins;

    if (properties !== undefined) {
      if (properties.columnCount > 1) {
        diagnostics.push({
          code: 'columnsNotLaidOut',
          severity: 'warning',
          message: `section ${index} declares ${properties.columnCount} columns; this slice lays out a single column`,
          docPos: undefined,
        });
      }
      if (properties.verticalAlignment !== undefined) {
        diagnostics.push({
          code: 'verticalAlignmentNotLaidOut',
          severity: 'info',
          message: `section ${index} vertical alignment is ignored by this slice`,
          docPos: undefined,
        });
      }
      if (properties.documentGrid !== undefined) {
        diagnostics.push({
          code: 'documentGridNotLaidOut',
          severity: 'info',
          message: `section ${index} document grid is ignored by this slice`,
          docPos: undefined,
        });
      }
    }

    sections.push({
      index,
      breakType,
      firstBlock,
      blockCount: group.length,
      page,
      contentBox,
      contentBoxes: { default: contentBox, first: contentBox, even: contentBox },
      pageWidth: page.width,
      pageHeight: page.height,
      titlePage: properties?.titlePage === true,
      evenAndOddHeaders: properties?.evenAndOddHeaders === true,
      headerDistance: twipToMp(margins?.header ?? DEFAULT_HEADER_DISTANCE),
      footerDistance: twipToMp(margins?.footer ?? DEFAULT_FOOTER_DISTANCE),
      propertiesElement: element,
    });
    firstBlock += group.length;
  }

  return sections;
};

export const sectionOfBlock = (
  sections: readonly Section[],
  block: number,
): Section | undefined => {
  let found: Section | undefined;
  for (const section of sections) {
    if (block >= section.firstBlock && block < section.firstBlock + section.blockCount) {
      found = section;
    }
  }
  return found ?? sections[sections.length - 1];
};

export const geometryChanged = (a: Section, b: Section): boolean =>
  a.pageWidth !== b.pageWidth || a.pageHeight !== b.pageHeight;
