import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { DocumentModel, Story } from '../model/index.js';
import { SectionProperties } from '../model/index.js';
import type { TextMeasurer } from '../measure/index.js';
import type { FontResolver } from './fonts.js';
import type { PaintRegistry } from './paint.js';
import type { Hasher } from './hash.js';
import { ingestStory } from './ingest.js';
import { buildParagraphBlock, prepareParagraphs } from './paragraph-blocks.js';
import { spaceAfterOf, spaceBeforeOf } from './paginate.js';
import { blockFragmentOf } from './finalize.js';
import type { Section } from './sections.js';
import type { PageFieldValues } from './fields.js';
import type {
  BlockFragment,
  HeaderFooterRegionKind,
  HeaderFooterVariant,
  LayoutDiagnostic,
  StoryId,
  StoryLayout,
} from './types.js';

export const HEADER_FOOTER_VARIANTS: readonly HeaderFooterVariant[] = ['default', 'first', 'even'];

export interface HeaderFooterSlot {
  readonly kind: HeaderFooterRegionKind;
  readonly variant: HeaderFooterVariant;
  readonly story: Story;
  readonly relationshipId: string | undefined;
  readonly inheritedFrom: number;
}

export interface SectionHeaderFooters {
  readonly header: Readonly<Record<HeaderFooterVariant, HeaderFooterSlot | undefined>>;
  readonly footer: Readonly<Record<HeaderFooterVariant, HeaderFooterSlot | undefined>>;
}

export interface HeaderFooterPlan {
  readonly sections: readonly SectionHeaderFooters[];
  readonly stories: readonly Story[];
}

export const resolveHeaderFooterPlan = (
  model: DocumentModel,
  sections: readonly Section[],
): HeaderFooterPlan => {
  const byPartName = new Map<string, Story>();
  for (const story of model.stories()) {
    if (story.kind === 'header' || story.kind === 'footer') byPartName.set(story.partName, story);
  }

  const slotAt = (
    sectionIndex: number,
    kind: HeaderFooterRegionKind,
    variant: HeaderFooterVariant,
  ): HeaderFooterSlot | undefined => {
    for (let index = sectionIndex; index >= 0; index -= 1) {
      const element = sections[index]?.propertiesElement;
      if (element === undefined) continue;
      const reference = SectionProperties.of(element).reference(kind, variant);
      if (reference === undefined) continue;
      const relationshipId = reference.relationshipId;
      const partName = relationshipId === undefined ? undefined : model.relationshipTarget(relationshipId);
      const story = partName === undefined ? undefined : byPartName.get(partName);
      if (story === undefined || story.kind !== kind) return undefined;
      return { kind, variant, story, relationshipId, inheritedFrom: index };
    }
    return undefined;
  };

  const stories: Story[] = [];
  const seen = new Set<string>();
  const collect = (slot: HeaderFooterSlot | undefined): void => {
    if (slot === undefined || seen.has(slot.story.id)) return;
    seen.add(slot.story.id);
    stories.push(slot.story);
  };

  const plan = sections.map((section) => {
    const header = {} as Record<HeaderFooterVariant, HeaderFooterSlot | undefined>;
    const footer = {} as Record<HeaderFooterVariant, HeaderFooterSlot | undefined>;
    for (const variant of HEADER_FOOTER_VARIANTS) {
      header[variant] = slotAt(section.index, 'header', variant);
      footer[variant] = slotAt(section.index, 'footer', variant);
      collect(header[variant]);
      collect(footer[variant]);
    }
    return { header, footer };
  });

  return { sections: plan, stories };
};

export interface RegionRequest {
  readonly model: DocumentModel;
  readonly story: Story;
  readonly page: number;
  readonly values: PageFieldValues;
  readonly x: Mp;
  readonly width: Mp;
  readonly blockIdBase: number;
  readonly lineIdBase: number;
  readonly measurer: TextMeasurer;
  readonly fonts: FontResolver;
  readonly paint: PaintRegistry;
  readonly hash: Hasher;
  readonly defaultFontFamily: string;
  readonly defaultTabStop: Mp;
  readonly diagnostics: LayoutDiagnostic[];
  readonly marks: boolean;
}

export interface RegionLayout {
  readonly height: Mp;
  readonly blocks: readonly BlockFragment[];
  readonly nextLineId: number;
}

export const layoutRegion = (request: RegionRequest): RegionLayout => {
  const ingested = ingestStory(request.model, request.story, {
    defaultFontFamily: request.defaultFontFamily,
    defaultTabStop: request.defaultTabStop,
    pageFields: request.values,
    hash: request.hash,
  });
  for (const diagnostic of ingested.diagnostics) request.diagnostics.push(diagnostic);

  const prepared = prepareParagraphs(ingested.paragraphs, {
    measurer: request.measurer,
    fonts: request.fonts,
    paint: request.paint,
    hash: request.hash,
  });

  const blocks: BlockFragment[] = [];
  let cursor = mp(0);
  let lineId = request.lineIdBase;
  let first = true;

  for (const block of ingested.blocks) {
    if (block.kind !== 'paragraph') {
      request.diagnostics.push({
        code: 'headerFooterTableNotLaidOut',
        severity: 'warning',
        message: `a table in ${request.story.kind} ${request.story.id} is not laid out by this slice`,
        docPos: undefined,
      });
      continue;
    }
    const entry = prepared[block.paragraph.index];
    if (entry === undefined) continue;
    const laid = buildParagraphBlock(entry, request.x, request.width, {
      defaultTabStop: request.defaultTabStop,
    });
    const top = mp(cursor + (first ? 0 : spaceBeforeOf(laid)));
    const result = blockFragmentOf({
      block: laid,
      id: request.blockIdBase + block.paragraph.index,
      page: request.page,
      x: request.x,
      width: request.width,
      boxTop: top,
      lineStart: 0,
      lineEnd: laid.lines.length,
      split: 'whole',
      cell: undefined,
      lineIdStart: lineId,
      collect: true,
      marks: request.marks,
    });
    lineId = result.nextLineId;
    blocks.push(result.fragment);
    cursor = mp(top + result.fragment.box.height + spaceAfterOf(laid));
    first = false;
  }

  return { height: cursor, blocks, nextLineId: lineId };
};

export const storyLayoutOf = (story: Story, blockCount: number): StoryLayout => ({
  id: story.id as StoryId,
  kind: story.kind,
  laidOut: true,
  blockCount,
});
