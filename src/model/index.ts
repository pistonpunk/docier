export type { DiagnosticCollector as DiagnosticCollectorType } from './diagnostics.js';
export { DiagnosticCollector } from './diagnostics.js';
export type {
  ModelDiagnostic,
  ModelDiagnosticCode,
  ModelDiagnosticSeverity,
} from './diagnostics.js';

export type { NodeId } from './ids.js';
export { NodeIdAllocator, asNodeId } from './ids.js';

export type { ViewFactory } from './view.js';
export { ModelNode, ViewCache } from './view.js';

export { ModelContext } from './context.js';

export {
  W,
  childElements,
  createWElement,
  hasWNamespaceAttribute,
  integerFrom,
  isOn,
  isWElement,
  needsSpacePreserve,
  prefixInScope,
  qualifiedNameOf,
  removeElement,
  removeWAttr,
  rootOf,
  setElementText,
  setWAttr,
  textOfElement,
  wAttr,
  wChild,
  wChildren,
  xmlSpaceOfElement,
} from './xml.js';

export {
  childOrderOf,
  ensureOrderedChild,
  findOrderedChild,
  findOrderedChildren,
  insertOrdered,
  insertionIndex,
  isKnownChildOf,
  removeOrderedChildren,
} from './schema-order.js';

export * from './properties/index.js';
export * from './inline/index.js';
export * from './blocks/index.js';
export * from './numbering/index.js';
export * from './styles/index.js';

export { SettingsPart } from './settings.js';
export type { CompatibilityFlags, DocumentProtectionEdit } from './settings.js';

export type { StoryKind, StoryNote, StoryOptions } from './story.js';
export { BookmarkIndex, STORY_KIND_LOCAL_NAMES, Story, storyKindForPartName, storyKindForRootName } from './story.js';

export type { LoadModelOptions, ModelParts, NoteReference } from './document.js';
export { DocumentModel } from './document.js';
