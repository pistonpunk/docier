export type {
  LevelJustification,
  LevelSuffix,
  LevelTextSegment,
  MultiLevelType,
  NumberFormat,
  NumberingLevelOrigin,
  ResolvedNumberingLevel,
} from './level.js';
export {
  MAX_NUMBERING_LEVEL,
  NumberingLevel,
  levelReferences,
  parseLevelText,
} from './level.js';

export { AbstractNumbering } from './abstract-numbering.js';

export type { LevelOverride, NumberingSource, ParagraphNumbering } from './instance.js';
export {
  NumberingInstance,
  isNumberingRemoved,
  resolveLevel,
  resolveStart,
} from './instance.js';

export { NumberingPart } from './numbering-part.js';
